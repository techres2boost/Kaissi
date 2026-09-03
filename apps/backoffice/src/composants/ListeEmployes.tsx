'use client'

import { useActionState, useState } from 'react'
import {
  changerRole,
  changerStatut,
  embaucher,
  reinitialiserPin,
  type Resultat,
} from '../app/[restaurant]/employes/actions.js'

export interface Employe {
  id: string
  nom: string
  email: string
  role: string
  statut: string
  aUnPin: boolean
  plafondRemise: string
  administrable: boolean
}

/**
 * `cles: true` = ce rôle donne accès à l'argent et à la configuration.
 * Seul un administrateur peut l'accorder : le distribuer, c'est distribuer
 * ses propres pouvoirs. RLS applique la même règle (migration 0024).
 */
/** Les rôles qui donnent accès à l'argent et à la configuration. */
const ROLES_A_CLES: readonly string[] = ['admin', 'gerant']

const ROLES = [
  { valeur: 'gerant', libelle: 'Gérant — remises sans limite', cles: true },
  { valeur: 'caissier', libelle: 'Caissier — remises jusqu’à 10 %', cles: false },
  { valeur: 'serveur', libelle: 'Serveur — remises jusqu’à 5 %', cles: false },
  { valeur: 'cuisine', libelle: 'Cuisine — pas de caisse', cles: false },
]

export function ListeEmployes({
  restaurantId,
  modifiable,
  administrateur,
  employes,
}: {
  restaurantId: string
  modifiable: boolean
  /** Seul un administrateur peut accorder un rôle qui donne les clés. */
  administrateur: boolean
  employes: Employe[]
}) {
  const [cible, setCible] = useState<Employe | null>(null)
  const [embaucheOuverte, setEmbaucheOuverte] = useState(false)

  return (
    <>
      {modifiable && (
        <FormulaireEmbauche
          restaurantId={restaurantId}
          administrateur={administrateur}
          ouvert={embaucheOuverte}
          ouvrir={() => setEmbaucheOuverte(true)}
          fermer={() => setEmbaucheOuverte(false)}
        />
      )}

      <section className="carte">
        {employes.length === 0 ? (
          <p className="vide">Aucun employé rattaché à cet établissement.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Employé</th>
                <th>Rôle</th>
                <th className="nombre">Plafond de remise</th>
                <th>Code PIN</th>
                <th>État</th>
                {modifiable && <th />}
              </tr>
            </thead>
            <tbody>
              {employes.map((employe) => (
                <tr key={employe.id}>
                  <td>
                    {employe.nom}
                    <div className="indication">{employe.email}</div>
                  </td>
                  <td>{employe.role}</td>
                  <td className="nombre">{employe.plafondRemise} %</td>
                  <td>
                    {employe.aUnPin ? (
                      <span className="etiquette actif">défini</span>
                    ) : (
                      <span className="etiquette inactif">aucun</span>
                    )}
                  </td>
                  <td>
                    <span
                      className={`etiquette ${employe.statut === 'actif' ? 'actif' : 'inactif'}`}
                    >
                      {employe.statut}
                    </span>
                  </td>
                  {modifiable && (
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {employe.administrable ? (
                        <>
                          <button
                            type="button"
                            className="discret"
                            onClick={() => setCible(employe)}
                          >
                            Gérer
                          </button>
                          <button
                            type="button"
                            className="discret"
                            onClick={() =>
                              void changerStatut(
                                restaurantId,
                                employe.id,
                                employe.statut === 'actif',
                              )
                            }
                          >
                            {employe.statut === 'actif' ? 'Suspendre' : 'Réactiver'}
                          </button>
                        </>
                      ) : (
                        <span className="indication">non administrable ici</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {cible && (
        <PanneauEmploye
          key={cible.id}
          restaurantId={restaurantId}
          administrateur={administrateur}
          employe={cible}
          fermer={() => setCible(null)}
        />
      )}
    </>
  )
}

function PanneauEmploye({
  restaurantId,
  administrateur,
  employe,
  fermer,
}: {
  restaurantId: string
  administrateur: boolean
  employe: Employe
  fermer: () => void
}) {
  const [resultatPin, actionPin, pinEnCours] = useActionState(
    reinitialiserPin.bind(null, restaurantId, employe.id),
    null as Resultat | null,
  )
  const [resultatRole, actionRole, roleEnCours] = useActionState(
    changerRole.bind(null, restaurantId, employe.id),
    null as Resultat | null,
  )

  return (
    <section className="carte" style={{ borderColor: 'var(--accent)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline' }}>
        <h2 style={{ marginBottom: 0 }}>{employe.nom}</h2>
        <button type="button" className="discret" style={{ marginLeft: 'auto' }} onClick={fermer}>
          Fermer
        </button>
      </div>

      <div className="grille deux" style={{ marginTop: '1rem' }}>
        <form action={actionPin}>
          <h2 style={{ fontSize: '0.95rem' }}>Code PIN</h2>
          <Message resultat={resultatPin} />
          <div className="champ">
            <label htmlFor={`pin-${employe.id}`}>Nouveau code</label>
            <input
              id={`pin-${employe.id}`}
              name="pin"
              inputMode="numeric"
              autoComplete="off"
              maxLength={8}
              required
            />
          </div>
          <div className="champ">
            <label htmlFor={`conf-${employe.id}`}>Confirmer</label>
            <input
              id={`conf-${employe.id}`}
              name="confirmation"
              inputMode="numeric"
              autoComplete="off"
              maxLength={8}
              required
            />
          </div>
          <button type="submit" className="principal" disabled={pinEnCours}>
            {pinEnCours ? 'Calcul du hachage…' : 'Réinitialiser le PIN'}
          </button>
          <p className="indication">
            Le code est haché (Argon2id) avant d&apos;être enregistré&nbsp;: il n&apos;est
            jamais stocké ni réaffiché en clair. Notez-le maintenant — vous ne pourrez pas
            le relire. Un PIN à quatre chiffres dit <strong>qui</strong> a agi&nbsp;; ce qui
            protège l&apos;argent, c&apos;est le jeton d&apos;appareil, RLS et le journal
            d&apos;audit.
          </p>
        </form>

        {/*
          Un gérant ne touche pas au rôle d'un pair ni d'un administrateur.
          RLS le refuse déjà (migration 0024) — mais afficher un formulaire qui
          va échouer, avec une liste où le rôle actuel n'apparaît même pas,
          ferait croire à une rétrogradation qui n'a pas eu lieu.
        */}
        {!administrateur && ROLES_A_CLES.includes(employe.role) ? (
          <section>
            <h2 style={{ fontSize: '0.95rem' }}>Rôle</h2>
            <p className="indication">
              {employe.nom} est {employe.role}. Seul un administrateur peut
              modifier ce rôle : accorder ou retirer l’accès à l’argent et à la
              configuration ne relève pas de la gestion courante.
            </p>
          </section>
        ) : (
        <form action={actionRole}>
          <h2 style={{ fontSize: '0.95rem' }}>Rôle</h2>
          <Message resultat={resultatRole} />
          <div className="champ">
            <label htmlFor={`role-${employe.id}`}>Rôle dans cet établissement</label>
            <select id={`role-${employe.id}`} name="role" defaultValue={employe.role}>
              {ROLES.filter((r) => administrateur || !r.cles).map((role) => (
                <option key={role.valeur} value={role.valeur}>
                  {role.libelle}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" disabled={roleEnCours}>
            {roleEnCours ? 'Enregistrement…' : 'Changer le rôle'}
          </button>
          <p className="indication">
            Le rôle vaut pour <strong>cet établissement</strong> seulement. Le même employé
            peut être serveur ici et caissier ailleurs. « Gérant » et
            « Administrateur » ne s&apos;attribuent que par un administrateur.
          </p>
        </form>
        )}
      </div>
    </section>
  )
}

function Message({ resultat }: { resultat: Resultat | null }) {
  if (!resultat) return null
  return (
    <p className={`message ${resultat.erreur ? 'erreur' : 'succes'}`} role="alert">
      {resultat.erreur ?? resultat.succes}
    </p>
  )
}

function FormulaireEmbauche({
  restaurantId,
  administrateur,
  ouvert,
  ouvrir,
  fermer,
}: {
  restaurantId: string
  administrateur: boolean
  ouvert: boolean
  ouvrir: () => void
  fermer: () => void
}) {
  const [resultat, action, enCours] = useActionState(
    embaucher.bind(null, restaurantId),
    null as Resultat | null,
  )

  if (!ouvert) {
    return (
      <div style={{ marginBottom: '1.25rem' }}>
        <Message resultat={resultat} />
        <button type="button" className="principal" onClick={ouvrir}>
          Embaucher un employé
        </button>
      </div>
    )
  }

  return (
    <section className="carte" style={{ borderColor: 'var(--accent)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline' }}>
        <h2 style={{ marginBottom: 0 }}>Embaucher un employé</h2>
        <button type="button" className="discret" style={{ marginLeft: 'auto' }} onClick={fermer}>
          Annuler
        </button>
      </div>

      <form action={action} style={{ marginTop: '1rem' }}>
        <Message resultat={resultat} />

        <div className="champs deux">
          <div className="champ">
            <label htmlFor="nom-embauche">Nom complet</label>
            <input id="nom-embauche" name="nom" required autoFocus placeholder="Mohamed Ben Ali" />
          </div>
          <div className="champ">
            <label htmlFor="role-embauche">Rôle</label>
            <select id="role-embauche" name="role" defaultValue="serveur">
              {ROLES.filter((r) => administrateur || !r.cles).map((role) => (
                <option key={role.valeur} value={role.valeur}>
                  {role.libelle}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="champs deux">
          <div className="champ">
            <label htmlFor="pin-embauche">Code PIN</label>
            <input
              id="pin-embauche"
              name="pin"
              inputMode="numeric"
              autoComplete="off"
              maxLength={8}
              required
            />
          </div>
          <div className="champ">
            <label htmlFor="conf-embauche">Confirmer le code</label>
            <input
              id="conf-embauche"
              name="confirmation"
              inputMode="numeric"
              autoComplete="off"
              maxLength={8}
              required
            />
          </div>
        </div>

        <div className="champ">
          <label htmlFor="email-embauche">E-mail (facultatif)</label>
          <input id="email-embauche" name="email" type="email" placeholder="—" />
          <p className="indication">
            Uniquement si cette personne doit un jour ouvrir le back-office. Un serveur en
            salle n&apos;en a pas besoin&nbsp;: il tape son PIN sur la tablette, il ne se
            connecte à rien.
          </p>
        </div>

        <button type="submit" className="principal" disabled={enCours}>
          {enCours ? 'Calcul du hachage…' : 'Embaucher'}
        </button>
        <p className="indication">
          Le PIN est haché (Argon2id) avant d&apos;être enregistré. Notez-le maintenant&nbsp;:
          il ne sera jamais réaffiché. Renseigner un e-mail ne crée <strong>pas</strong> de
          compte de connexion — cela reste une opération d&apos;administrateur.
        </p>
      </form>
    </section>
  )
}
