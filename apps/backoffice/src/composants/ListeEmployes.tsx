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
  /** Poste tenu, pour un rôle de préparation. `null` : tous les postes. */
  posteId: string | null
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
  { valeur: 'cuisine', libelle: 'Cuisine — écran de préparation seul', cles: false },
  { valeur: 'bar', libelle: 'Bar — écran de préparation seul', cles: false },
]

/**
 * Les rôles qui tiennent un POSTE.
 *
 * Le champ n'apparaît que pour eux : proposer un poste à un caissier
 * poserait une question qui n'a pas de réponse, et un formulaire qui pose
 * des questions inutiles finit par ne plus être lu.
 */
const ROLES_DE_PREPARATION: readonly string[] = ['cuisine', 'bar']

/** Un poste de préparation de l'établissement — Cuisine, Bar… */
export interface Poste {
  id: string
  nom: string
}

export function ListeEmployes({
  restaurantId,
  modifiable,
  administrateur,
  employes,
  postes,
}: {
  restaurantId: string
  modifiable: boolean
  /** Seul un administrateur peut accorder un rôle qui donne les clés. */
  administrateur: boolean
  employes: Employe[]
  postes: Poste[]
}) {
  const [cible, setCible] = useState<Employe | null>(null)
  const [embaucheOuverte, setEmbaucheOuverte] = useState(false)

  return (
    <>
      {modifiable && (
        <FormulaireEmbauche
          restaurantId={restaurantId}
          administrateur={administrateur}
          postes={postes}
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
          postes={postes}
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
  postes,
  fermer,
}: {
  restaurantId: string
  administrateur: boolean
  employe: Employe
  postes: Poste[]
  fermer: () => void
}) {
  const [resultatPin, actionPin, pinEnCours] = useActionState(
    reinitialiserPin.bind(null, restaurantId, employe.id),
    null as Resultat | null,
  )
  const [roleChoisi, setRoleChoisi] = useState(employe.role)
  const [resultatRole, actionRole, roleEnCours] = useActionState(
    changerRole.bind(null, restaurantId, employe.id, postes.map((p) => p.id)),
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
            <select
              id={`role-${employe.id}`}
              name="role"
              defaultValue={employe.role}
              // Le champ POSTE apparaît et disparaît avec le rôle : on suit
              // donc la sélection en cours, pas seulement la valeur enregistrée.
              onChange={(e) => setRoleChoisi(e.currentTarget.value)}
            >
              {ROLES.filter((r) => administrateur || !r.cles).map((role) => (
                <option key={role.valeur} value={role.valeur}>
                  {role.libelle}
                </option>
              ))}
            </select>
          </div>

          <ChampPoste
            id={`poste-${employe.id}`}
            role={roleChoisi}
            postes={postes}
            valeur={employe.posteId}
          />

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

/**
 * Le poste tenu — visible SEULEMENT pour un rôle qui prépare.
 *
 * ── Pourquoi ce champ existe ──────────────────────────────────────────────
 *
 * Sans lui, le poste se devinait en comparant le rôle au NOM de la station.
 * Cela marche jusqu'au jour où quelqu'un renomme « Bar » en « Comptoir » :
 * l'écran du barman se vide, et rien n'explique pourquoi. Le rendre explicite
 * transforme un mystère en réglage.
 *
 * « Tous les postes » reste un choix valide : dans un snack à un seul écran,
 * c'est ce qu'on veut, et l'imposer obligerait à créer des postes fictifs.
 */
function ChampPoste({
  id,
  role,
  postes,
  valeur,
}: {
  id: string
  role: string
  postes: Poste[]
  valeur?: string | null
}) {
  if (!ROLES_DE_PREPARATION.includes(role)) return null

  if (postes.length === 0) {
    return (
      <p className="indication">
        Aucun poste de préparation n’est défini pour cet établissement. Cette
        personne verra <strong>toutes</strong> les lignes du service — ce qui
        est correct s’il n’y a qu’un écran.
      </p>
    )
  }

  return (
    <div className="champ">
      <label htmlFor={id}>Poste tenu</label>
      <select id={id} name="poste" defaultValue={valeur ?? ''}>
        <option value="">— tous les postes —</option>
        {postes.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nom}
          </option>
        ))}
      </select>
      <p className="indication">
        Son écran de préparation n’affichera que les lignes de ce poste, et son
        titre en portera le nom. « Tous les postes » convient à un
        établissement qui n’a qu’un seul écran.
      </p>
    </div>
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
  postes,
  ouvert,
  ouvrir,
  fermer,
}: {
  restaurantId: string
  administrateur: boolean
  postes: Poste[]
  ouvert: boolean
  ouvrir: () => void
  fermer: () => void
}) {
  const [roleChoisi, setRoleChoisi] = useState('serveur')
  const [resultat, action, enCours] = useActionState(
    embaucher.bind(null, restaurantId, postes.map((p) => p.id)),
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
            <select
              id="role-embauche"
              name="role"
              defaultValue="serveur"
              onChange={(e) => setRoleChoisi(e.currentTarget.value)}
            >
              {ROLES.filter((r) => administrateur || !r.cles).map((role) => (
                <option key={role.valeur} value={role.valeur}>
                  {role.libelle}
                </option>
              ))}
            </select>
          </div>
        </div>

        <ChampPoste id="poste-embauche" role={roleChoisi} postes={postes} />

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
