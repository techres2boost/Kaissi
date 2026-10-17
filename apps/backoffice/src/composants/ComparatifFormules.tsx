import { FORMULES, type EtatAbonnement, type Plan } from '@kaissi/domain'
import { Check, Minus } from 'lucide-react'
import { use } from 'react'
import { aTraduire } from '@kaissi/i18n'
import { traduction } from '../i18n/serveur.js'
import type { Traduction } from '../i18n/commun.js'

/**
 * Ce que chaque formule ouvre — et la ligne qui ne change jamais.
 *
 * ── La première ligne du tableau est le produit tout entier ───────────────
 *
 * « Encaissement hors ligne : toutes les formules. » Elle n'est pas là pour
 * faire nombre : c'est la seule promesse que Kaissi tient et que ses
 * concurrents ne tiennent pas, et un tableau de formules qui la passerait
 * sous silence laisserait croire qu'elle se paie. Elle ne se paie pas, et
 * elle ne peut pas se retirer — le code de la caisse est dans l'APK, il
 * n'interroge aucun abonnement, et lui apprendre à le faire serait écrire
 * exprès de quoi arrêter un service un vendredi soir.
 *
 * ── Les droits sont LUS dans `@kaissi/domain`, pas recopiés ───────────────
 *
 * `FORMULES` est la même table que celle qui FERME réellement les écrans.
 * Recopier ici « Gratuit : 2 mois » produirait, le jour où la durée change,
 * un tableau qui promet une chose et une garde qui en applique une autre —
 * et c'est le tableau que le client aura lu avant de payer.
 */

/** Une ligne du comparatif. `valeur` lit la formule, jamais une constante. */
interface LigneComparatif {
  readonly quoi: string
  readonly detail: string
  readonly valeur: (plan: Plan, t: Traduction) => string | boolean
}

const LIGNES: readonly LigneComparatif[] = [
  {
    quoi: aTraduire('Encaissement, même sans Internet'),
    detail:
      aTraduire('La caisse est installée sur la tablette, pas chargée depuis un site. Elle ouvre, encaisse et imprime sans réseau, et rattrape la synchronisation ensuite.'),
    valeur: () => true,
  },
  {
    quoi: aTraduire('Tickets ouverts, remises, taxes, modificateurs'),
    detail: aTraduire('Tout ce qui se passe sur la tablette pendant le service.'),
    valeur: () => true,
  },
  {
    quoi: aTraduire('Employés, code PIN et journal d’audit'),
    detail: aTraduire('Qui a fait quoi, y compris hors ligne.'),
    valeur: () => true,
  },
  {
    quoi: aTraduire('Rapports et exports'),
    detail: aTraduire('Ventes, articles, catégories, employés, modes de paiement, reçus, réductions.'),
    valeur: () => true,
  },
  {
    quoi: aTraduire('Historique consultable'),
    detail:
      aTraduire('Jusqu’où les rapports remontent. Les ventes plus anciennes restent en base et reviennent entières si vous changez de formule — rien n’est effacé.'),
    valeur: (plan, t) => {
      const jours = FORMULES[plan].joursHistorique
      return jours === null ? t('Sans limite') : t('{jours} jours', { jours })
    },
  },
  {
    quoi: aTraduire('Inventaire avancé'),
    detail: aTraduire('Fiches fournisseurs, réceptions rattachées, et valorisation du stock au coût d’achat.'),
    valeur: (plan) => FORMULES[plan].modules.includes('inventaire_avance'),
  },
]

/** Les colonnes : Gratuit et Payant, les deux seules formules proposées. */
const COLONNES: readonly Plan[] = ['gratuit', 'pro']

export function ComparatifFormules({ etat }: { etat: EtatAbonnement }) {
  const t = use(traduction())
  /*
   * La colonne EN COURS est mise en évidence — sauf pendant un essai, où
   * aucune des deux ne l'est : pendant l'essai, le client a les droits du
   * « Pro » sans y être abonné. Surligner « Pro » lui ferait croire qu'il
   * l'a déjà, et la fin de l'essai passerait pour une panne.
   */
  const colonneActuelle = etat.enEssai ? null : etat.essaiExpire ? 'gratuit' : etat.plan

  return (
    <>
      <div className="tableau-defilant">
        <table className="comparatif-formules">
          <thead>
            <tr>
              <th scope="col">{t('Ce que vous avez')}</th>
              {COLONNES.map((plan) => (
                <th key={plan} scope="col" className={plan === colonneActuelle ? 'colonne-actuelle' : undefined}>
                  {t(FORMULES[plan].nom)}
                  {plan === colonneActuelle && <span className="etiquette actif">{t('en cours')}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LIGNES.map((ligne) => (
              <tr key={ligne.quoi}>
                <th scope="row">
                  {t(ligne.quoi)}
                  <span className="detail">{t(ligne.detail)}</span>
                </th>
                {COLONNES.map((plan) => {
                  const valeur = ligne.valeur(plan, t)
                  return (
                    <td
                      key={plan}
                      className={plan === colonneActuelle ? 'colonne-actuelle' : undefined}
                    >
                      {typeof valeur === 'string' ? (
                        valeur
                      ) : valeur ? (
                        /*
                          L'icône REDIT ce que le texte caché annonce : sans ce
                          texte, un lecteur d'écran lit une cellule vide, et le
                          tableau ne dit plus rien de ce qu'il compare.
                        */
                        <>
                          <Check size={17} strokeWidth={2} aria-hidden="true" className="oui" />
                          <span className="visuellement-cache">{t('Compris')}</span>
                        </>
                      ) : (
                        <>
                          <Minus size={17} strokeWidth={2} aria-hidden="true" className="non" />
                          <span className="visuellement-cache">{t('Non compris')}</span>
                        </>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
