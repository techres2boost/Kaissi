'use client'

/**
 * Les fiches FOURNISSEURS — module « inventaire avancé ».
 *
 * ── Ce que cet écran n'impose pas ─────────────────────────────────────────
 *
 * Rien. Une réception se saisit toujours avec un nom libre dans l'écran
 * Stock ; ces fiches ne font que proposer les noms déjà connus et rattacher
 * la réception quand le nom tapé correspond. C'est la raison écrite dans la
 * migration 0026, et elle n'a pas changé : personne ne crée une fiche au
 * moment où il décharge des cageots.
 *
 * ── Pourquoi une fiche s'ARCHIVE et ne se supprime pas ────────────────────
 *
 * Ses réceptions restent dans l'historique du stock. Effacer la fiche les
 * rendrait illisibles — « +12 le 3 septembre, chez qui ? ». L'archivage la
 * retire des propositions sans rien perdre, et se défait.
 */

import { useActionState, useState, useTransition } from 'react'
import { Archive, ArchiveRestore, Phone, Plus, UserRound } from 'lucide-react'
import {
  archiverFournisseur,
  creerFournisseur,
  modifierFournisseur,
  type Resultat,
} from '../app/[restaurant]/inventaire/actions.js'

export interface Fournisseur {
  id: string
  nom: string
  contact: string | null
  telephone: string | null
  note: string | null
  archive: boolean
  /** Réceptions déjà rattachées à cette fiche — ce qu'on perdrait des yeux. */
  receptions: number
}

function LigneFournisseur({
  restaurantId,
  fournisseur,
  modifiable,
}: {
  restaurantId: string
  fournisseur: Fournisseur
  modifiable: boolean
}) {
  const [resultat, action] = useActionState(
    modifierFournisseur.bind(null, restaurantId, fournisseur.id),
    null as Resultat | null,
  )
  const [archivage, setArchivage] = useState<Resultat | null>(null)
  /*
   * `useTransition` et non un `onClick` asynchrone.
   *
   * React attend un gestionnaire qui ne rend RIEN : lui passer une fonction
   * `async` rend une promesse que personne n'attend, donc une erreur de
   * l'action se perdrait sans rien afficher. La transition, elle, tient l'état
   * « en cours » et empêche le double clic — celui qui archiverait puis
   * réactiverait aussitôt.
   */
  const [enCours, demarrer] = useTransition()

  return (
    <li className={fournisseur.archive ? 'carte-groupe archive' : 'carte-groupe'}>
      <form action={action} className="ligne-imprimante">
        <input
          name="nom"
          defaultValue={fournisseur.nom}
          aria-label="Nom du fournisseur"
          maxLength={120}
          required
          disabled={!modifiable}
        />
        <input
          name="contact"
          defaultValue={fournisseur.contact ?? ''}
          aria-label={`Personne à joindre chez ${fournisseur.nom}`}
          placeholder="personne à joindre"
          maxLength={120}
          disabled={!modifiable}
        />
        <input
          name="telephone"
          defaultValue={fournisseur.telephone ?? ''}
          aria-label={`Téléphone de ${fournisseur.nom}`}
          placeholder="téléphone"
          maxLength={40}
          inputMode="tel"
          disabled={!modifiable}
        />
        {/*
          La NOTE dans la même rangée que le reste, et non dans un formulaire
          à part : deux formulaires côte à côte, c'est deux boutons
          « Enregistrer », et l'un des deux efface toujours ce que l'autre
          vient d'écrire — l'action réécrit les quatre champs.
        */}
        <input
          name="note"
          defaultValue={fournisseur.note ?? ''}
          aria-label={`Note sur ${fournisseur.nom}`}
          placeholder="note (livraisons le mardi, facture à 30 jours…)"
          maxLength={500}
          disabled={!modifiable}
        />
        {modifiable && (
          <button type="submit" className="discret">
            Enregistrer
          </button>
        )}
      </form>

      <p className="indication">
        {fournisseur.receptions === 0
          ? 'Aucune réception rattachée pour l’instant.'
          : `${fournisseur.receptions} réception(s) rattachée(s).`}
        {fournisseur.archive && ' Archivé : il n’est plus proposé à la saisie.'}
      </p>

      {modifiable && (
        <div className="ajout-choix">
          <button
            type="button"
            className="discret"
            disabled={enCours}
            onClick={() => {
              demarrer(async () => {
                setArchivage(
                  await archiverFournisseur(restaurantId, fournisseur.id, !fournisseur.archive),
                )
              })
            }}
          >
            {fournisseur.archive ? (
              <>
                <ArchiveRestore size={15} strokeWidth={1.9} aria-hidden="true" /> Réactiver
              </>
            ) : (
              <>
                <Archive size={15} strokeWidth={1.9} aria-hidden="true" /> Archiver
              </>
            )}
          </button>
        </div>
      )}

      {resultat?.erreur && <p className="message erreur">{resultat.erreur}</p>}
      {resultat?.succes && <p className="message succes">{resultat.succes}</p>}
      {archivage?.erreur && <p className="message erreur">{archivage.erreur}</p>}
      {archivage?.succes && <p className="message succes">{archivage.succes}</p>}
    </li>
  )
}

export function GestionFournisseurs({
  restaurantId,
  modifiable,
  fournisseurs,
}: {
  restaurantId: string
  modifiable: boolean
  fournisseurs: Fournisseur[]
}) {
  const [resultat, action] = useActionState(
    creerFournisseur.bind(null, restaurantId),
    null as Resultat | null,
  )

  const actifs = fournisseurs.filter((f) => !f.archive)
  const archives = fournisseurs.filter((f) => f.archive)

  return (
    <>
      {modifiable && (
        <form action={action} className="carte-groupe">
          <div className="ligne-imprimante">
            <input name="nom" placeholder="Sfax Primeurs" maxLength={120} required />
            <input name="contact" placeholder="personne à joindre" maxLength={120} />
            <input name="telephone" placeholder="téléphone" maxLength={40} inputMode="tel" />
            <button type="submit" className="principal">
              <Plus size={15} strokeWidth={2} aria-hidden="true" /> Ajouter
            </button>
          </div>
          {resultat?.erreur && <p className="message erreur">{resultat.erreur}</p>}
          {resultat?.succes && <p className="message succes">{resultat.succes}</p>}
        </form>
      )}

      {actifs.length === 0 ? (
        <p className="vide">
          Aucun fournisseur enregistré. Les réceptions continuent de s’enregistrer
          avec un nom libre — une fiche ne sert qu’à ne plus le retaper.
        </p>
      ) : (
        <ul className="liste-taux">
          {actifs.map((f) => (
            <LigneFournisseur
              key={f.id}
              restaurantId={restaurantId}
              fournisseur={f}
              modifiable={modifiable}
            />
          ))}
        </ul>
      )}

      {archives.length > 0 && (
        <details className="rattachement">
          <summary>{archives.length} fiche(s) archivée(s)</summary>
          <ul className="liste-taux">
            {archives.map((f) => (
              <LigneFournisseur
                key={f.id}
                restaurantId={restaurantId}
                fournisseur={f}
                modifiable={modifiable}
              />
            ))}
          </ul>
        </details>
      )}

      <p className="indication">
        <UserRound size={14} strokeWidth={2} aria-hidden="true" /> La personne à
        joindre et le <Phone size={14} strokeWidth={2} aria-hidden="true" />{' '}
        téléphone ne servent qu’ici : Kaissi n’envoie rien à un fournisseur, et
        ne passe aucune commande. C’est un carnet, pas un portail d’achats.
      </p>
    </>
  )
}
