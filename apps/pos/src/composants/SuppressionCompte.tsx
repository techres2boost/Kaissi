/**
 * Supprimer son compte, DEPUIS la caisse.
 *
 * ── Pourquoi cet écran est dans la caisse, et pas seulement au back-office ─
 *
 * Deux raisons, et la plus visible n'est pas la plus importante. La règle
 * 5.1.1(v) d'Apple exige qu'une application permettant de CRÉER un compte
 * permette de le supprimer depuis l'application — et la caisse en crée un
 * (écran de bienvenue → « Créer un compte »). Une adresse e-mail à qui
 * écrire ne satisfait pas la règle, et ne satisfaisait pas non plus le
 * droit à l'effacement, qui ne dépend d'aucun magasin d'applications.
 *
 * ── Pourquoi on redemande le mot de passe ─────────────────────────────────
 *
 * La tablette ne porte AUCUNE session d'utilisateur : son jeton d'appareil
 * n'est l'identité de personne, et c'est voulu. Il n'y a donc rien à
 * présenter au serveur — il faut s'authentifier. C'est d'ailleurs ce qu'il
 * faut faire de toute façon : une caisse reste allumée sur un comptoir, et
 * un écran laissé ouvert ne doit pas suffire à effacer un compte.
 *
 * ── En deux temps, jamais en un ───────────────────────────────────────────
 *
 * On montre d'abord CE QUE la suppression emporte — les établissements, le
 * nombre de ventes qui resteront — puis on demande de retaper l'adresse.
 * « Supprimer mon compte » ne dit pas si les ventes partent avec, et c'est
 * exactement la question que se pose un restaurateur.
 */

import { useEffect, useState } from 'react'
import { UserX } from 'lucide-react'
import { URL_SYNC_PAR_DEFAUT } from '../config.js'
import { expliquerEchecReseau } from '../donnees/diagnostic-reseau.js'
import { useApp } from '../etat/contexte.js'
import { t, tm } from '../i18n.js'

interface Etablissement {
  readonly restaurantId: string
  readonly nom: string
  readonly role: string
  readonly devenir: 'inchange' | 'sans_administrateur' | 'ferme'
}

interface Apercu {
  readonly email: string
  readonly nom: string
  readonly etablissements: Etablissement[]
  readonly ventes: number
  /** Établissements que ce départ laisse sans aucun compte : ils seront fermés. */
  readonly fermes: string[]
  /** Établissements qui restent exploités, mais sans administrateur. */
  readonly sansAdministrateur: string[]
}

export function SuppressionCompte({ onRetour }: { onRetour: () => void }) {
  const { app } = useApp()
  const [url, setUrl] = useState(URL_SYNC_PAR_DEFAUT)
  const [email, setEmail] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [apercu, setApercu] = useState<Apercu | null>(null)
  const [etat, setEtat] = useState<'saisie' | 'envoi' | 'erreur' | 'fait'>('saisie')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void app.etat.lire('url_sync').then((u) => u && setUrl(u))
  }, [app])

  const appeler = async (chemin: string, corps: Record<string, unknown>) => {
    const base = url.replace(/\/+$/, '')
    // MÊME délai que l'appairage : c'est l'autre endroit du produit où un
    // humain attend devant l'écran, et une requête en suspens laissait le
    // bouton figé sans message et sans issue.
    const reponse = await fetch(`${base}${chemin}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corps),
      signal: AbortSignal.timeout(15_000),
    })
    const lu = (await reponse.json().catch(() => null)) as {
      message?: string
      erreur?: string
    } | null
    if (!reponse.ok) {
      throw new Error(lu?.message ?? t('Le serveur a répondu {statut}.', { statut: String(reponse.status) }))
    }
    return lu
  }

  const voir = async () => {
    setEtat('envoi')
    setMessage(null)
    try {
      const lu = (await appeler('/compte/apercu-suppression', {
        email: email.trim(),
        motDePasse,
      })) as unknown as Apercu
      setApercu(lu)
      setEtat('saisie')
    } catch (erreur) {
      setMessage(
        erreur instanceof Error ? tm(erreur.message) : expliquerEchecReseau(erreur, url),
      )
      setEtat('erreur')
    }
  }

  const supprimer = async () => {
    setEtat('envoi')
    setMessage(null)
    try {
      const lu = await appeler('/compte/supprimer', {
        email: email.trim(),
        motDePasse,
        confirmation: confirmation.trim(),
      })
      setMessage(lu?.message ?? null)
      setEtat('fait')
    } catch (erreur) {
      setMessage(
        erreur instanceof Error ? tm(erreur.message) : expliquerEchecReseau(erreur, url),
      )
      setEtat('erreur')
    }
  }

  if (etat === 'fait') {
    return (
      <section className="carte-action">
        <h1>{t('Compte supprimé')}</h1>
        {message && <p>{tm(message)}</p>}
        {/*
          Ce que cette caisse-ci devient, dit explicitement.

          Supprimer un compte ne révoque pas la tablette : son jeton
          d'appareil n'est l'identité de personne, et une caisse qui
          s'arrêterait parce qu'un gérant a supprimé son compte, c'est le
          service qui s'arrête. Mais il faut le DIRE, sinon on le découvre.
        */}
        <p className="aide">{t('Cette caisse continue de fonctionner : son jeton d’appareil n’est l’identité de personne. Pour la mettre hors service, utilisez « Révoquer » au back-office, ou effacez-la depuis l’écran Synchronisation.')}</p>
        <button type="button" className="principal" onClick={onRetour}>{t('Terminer')}</button>
      </section>
    )
  }

  if (apercu) {
    return (
      <section className="carte-action">
        <button type="button" className="retour-accueil" onClick={() => setApercu(null)}>{t('‹ Retour')}</button>
        <h1>{t('Supprimer mon compte')}</h1>
        <p>{t('Compte : {email}', { email: apercu.email })}</p>

        <div className="effets-suppression">
          <h2>{t('Ce qui sera effacé')}</h2>
          <ul>
            <li>{t('Votre connexion au back-office — définitivement.')}</li>
            <li>{t('Votre nom, votre adresse e-mail et votre téléphone.')}</li>
            <li>{t('Votre code PIN de caisse.')}</li>
            {apercu.etablissements.length > 0 && (
              <li>{t('Votre rattachement à : {noms}.', { noms: apercu.etablissements.map((e) => e.nom).join(', ') })}</li>
            )}
          </ul>

          <h2>{t('Ce qui sera conservé')}</h2>
          <ul>
            <li>
              {apercu.ventes > 0
                ? t('Les {n} vente(s) que vous avez encaissées — sans votre nom.', { n: String(apercu.ventes) })
                : t('Aucune vente n’est rattachée à ce compte.')}
            </li>
            <li>{t('Le journal des ventes et le journal d’audit : ce sont des écritures comptables, elles ne se suppriment pas. Elles ne portent plus votre nom.')}</li>
          </ul>

          {/*
            Ce qui arrive aux ÉTABLISSEMENTS — et jamais un refus.

            La première version bloquait le dernier administrateur : « nommez
            quelqu'un d'abord ». Dans un restaurant tenu par une seule
            personne, il n'y a personne à nommer, et le compte devenait
            indestructible. On informe, on n'empêche pas.
          */}
          {(apercu.fermes.length > 0 || apercu.sansAdministrateur.length > 0) && (
            <>
              <h2>{t('Ce qui arrivera à vos établissements')}</h2>
              <ul>
                {apercu.fermes.length > 0 && (
                  <li>{t('{noms} : plus aucun compte n’y donnerait accès. L’établissement sera FERMÉ — aucune caisse ne pourra plus s’y appairer. Ses ventes sont conservées, et Res2Boost peut le rouvrir.', { noms: apercu.fermes.join(', ') })}</li>
                )}
                {apercu.sansAdministrateur.length > 0 && (
                  <li>{t('{noms} : il n’y aura plus d’administrateur. Les gérants continueront d’exploiter normalement — carte, stock, rapports — mais plus personne ne pourra y accorder ni retirer un accès.', { noms: apercu.sansAdministrateur.join(', ') })}</li>
                )}
              </ul>
            </>
          )}
        </div>

        <label htmlFor="suppr-confirmation">{t('Pour confirmer, retapez votre adresse e-mail')}</label>
        <input
          id="suppr-confirmation"
          type="email"
          autoComplete="off"
          autoCapitalize="none"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          placeholder={apercu.email}
        />
        <p className="aide">{t('Retaper l’adresse oblige à lire QUEL compte sera effacé. Une case à cocher ne l’oblige pas.')}</p>

        <button
          type="button"
          className="principal destructif"
          disabled={etat === 'envoi' || confirmation.trim().toLowerCase() !== apercu.email.trim().toLowerCase()}
          onClick={() => void supprimer()}
        >
          <UserX size={18} strokeWidth={2} aria-hidden="true" />{' '}
          {etat === 'envoi' ? t('Suppression…') : t('Supprimer définitivement mon compte')}
        </button>

        {etat === 'erreur' && message && (
          <p className="erreur" style={{ whiteSpace: 'pre-line' }}>{tm(message)}</p>
        )}
      </section>
    )
  }

  const pret = email.trim().length > 3 && motDePasse.length > 0

  return (
    <section className="carte-action">
      <button type="button" className="retour-accueil" onClick={onRetour}>{t('‹ Retour')}</button>
      <h1>{t('Supprimer mon compte')}</h1>
      <p>{t('Identifiez-vous : la caisse ne garde aucune session d’utilisateur, et un écran laissé ouvert sur un comptoir ne doit pas suffire à effacer un compte.')}</p>

      <label htmlFor="suppr-email">{t('E-mail')}</label>
      <input
        id="suppr-email"
        type="email"
        autoComplete="username"
        autoCapitalize="none"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <label htmlFor="suppr-mdp">{t('Mot de passe')}</label>
      <input
        id="suppr-mdp"
        type="password"
        autoComplete="current-password"
        value={motDePasse}
        onChange={(e) => setMotDePasse(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && pret && etat !== 'envoi') void voir()
        }}
      />

      <button
        type="button"
        className="principal"
        disabled={!pret || etat === 'envoi'}
        onClick={() => void voir()}
      >
        {etat === 'envoi' ? t('Vérification…') : t('Continuer')}
      </button>
      <p className="aide">{t('Rien n’est supprimé à cette étape : l’écran suivant montre d’abord ce qui serait effacé.')}</p>

      {etat === 'erreur' && message && (
        <p className="erreur" style={{ whiteSpace: 'pre-line' }}>{tm(message)}</p>
      )}
    </section>
  )
}
