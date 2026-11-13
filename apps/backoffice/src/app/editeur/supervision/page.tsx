/**
 * Éditeur → Supervision : le centre d'exploitation de Kaissi.
 *
 * ── Ce qui le distingue de « Surveillance » ───────────────────────────────
 *
 * Surveillance dit l'état MAINTENANT, en mémoire du service. Supervision y
 * ajoute la MÉMOIRE : séries sur 1 h à 30 jours, incidents avec leur cycle
 * (ouvert → pris en charge → résolu), journal des événements de sécurité et
 * d'exploitation, et l'état de chaque terminal. Tout vient de
 * l'instrumentation du service (`apps/sync/src/supervision.ts`), écrite une
 * fois par période — jamais une ligne par vente (migration 0050).
 *
 * ── Les erreurs vues CHEZ LE CLIENT ───────────────────────────────────────
 *
 * Celles de la caisse arrivent à sa synchronisation suivante, dédupliquées
 * par elle (`apps/pos/src/etat/collecteur-erreurs.ts`) ; celles du
 * back-office, dès que sa page d'erreur s'affiche. Une caisse hors ligne
 * les garde : l'écran le dit, plutôt que de laisser croire qu'un compteur à
 * zéro est une bonne nouvelle.
 *
 * ── Données sensibles ─────────────────────────────────────────────────────
 *
 * Aucune adresse IP complète (tronquée au réseau), aucune adresse e-mail en
 * clair dans le journal, aucun jeton, aucun montant. L'éditeur voit la santé
 * du système, pas le chiffre d'affaires de ses clients.
 */

import { notFound } from 'next/navigation'
import { sessionObligatoire } from '../../../serveur/session.js'
import { BarreCompte } from '../../../composants/BarreCompte.js'
import { VueSupervision, FENETRES, CATEGORIES, NIVEAUX } from '../../../composants/VueSupervision.js'
import { lireSupervision } from '../actions.js'
import { traduction } from '../../../i18n/serveur.js'

export const dynamic = 'force-dynamic'

function lire(v: string | string[] | undefined): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

export default async function PageSupervision({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const t = await traduction()
  const session = await sessionObligatoire()
  const params = await searchParams
  const fenetre = FENETRES.find((f) => f.valeur === lire(params['fenetre']))?.valeur ?? '24h'
  const categorie = CATEGORIES.find((c) => c.valeur === lire(params['categorie']))?.valeur ?? null
  const niveau = NIVEAUX.find((n) => n.valeur === lire(params['niveau']))?.valeur ?? null
  const etat = await lireSupervision({ fenetre, categorie, niveau })
  if (etat === null) notFound()
  return (
    <>
      <BarreCompte session={session} />
      <VueSupervision etat={etat} fenetre={fenetre} categorie={categorie} niveau={niveau} t={t} />
    </>
  )
}
