import { seDeconnecter } from '../app/connexion/actions.js'
import type { SessionBackoffice } from '../serveur/session.js'
import { traduction } from '../i18n/serveur.js'
import { ChoixLangue } from '../i18n/client.js'
import { use } from 'react'

/** Bandeau minimal, sans navigation : utilisé hors d'un établissement. */
export function BarreCompte({ session }: { session: SessionBackoffice }) {
  const t = use(traduction())
  return (
    <header className="barre">
      <span className="marque">Kaissi</span>
      <div className="droite">
        {/*
          `title` parce que l'adresse s'abrège en ellipse sur un téléphone :
          sans lui, on ne pourrait plus savoir quelle session est ouverte, et
          c'est précisément ce qu'on vient vérifier ici.
        */}
        <span className="etiquette" title={session.email}>
          {session.email}
        </span>
        <ChoixLangue />
        <form action={seDeconnecter}>
          <button type="submit" className="discret">{t('Se déconnecter')}</button>
        </form>
      </div>
    </header>
  )
}
