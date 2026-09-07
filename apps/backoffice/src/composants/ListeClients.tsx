'use client'

/**
 * La liste des clients — recherche, pagination, fiche.
 *
 * ── Pourquoi la recherche vit dans l'URL ──────────────────────────────────
 *
 * Comme la période des rapports : un écran filtré se partage, se met en
 * favori et survit à un rechargement. C'est aussi ce qui permet à la page
 * serveur de faire le filtrage en base plutôt que dans le navigateur — la
 * seule façon de tenir un carnet de deux mille fiches.
 *
 * ── Une fiche s'ouvre EN PLACE ────────────────────────────────────────────
 *
 * Pas de page dédiée : on ouvre une fiche pour corriger un numéro mal noté,
 * et on revient à la liste. Une navigation complète pour deux caractères
 * ferait perdre la recherche en cours à chaque correction.
 */

import { useActionState, useState, useTransition } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import {
  archiverClient,
  creerClient,
  importerClients,
  modifierClient,
  type BilanImport,
  type Resultat,
} from '../app/[restaurant]/clients/actions.js'
import { destinationSure } from '../serveur/redirection.js'

export interface ClientAffiche {
  id: string
  nom: string
  telephone: string
  email: string
  note: string
  archive: boolean
  premiereVisite: string
  derniereVisite: string
  visites: number
  depense: string
  depenseMillimes: number
}

export function ListeClients({
  restaurantId,
  modifiable,
  clients,
  total,
  page,
  taille,
  tailles,
  recherche,
  archives,
}: {
  restaurantId: string
  modifiable: boolean
  clients: ClientAffiche[]
  total: number
  page: number
  taille: number
  tailles: readonly number[]
  recherche: string
  archives: boolean
}) {
  const router = useRouter()
  const chemin = usePathname()
  const parametres = useSearchParams()
  const [enCours, demarrer] = useTransition()
  const [cible, setCible] = useState<ClientAffiche | null>(null)
  const [ajoutOuvert, setAjoutOuvert] = useState(false)
  const [importOuvert, setImportOuvert] = useState(false)
  const [message, setMessage] = useState<Resultat | null>(null)
  const [saisie, setSaisie] = useState(recherche)

  const aller = (changements: Record<string, string | null>) => {
    const suivants = new URLSearchParams(parametres.toString())
    for (const [cle, valeur] of Object.entries(changements)) {
      if (valeur === null || valeur === '') suivants.delete(cle)
      else suivants.set(cle, valeur)
    }
    demarrer(() => router.push(destinationSure(`${chemin}?${suivants.toString()}`)))
  }

  const pages = Math.max(1, Math.ceil(total / taille))

  return (
    <>
      {message?.erreur && <p className="message erreur">{message.erreur}</p>}
      {message?.succes && <p className="message succes">{message.succes}</p>}

      <div className="barre-clients">
        {modifiable && (
          <>
            <button type="button" className="principal" onClick={() => setAjoutOuvert(true)}>
              + Ajouter un client
            </button>
            <button type="button" className="discret" onClick={() => setImportOuvert(true)}>
              Importer
            </button>
          </>
        )}
        {/*
          L'export est un LIEN, pas un bouton : il télécharge un fichier, et
          un clic droit « enregistrer sous » doit marcher. Il passe par la
          route d'export, qui refait le contrôle de rôle — un export sans
          garde rendrait ce qu'on vient de retirer de l'écran.
        */}
        <a className="bouton discret" href={`/${restaurantId}/export/clients`}>
          Exporter
        </a>

        <form
          className="recherche-clients"
          onSubmit={(e) => {
            e.preventDefault()
            // Retour à la page 1 : garder la page 7 d'une recherche pour la
            // suivante affiche une liste vide qu'on croit sans résultat.
            aller({ q: saisie, page: null })
          }}
        >
          <input
            type="search"
            value={saisie}
            placeholder="Nom, téléphone, e-mail…"
            aria-label="Rechercher un client"
            onChange={(e) => setSaisie(e.target.value)}
          />
          <button type="submit" className="discret">
            Rechercher
          </button>
          {recherche !== '' && (
            <button
              type="button"
              className="discret"
              onClick={() => {
                setSaisie('')
                aller({ q: null, page: null })
              }}
            >
              Effacer
            </button>
          )}
        </form>

        <button
          type="button"
          className={archives ? 'discret actif' : 'discret'}
          onClick={() => aller({ archives: archives ? null : '1', page: null })}
        >
          {archives ? 'Voir les clients actifs' : 'Voir les archivés'}
        </button>
      </div>

      {ajoutOuvert && modifiable && (
        <FicheClient
          restaurantId={restaurantId}
          client={null}
          fermer={() => setAjoutOuvert(false)}
        />
      )}

      {importOuvert && modifiable && (
        <PanneauImport restaurantId={restaurantId} fermer={() => setImportOuvert(false)} />
      )}

      <section className="carte" aria-busy={enCours}>
        {clients.length === 0 ? (
          <p className="vide">
            {recherche !== ''
              ? `Aucun client ne correspond à « ${recherche} ».`
              : archives
                ? 'Aucun client archivé.'
                : 'Aucun client enregistré. Ajoutez-en un, ou importez votre carnet.'}
          </p>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Contacts</th>
                  <th>Première visite</th>
                  <th>Dernière visite</th>
                  <th className="nombre">Total des visites</th>
                  <th className="nombre">Total dépensé</th>
                  {modifiable && <th />}
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {c.nom}
                      {c.note !== '' && <div className="indication">{c.note}</div>}
                    </td>
                    <td>
                      {c.telephone !== '' && <div className="mono">{c.telephone}</div>}
                      {c.email !== '' && <div className="indication">{c.email}</div>}
                      {c.telephone === '' && c.email === '' && (
                        <span className="detail">—</span>
                      )}
                    </td>
                    <td>{c.premiereVisite}</td>
                    <td>{c.derniereVisite}</td>
                    <td className="nombre">{c.visites}</td>
                    <td className="nombre">{c.depense}</td>
                    {modifiable && (
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <button
                          type="button"
                          className="discret"
                          onClick={() => setCible(c)}
                        >
                          Ouvrir
                        </button>
                        <button
                          type="button"
                          className={c.archive ? 'discret' : 'discret danger'}
                          disabled={enCours}
                          onClick={() =>
                            demarrer(async () => {
                              setMessage(await archiverClient(restaurantId, c.id, !c.archive))
                              router.refresh()
                            })
                          }
                        >
                          {c.archive ? 'Réactiver' : 'Archiver'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="pagination">
              <button
                type="button"
                className="discret"
                disabled={page <= 1}
                onClick={() => aller({ page: String(page - 1) })}
                aria-label="Page précédente"
              >
                ‹
              </button>
              <span>
                Page {page} de {pages} · {total} client{total > 1 ? 's' : ''}
              </span>
              <button
                type="button"
                className="discret"
                disabled={page >= pages}
                onClick={() => aller({ page: String(page + 1) })}
                aria-label="Page suivante"
              >
                ›
              </button>
              <label>
                Lignes par page
                <select
                  value={taille}
                  onChange={(e) => aller({ taille: e.target.value, page: null })}
                >
                  {tailles.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </>
        )}
      </section>

      {cible && modifiable && (
        <FicheClient
          key={cible.id}
          restaurantId={restaurantId}
          client={cible}
          fermer={() => setCible(null)}
        />
      )}
    </>
  )
}

/** La fiche : les quatre champs, et rien d'autre. */
function FicheClient({
  restaurantId,
  client,
  fermer,
}: {
  restaurantId: string
  client: ClientAffiche | null
  fermer: () => void
}) {
  const router = useRouter()
  const [resultat, action, enCours] = useActionState(
    client === null
      ? creerClient.bind(null, restaurantId)
      : modifierClient.bind(null, restaurantId, client.id),
    null as Resultat | null,
  )

  // Refermer sur succès, et rafraîchir : sinon la ligne modifiée garde
  // l'ancienne valeur à l'écran, et on la modifie une seconde fois.
  if (resultat?.succes) {
    router.refresh()
  }

  return (
    <section className="carte">
      <div className="entete-panneau">
        <h2>{client === null ? 'Nouveau client' : client.nom}</h2>
        <button type="button" className="discret" onClick={fermer}>
          Fermer
        </button>
      </div>

      {resultat?.erreur && <p className="message erreur">{resultat.erreur}</p>}
      {resultat?.succes && <p className="message succes">{resultat.succes}</p>}

      {client !== null && (
        <p className="indication">
          {client.visites} visite{client.visites > 1 ? 's' : ''} · {client.depense} dépensé
          {client.derniereVisite !== '—' && ` · dernière le ${client.derniereVisite}`}
        </p>
      )}

      <form action={action}>
        <div className="champs deux">
          <label className="champ">
            Nom
            <input name="nom" defaultValue={client?.nom ?? ''} maxLength={120} required />
          </label>
          <label className="champ">
            Téléphone
            <input
              name="telephone"
              defaultValue={client?.telephone ?? ''}
              inputMode="tel"
              placeholder="20 123 456"
              maxLength={30}
            />
          </label>
        </div>
        <div className="champs deux">
          <label className="champ">
            E-mail
            <input
              name="email"
              type="email"
              defaultValue={client?.email ?? ''}
              maxLength={160}
            />
          </label>
          <label className="champ">
            Note de service
            <input
              name="note"
              defaultValue={client?.note ?? ''}
              maxLength={500}
              placeholder="Allergique aux fruits de mer"
            />
          </label>
        </div>
        <p className="indication">
          Le téléphone est ce qui distingue deux clients du même prénom : un
          numéro déjà connu ouvre la fiche existante au lieu d’en créer une
          seconde, qui partagerait ses visites en deux.
        </p>
        <button type="submit" disabled={enCours}>
          {enCours ? 'Enregistrement…' : client === null ? 'Ajouter' : 'Enregistrer'}
        </button>
      </form>
    </section>
  )
}

/** L'import : un fichier, ou du texte collé. */
function PanneauImport({
  restaurantId,
  fermer,
}: {
  restaurantId: string
  fermer: () => void
}) {
  const router = useRouter()
  const [bilan, action, enCours] = useActionState(
    importerClients.bind(null, restaurantId),
    null as BilanImport | null,
  )
  if (bilan?.succes) router.refresh()

  return (
    <section className="carte">
      <div className="entete-panneau">
        <h2>Importer des clients</h2>
        <button type="button" className="discret" onClick={fermer}>
          Fermer
        </button>
      </div>

      {bilan?.erreur && <p className="message erreur">{bilan.erreur}</p>}
      {bilan?.succes && <p className="message succes">{bilan.succes}</p>}
      {bilan?.refuses && bilan.refuses.length > 0 && (
        <ul className="indication">
          {bilan.refuses.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}

      <form action={action}>
        <p className="indication">
          Un fichier CSV dont la première ligne porte les en-têtes{' '}
          <strong>nom</strong>, <strong>telephone</strong>, <strong>email</strong>,{' '}
          <strong>note</strong>. La virgule et le point-virgule sont acceptés,
          l’ordre des colonnes n’a pas d’importance, et un export de Loyverse
          passe tel quel.
        </p>
        <div className="champ">
          <label htmlFor="fichier-clients">Fichier</label>
          <input id="fichier-clients" type="file" name="fichier" accept=".csv,text/csv" />
        </div>
        <div className="champ">
          <label htmlFor="colle-clients">…ou collez le contenu</label>
          <textarea
            id="colle-clients"
            name="colle"
            rows={5}
            placeholder={'nom,telephone\nSalem,20123456'}
          />
        </div>
        <p className="indication">
          Un client dont le <strong>téléphone</strong> est déjà connu n’est{' '}
          <strong>jamais</strong> écrasé : il est compté comme doublon et laissé
          tel quel. Ré-importer un fichier après quelques corrections ne peut donc
          rien effacer.
        </p>
        <button type="submit" disabled={enCours}>
          {enCours ? 'Import en cours…' : 'Importer'}
        </button>
      </form>
    </section>
  )
}
