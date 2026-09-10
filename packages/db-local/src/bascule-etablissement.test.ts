/**
 * Changer une caisse d'établissement — sans mélanger deux restaurants.
 *
 * PANNE OBSERVÉE. Un gérant ouvre un second restaurant au back-office, y crée
 * ses employés, puis rouvre la caisse : elle affiche toujours la carte, les
 * employés et le stock du PREMIER. On en conclut que le second restaurant
 * n'existe pas vraiment.
 *
 * L'appairage n'était pas en cause. C'est la base LOCALE qui restait celle du
 * premier établissement, et deux mécanismes indépendants la figeaient :
 *
 *   • `last_catalog_seq` est un curseur sur `change_log.seq`, un `bigserial`
 *     GLOBAL à toute la base (RÈGLE 4). Le terminal l'avait déjà avancé loin
 *     en suivant le premier restaurant ; les entrées du second, écrites
 *     avant, portent des `seq` inférieurs et n'auraient JAMAIS été tirées ;
 *   • les tables miroir contenaient encore l'ancien référentiel. Même en
 *     tirant le nouveau catalogue, on aurait obtenu l'UNION des deux — une
 *     carte mélangée, sur une caisse.
 *
 * Ces tests figent les deux, et la règle qui les accompagne : on ne bascule
 * PAS avec des ventes en attente.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { adaptateurNode } from './adaptateurs/node.js'
import type { AdaptateurSqlite } from './adaptateur.js'
import { migrer } from './migrateur.js'
import { installerGraine, DEMO_DEVICE, DEMO_ORG, DEMO_RESTO } from './graine.js'
import { depotEtat } from './depots/etat.js'
import { depotCatalogue } from './depots/catalogue.js'
import {
  dejaEnService,
  motifDeRefus,
  peutBasculer,
  reinitialiserPourAutreEtablissement,
} from './bascule-etablissement.js'

let db: AdaptateurSqlite

beforeEach(async () => {
  db = adaptateurNode(':memory:')
  await migrer(db)
  await installerGraine(db)
})

async function compter(table: string): Promise<number> {
  const ligne = await db.lireUne<{ n: number }>(`SELECT count(*) AS n FROM ${table}`)
  return ligne?.n ?? 0
}

/**
 * De l'ACTIVITÉ dans la base — et non des tables vides.
 *
 * C'est ce qui manquait, et c'est ce qui a laissé passer la panne : un
 * `DELETE` sur une table vide ne déclenche aucun `BEFORE DELETE`. Les tests
 * vidaient donc joyeusement une base où rien n'était protégé, pendant qu'en
 * clientèle la toute première bascule mourait sur le déclencheur
 * d'immuabilité de `order_events` (RÈGLE 6).
 */
async function poserUneVente(orderId = 'cmd-1'): Promise<void> {
  await db.executer(
    `INSERT INTO orders (id, organization_id, restaurant_id, device_id, status,
                         ticket_number, opened_at, updated_at)
     VALUES (?, ?, ?, ?, 'ouverte', 'P1-000001',
             '2026-08-25T19:00:00.000Z', '2026-08-25T19:00:00.000Z')`,
    [orderId, DEMO_ORG, DEMO_RESTO, DEMO_DEVICE],
  )
  for (const [i, type] of ['order.opened', 'line.added'].entries()) {
    await db.executer(
      `INSERT INTO order_events (event_id, order_id, organization_id, restaurant_id,
                                 device_id, seq_device, type, payload, client_ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, '{}', '2026-08-25T19:00:00.000Z')`,
      [`ev-${i}`, orderId, DEMO_ORG, DEMO_RESTO, DEMO_DEVICE, i + 1, type],
    )
  }
}

describe('ce que la bascule efface', () => {
  it('vide le référentiel — sinon les deux cartes se mélangent', async () => {
    const catalogue = depotCatalogue(db)
    expect(await catalogue.nombreProduits(), 'la graine pose bien des produits').toBeGreaterThan(0)
    expect(await compter('employees')).toBeGreaterThan(0)

    await reinitialiserPourAutreEtablissement(db)

    expect(await catalogue.nombreProduits()).toBe(0)
    expect(await compter('employees')).toBe(0)
    expect(await compter('categories')).toBe(0)
    expect(await compter('payment_methods')).toBe(0)
    expect(await compter('tax_rates')).toBe(0)
    // Table de LIAISON, absente du miroir : l'oublier laisserait des
    // modificateurs de l'ancien établissement collés aux nouveaux produits.
    expect(await compter('product_modifiers')).toBe(0)
  })

  it('remet les CURSEURS à zéro — le vrai piège de cette bascule', async () => {
    const etat = depotEtat(db)
    await etat.ecrire('last_catalog_seq', '4821')
    await etat.ecrire('last_event_seq', '990')

    await reinitialiserPourAutreEtablissement(db)

    /*
     * Sans cela, le catalogue du nouvel établissement — dont les `seq` sont
     * INFÉRIEURS à 4821 — ne serait jamais tiré. La caisse resterait vide, et
     * rien nulle part ne dirait pourquoi.
     */
    expect(await etat.lire('last_catalog_seq')).toBeNull()
    expect(await etat.lire('last_event_seq')).toBeNull()
  })

  it("efface l'identité reçue du serveur, et le service en cours", async () => {
    const etat = depotEtat(db)
    await etat.ecrire('device_id', 'ancien-appareil')
    await etat.ecrire('restaurant_id', 'ancien-resto')
    await etat.ecrire('ticket_prefix', 'P1')
    await etat.ecrire('shift_courant', 'un-service-ouvert')
    await etat.ecrire('employe_courant', 'une-caissiere')

    await reinitialiserPourAutreEtablissement(db)

    for (const cle of ['device_id', 'restaurant_id', 'ticket_prefix', 'shift_courant', 'employe_courant'] as const) {
      expect(await etat.lire(cle), `${cle} doit être effacée`).toBeNull()
    }
  })

  it("CONSERVE l'identifiant d'installation — et lui seul", async () => {
    const etat = depotEtat(db)
    await etat.ecrire('installation_id', 'installation-stable')

    await reinitialiserPourAutreEtablissement(db)

    /*
     * Il ne vient pas du serveur et identifie l'INSTALLATION, pas l'appareil.
     * Le garder est ce qui permet au serveur de reconnaître ce terminal s'il
     * revient un jour au premier établissement, au lieu de créer une caisse
     * de plus (migration 0021).
     */
    expect(await etat.lire('installation_id')).toBe('installation-stable')
  })

  it("vide le JOURNAL D'ÉVÉNEMENTS — malgré son déclencheur d'immuabilité", async () => {
    /*
     * ── La panne que ce test aurait dû attraper ──────────────────────────
     *
     * `order_events` est en insertion seule (RÈGLE 6, migration 001). Toute
     * bascule mourait donc sur :
     *
     *   Échec de « DELETE FROM order_events »
     *   — order_events est en insertion seule : aucune suppression
     *
     * Le déclencheur avait raison ; c'est la purge qui ignorait son
     * existence. Et aucun test ne l'a vu, parce qu'aucun ne posait de ligne.
     *
     * Garder ces événements n'était pas une option : ils portent le
     * `restaurant_id` de l'ancien établissement, et la projection les
     * ferait réapparaître dans le chiffre du nouveau.
     */
    await poserUneVente()
    expect(await compter('order_events')).toBe(2)

    await reinitialiserPourAutreEtablissement(db)

    expect(await compter('order_events')).toBe(0)
    expect(await compter('orders')).toBe(0)
  })

  it('REFERME le journal derrière elle — la RÈGLE 6 reste entière', async () => {
    await poserUneVente()
    await reinitialiserPourAutreEtablissement(db)

    // Le nouvel établissement encaisse ; son journal doit être aussi
    // inviolable que l'ancien. Un drapeau resté posé ferait de la RÈGLE 6
    // une politesse.
    await poserUneVente('cmd-2')
    await expect(db.executer('DELETE FROM order_events')).rejects.toThrow(
      /insertion seule/,
    )
    expect(await compter('order_events')).toBe(2)

    // Et le drapeau lui-même n'a rien laissé derrière lui.
    expect(await depotEtat(db).lire('purge_etablissement')).toBeNull()
  })

  it("un ÉCHEC en cours de purge ne laisse pas le journal ouvert", async () => {
    /*
     * Le drapeau et la purge vivent dans la MÊME transaction : si quoi que
     * ce soit échoue, l'annulation emporte le drapeau. Sans cela, une
     * tablette pourrait rester indéfiniment dans un état où n'importe quel
     * `DELETE` sur le journal passerait — et rien ne le dirait.
     *
     * On provoque l'échec en retirant une table que la purge attend.
     */
    await poserUneVente()
    await db.executer('DROP TABLE print_queue')

    await expect(reinitialiserPourAutreEtablissement(db)).rejects.toThrow()

    expect(await depotEtat(db).lire('purge_etablissement')).toBeNull()
    // Rien n'a été perdu : la transaction entière a été annulée.
    expect(await compter('order_events')).toBe(2)
    await expect(db.executer('DELETE FROM order_events')).rejects.toThrow(
      /insertion seule/,
    )
  })

  it('tient en UNE transaction — une base à moitié vidée serait irréparable', async () => {
    // Le contrat est celui des migrations locales : sur la tablette d'un
    // restaurant à Sfax, on ne répare pas à distance.
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./bascule-etablissement.ts', import.meta.url), 'utf8'),
    )
    expect(source).toContain('db.transaction')
  })
})

describe('quand on REFUSE de basculer', () => {
  it('laisse passer une caisse à jour', () => {
    expect(peutBasculer({ enAttente: 0, rejetes: 0 })).toBe(true)
    expect(motifDeRefus({ enAttente: 0, rejetes: 0 })).toBeNull()
  })

  it('refuse tant que des ventes ne sont pas remontées', () => {
    /*
     * Elles portent l'ANCIEN `device_id` : après la bascule, le serveur les
     * refuserait « appareil_etranger », et un rejet ne se réessaie jamais
     * tout seul. Ces ventes n'arriveraient JAMAIS.
     */
    expect(peutBasculer({ enAttente: 3, rejetes: 0 })).toBe(false)
    const motif = motifDeRefus({ enAttente: 3, rejetes: 0 })
    expect(motif).toContain('3 opération')
    // Le message doit dire QUOI FAIRE, pas seulement ce qui ne va pas.
    expect(motif).toContain('Synchronisez')
  })

  it('refuse aussi sur des opérations REJETÉES', () => {
    // Un rejet est une règle métier à arbitrer, pas une panne de réseau :
    // l'effacer reviendrait à jeter une vente que le gérant doit voir.
    expect(peutBasculer({ enAttente: 0, rejetes: 1 })).toBe(false)
    expect(motifDeRefus({ enAttente: 0, rejetes: 1 })).toContain('refusées')
  })
})

/*
 * ── « Snack Lac 2 ne marche pas en cliquant dessus » ──────────────────────
 *
 * PANNE OBSERVÉE, en clientèle. Le gérant se connecte sur une tablette qui a
 * déjà servi en local, choisit son second établissement dans la liste… et il
 * ne se passe rien. Aucun message, aucun mouvement. On en conclut que le
 * second restaurant n'existe pas.
 *
 * Deux défauts se superposaient, et le second cachait le premier :
 *
 *   • la caisse n'avait jamais été mise en service, mais la graine locale
 *     écrit `DEMO_DEVICE` dans `sync_state` : le garde-fou de bascule voyait
 *     un changement d'établissement, trouvait l'outbox pleine des ventes de
 *     démonstration, et refusait ;
 *   • ce refus était rangé dans un message que la liste des établissements
 *     ne rendait nulle part.
 *
 * Le refus était de surcroît un cul-de-sac : ces opérations portent une
 * identité d'appareil qu'aucun serveur n'a jamais délivrée. Elles ne
 * partiront JAMAIS, quel que soit le nombre de synchronisations.
 */
describe('en service, ou pas encore', () => {
  it('une caisse neuve porte le device de la DÉMONSTRATION', () => {
    expect(dejaEnService(DEMO_DEVICE)).toBe(false)
  })

  it('une caisse sans device du tout n’a jamais été en service', () => {
    expect(dejaEnService(null)).toBe(false)
    expect(dejaEnService('')).toBe(false)
    expect(dejaEnService(undefined)).toBe(false)
  })

  it('un device attribué par le SERVEUR dit « en service »', () => {
    expect(dejaEnService('0199f0aa-1111-7000-8000-abcdefabcdef')).toBe(true)
  })

  it('la graine écrit bien DEMO_DEVICE — c’est ce qui rend le test utile', async () => {
    /*
     * Si la graine cessait d'écrire cette valeur, `dejaEnService()` rendrait
     * « vrai » sur une caisse neuve et on reviendrait au cul-de-sac, sans
     * qu'aucun test ne bouge. On le vérifie donc sur la vraie graine.
     */
    // `db` sort du `beforeEach` : migrations de production + vraie graine.
    const etat = depotEtat(db)
    expect(await etat.lire('device_id')).toBe(DEMO_DEVICE)
    expect(dejaEnService(await etat.lire('device_id'))).toBe(false)
  })
})
