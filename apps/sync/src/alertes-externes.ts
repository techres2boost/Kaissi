/**
 * Les alertes qui SORTENT du service — sur un téléphone, pas sur un écran.
 *
 * ── Le trou que cela bouche ───────────────────────────────────────────────
 *
 * Le centre de supervision ouvre des incidents, mais il faut le regarder :
 * une panne à 21 h un samedi se découvrait par l'appel d'un restaurateur.
 * Ici, l'ouverture d'un incident (et sa résolution) part vers un WEBHOOK —
 * Telegram, Slack, Discord, Google Chat, Mattermost : tous lisent un champ
 * `text` (Discord, `content` — les deux sont envoyés).
 *
 * ── Ce que cela ne coûte pas ──────────────────────────────────────────────
 *
 * Aucune requête en temps normal : on n'envoie qu'à une TRANSITION
 * d'incident, jamais à chaque période où il est revu. Aucune lecture de base :
 * la transition est rendue par l'écriture de la période elle-même. Et un
 * PLAFOND par heure : une base qui oscille autour d'un seuil ne transforme
 * pas le téléphone d'astreinte en sirène — on coupe une alerte qui sonne
 * trop, et le jour où elle compte, elle est coupée.
 *
 * ── Ce qui n'en sort jamais ───────────────────────────────────────────────
 *
 * Le sujet et le constat de l'incident, déjà nettoyés par la supervision :
 * aucune donnée de vente, aucun nom de client, aucune adresse complète.
 * L'adresse du webhook est un SECRET (elle porte le jeton du canal) : elle
 * n'apparaît dans aucun journal, aucun message d'erreur, aucune réponse.
 *
 * ── Ce qu'il ne remplace pas ──────────────────────────────────────────────
 *
 * Si le service est MORT, il ne prévient personne. C'est le rôle d'une sonde
 * EXTERNE sur `/sante` (docs/deploiement.md § 6 ter) — les deux ensemble.
 */

export type TransitionIncident = 'ouvert' | 'aggrave' | 'resolu'

export interface ChangementIncident {
  readonly transition: TransitionIncident
  readonly id: string
  readonly cle: string
  readonly niveau: string
  readonly sujet: string
  readonly message: string
}

export interface Notificateur {
  /** Rend `true` si le message est parti, `false` s'il a été retenu ou a échoué. */
  envoyer(changement: ChangementIncident): Promise<ResultatEnvoi>
}

export type ResultatEnvoi =
  | { readonly envoye: true }
  | { readonly envoye: false; readonly raison: 'niveau' | 'plafond' | 'echec'; readonly detail?: string }

export interface OptionsWebhook {
  /** Adresse COMPLÈTE du webhook — secrète. */
  readonly url: string
  /** Lien vers le centre de supervision, ajouté au message. */
  readonly lien?: string | null
  /** `critique` (défaut) : seuls les incidents critiques sonnent. */
  readonly niveauMinimum?: 'critique' | 'attention'
  /** Messages au plus par heure glissante (défaut 12). */
  readonly plafondParHeure?: number
  readonly delaiMs?: number
  readonly fetch?: typeof fetch
  readonly maintenant?: () => number
}

const RANG: Record<string, number> = { info: 0, attention: 1, critique: 2 }

export class NotificateurWebhook implements Notificateur {
  private readonly url: string
  private readonly lien: string | null
  private readonly niveauMinimum: number
  private readonly plafond: number
  private readonly delaiMs: number
  private readonly fetchImpl: typeof fetch
  private readonly maintenant: () => number
  private envois: number[] = []
  private retenus = 0

  constructor(options: OptionsWebhook) {
    this.url = options.url
    this.lien = options.lien ?? null
    this.niveauMinimum = RANG[options.niveauMinimum ?? 'critique'] ?? 2
    this.plafond = Math.max(1, options.plafondParHeure ?? 12)
    this.delaiMs = options.delaiMs ?? 5_000
    this.fetchImpl = options.fetch ?? fetch
    this.maintenant = options.maintenant ?? Date.now
  }

  async envoyer(c: ChangementIncident): Promise<ResultatEnvoi> {
    if ((RANG[c.niveau] ?? 0) < this.niveauMinimum) return { envoye: false, raison: 'niveau' }

    const t = this.maintenant()
    this.envois = this.envois.filter((e) => t - e < 3_600_000)
    if (this.envois.length >= this.plafond) {
      this.retenus += 1
      return { envoye: false, raison: 'plafond' }
    }
    this.envois.push(t)

    const texte = formaterAlerte(c, this.lien, this.retenus)
    try {
      const reponse = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: texte, content: texte }),
        signal: AbortSignal.timeout(this.delaiMs),
      })
      if (!reponse.ok) {
        // Le statut seul : le corps d'une erreur de webhook peut recopier l'URL.
        return { envoye: false, raison: 'echec', detail: `HTTP ${reponse.status}` }
      }
      this.retenus = 0
      return { envoye: true }
    } catch (erreur) {
      const nom = erreur instanceof Error ? erreur.name : 'Erreur'
      return { envoye: false, raison: 'echec', detail: nom === 'TimeoutError' ? 'délai dépassé' : nom }
    }
  }
}

export function formaterAlerte(c: ChangementIncident, lien: string | null, retenus = 0): string {
  const entete =
    c.transition === 'resolu'
      ? `✅ Kaissi — résolu : ${c.sujet}`
      : c.transition === 'aggrave'
        ? `⛔ Kaissi — AGGRAVÉ en critique : ${c.sujet}`
        : c.niveau === 'critique'
          ? `⛔ Kaissi — CRITIQUE : ${c.sujet}`
          : `⚠ Kaissi — attention : ${c.sujet}`
  const lignes = [entete]
  if (c.transition !== 'resolu') lignes.push(c.message)
  if (retenus > 0) lignes.push(`(${retenus} alerte(s) précédente(s) retenue(s) par le plafond horaire)`)
  if (lien) lignes.push(lien)
  return lignes.join('\n')
}

/**
 * `SYNC_ALERTES_WEBHOOK` — adresse https du webhook (secret, chez Railway).
 * `SYNC_ALERTES_NIVEAU`  — `critique` (défaut) ou `attention`.
 * `SYNC_ALERTES_LIEN`    — l'adresse du centre de supervision, ajoutée au message.
 *
 * Une adresse absente, illisible ou en clair (http) : pas de notificateur.
 * Un jeton envoyé en clair sur le réseau serait pire qu'une alerte manquante.
 */
export function notificateurDepuisEnvironnement(
  env: Record<string, string | undefined> = process.env,
): NotificateurWebhook | null {
  const brute = (env['SYNC_ALERTES_WEBHOOK'] ?? '').trim()
  if (!brute) return null
  let url: URL
  try {
    url = new URL(brute)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  const niveau = env['SYNC_ALERTES_NIVEAU'] === 'attention' ? 'attention' : 'critique'
  const lien = (env['SYNC_ALERTES_LIEN'] ?? '').trim()
  return new NotificateurWebhook({
    url: url.toString(),
    niveauMinimum: niveau,
    lien: /^https:\/\//.test(lien) ? lien : null,
  })
}
