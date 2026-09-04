/**
 * L'historique des mouvements de stock.
 *
 * ── Pourquoi cet écran manquait ───────────────────────────────────────────
 *
 * `stock_movements` enregistrait déjà tout depuis la migration 0019 : quoi,
 * combien, pourquoi, par qui, et quand. Rien n'était perdu — mais rien
 * n'était MONTRÉ. Un gérant qui constate un écart de comptage devait ouvrir
 * la base pour savoir ce qui était entré et quand, ce qu'il ne fera jamais.
 *
 * L'écran répond donc à une seule question, celle qu'on se pose devant un
 * stock qui ne tombe pas juste : qu'est-ce qui a bougé, et à cause de qui ?
 *
 * ── Ce qu'il ne montre PAS, volontairement ────────────────────────────────
 *
 * Les VENTES n'y figurent pas. Elles ne sont pas dupliquées dans
 * `stock_movements` — `order_items` fait foi, et le stock se calcule à la
 * lecture (comptage de référence + mouvements − ventes depuis ce comptage).
 * Les recopier ici doublerait la source de vérité, avec la certitude que les
 * deux finiraient par diverger. La colonne « vendu depuis le comptage » du
 * tableau de stock répond déjà à cette question-là.
 */

export interface Mouvement {
  id: string
  produit: string
  /** Signé : +12 pour une réception, −3 pour une casse. */
  delta: number
  raison: string
  note: string | null
  fournisseur: string | null
  auteur: string | null
  creeA: string
}

const LIBELLES_RAISON: Record<string, string> = {
  reception: 'Réception',
  perte: 'Perte / casse',
  // Retiré de la saisie, mais présent dans l'historique : des lignes
  // existantes le portent, et un libellé absent afficherait un code brut.
  correction: 'Correction',
}

/**
 * Date et heure, séparées.
 *
 * La demande distinguait « quand les articles sont entrés » et un horodatage
 * « pour suivre ». Ce sont bien deux lectures différentes du même instant :
 * on trie et on regroupe par JOUR, mais on rapproche deux réceptions du même
 * après-midi par l'HEURE. Les afficher collés dans une seule colonne oblige
 * à lire toute la chaîne pour trouver l'une ou l'autre.
 */
function dateEtHeure(iso: string): { jour: string; heure: string } {
  const d = new Date(iso)
  return {
    jour: d.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }),
    heure: d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
  }
}

export function HistoriqueStock({ mouvements }: { mouvements: Mouvement[] }) {
  if (mouvements.length === 0) {
    return (
      <section className="bloc">
        <h2>Historique des mouvements</h2>
        <p className="vide">
          Aucun mouvement manuel enregistré. Les réceptions et les pertes
          saisies plus haut apparaîtront ici.
        </p>
      </section>
    )
  }

  return (
    <section className="bloc">
      <h2>Historique des mouvements</h2>
      <p className="indication">
        Les <strong>ventes n’y figurent pas</strong> : elles ne sont pas
        recopiées ici, le stock les déduit directement des commandes. Cette
        liste montre ce qui est entré et sorti à la main.
      </p>
      <div className="tableau-defilant">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Heure</th>
              <th>Produit</th>
              <th className="nombre">Mouvement</th>
              <th>Motif</th>
              <th>Fournisseur</th>
              <th>Note</th>
              <th>Par</th>
            </tr>
          </thead>
          <tbody>
            {mouvements.map((m) => {
              const { jour, heure } = dateEtHeure(m.creeA)
              return (
                <tr key={m.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{jour}</td>
                  <td className="detail" style={{ whiteSpace: 'nowrap' }}>
                    {heure}
                  </td>
                  <td>{m.produit}</td>
                  {/*
                    Le SIGNE est ce qu'on lit en premier : « +12 » et « −3 »
                    doivent se distinguer sans lire le motif. Un « 12 » nu
                    obligerait à croiser deux colonnes pour savoir si le stock
                    a monté ou baissé.
                  */}
                  <td className={`nombre ${m.delta < 0 ? 'ecart negatif' : ''}`}>
                    {m.delta > 0 ? `+${m.delta}` : m.delta}
                  </td>
                  <td>{LIBELLES_RAISON[m.raison] ?? m.raison}</td>
                  <td>{m.fournisseur ?? <span className="detail">—</span>}</td>
                  <td className="detail">{m.note ?? '—'}</td>
                  <td className="detail">{m.auteur ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
