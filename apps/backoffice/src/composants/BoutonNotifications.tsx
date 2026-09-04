'use client'

/**
 * Activer les alertes de stock sur CE navigateur.
 *
 * ── Pourquoi « ce navigateur » et pas « moi » ─────────────────────────────
 *
 * Une notification web s'adresse à une installation de navigateur, pas à une
 * personne. Le même gérant sur son téléphone et sur le poste du comptoir a
 * deux abonnements, et il faut les activer des deux côtés. Le dire
 * explicitement évite la question « je l'ai activé, pourquoi mon téléphone
 * ne sonne pas ».
 *
 * ── Ce qui peut manquer, et ce qu'on en dit ───────────────────────────────
 *
 * Trois choses peuvent empêcher l'abonnement, et elles ne se corrigent pas
 * au même endroit :
 *   • le navigateur ne sait pas faire (Safari < 16.4, mode privé) ;
 *   • la permission a été REFUSÉE — le bouton n'y peut plus rien, il faut
 *     passer par les réglages du site ;
 *   • la clé publique VAPID n'est pas configurée côté serveur.
 * Un bouton grisé sans explication ferait taper trois fois dessus.
 */

import { useEffect, useState, useTransition } from 'react'
import {
  enregistrerAbonnement,
  retirerAbonnement,
  type ResultatAbonnement,
} from '../app/[restaurant]/stock/notifications.js'

/**
 * La clé VAPID voyage en base64url ; `applicationServerKey` veut des octets.
 * Sans cette conversion, Chrome répond « InvalidAccessError » sans dire
 * lequel des deux formats il attendait.
 */
function versOctets(base64url: string): Uint8Array<ArrayBuffer> {
  const rembourrage = '='.repeat((4 - (base64url.length % 4)) % 4)
  const base64 = (base64url + rembourrage).replace(/-/g, '+').replace(/_/g, '/')
  const brut = atob(base64)
  // Le tampon est déclaré explicitement : sans lui, TypeScript infère
  // `ArrayBufferLike`, qui recouvre `SharedArrayBuffer` — que
  // `applicationServerKey` refuse, à raison.
  const octets = new Uint8Array(new ArrayBuffer(brut.length))
  for (let i = 0; i < brut.length; i += 1) octets[i] = brut.charCodeAt(i)
  return octets
}

/** Les clés que le navigateur nous donne, en base64url. */
function clesDe(abonnement: PushSubscription): { p256dh: string; auth: string } | null {
  const brut = abonnement.toJSON().keys
  if (!brut?.['p256dh'] || !brut['auth']) return null
  return { p256dh: brut['p256dh'], auth: brut['auth'] }
}

type Etat = 'inconnu' | 'indisponible' | 'refuse' | 'inactif' | 'actif'

export function BoutonNotifications({
  restaurant,
  clePublique,
}: {
  restaurant: string
  /** `null` : aucune clé VAPID configurée côté serveur. */
  clePublique: string | null
}) {
  const [etat, setEtat] = useState<Etat>('inconnu')
  const [message, setMessage] = useState<ResultatAbonnement>({})
  const [enCours, demarrer] = useTransition()

  useEffect(() => {
    let vivant = true
    const lire = async () => {
      if (
        typeof window === 'undefined' ||
        !('serviceWorker' in navigator) ||
        !('PushManager' in window)
      ) {
        if (vivant) setEtat('indisponible')
        return
      }
      if (Notification.permission === 'denied') {
        if (vivant) setEtat('refuse')
        return
      }
      const enregistrement = await navigator.serviceWorker.getRegistration('/sw-alertes.js')
      const abonnement = await enregistrement?.pushManager.getSubscription()
      if (vivant) setEtat(abonnement ? 'actif' : 'inactif')
    }
    void lire()
    return () => {
      vivant = false
    }
  }, [])

  const activer = () => {
    setMessage({})
    demarrer(async () => {
      try {
        if (!clePublique) {
          setMessage({ erreur: 'Les notifications ne sont pas configurées sur ce serveur.' })
          return
        }
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') {
          setEtat(permission === 'denied' ? 'refuse' : 'inactif')
          setMessage({ erreur: 'Le navigateur a refusé les notifications.' })
          return
        }
        const enregistrement = await navigator.serviceWorker.register('/sw-alertes.js')
        // `ready` : sans lui, `pushManager` peut être interrogé avant que le
        // worker ne soit actif, et l'abonnement échoue une fois sur deux —
        // le genre de défaut qui ne se reproduit jamais quand on le cherche.
        await navigator.serviceWorker.ready
        const abonnement = await enregistrement.pushManager.subscribe({
          // Obligatoire : le navigateur n'autorise pas de notification
          // silencieuse. C'est une bonne chose — une notification invisible
          // serait un mouchard.
          userVisibleOnly: true,
          applicationServerKey: versOctets(clePublique),
        })
        const cles = clesDe(abonnement)
        if (!cles) {
          setMessage({ erreur: 'Le navigateur n’a pas fourni de clés d’abonnement.' })
          return
        }
        const resultat = await enregistrerAbonnement(restaurant, {
          endpoint: abonnement.endpoint,
          ...cles,
        })
        setMessage(resultat)
        if (resultat.succes) setEtat('actif')
        // L'abonnement local est ANNULÉ si le serveur n'a pas pu l'écrire :
        // le laisser donnerait un bouton « actif » pour un canal que
        // personne ne connaît, et des alertes qui n'arriveraient jamais.
        else await abonnement.unsubscribe().catch(() => undefined)
      } catch (erreur) {
        setMessage({
          erreur: `Abonnement impossible : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
        })
      }
    })
  }

  const desactiver = () => {
    setMessage({})
    demarrer(async () => {
      const enregistrement = await navigator.serviceWorker.getRegistration('/sw-alertes.js')
      const abonnement = await enregistrement?.pushManager.getSubscription()
      if (!abonnement) {
        setEtat('inactif')
        return
      }
      // On prévient le serveur AVANT de se désabonner : l'inverse laisserait
      // une ligne morte en base si l'appel échouait, et le service
      // retenterait indéfiniment un canal qui n'existe plus.
      const resultat = await retirerAbonnement(restaurant, abonnement.endpoint)
      setMessage(resultat)
      if (!resultat.erreur) {
        await abonnement.unsubscribe().catch(() => undefined)
        setEtat('inactif')
      }
    })
  }

  return (
    <div className="notifications">
      {etat === 'indisponible' && (
        <p className="detail">
          Ce navigateur ne sait pas recevoir de notifications. Les alertes
          restent visibles sur cet écran.
        </p>
      )}
      {etat === 'refuse' && (
        <p className="detail">
          Les notifications ont été refusées pour ce site. Réautorise-les dans
          les réglages du navigateur (cadenas à gauche de l’adresse), puis
          recharge la page.
        </p>
      )}
      {etat === 'inactif' && (
        <button type="button" onClick={activer} disabled={enCours || !clePublique}>
          🔔 M’alerter des ruptures sur ce navigateur
        </button>
      )}
      {etat === 'actif' && (
        <button type="button" className="discret" onClick={desactiver} disabled={enCours}>
          Alertes actives sur ce navigateur — désactiver
        </button>
      )}
      {!clePublique && etat === 'inactif' && (
        <p className="detail">
          Notifications non configurées sur ce serveur (clé VAPID absente).
        </p>
      )}
      {message.erreur && <p className="message erreur">{message.erreur}</p>}
      {message.succes && <p className="message succes">{message.succes}</p>}
    </div>
  )
}
