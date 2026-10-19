/**
 * « Table 3 — prête » : la cuisine prévient la salle.
 *
 * ── La demande ──────────────────────────────────────────────────────────
 *
 * Quand la cuisine ou le bar marque une commande prête, la personne qui
 * tient la caisse — caissier, serveur, gérant — doit le SAVOIR, sans avoir
 * à regarder la salle. Le badge « Prêt » existait déjà, mais un badge ne se
 * voit que si l'on regarde : en plein service, on prend une autre commande.
 *
 * ── Comment ─────────────────────────────────────────────────────────────
 *
 * Le « prêt » descend par le catalogue (Postgres 0029) : à chaque cycle de
 * synchronisation qui avance le curseur du catalogue, on relit les commandes
 * ouvertes et on compare. Une commande qui PASSE à prête — et seulement
 * celles-là — sonne, vibre, et s'affiche dans un bandeau en haut de l'écran.
 *
 * Le premier relevé ne sonne pas : ce qui était déjà prêt au démarrage n'est
 * pas une nouvelle. Et un ajout envoyé après un « prêt » (0046) éteint la
 * commande ; quand la cuisine dit de nouveau « prêt », elle REPASSE à prête,
 * et sonne de nouveau — c'est exactement ce qu'on veut.
 *
 * Rien de tout cela n'est sur le chemin de l'encaissement : c'est une
 * lecture locale, après coup, qui ne bloque aucun geste.
 */

import { useEffect, useRef, useState } from 'react'
import { useApp } from '../etat/contexte.js'
import { t } from '../i18n.js'

interface Annonce {
  readonly id: string
  readonly texte: string
}

/** Trois notes descendantes — distinctes de la cuisine, qui monte. */
function bip(): void {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    const debut = ctx.currentTime
    ;[1568, 1175, 880].forEach((frequence, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = frequence
      const instant = debut + i * 0.16
      gain.gain.setValueAtTime(0.0001, instant)
      gain.gain.exponentialRampToValueAtTime(0.3, instant + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, instant + 0.14)
      osc.connect(gain).connect(ctx.destination)
      osc.start(instant)
      osc.stop(instant + 0.15)
    })
    setTimeout(() => void ctx.close().catch(() => undefined), 800)
  } catch {
    // Pas de son possible : le bandeau et la vibration suffisent.
  }
}

export function AlertePrete() {
  const { app, version, resumeSync, tables } = useApp()
  const [annonces, setAnnonces] = useState<Annonce[]>([])
  const pretesVues = useRef<Set<string> | null>(null)

  useEffect(() => {
    let vivant = true
    void app.caisse.commandesOuvertes().then((commandes) => {
      if (!vivant) return
      const pretes = commandes.filter((c) => c.preteA !== null)
      const precedentes = pretesVues.current
      pretesVues.current = new Set(pretes.map((c) => c.id))
      if (precedentes === null) return
      const nouvelles = pretes.filter((c) => !precedentes.has(c.id))
      if (nouvelles.length === 0) return

      bip()
      try {
        navigator.vibrate?.([150, 80, 150])
      } catch {
        // Pas de vibreur.
      }
      setAnnonces((avant) => [
        ...avant,
        ...nouvelles.map((c) => ({
          id: c.id,
          texte: c.tableId
            ? t('{table} — prête en cuisine', {
                table: t('Table {numero}', {
                  numero: c.tableLabel ?? tables.find((x) => x.id === c.tableId)?.label ?? '?',
                }),
              })
            : t('{ticket} — prête en cuisine', { ticket: c.numeroTicket ?? t('À emporter') }),
        })),
      ])
    })
    return () => {
      vivant = false
    }
  }, [app, version, resumeSync.curseurCatalogue, tables])

  // Une annonce s'efface seule au bout de vingt secondes : le badge « Prêt »
  // de la salle reste, lui, jusqu'à l'encaissement.
  useEffect(() => {
    if (annonces.length === 0) return
    const minuteur = setTimeout(() => setAnnonces((a) => a.slice(1)), 20_000)
    return () => clearTimeout(minuteur)
  }, [annonces])

  if (annonces.length === 0) return null
  return (
    <div className="alerte-prete" role="status" aria-live="assertive">
      {annonces.map((a) => (
        <div key={a.id} className="annonce">
          <span aria-hidden="true">🍽</span>
          <span className="texte">{a.texte}</span>
          <button
            type="button"
            onClick={() => setAnnonces((liste) => liste.filter((x) => x.id !== a.id))}
          >{t('Vu')}</button>
        </div>
      ))}
    </div>
  )
}
