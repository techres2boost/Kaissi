'use client'

/**
 * Faire SONNER un écran de préparation — sans fichier son, sans service.
 *
 * ── Pourquoi un bip synthétisé, et pas un .mp3 ───────────────────────────
 *
 * Le son est la partie de l'alerte qui compte : une cuisine regarde ses
 * casseroles, pas son écran. Un fichier audio serait une requête de plus à
 * réussir au mauvais moment ; trois notes générées par Web Audio ne
 * dépendent de rien, et passent le bruit d'une hotte.
 *
 * ── Pourquoi il faut un premier geste ────────────────────────────────────
 *
 * Tous les navigateurs bloquent le son tant que personne n'a touché la page
 * (politique d'« autoplay »), et la permission de notification ne se demande
 * que sur un geste. D'où le bouton « Activer le son » de l'écran : un toucher
 * en début de service, mémorisé sur CET appareil.
 */

const CLE = 'kaissi.alerte-cuisine'

let contexte: AudioContext | null = null

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  contexte ??= new Ctor()
  return contexte
}

/** Le choix de CET appareil. Le stockage peut être refusé : alors, non. */
export function alerteActivee(): boolean {
  try {
    return window.localStorage.getItem(CLE) === 'oui'
  } catch {
    return false
  }
}

/**
 * À appeler DANS un gestionnaire de clic : c'est ce qui déverrouille le son
 * et permet de demander la notification.
 */
export async function activerAlerte(): Promise<void> {
  try {
    window.localStorage.setItem(CLE, 'oui')
  } catch {
    // Stockage refusé (navigation privée) : l'alerte vaut pour cette visite.
  }
  await audio()?.resume().catch(() => undefined)
  if ('Notification' in window && Notification.permission === 'default') {
    await Notification.requestPermission().catch(() => undefined)
  }
  bip()
}

export function desactiverAlerte(): void {
  try {
    window.localStorage.removeItem(CLE)
  } catch {
    // Rien à défaire.
  }
}

/** Trois notes montantes, courtes : reconnaissables, jamais stridentes. */
export function bip(): void {
  const ctx = audio()
  if (!ctx || ctx.state !== 'running') return
  const debut = ctx.currentTime
  ;[880, 1175, 1568].forEach((frequence, i) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = frequence
    const t = debut + i * 0.16
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + 0.15)
  })
}

/**
 * Le son, la vibration, et une notification système si la page n'est pas
 * au premier plan — c'est le cas du poste qui affiche autre chose, ou de la
 * tablette en veille d'écran.
 */
export function alerter(titre: string, corps: string): void {
  if (!alerteActivee()) return
  bip()
  try {
    navigator.vibrate?.([120, 60, 120])
  } catch {
    // Pas de vibreur : le son suffit.
  }
  if (
    typeof document !== 'undefined' &&
    document.visibilityState !== 'visible' &&
    'Notification' in window &&
    Notification.permission === 'granted'
  ) {
    try {
      new Notification(titre, { body: corps, tag: 'kaissi-preparation' })
    } catch {
      // Certains navigateurs mobiles n'acceptent que les notifications d'un
      // service worker : le son a déjà fait le travail.
    }
  }
}
