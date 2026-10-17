'use client'

import { useActionState, useState, useTransition } from 'react'
import {
  changerMotDePasseAcces,
  changerRole,
  changerStatut,
  embaucher,
  ouvrirAcces,
  reinitialiserPin,
  retirerDeLEtablissement,
  type Resultat,
} from '../app/[restaurant]/employes/actions.js'
import { useT } from '../i18n/client.js'
import { aTraduire } from '@kaissi/i18n'

export interface Employe {
  id: string
  nom: string
  email: string
  role: string
  statut: string
  aUnPin: boolean
  /** A-t-il un compte pour OUVRIR le back-office ? Le PIN est autre chose. */
  aUnCompte: boolean
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
  { valeur: 'gerant', libelle: aTraduire('Gérant — remises sans limite'), cles: true },
  { valeur: 'caissier', libelle: aTraduire('Caissier — remises jusqu’à 10 %'), cles: false },
  { valeur: 'serveur', libelle: aTraduire('Serveur — remises jusqu’à 5 %'), cles: false },
  { valeur: 'cuisine', libelle: aTraduire('Cuisine — écran de préparation seul'), cles: false },
  { valeur: 'bar', libelle: aTraduire('Bar — écran de préparation seul'), cles: false },
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
  const t = useT()
  const [cible, setCible] = useState<Employe | null>(null)
  const [embaucheOuverte, setEmbaucheOuverte] = useState(false)
  /*
   * Le résultat de « Suspendre » était JETÉ.
   *
   * Le bouton appelait l'action sans rien faire de ce qu'elle rend : quand
   * elle échouait — et elle échouait, faute d'un privilège de colonne — il
   * ne se passait strictement rien à l'écran. Un bouton qui ne dit ni oui ni
   * non est pire qu'un bouton absent : on le presse trois fois, puis on
   * conclut que le logiciel est cassé, sans jamais savoir pourquoi.
   */
  const [message, setMessage] = useState<Resultat | null>(null)
  const [enCours, demarrer] = useTransition()

  const basculerStatut = (employe: Employe) => {
    setMessage(null)
    demarrer(async () => {
      setMessage(await changerStatut(restaurantId, employe.id, employe.statut === 'actif'))
    })
  }

  const retirer = (employe: Employe) => {
    setMessage(null)
    demarrer(async () => {
      setMessage(await retirerDeLEtablissement(restaurantId, employe.id))
    })
  }

  /*
   * Deux tables, pas une colonne « État » à relire ligne par ligne.
   *
   * Un employé suspendu au milieu des autres se lit comme un employé : on
   * regarde le nom et le rôle, pas l'étiquette au bout de la ligne. Or la
   * question qu'on pose à cet écran est « qui travaille ici », et la réponse
   * doit tenir dans la première table — sans quoi on finit par compter les
   * étiquettes.
   *
   * Les suspendus ne DISPARAISSENT pas pour autant : on doit pouvoir
   * réactiver quelqu'un revenu de congé, et surtout voir qu'il existe. Ils
   * descendent simplement dans leur propre section.
   */
  const enPoste = employes.filter((e) => e.statut === 'actif')
  const suspendus = employes.filter((e) => e.statut !== 'actif')

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
        <Message resultat={message} />
        {employes.length === 0 ? (
          <p className="vide">{t('Aucun employé rattaché à cet établissement.')}</p>
        ) : (
          <TableEmployes
            titre={t('En poste')}
            employes={enPoste}
            vide={t('Personne en poste : tout le monde est suspendu.')}
            modifiable={modifiable}
            enCours={enCours}
            gerer={setCible}
            basculerStatut={basculerStatut}
            retirer={retirer}
          />
        )}
      </section>

      {/*
        Les suspendus, à part et repliés. Ils restent à un clic — quelqu'un
        revient de congé, on le réactive — mais ils ne se lisent plus au
        milieu de l'équipe du jour.
      */}
      {suspendus.length > 0 && (
        <section className="carte">
          <details>
            <summary>{t('Ne prennent plus de poste')}{' '}<span className="etiquette">{suspendus.length}</span>
            </summary>
            <p className="indication">{t('Un employé suspendu ne peut plus ouvrir de commande ; ses ventes passées gardent son nom.')}{' '}<strong>{t('Retirer')}</strong>{' '}{t('le sort définitivement de cet établissement — sans rien effacer de ce qu’il a fait.')}</p>
            <TableEmployes
              titre={null}
              employes={suspendus}
              vide=""
              modifiable={modifiable}
              enCours={enCours}
              gerer={setCible}
              basculerStatut={basculerStatut}
              retirer={retirer}
            />
          </details>
        </section>
      )}

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

/** La table elle-même — la même pour l'équipe en poste et pour les suspendus. */
function TableEmployes({
  titre,
  employes,
  vide,
  modifiable,
  enCours,
  gerer,
  basculerStatut,
  retirer,
}: {
  titre: string | null
  employes: Employe[]
  vide: string
  modifiable: boolean
  enCours: boolean
  gerer: (e: Employe) => void
  basculerStatut: (e: Employe) => void
  retirer: (e: Employe) => void
}) {
  const t = useT()
  if (employes.length === 0) return vide ? <p className="vide">{vide}</p> : null
  return (
    <>
      {titre && <h2>{titre}</h2>}
      <table>
            <thead>
              <tr>
                <th>{t('Employé')}</th>
                <th>{t('Rôle')}</th>
                <th className="nombre">{t('Plafond de remise')}</th>
                <th>{t('Code PIN')}</th>
                <th>{t('État')}</th>
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
                  <td>{t.role(employe.role)}</td>
                  <td className="nombre">{employe.plafondRemise} %</td>
                  <td>
                    {employe.aUnPin ? (
                      <span className="etiquette actif">{t('défini')}</span>
                    ) : (
                      <span className="etiquette inactif">{t('aucun')}</span>
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
                            onClick={() => gerer(employe)}
                          >{t('Gérer')}</button>
                          <button
                            type="button"
                            className="discret"
                            disabled={enCours}
                            onClick={() => basculerStatut(employe)}
                          >
                            {employe.statut === 'actif' ? t('Suspendre') : t('Réactiver')}
                          </button>
                          {/*
                            « Retirer » n'apparaît QUE pour un employé déjà
                            suspendu. Un départ se décide en deux temps —
                            suspendre, puis retirer — et ce n'est pas une
                            précaution de façade : sur la même ligne que
                            « Gérer », le bouton qui sort quelqu'un de
                            l'établissement se cliquerait par erreur, un jour
                            de service.
                          */}
                          {employe.statut !== 'actif' && (
                            <button
                              type="button"
                              className="discret danger"
                              disabled={enCours}
                              onClick={() => {
                                if (
                                  confirm(
                                    t(
                                      'Retirer {nom} de cet établissement ?\n\nIl disparaîtra de la liste et ne pourra plus prendre de poste. Ses ventes passées gardent son nom — rien n’est effacé. Le réembaucher plus tard reste possible.',
                                      { nom: employe.nom },
                                    ),
                                  )
                                ) {
                                  retirer(employe)
                                }
                              }}
                            >{t('Retirer')}</button>
                          )}
                        </>
                      ) : (
                        <span className="indication">{t('non administrable ici')}</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
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
  const t = useT()
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
        <button type="button" className="discret" style={{ marginInlineStart: 'auto' }} onClick={fermer}>{t('Fermer')}</button>
      </div>

      <div className="grille deux" style={{ marginTop: '1rem' }}>
        <form action={actionPin}>
          <h2 style={{ fontSize: '0.95rem' }}>{t('Code PIN')}</h2>
          <Message resultat={resultatPin} />
          <div className="champ">
            <label htmlFor={`pin-${employe.id}`}>{t('Nouveau code')}</label>
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
            <label htmlFor={`conf-${employe.id}`}>{t('Confirmer')}</label>
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
            {pinEnCours ? t('Calcul du hachage…') : t('Réinitialiser le PIN')}
          </button>
          <p className="indication">{t('Le code est haché (Argon2id) avant d\'être enregistré : il n\'est jamais stocké ni réaffiché en clair. Notez-le maintenant — vous ne pourrez pas le relire. Un PIN à quatre chiffres dit')}{' '}<strong>{t('qui')}</strong>{' '}{t('a agi ; ce qui protège l\'argent, c\'est le jeton d\'appareil, RLS et le journal d\'audit.')}</p>
        </form>

        {/*
          Un gérant ne touche pas au rôle d'un pair ni d'un administrateur.
          RLS le refuse déjà (migration 0024) — mais afficher un formulaire qui
          va échouer, avec une liste où le rôle actuel n'apparaît même pas,
          ferait croire à une rétrogradation qui n'a pas eu lieu.
        */}
        {!administrateur && ROLES_A_CLES.includes(employe.role) ? (
          <section>
            <h2 style={{ fontSize: '0.95rem' }}>{t('Rôle')}</h2>
            <p className="indication">
              {employe.nom}{' '}{t('est')}{' '}{t.role(employe.role)}{t('. Seul un administrateur peut modifier ce rôle : accorder ou retirer l’accès à l’argent et à la configuration ne relève pas de la gestion courante.')}</p>
          </section>
        ) : (
        <form action={actionRole}>
          <h2 style={{ fontSize: '0.95rem' }}>{t('Rôle')}</h2>
          <Message resultat={resultatRole} />
          <div className="champ">
            <label htmlFor={`role-${employe.id}`}>{t('Rôle dans cet établissement')}</label>
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
                  {t(role.libelle)}
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
            {roleEnCours ? t('Enregistrement…') : t('Changer le rôle')}
          </button>
          <p className="indication">{t('Le rôle vaut pour')}{' '}<strong>{t('cet établissement')}</strong>{' '}{t('seulement. Le même employé peut être serveur ici et caissier ailleurs. « Gérant » et « Administrateur » ne s\'attribuent que par un administrateur.')}</p>
        </form>
        )}
      </div>

      <AccesBackoffice
        restaurantId={restaurantId}
        administrateur={administrateur}
        employe={employe}
      />
    </section>
  )
}

/**
 * L'accès au BACK-OFFICE — e-mail et mot de passe.
 *
 * ── Pourquoi ce bloc existe ───────────────────────────────────────────────
 *
 * Il fallait jusqu'ici créer le compte dans le tableau de bord Supabase,
 * PUIS lancer `pnpm sync:acces` dans un terminal. Aucun restaurateur ne fera
 * ça, et il aura raison : ouvrir un écran à son cuisinier n'est pas une
 * opération d'administrateur système.
 *
 * ── Ce que le back-office ne fait toujours pas ────────────────────────────
 *
 * Créer le compte lui-même. Cela exige la clé `service_role`, qui contourne
 * RLS ; elle vit dans le service de synchronisation, jamais ici. Ce
 * formulaire lui parle, avec le jeton de la session en cours, et c'est le
 * service qui relit les droits en base. La règle du dépôt tient : la clé
 * n'est jamais descendue d'un cran vers le navigateur.
 */
function AccesBackoffice({
  restaurantId,
  administrateur,
  employe,
}: {
  restaurantId: string
  administrateur: boolean
  employe: Employe
}) {
  const t = useT()
  const [resultat, action, enCours] = useActionState(
    employe.aUnCompte
      ? changerMotDePasseAcces.bind(null, restaurantId, employe.id)
      : ouvrirAcces.bind(null, restaurantId, {
          id: employe.id,
          nom: employe.nom,
          email: employe.email,
          role: employe.role,
        }),
    null as Resultat | null,
  )

  // Un gérant ne remet pas le mot de passe d'un pair ni d'un administrateur :
  // ce serait prendre sa place. Le service le refuse aussi — l'écrire ici
  // évite seulement de proposer un bouton qui va échouer.
  if (!administrateur && ROLES_A_CLES.includes(employe.role)) {
    return (
      <section style={{ marginTop: '1rem' }}>
        <h2 style={{ fontSize: '0.95rem' }}>{t('Accès au back-office')}</h2>
        <p className="indication">{t('Seul un administrateur peut ouvrir ou réinitialiser l’accès d’un')}{' '}
          {t.role(employe.role)}.
        </p>
      </section>
    )
  }

  return (
    <form action={action} style={{ marginTop: '1rem' }}>
      <h2 style={{ fontSize: '0.95rem' }}>{t('Accès au back-office')}</h2>
      <Message resultat={resultat} />

      {employe.aUnCompte ? (
        <p className="indication">
          {employe.nom}{' '}{t('se connecte déjà avec')}{' '}<strong>{employe.email}</strong>{t('. Mot de passe perdu ? Posez-en un nouveau ci-dessous.')}</p>
      ) : (
        <div className="champ">
          <label htmlFor={`email-${employe.id}`}>{t('Adresse e-mail')}</label>
          <input
            id={`email-${employe.id}`}
            name="email"
            type="email"
            defaultValue={employe.email}
            required
          />
          <p className="indication">{t('C’est l’identifiant de connexion. Elle n’a pas besoin d’être relevée : aucun e-mail n’est envoyé, le mot de passe se communique de vive voix.')}</p>
        </div>
      )}

      <div className="champ">
        <label htmlFor={`mdp-${employe.id}`}>
          {employe.aUnCompte ? t('Nouveau mot de passe') : t('Mot de passe')}
        </label>
        <input
          id={`mdp-${employe.id}`}
          name="motDePasse"
          type="text"
          autoComplete="off"
          minLength={8}
          required
        />
        <p className="indication">{t('Huit caractères au moins. Il est affiché en clair pendant que vous le tapez — c’est voulu : il faut le dicter, et un mot de passe qu’on recopie de travers n’ouvre rien.')}</p>
      </div>

      <button type="submit" className="principal" disabled={enCours}>
        {enCours
          ? t('Envoi…')
          : employe.aUnCompte
            ? t('Changer le mot de passe')
            : t('Ouvrir l’accès (rôle « {role} »)', { role: employe.role })}
      </button>
      {!employe.aUnCompte && (
        <p className="indication">{t('Le rôle donné à l’accès est celui de l’employé, ci-dessus. Un rôle de préparation n’ouvre que son écran ; un caissier ou un serveur n’a en général pas besoin de compte du tout — il tape un PIN sur la tablette.')}</p>
      )}
    </form>
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
  const t = useT()
  if (!ROLES_DE_PREPARATION.includes(role)) return null

  if (postes.length === 0) {
    return (
      <p className="indication">{t('Aucun poste de préparation n’est défini pour cet établissement. Cette personne verra')}{' '}<strong>{t('toutes')}</strong>{' '}{t('les lignes du service — ce qui est correct s’il n’y a qu’un écran.')}</p>
    )
  }

  return (
    <div className="champ">
      <label htmlFor={id}>{t('Poste tenu')}</label>
      <select id={id} name="poste" defaultValue={valeur ?? ''}>
        <option value="">{t('— tous les postes —')}</option>
        {postes.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nom}
          </option>
        ))}
      </select>
      <p className="indication">{t('Son écran de préparation n’affichera que les lignes de ce poste, et son titre en portera le nom. « Tous les postes » convient à un établissement qui n’a qu’un seul écran.')}</p>
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
  const t = useT()
  const [roleChoisi, setRoleChoisi] = useState('serveur')
  const [resultat, action, enCours] = useActionState(
    embaucher.bind(null, restaurantId, postes.map((p) => p.id)),
    null as Resultat | null,
  )

  if (!ouvert) {
    return (
      <div style={{ marginBottom: '1.25rem' }}>
        <Message resultat={resultat} />
        <button type="button" className="principal" onClick={ouvrir}>{t('Embaucher un employé')}</button>
      </div>
    )
  }

  return (
    <section className="carte" style={{ borderColor: 'var(--accent)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline' }}>
        <h2 style={{ marginBottom: 0 }}>{t('Embaucher un employé')}</h2>
        <button type="button" className="discret" style={{ marginInlineStart: 'auto' }} onClick={fermer}>{t('Annuler')}</button>
      </div>

      <form action={action} style={{ marginTop: '1rem' }}>
        <Message resultat={resultat} />

        <div className="champs deux">
          <div className="champ">
            <label htmlFor="nom-embauche">{t('Nom complet')}</label>
            <input id="nom-embauche" name="nom" required autoFocus placeholder={t('Mohamed Ben Ali')} />
          </div>
          <div className="champ">
            <label htmlFor="role-embauche">{t('Rôle')}</label>
            <select
              id="role-embauche"
              name="role"
              defaultValue="serveur"
              onChange={(e) => setRoleChoisi(e.currentTarget.value)}
            >
              {ROLES.filter((r) => administrateur || !r.cles).map((role) => (
                <option key={role.valeur} value={role.valeur}>
                  {t(role.libelle)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <ChampPoste id="poste-embauche" role={roleChoisi} postes={postes} />

        <div className="champs deux">
          <div className="champ">
            <label htmlFor="pin-embauche">{t('Code PIN')}</label>
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
            <label htmlFor="conf-embauche">{t('Confirmer le code')}</label>
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
          <label htmlFor="email-embauche">{t('E-mail (facultatif)')}</label>
          <input id="email-embauche" name="email" type="email" placeholder="—" />
          <p className="indication">{t('Uniquement si cette personne doit un jour ouvrir le back-office. Un serveur en salle n\'en a pas besoin : il tape son PIN sur la tablette, il ne se connecte à rien.')}</p>
        </div>

        <button type="submit" className="principal" disabled={enCours}>
          {enCours ? t('Calcul du hachage…') : t('Embaucher')}
        </button>
        <p className="indication">{t('Le PIN est haché (Argon2id) avant d\'être enregistré. Notez-le maintenant : il ne sera jamais réaffiché. Renseigner un e-mail ne crée')}{' '}<strong>{t('pas')}</strong>{' '}{t('de compte de connexion — cela reste une opération d\'administrateur.')}</p>
      </form>
    </section>
  )
}
