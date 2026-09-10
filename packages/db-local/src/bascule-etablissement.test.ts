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
import { installerGraine } from './graine.js'
import { depotEtat } from './depots/etat.js'
import { depotCatalogue } from './depots/catalogue.js'
import {
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
