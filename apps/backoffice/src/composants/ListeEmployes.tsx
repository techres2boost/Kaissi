'use client'

import { useActionState, useState } from 'react'
import {
  changerRole,
  changerStatut,
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

const ROLES = [
  { valeur: 'gerant', libelle: 'Gérant — remises sans limite' },
  { valeur: 'caissier', libelle: 'Caissier — remises jusqu’à 10 %' },
  { valeur: 'serveur', libelle: 'Serveur — remises jusqu’à 5 %' },
  { valeur: 'cuisine', libelle: 'Cuisine — pas de caisse' },
]

export function ListeEmployes({
  restaurantId,
  modifiable,
  employes,
}: {
  restaurantId: string
  modifiable: boolean
  employes: Employe[]
}) {
  const [cible, setCible] = useState<Employe | null>(null)

  return (
    <>
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
          employe={cible}
          fermer={() => setCible(null)}
        />
      )}
    </>
  )
}

function PanneauEmploye({
  restaurantId,
  employe,
  fermer,
}: {
  restaurantId: string
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

        <form action={actionRole}>
          <h2 style={{ fontSize: '0.95rem' }}>Rôle</h2>
          <Message resultat={resultatRole} />
          <div className="champ">
            <label htmlFor={`role-${employe.id}`}>Rôle dans cet établissement</label>
            <select id={`role-${employe.id}`} name="role" defaultValue={employe.role}>
              {ROLES.map((role) => (
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
            peut être serveur ici et caissier ailleurs. « Administrateur » ne s&apos;attribue
            que par un administrateur.
          </p>
        </form>
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
