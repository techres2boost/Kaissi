/**
 * Ouvrir un restaurant depuis la tablette, sans compte préalable.
 *
 * ── Ce que cet écran fait en UN geste ─────────────────────────────────────
 *
 * Compte, organisation, restaurant, et appairage de CETTE caisse. Découper
 * aurait obligé à ressaisir les identifiants qu'on vient de choisir, soit
 * exactement l'étape en trop que l'écran d'accueil a supprimée.
 *
 * ── Ce qu'il dit, et qu'il serait tentant de taire ────────────────────────
 *
 * Le taux de taxe est posé à ZÉRO. Le serveur refuse d'écrire un taux
 * « standard » dans son code — ce serait affirmer une règle fiscale
 * tunisienne — mais un zéro silencieux ferait facturer sans taxe pendant des
 * semaines. L'écran de succès le met donc en avertissement, pas en note de
 * bas de page.
 */

import { useState } from 'react'
import { Store, TriangleAlert } from 'lucide-react'
import { useApp } from '../etat/contexte.js'
import { URL_SYNC_PAR_DEFAUT } from '../config.js'
import { identifiantInstallation } from '../donnees/installation.js'
import { expliquerEchecReseau } from '../donnees/diagnostic-reseau.js'

export function FormulaireInscription({
  onInscrit,
  onDejaUnCompte,
}: {
  onInscrit: () => void
  onDejaUnCompte: () => void
}) {
  const { app, rafraichir } = useApp()
  const [nomRestaurant, setNomRestaurant] = useState('')
  const [nomGerant, setNomGerant] = useState('')
  const [email, setEmail] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [etat, setEtat] = useState<'saisie' | 'envoi' | 'erreur'>('saisie')
  const [message, setMessage] = useState<string | null>(null)
  /** Non nul = c'est fait, et il reste une chose à dire avant de continuer. */
  const [aRegler, setARegler] = useState<string | null>(null)

  const pret =
    nomRestaurant.trim().length >= 2 && email.trim() !== '' && motDePasse.length >= 8

  const inscrire = async () => {
    setEtat('envoi')
    setMessage(null)
    const base = ((await app.etat.lire('url_sync')) || URL_SYNC_PAR_DEFAUT).replace(/\/+$/, '')

    try {
      const installationId = await identifiantInstallation(app.etat)
      // MÊME délai que l'appairage : une requête en suspens laisserait le
      // bouton figé sans message et sans issue autre que recharger.
      const reponse = await fetch(`${base}/inscription`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          motDePasse,
          nomRestaurant: nomRestaurant.trim(),
          nomGerant: nomGerant.trim(),
          // Tunisie par DÉFAUT, jamais le fuseau du serveur : un conteneur en
          // Europe ne décide pas de la journée commerciale d'un restaurant
          // tunisien. Le gérant le changera au back-office s'il le faut.
          timezone: 'Africa/Tunis',
          installationId,
          libelle: 'Terminal',
        }),
        signal: AbortSignal.timeout(20_000),
      })

      const corps = (await reponse.json().catch(() => null)) as {
        jeton?: string
        deviceId?: string
        restaurantId?: string
        organizationId?: string
        prefixe?: string
        employeId?: string
        aRegler?: string[]
        message?: string
      } | null

      if (!reponse.ok || !corps?.jeton || !corps.deviceId) {
        setEtat('erreur')
        setMessage(corps?.message ?? `Le serveur a répondu ${reponse.status}.`)
        return
      }

      /*
       * L'identité arrive du SERVEUR et s'adopte en bloc — même geste qu'à
       * l'appairage. Sans le préfixe de tickets, deux terminaux émettraient
       * le même numéro et la seconde vente n'apparaîtrait jamais au
       * back-office.
       */
      await app.etat.ecrire('url_sync', base)
      await app.etat.ecrire('jeton_appareil', corps.jeton)
      await app.etat.ecrire('device_id', corps.deviceId)
      if (corps.restaurantId) await app.etat.ecrire('restaurant_id', corps.restaurantId)
      if (corps.organizationId) await app.etat.ecrire('organization_id', corps.organizationId)
      if (corps.prefixe) await app.etat.ecrire('ticket_prefix', corps.prefixe)
      if (corps.employeId) await app.etat.ecrire('employe_appaireur', corps.employeId)

      setARegler(corps.message ?? null)
      setEtat('saisie')
      rafraichir()
    } catch (erreur) {
      setEtat('erreur')
      console.error('inscription', erreur)
      const expire =
        erreur instanceof DOMException &&
        (erreur.name === 'TimeoutError' || erreur.name === 'AbortError')
      setMessage(
        expire
          ? 'Le serveur n’a pas répondu en 20 secondes. Réessayez : rien n’a été créé.'
          : expliquerEchecReseau(erreur, base),
      )
    }
  }

  if (aRegler !== null) {
    return (
      <section className="carte-action">
        <h1>C’est ouvert.</h1>
        <p>{aRegler}</p>
        {/*
          L'avertissement du taux à zéro, en évidence. Le serveur refuse
          d'inventer un taux ; le taire ici reviendrait à le faire pour lui.
        */}
        <p className="aide avertissement-demo">
          <TriangleAlert size={15} strokeWidth={2} aria-hidden="true" /> Réglez le
          taux de taxe au back-office avant d’encaisser. Kaissi ne le devine
          pas : une règle fiscale se vérifie, elle ne se suppose pas.
        </p>
        <button
          type="button"
          className="principal"
          onClick={() => {
            /*
             * Rechargement, et pas un simple rafraîchissement : le
             * `device_id` est lu une fois au montage du contexte puis figé
             * dans la session de caisse. Sans cela, les ventes suivantes
             * seraient signées avec l'identité de la graine et refusées
             * « appareil_etranger ».
             */
            onInscrit()
            window.location.reload()
          }}
        >
          Commencer
        </button>
      </section>
    )
  }

  return (
    <section className="carte-action">
      <h1>Ouvrir mon restaurant</h1>
      <p>
        Un seul compte, pour la caisse et pour le back-office. Cette tablette
        sera rattachée automatiquement — il n’y a rien d’autre à régler ensuite.
      </p>

      <label htmlFor="insc-resto">Nom du restaurant</label>
      <input
        id="insc-resto"
        type="text"
        value={nomRestaurant}
        onChange={(e) => setNomRestaurant(e.target.value)}
        placeholder="Snack du Lac"
        autoComplete="organization"
      />

      <label htmlFor="insc-gerant">Votre nom</label>
      <input
        id="insc-gerant"
        type="text"
        value={nomGerant}
        onChange={(e) => setNomGerant(e.target.value)}
        placeholder="Fatma Ben Salah"
        autoComplete="name"
      />

      <label htmlFor="insc-email">E-mail</label>
      <input
        id="insc-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="gerant@monresto.tn"
        autoComplete="email"
        inputMode="email"
      />

      <label htmlFor="insc-mdp">Mot de passe</label>
      <input
        id="insc-mdp"
        type="password"
        value={motDePasse}
        onChange={(e) => setMotDePasse(e.target.value)}
        autoComplete="new-password"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && pret && etat !== 'envoi') void inscrire()
        }}
      />
      {/* Le minimum est dit AVANT le refus : le découvrir après la saisie
          fait recommencer, clavier ouvert, sur une tablette. */}
      <p className="aide">Huit caractères au moins.</p>

      <button
        type="button"
        className="principal"
        disabled={!pret || etat === 'envoi'}
        onClick={() => void inscrire()}
      >
        <Store size={18} strokeWidth={2} aria-hidden="true" />{' '}
        {etat === 'envoi' ? 'Création…' : 'Ouvrir mon restaurant'}
      </button>

      {etat === 'erreur' && message && <p className="erreur">{message}</p>}

      <button type="button" className="lien-discret" onClick={onDejaUnCompte}>
        J’ai déjà un compte — me connecter
      </button>
    </section>
  )
}
