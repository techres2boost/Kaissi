'use client'

/**
 * Le tableau de stock, et ses deux gestes : compter, et mouvementer.
 *
 * Un seul produit est ouvert à la fois. Un formulaire par ligne, déplié sur
 * 40 produits, transformerait la page en mur de champs où l'on se trompe de
 * ligne — et une erreur de stock ne se voit pas avant l'inventaire suivant.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { formaterPourcentage, formaterTND, millimes } from '@kaissi/domain'
import {
  activerSuivi,
  basculerDisponibilite,
  basculerRuptureAuto,
  enregistrerMouvement,
} from '../app/[restaurant]/stock/actions.js'
import type { ProduitStock } from '../app/[restaurant]/stock/page.js'
import { grouperParCategorie } from './grouper.js'

const LIBELLE_ETAT: Record<string, string> = {
  rupture: 'Rupture',
  faible: 'Faible',
  ok: 'OK',
  non_suivi: 'Non suivi',
}

export function TableauStock({
  restaurantId,
  produits,
  categories,
}: {
  restaurantId: string
  produits: ProduitStock[]
  /** Les catégories DANS L'ORDRE du Menu — c'est l'ordre des groupes. */
  categories: readonly { id: string; nom: string }[]
}) {
  const router = useRouter()
  const [ouvert, setOuvert] = useState<string | null>(null)
  const [message, setMessage] = useState<{ texte: string; erreur: boolean } | null>(null)
  const [enCours, demarrer] = useTransition()

  const agir = (action: () => Promise<{ erreur?: string; succes?: string }>) => {
    demarrer(async () => {
      const r = await action()
      setMessage(
        r.erreur
          ? { texte: r.erreur, erreur: true }
          : { texte: r.succes ?? 'Enregistré.', erreur: false },
      )
      if (!r.erreur) {
        setOuvert(null)
        router.refresh()
      }
    })
  }

  return (
    <section className="bloc">
      <h2>Tous les produits</h2>

      {message && (
        <p className={`message ${message.erreur ? 'erreur' : 'succes'}`}>{message.texte}</p>
      )}

      <table>
        <thead>
          <tr>
            <th>Produit</th>
            <th className="nombre">Prix</th>
            <th className="nombre">Coût</th>
            <th className="nombre">Marge</th>
            {/* Deux colonnes s'appelaient « Stock » : la quantité et l'état
                de la carte. On nomme donc la première par ce qu'elle est —
                une quantité — et la seconde garde « Stock », qui est la
                question posée à la caisse : en reste-t-il ? */}
            <th className="nombre">Quantité</th>
            <th className="nombre">Seuil</th>
            <th>État</th>
            <th>Stock</th>
            <th />
          </tr>
        </thead>
        {/*
          Un `tbody` par catégorie. Quarante références à la file se lisent
          ligne à ligne ; rangées sous « Boissons », « Pizzas », « Plats »,
          elles se parcourent d'un coup d'œil — et une catégorie qu'on a
          oublié de compter saute aux yeux.
        */}
        {grouperParCategorie(produits, (p) => p.categorieId, categories).map((groupe) => (
        <tbody key={groupe.cle}>
          <tr className="ligne-groupe">
            <td colSpan={9}>
              {groupe.titre} <span className="compte">· {groupe.lignes.length}</span>
            </td>
          </tr>
          {groupe.lignes.map((p) => (
            <>
              <tr key={p.id}>
                <td>{p.nom}</td>
                <td className="nombre">{formaterTND(millimes(p.prixMillimes))}</td>
                <td className="nombre">
                  {p.coutUnitaire === null ? (
                    <span className="detail">non saisi</span>
                  ) : (
                    formaterTND(millimes(Math.round(p.coutUnitaire)))
                  )}
                </td>
                <td className={`nombre ${p.margeMillimes < 0 ? 'ecart negatif' : ''}`}>
                  {formaterTND(millimes(p.margeMillimes))}
                  {p.margeBp !== null && (
                    <small className="detail"> {formaterPourcentage(p.margeBp)} %</small>
                  )}
                </td>
                <td className="nombre">{p.suivi ? p.quantite : '—'}</td>
                <td className="nombre">{p.seuil ?? '—'}</td>
                <td>
                  <span className={`etiquette etat-${p.etat}`}>{LIBELLE_ETAT[p.etat]}</span>
                </td>
                <td>
                  {/*
                    Deux informations en un bouton : l'état de la carte, et
                    QUI l'a décidé. « Rupture » seul laissait croire à un bug
                    quand c'était l'automatisme, et à un automatisme quand
                    c'était une décision de gestion.
                  */}
                  <button
                    type="button"
                    className={p.enVente ? 'discret' : 'discret alerte'}
                    disabled={enCours}
                    onClick={() => agir(() => basculerDisponibilite(restaurantId, p.id, !p.enVente))}
                    title={
                      p.enVente
                        ? 'Retirer ce produit de la carte des caisses'
                        : p.motifRetrait === 'stock'
                          ? 'Retiré automatiquement : stock à zéro. Il reviendra seul à la première réception.'
                          : 'Retiré à la main. L’automatisme ne le remettra jamais en vente tout seul.'
                    }
                  >
                    {p.enVente
                      ? 'En stock'
                      : p.motifRetrait === 'stock'
                        ? 'Rupture (auto)'
                        : 'Rupture (manuel)'}
                  </button>
                  {/*
                    La case « auto » a QUITTÉ cette cellule.
                    
                    Deux caractères sans phrase, sous un bouton qui dit déjà
                    autre chose : personne ne pouvait deviner qu'elle coupait
                    la sortie automatique de la carte. On la décochait sans
                    le savoir, et le produit restait vendable à zéro — ce qui
                    ressemblait alors à une panne. Elle vit maintenant dans le
                    tiroir « Ajuster », avec sa phrase entière.

                    Ce qui RESTE ici, c'est la conséquence : quand
                    l'automatisme est coupé ET que le stock est à zéro, la
                    ligne le dit. Sans cela, « Rupture » et « En stock » se
                    contredisent sous les yeux du gérant.
                  */}
                  {p.suivi && !p.ruptureAuto && (p.quantite ?? 0) <= 0 && (
                    <div
                      className="indication"
                      title="Le retrait automatique est coupé pour ce produit (tiroir « Ajuster »)."
                    >
                      automatisme coupé
                    </div>
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    className="discret"
                    onClick={() => setOuvert(ouvert === p.id ? null : p.id)}
                  >
                    {ouvert === p.id ? 'Fermer' : p.suivi ? 'Ajuster' : 'Saisir le stock'}
                  </button>
                </td>
              </tr>

              {ouvert === p.id && (
                <tr key={`${p.id}-edition`} className="ligne-edition">
                  <td colSpan={9}>
                    <div className="grille deux">
                      <form
                        action={(donnees) =>
                          agir(() => activerSuivi(restaurantId, p.id, null, donnees))
                        }
                      >
                        <h3>{p.suivi ? 'Recompter le stock' : 'Saisir le stock'}</h3>
                        <p className="indication">
                          Saisir la quantité <strong>constatée maintenant</strong>. Les
                          ventes antérieures sont réputées déjà déduites : sans cela,
                          le premier comptage retrancherait tout l’historique d’un coup.
                          À zéro, le produit sort de la carte tout seul.
                        </p>
                        <div className="champs deux">
                          <label className="champ">
                            Quantité en stock
                            <input
                              name="quantite"
                              inputMode="decimal"
                              defaultValue={p.suivi ? String(p.quantite) : '0'}
                              required
                            />
                          </label>
                          <label className="champ">
                            Seuil d’alerte (facultatif)
                            <input
                              name="seuil"
                              inputMode="decimal"
                              defaultValue={p.seuil === null ? '' : String(p.seuil)}
                            />
                          </label>
                        </div>
                        {/*
                          Plus d'« arrêter le suivi » : trois notions — suivre,
                          compter, ne plus suivre — pour une seule question,
                          combien en reste-t-il. La rupture automatique fait le
                          reste.
                        */}
                        <button type="submit" className="principal" disabled={enCours}>
                          {p.suivi ? 'Enregistrer le comptage' : 'Enregistrer le stock'}
                        </button>

                        {p.suivi && (
                          <label
                            className="champ"
                            style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}
                          >
                            <input
                              type="checkbox"
                              checked={p.ruptureAuto}
                              disabled={enCours}
                              onChange={(e) =>
                                agir(() =>
                                  basculerRuptureAuto(restaurantId, p.id, e.target.checked),
                                )
                              }
                              style={{ width: 'auto', marginTop: '0.2rem' }}
                            />
                            <span>
                              Retirer ce produit de la carte <strong>dès qu’il atteint
                              zéro</strong>, et l’y remettre à la première réception.
                              <span className="indication">
                                À décocher pour un produit dont le comptage n’est
                                qu’indicatif — un plat dont on ne compte pas les
                                ingrédients ne doit pas disparaître de la carte pour une
                                erreur d’inventaire. Décoché, il reste vendable même à
                                zéro.
                              </span>
                            </span>
                          </label>
                        )}
                      </form>

                      {p.suivi && (
                        <form
                          action={(donnees) =>
                            agir(() => enregistrerMouvement(restaurantId, p.id, null, donnees))
                          }
                        >
                          <h3>Mouvement</h3>
                          <p className="indication">
                            Une réception ajoute, une perte retranche. Saisissez
                            toujours un nombre <strong>positif</strong> : le signe
                            découle du motif.
                          </p>
                          <div className="champs deux">
                            <label className="champ">
                              Quantité
                              <input name="delta" inputMode="decimal" required />
                            </label>
                            <label className="champ">
                              Motif
                              {/*
                                Deux motifs, pas trois. « Correction » attirait
                                tout ce qu'on n'avait pas envie de qualifier, et
                                l'historique perdait ce qu'on lui demande :
                                POURQUOI le stock a bougé. Un recomptage se fait
                                dans le formulaire de gauche, qui repose la
                                référence — c'est le geste juste.
                              */}
                              <select name="raison" defaultValue="reception">
                                <option value="reception">Réception</option>
                                <option value="perte">Perte / casse</option>
                              </select>
                            </label>
                          </div>
                          <div className="champs deux">
                            <label className="champ">
                              Fournisseur (facultatif)
                              <input name="fournisseur" placeholder="Sfax Primeurs" />
                            </label>
                            <label className="champ">
                              Note (facultatif)
                              <input name="note" placeholder="Facture 128" />
                            </label>
                          </div>
                          <button type="submit" className="principal" disabled={enCours}>
                            Enregistrer le mouvement
                          </button>
                        </form>
                      )}
                    </div>

                    {p.suivi && (
                      <p className="indication">
                        Depuis le comptage : {p.vendue} vendu(s).
                        {p.compteA &&
                          ` Dernier comptage le ${new Date(p.compteA).toLocaleString('fr-FR', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}.`}
                      </p>
                    )}
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
        ))}
      </table>
    </section>
  )
}
