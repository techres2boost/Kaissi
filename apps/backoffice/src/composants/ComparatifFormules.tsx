import { FORMULES, type EtatAbonnement, type Plan } from '@kaissi/domain'
import { Check, Minus } from 'lucide-react'

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
  readonly valeur: (plan: Plan) => string | boolean
}

const LIGNES: readonly LigneComparatif[] = [
  {
    quoi: 'Encaissement, même sans Internet',
    detail:
      'La caisse est installée sur la tablette, pas chargée depuis un site. Elle ouvre, ' +
      'encaisse et imprime sans réseau, et rattrape la synchronisation ensuite.',
    valeur: () => true,
  },
  {
    quoi: 'Tickets ouverts, remises, taxes, modificateurs',
    detail: 'Tout ce qui se passe sur la tablette pendant le service.',
    valeur: () => true,
  },
  {
    quoi: 'Employés, code PIN et journal d’audit',
    detail: 'Qui a fait quoi, y compris hors ligne.',
    valeur: () => true,
  },
  {
    quoi: 'Rapports et exports',
    detail: 'Ventes, articles, catégories, employés, modes de paiement, reçus, réductions.',
    valeur: () => true,
  },
  {
    quoi: 'Historique consultable',
    detail:
      'Jusqu’où les rapports remontent. Les ventes plus anciennes restent en base et ' +
      'reviennent entières si vous changez de formule — rien n’est effacé.',
    valeur: (plan) => {
      const jours = FORMULES[plan].joursHistorique
      return jours === null ? 'Sans limite' : `${jours} jours`
    },
  },
  {
    quoi: 'Inventaire avancé',
    detail: 'Fiches fournisseurs, réceptions rattachées, et valorisation du stock au coût d’achat.',
    valeur: (plan) => FORMULES[plan].modules.includes('inventaire_avance'),
  },
]

/** Les colonnes. L'essai n'en est pas une : il ouvre tout, et il est dit à côté. */
const COLONNES: readonly Plan[] = ['gratuit', 'pro']

export function ComparatifFormules({ etat }: { etat: EtatAbonnement }) {
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
              <th scope="col">Ce que vous avez</th>
              {COLONNES.map((plan) => (
                <th key={plan} scope="col" className={plan === colonneActuelle ? 'colonne-actuelle' : undefined}>
                  {FORMULES[plan].nom}
                  {plan === colonneActuelle && <span className="etiquette actif">en cours</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LIGNES.map((ligne) => (
              <tr key={ligne.quoi}>
                <th scope="row">
                  {ligne.quoi}
                  <span className="detail">{ligne.detail}</span>
                </th>
                {COLONNES.map((plan) => {
                  const valeur = ligne.valeur(plan)
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
                          <span className="visuellement-cache">Compris</span>
                        </>
                      ) : (
                        <>
                          <Minus size={17} strokeWidth={2} aria-hidden="true" className="non" />
                          <span className="visuellement-cache">Non compris</span>
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
      {/*
        Le rappel de l'essai sous le tableau, et pas dans une colonne : un
        essai n'est pas une formule qu'on choisit, c'est un état temporaire
        de celle qu'on a.
      */}
      <p className="indication">
        L’<strong>essai</strong> ouvre tout ce que la colonne « Pro » ouvre, pendant
        quatorze jours. À son terme, l’accès revient à la formule
        « Gratuit » — aucune donnée n’est perdue, et la caisse ne s’arrête pas.
      </p>
    </>
  )
}
