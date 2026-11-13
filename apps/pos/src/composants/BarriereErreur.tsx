/**
 * Une erreur d'affichage ne laisse plus la caisse sur un écran BLANC.
 *
 * Sans barrière, React démonte tout l'arbre sur une erreur de rendu : le
 * caissier voit une page vide, ne sait pas si la vente est partie, et
 * redémarre la tablette en se demandant ce qu'il a perdu. Il n'a rien perdu
 * — chaque geste est déjà dans SQLite et dans l'outbox — et c'est
 * précisément ce que l'écran doit dire.
 *
 * L'erreur est notée par le collecteur (`collecteur-erreurs.ts`) : elle
 * remontera au centre de supervision au prochain cycle de synchronisation,
 * après les ventes.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { t } from '../i18n.js'
import { collecteurErreurs } from '../etat/collecteur-erreurs.js'

export class BarriereErreur extends Component<{ children: ReactNode }, { erreur: Error | null }> {
  override state: { erreur: Error | null } = { erreur: null }

  static getDerivedStateFromError(erreur: Error) {
    return { erreur }
  }

  override componentDidCatch(erreur: Error, info: ErrorInfo) {
    const pile = [erreur.stack ?? '', info.componentStack ?? ''].join('\n')
    const avecPile = Object.assign(new Error(erreur.message), { name: erreur.name, stack: pile })
    collecteurErreurs.noter(avecPile, { type: 'rendu' })
  }

  override render() {
    if (!this.state.erreur) return this.props.children
    return (
      <div className="ecran-centre" role="alert">
        <div className="carte-action">
          <h1>{t('Un écran de la caisse a rencontré une erreur')}</h1>
          <p className="aide">
            {t('Vos ventes sont enregistrées sur cette caisse : rien n’est perdu. Relancez l’écran pour reprendre là où vous en étiez.')}
          </p>
          <p className="aide">
            {t('L’erreur sera transmise à l’équipe Kaissi à la prochaine synchronisation.')}
          </p>
          <button type="button" className="principal" onClick={() => window.location.reload()}>
            {t('Relancer la caisse')}
          </button>
        </div>
      </div>
    )
  }
}
