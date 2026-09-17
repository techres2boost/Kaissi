/**
 * Chaque écran d'établissement vérifie-t-il le rôle de qui l'ouvre ?
 *
 * ── Le défaut que cette garde empêche de revenir ──────────────────────────
 *
 * Trois écrans — `ventes`, `tickets`, `tableau-bord` — ne vérifiaient AUCUN
 * rôle. Masquer leur entrée de menu à un cuisinier ne les fermait pas : une
 * adresse tapée à la main rendait le chiffre d'affaires du restaurant, sur un
 * écran posé au passe et visible de la salle.
 *
 * Le défaut a été corrigé, écran par écran, à la main. C'est exactement le
 * genre de correction qui revient : le prochain écran s'écrira sur le modèle
 * du précédent, et un jour quelqu'un copiera celui qui n'appelle rien — ou
 * écrira un écran neuf sans y penser. RLS ne rattrape pas : elle cloisonne
 * entre CLIENTS, elle ne dit pas quel écran un membre légitime de CE
 * restaurant peut ouvrir. Ce cloisonnement-là est applicatif, par nature.
 *
 * ── Pourquoi lire le FICHIER, et pas exécuter la page ─────────────────────
 *
 * Rendre une page serveur de Next.js hors d'une requête demande une session
 * Supabase, des cookies et un routeur. On simulerait donc tout ce qui compte,
 * et le test finirait par éprouver les simulacres. Lire le texte du module
 * répond exactement à la question posée : cet écran appelle-t-il son garde ?
 *
 * Grossier, et c'est assumé : il ne vérifie pas que l'appel est ATTEINT. Mais
 * un écran qui ne le nomme pas du tout ne peut certainement pas le franchir,
 * et c'est ce défaut-là qui s'est produit trois fois.
 *
 * ── Les exemptions se DÉCLARENT, avec leur raison ─────────────────────────
 *
 * Une liste vide serait fausse : trois chemins n'ont légitimement pas de
 * garde. Les nommer ici, avec la raison, fait de chaque exemption une
 * décision relue — et non un oubli qui ressemble à une décision.
 */

import { readFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RACINE = new URL('../app/[restaurant]', import.meta.url).pathname

/** Les chemins qui n'appellent PAS `ecranReserve`, et pourquoi. */
const EXEMPTES: Record<string, string> = {
  'page.tsx':
    'Racine : elle ne rend rien. Elle redirige chacun vers SON écran — la ' +
    'préparation sur ses lignes, l’encadrement sur les chiffres, un caissier ' +
    'sur la journée. C’est `etablissementObligatoire` qui l’autorise, et la ' +
    'destination qui porte son propre garde.',
  'preparation/page.tsx':
    'L’écran de la cuisine et du bar. C’est le SEUL que les rôles de ' +
    'préparation peuvent ouvrir : le leur refuser les laisserait sans aucun ' +
    'écran. Il ne montre aucun montant, ce qui est tout le sujet.',
  'tickets/page.tsx':
    'Ancienne adresse de « Reçus », conservée pour les favoris déjà posés. ' +
    'Elle redirige sans rien lire ; le garde est sur `recus`, où elle mène.',
}

/** Tous les `page.tsx` sous `[restaurant]`, chemin relatif à la racine. */
function ecrans(dossier = RACINE, prefixe = ''): string[] {
  const trouves: string[] = []
  for (const entree of readdirSync(dossier, { withFileTypes: true })) {
    const relatif = prefixe ? `${prefixe}/${entree.name}` : entree.name
    if (entree.isDirectory()) {
      trouves.push(...ecrans(join(dossier, entree.name), relatif))
    } else if (entree.name === 'page.tsx') {
      trouves.push(relatif)
    }
  }
  return trouves.sort()
}

describe('les écrans d’un établissement', () => {
  const tous = ecrans()

  it('sont bien trouvés — sinon cette garde ne vérifie rien', () => {
    /*
     * Un test qui balaie un dossier peut passer en ne trouvant RIEN : un
     * chemin faux, une arborescence déplacée, et il devient une décoration.
     * Le compte plancher le dit tout de suite.
     */
    expect(tous.length).toBeGreaterThan(20)
    expect(tous).toContain('tableau-bord/page.tsx')
    expect(tous).toContain('ventes/page.tsx')
  })

  it('appellent TOUS `ecranReserve`, sauf les exemptions déclarées', () => {
    const sansGarde = tous.filter((chemin) => {
      if (chemin in EXEMPTES) return false
      return !readFileSync(join(RACINE, chemin), 'utf8').includes('ecranReserve(')
    })
    expect(
      sansGarde,
      `écrans sans garde de rôle : ${sansGarde.join(' · ')}\n` +
        'Ajoutez `ecranReserve(etablissement, …)`, ou déclarez l’exemption ' +
        'et sa raison dans EXEMPTES.',
    ).toEqual([])
  })

  it('n’exempte aucun écran qui aurait entre-temps reçu son garde', () => {
    /*
     * L'autre sens, et il compte autant : une exemption qui n'a plus lieu
     * d'être est une porte ouverte dans la liste des portes ouvertes. Elle
     * n'ouvre rien aujourd'hui — l'écran a son garde — mais elle le
     * réouvrirait le jour où quelqu'un retire l'appel en croyant que la
     * liste dit vrai.
     */
    const inutiles = Object.keys(EXEMPTES).filter((chemin) => {
      if (!tous.includes(chemin)) return true
      return readFileSync(join(RACINE, chemin), 'utf8').includes('ecranReserve(')
    })
    expect(
      inutiles,
      `exemptions devenues fausses : ${inutiles.join(' · ')}`,
    ).toEqual([])
  })

  it('chaque exemption porte une RAISON, et pas trois mots', () => {
    const muettes = Object.entries(EXEMPTES)
      .filter(([, raison]) => raison.trim().length < 60)
      .map(([chemin]) => chemin)
    expect(muettes, `exemptions sans justification : ${muettes.join(' · ')}`).toEqual([])
  })
})

describe('les routes qui rendent des données', () => {
  it('l’export porte le MÊME garde que les écrans', () => {
    /*
     * « Les exports passent par le même garde » : un export sans garde
     * rendrait en CSV ce qu'on vient de retirer de l'écran — et un fichier
     * se transfère plus facilement qu'une capture.
     */
    const route = readFileSync(
      join(RACINE, 'export/[quoi]/route.ts'),
      'utf8',
    )
    expect(route).toContain('ecranReserve(')
    // Et la garde de MODULE sur la valorisation, qui n'existe que là.
    expect(route).toContain('exigerModule(')
  })
})
