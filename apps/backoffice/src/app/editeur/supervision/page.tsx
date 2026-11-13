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
 * ── Ce qu'il ne montre PAS, et le dit ─────────────────────────────────────
 *
 * Les erreurs du navigateur et les plantages de la caisse ne remontent pas
 * encore : une caisse qui plante redémarre et garde ses ventes dans son
 * outbox, ce qui se voit ici comme un terminal qui se tait puis reprend.
 * L'écran le dit en clair plutôt que d'afficher un compteur à zéro qui
 * aurait l'air d'une bonne nouvelle.
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
