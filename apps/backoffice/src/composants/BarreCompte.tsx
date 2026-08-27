import { seDeconnecter } from '../app/connexion/actions.js'
import type { SessionBackoffice } from '../serveur/session.js'

/** Bandeau minimal, sans navigation : utilisé hors d'un établissement. */
export function BarreCompte({ session }: { session: SessionBackoffice }) {
  return (
    <header className="barre">
      <span className="marque">Kaissi</span>
      <div className="droite">
        <span className="etiquette">{session.email}</span>
        <form action={seDeconnecter}>
          <button type="submit" className="discret">
            Se déconnecter
          </button>
        </form>
      </div>
    </header>
  )
}
