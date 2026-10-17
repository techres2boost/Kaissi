'use client'

import { use, useActionState } from 'react'
import { seConnecter } from './actions.js'
import { ChoixLangue, useT } from '../../i18n/client.js'

export default function PageConnexion({
  searchParams,
}: {
  searchParams: Promise<{ suite?: string }>
}) {
  const t = useT()
  const params = use(searchParams)
  const [erreur, action, enCours] = useActionState(seConnecter, null)

  return (
    <main className="enveloppe" style={{ maxWidth: '24rem', paddingTop: '5rem' }}>
      <h1 style={{ color: 'var(--accent)' }}>Kaissi</h1>
      <p className="sous-titre">{t('Back-office — Res2Boost')}</p>

      <form action={action} className="carte">
        {erreur ? (
          <p className="message erreur" role="alert">
            {t.m(erreur)}
          </p>
        ) : null}

        {/* La destination d'origine, pour y revenir après connexion plutôt
            que de renvoyer l'utilisateur sur un accueil qui lui fait tout
            recommencer. */}
        <input type="hidden" name="suite" value={params.suite ?? '/'} />

        <div className="champ">
          <label htmlFor="email">{t('E-mail')}</label>
          <input id="email" name="email" type="email" autoComplete="username" required autoFocus />
        </div>

        <div className="champ">
          <label htmlFor="motDePasse">{t('Mot de passe')}</label>
          <input
            id="motDePasse"
            name="motDePasse"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>

        <button type="submit" className="principal" disabled={enCours} style={{ width: '100%' }}>
          {enCours ? t('Connexion…') : t('Se connecter')}
        </button>
      </form>

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem' }}>
        <ChoixLangue />
      </div>

      <p className="indication">{t('Le code PIN à quatre chiffres sert sur la tablette, pas ici. Ce sont deux identités distinctes : celle-ci ouvre le back-office, le PIN dit qui agit sur un terminal.')}</p>
    </main>
  )
}
