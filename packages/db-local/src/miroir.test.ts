/**
 * Le miroir du référentiel — et surtout le PIN.
 *
 * PANNE OBSERVÉE. Un gérant réinitialise le code PIN d'une caissière au
 * back-office. Le message dit « Code PIN réinitialisé ». Sur la tablette,
 * l'ANCIEN code continue de fonctionner, et le nouveau est refusé. Rien ne
 * le signale : la caisse affiche « à jour », et elle l'est — pour tout sauf
 * ça.
 *
 * Le chemin complet fait quatre sauts : le back-office écrit `users.pin_hash`,
 * un déclencheur Postgres journalise une ligne par établissement, la tablette
 * tire cette page, et ce fichier-ci l'applique. Les trois premiers sont
 * couverts par les tests de synchronisation, contre un vrai PostgreSQL. Le
 * quatrième ne l'était par RIEN : il vivait au milieu du branchement réseau
 * du POS, où aucun test ne l'atteignait sans monter un serveur.
 *
 * C'est exactement le genre d'endroit où une régression ne se voit qu'en
 * clientèle — et où elle se traduit par « un employé parti la semaine
 * dernière entre encore dans la caisse ».
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { configEtablissement, hacherPin } from '@kaissi/domain'
import { adaptateurNode } from './adaptateurs/node.js'
import type { AdaptateurSqlite } from './adaptateur.js'
import { migrer } from './migrateur.js'
import { installerGraine, DEMO_ORG, DEMO_RESTO } from './graine.js'
import { appliquerMiroir, type ChangementMiroir } from './miroir.js'
import { depotEmployes } from './depots/employes.js'
import { depotCatalogue } from './depots/catalogue.js'

/** Salma Trabelsi, caissière du jeu de démonstration. PIN d'origine : 2468. */
const SALMA = '01930000-0000-7000-8000-000000000701'
const PIZZA = '01930000-0000-7000-8000-000000000201'
/** TVA 19 % du jeu de démonstration — un identifiant RÉEL, pas un UUID inventé. */
const TVA_19 = '01930000-0000-7000-8000-000000000010'

let db: AdaptateurSqlite
let seq = 0

beforeEach(async () => {
  db = adaptateurNode(':memory:')
  await migrer(db)
  await installerGraine(db)
  seq = 0
})

/** Une page de changements, telle que `change_log` la descend. */
function changement(
  entite: string,
  entiteId: string,
  donnees: Record<string, unknown> | null,
  operation = 'update',
): ChangementMiroir {
  seq += 1
  return { seq, entite, entiteId, operation, donnees }
}

/** La charge utile « employees », à la forme exacte du déclencheur 0011. */
function employe(surcharges: Record<string, unknown> = {}) {
  return {
    id: SALMA,
    organization_id: DEMO_ORG,
    restaurant_id: DEMO_RESTO,
    full_name: 'Salma Trabelsi',
    role: 'caissier',
    pin_hash: hacherPin('2468'),
    permissions: {},
    is_active: 1,
    archived_at: null,
    ...surcharges,
  }
}

describe('un PIN réinitialisé prend effet sur la tablette', () => {
  it('accepte le NOUVEAU code, et refuse l’ancien', async () => {
    const employes = depotEmployes(db)
    // L'état de départ : le PIN de la graine fonctionne.
    expect(await employes.verifier(SALMA, '2468')).not.toBeNull()

    await appliquerMiroir(db, [
      changement('employees', SALMA, employe({ pin_hash: hacherPin('7391') })),
    ])

    expect(await employes.verifier(SALMA, '7391')).not.toBeNull()
    // LE point du test. Un ancien code qui continue de marcher, c'est un
    // employé parti qui entre encore dans la caisse.
    expect(await employes.verifier(SALMA, '2468')).toBeNull()
  })

  it('ne se laisse pas contourner par la recherche PAR PIN', async () => {
    // La prise de poste peut se faire sans choisir son nom : on tape le code,
    // et la caisse retrouve qui c'est. Ce chemin-là balaie TOUS les employés
    // — il doit refuser l'ancien code aussi.
    const employes = depotEmployes(db)
    await appliquerMiroir(db, [
      changement('employees', SALMA, employe({ pin_hash: hacherPin('7391') })),
    ])
    expect((await employes.parPin('7391'))?.id).toBe(SALMA)
    expect(await employes.parPin('2468')).toBeNull()
  })

  it('une suspension retire de la prise de poste sans effacer la personne', async () => {
    const employes = depotEmployes(db)
    await appliquerMiroir(db, [changement('employees', SALMA, employe({ is_active: 0 }))])

    expect(await employes.verifier(SALMA, '2468')).toBeNull()
    expect((await employes.actifs()).some((e) => e.id === SALMA)).toBe(false)
    // La ligne RESTE : les commandes déjà passées à son nom doivent rester
    // lisibles. Une suspension n'efface jamais rien.
    const reste = await db.lireUne<{ n: number }>(
      'SELECT count(*) AS n FROM employees WHERE id = ?',
      [SALMA],
    )
    expect(reste?.n).toBe(1)
  })

  it('une réactivation la remet, avec son PIN du moment', async () => {
    const employes = depotEmployes(db)
    await appliquerMiroir(db, [changement('employees', SALMA, employe({ is_active: 0 }))])
    await appliquerMiroir(db, [
      changement('employees', SALMA, employe({ is_active: 1, pin_hash: hacherPin('5150') })),
    ])
    expect(await employes.verifier(SALMA, '5150')).not.toBeNull()
    expect(await employes.verifier(SALMA, '2468')).toBeNull()
  })
})

describe('le miroir recopie sans raisonner', () => {
  it('applique un retrait de la carte décidé par le SERVEUR', async () => {
    // RÈGLE : c'est le serveur qui bascule `is_available`, jamais la
    // tablette. La caisse ne fait qu'appliquer.
    await appliquerMiroir(db, [
      changement('products', PIZZA, {
        id: PIZZA,
        is_available: false,
        unavailable_reason: 'stock',
      }),
    ])
    const ligne = await db.lireUne<{ is_available: number; unavailable_reason: string }>(
      'SELECT is_available, unavailable_reason FROM products WHERE id = ?',
      [PIZZA],
    )
    expect(ligne?.is_available).toBe(0)
    expect(ligne?.unavailable_reason).toBe('stock')
  })

  it('n’écrase QUE les colonnes reçues', async () => {
    // Le déclencheur `products` n'envoie parfois qu'une partie des colonnes.
    // Écraser les autres par nul viderait le nom d'un produit à chaque
    // changement de disponibilité.
    const avant = await db.lireUne<{ name: string }>(
      'SELECT name FROM products WHERE id = ?',
      [PIZZA],
    )
    await appliquerMiroir(db, [changement('products', PIZZA, { id: PIZZA, is_available: false })])
    const apres = await db.lireUne<{ name: string }>(
      'SELECT name FROM products WHERE id = ?',
      [PIZZA],
    )
    expect(apres?.name).toBe(avant?.name)
  })

  it('ignore une entité que cette version ne connaît pas encore', async () => {
    // Support N−2 : un serveur plus récent peut journaliser des tables que
    // cette application n'a pas. Les ignorer est la bonne réponse — planter
    // bloquerait la synchronisation de TOUT le reste, encaissements compris.
    await expect(
      appliquerMiroir(db, [
        changement('loyalty_tiers', 'peu-importe', { id: 'x', name: 'Or' }),
      ]),
    ).resolves.toBe(0)
  })

  it('ignore une colonne que ce schéma local ne connaît pas encore', async () => {
    // Même raison, un cran plus fin : le serveur peut ajouter une colonne
    // avant que la tablette ne soit mise à jour.
    await appliquerMiroir(db, [
      changement('products', PIZZA, {
        id: PIZZA,
        is_available: false,
        calories_par_portion: 890,
      }),
    ])
    const ligne = await db.lireUne<{ is_available: number }>(
      'SELECT is_available FROM products WHERE id = ?',
      [PIZZA],
    )
    expect(ligne?.is_available).toBe(0)
  })

  it('applique une réduction du référentiel, clé « id »', async () => {
    const id = '01a00000-0000-7000-8000-0000000009f1'
    await appliquerMiroir(db, [
      changement(
        'discounts',
        id,
        {
          id,
          organization_id: DEMO_ORG,
          restaurant_id: DEMO_RESTO,
          name: 'Fête nationale',
          kind: 'pourcentage',
          value_bp: 1500,
          amount_millimes: null,
          position: 9,
          archived_at: null,
        },
        'insert',
      ),
    ])
    const proposees = await depotCatalogue(db).reductions()
    expect(proposees.map((r) => r.nom)).toContain('Fête nationale')
  })

  it('archive une réduction sans la supprimer', async () => {
    const avant = await depotCatalogue(db).reductions()
    const cible = avant[0]!
    await appliquerMiroir(db, [
      changement('discounts', cible.id, {
        id: cible.id,
        archived_at: '2026-09-07T10:00:00.000Z',
      }),
    ])
    const apres = await depotCatalogue(db).reductions()
    expect(apres.some((r) => r.id === cible.id)).toBe(false)
    const ligne = await db.lireUne<{ n: number }>(
      'SELECT count(*) AS n FROM discounts WHERE id = ?',
      [cible.id],
    )
    expect(ligne?.n).toBe(1)
  })

  it('« prêt » est identifié par la COMMANDE, pas par une ligne', async () => {
    // `kitchen_ready` n'a pas de colonne `id` : sa clé est `order_id`. Se
    // tromper de clé créerait une ligne par pull, et le badge ne
    // s'éteindrait jamais.
    const commande = '01a00000-0000-7000-8000-0000000009c1'
    const marqueur = (cleared: string | null) => ({
      order_id: commande,
      organization_id: DEMO_ORG,
      restaurant_id: DEMO_RESTO,
      ready_at: '2026-09-07T10:00:00.000Z',
      cleared_at: cleared,
    })
    await appliquerMiroir(db, [
      changement('kitchen_ready', commande, marqueur(null), 'insert'),
    ])
    await appliquerMiroir(db, [
      changement('kitchen_ready', commande, marqueur('2026-09-07T10:05:00.000Z')),
    ])
    const lignes = await db.lire<{ cleared_at: string | null }>(
      'SELECT cleared_at FROM kitchen_ready WHERE order_id = ?',
      [commande],
    )
    expect(lignes).toHaveLength(1)
    expect(lignes[0]?.cleared_at).not.toBeNull()
  })

  it('une suppression retire la ligne locale', async () => {
    await appliquerMiroir(db, [changement('products', PIZZA, null, 'delete')])
    const ligne = await db.lireUne<{ n: number }>(
      'SELECT count(*) AS n FROM products WHERE id = ?',
      [PIZZA],
    )
    expect(ligne?.n).toBe(0)
  })
})

/*
 * ── Les OPTIONS DE RESTAURATION arrivent-elles jusqu'à la caisse ? ─────────
 *
 * Le chemin complet fait quatre sauts, comme celui du PIN : le back-office
 * écrit `restaurants`, le déclencheur `restaurants_change_log` (0035)
 * journalise, la tablette tire la page, et `appliquerMiroir` l'applique.
 *
 * `apps/sync/test/options-de-restauration.test.ts` couvre les trois premiers
 * contre un vrai PostgreSQL. Le quatrième ne l'est que par ici — et il tient
 * à une liste de chaînes dans `TABLES_MIROIR`, où une colonne oubliée ne
 * produit AUCUNE erreur : la ligne est simplement écrite sans elle, la caisse
 * calcule sans service, et le total du ticket cesse de valoir celui du
 * back-office. Rien ne le dit.
 */
describe('les options de restauration descendent jusqu’à la base locale', () => {
  /** La charge utile « restaurants », à la forme de `to_jsonb(new)`. */
  const etablissement = (surcharges: Record<string, unknown> = {}) => ({
    id: DEMO_RESTO,
    organization_id: DEMO_ORG,
    name: 'Snack Lac 1',
    timezone: 'Africa/Tunis',
    address: '12 rue du Lac',
    phone: '+216 71 000 000',
    fiscal_id: null,
    receipt_footer: null,
    // Postgres rend un vrai booléen ; SQLite n'en a pas. C'est `normaliser()`
    // qui convertit, et ce test le vérifie en passant `true`, pas 1.
    service_taxable: false,
    service_rate_bp: 0,
    service_tax_rate_id: null,
    stamp_duty_millimes: 0,
    ...surcharges,
  })

  it('écrit les quatre colonnes que le calcul du total lit', async () => {
    await appliquerMiroir(db, [
      changement(
        'restaurants',
        DEMO_RESTO,
        etablissement({
          service_rate_bp: 1000,
          service_taxable: true,
          service_tax_rate_id: TVA_19,
          stamp_duty_millimes: 600,
        }),
      ),
    ])

    const ligne = await db.lireUne<{
      service_rate_bp: number
      service_taxable: number
      service_tax_rate_id: string | null
      stamp_duty_millimes: number
    }>(
      `SELECT service_rate_bp, service_taxable, service_tax_rate_id,
              stamp_duty_millimes FROM restaurants WHERE id = ?`,
      [DEMO_RESTO],
    )

    expect(ligne?.service_rate_bp).toBe(1000)
    // Le booléen de Postgres est devenu un entier SQLite. Sans `normaliser()`,
    // l'écriture échouerait — et la page ENTIÈRE du catalogue serait annulée.
    expect(ligne?.service_taxable).toBe(1)
    expect(ligne?.service_tax_rate_id).toBe(TVA_19)
    expect(ligne?.stamp_duty_millimes).toBe(600)
  })

  it('la caisse en tire la MÊME configuration que le serveur', async () => {
    /*
     * On ne vérifie pas seulement que les colonnes sont écrites : on refait le
     * geste du POS, `configEtablissement` sur ce qu'il vient de lire. C'est ce
     * qui relie le miroir au TOTAL — sans cela, le test dirait « la colonne
     * est là » sans rien dire de ce qu'elle produit.
     */
    await appliquerMiroir(db, [
      changement(
        'restaurants',
        DEMO_RESTO,
        etablissement({ service_rate_bp: 1000, stamp_duty_millimes: 600 }),
      ),
    ])
    const l = await db.lireUne<{
      service_rate_bp: number
      service_taxable: number
      service_tax_rate_id: string | null
      stamp_duty_millimes: number
    }>(
      `SELECT service_rate_bp, service_taxable, service_tax_rate_id,
              stamp_duty_millimes FROM restaurants WHERE id = ?`,
      [DEMO_RESTO],
    )

    const config = configEtablissement([], {
      tauxServiceBp: l?.service_rate_bp ?? 0,
      serviceTaxable: Boolean(l?.service_taxable),
      serviceTauxTaxeId: l?.service_tax_rate_id ?? null,
      timbreMillimes: l?.stamp_duty_millimes ?? 0,
    })

    expect(config.service?.tauxBp).toBe(1000)
    expect(config.timbreFiscalMillimes).toBe(600)
  })

  it('un service à ZÉRO reste ABSENT, et ne pose aucune ligne sur le ticket', async () => {
    // La graine n'a pas d'options : c'est l'état d'un restaurant ordinaire, et
    // il ne doit produire ni « Service 0,000 » ni « Timbre 0,000 ».
    const config = configEtablissement([], {
      tauxServiceBp: 0,
      serviceTaxable: false,
      serviceTauxTaxeId: null,
      timbreMillimes: 0,
    })
    expect(config.service).toBeUndefined()
    expect(config.timbreFiscalMillimes).toBeUndefined()
  })
})
