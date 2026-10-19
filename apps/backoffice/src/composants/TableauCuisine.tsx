'use client'

/**
 * Le tableau de la cuisine.
 *
 * Trois exigences qui viennent du poste, pas de l'écran :
 *
 *  1. **Gros.** On le lit à un mètre cinquante, les mains occupées.
 *  2. **L'attente est la seule information urgente.** Une commande de trois
 *     minutes et une de vingt se ressemblent si l'on n'affiche que l'heure
 *     d'envoi. On affiche donc les minutes écoulées, et on les colore.
 *  3. **Ce qui est prêt ne disparaît pas tout de suite.** Un plateau annoncé
 *     par erreur doit pouvoir être repris ; il reste visible, grisé, jusqu'à
 *     ce que la caisse encaisse la commande et la fasse sortir de la liste.
 */

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { destinationSure } from '../serveur/redirection.js'
import { marquerPrete, retirerPrete } from '../app/[restaurant]/preparation/actions.js'
import { useT } from '../i18n/client.js'
import { aTraduire } from '@kaissi/i18n'
import { activerAlerte, alerteActivee, alerter, desactiverAlerte } from './alerteArrivee.js'

export interface CommandeCuisine {
  id: string
  numero: string | null
  table: string | null
  type: string
  couverts: number | null
  envoyeeA: string
  preteA: string | null
  /**
   * Des plats ajoutés APRÈS un « prêt » (0046) : la commande revient, et
   * l'écran le dit, plutôt que de la montrer comme une neuve.
   */
  ajout: boolean
  /** Le dernier envoi affiché — c'est lui que « Prêt » couvrira. */
  rangEnvoi: number | null
  lignes: {
    id: string
    designation: string
    quantite: number
    options: string[]
    note: string | null
    /** Partie après le dernier « prêt » : c'est elle qu'il faut préparer. */
    nouvelle: boolean
  }[]
}

/** Rafraîchissement automatique. Assez court pour être vivant, assez long
 *  pour ne pas marteler la base pendant tout un service. */
const PERIODE_MS = 15_000

const LIBELLE_TYPE: Record<string, string> = {
  dine_in: aTraduire('Sur place'),
  takeaway: aTraduire('À emporter'),
  delivery: 'Livraison',
}

function minutesDepuis(iso: string, maintenant: number): number {
  const debut = new Date(iso).getTime()
  if (Number.isNaN(debut)) return 0
  return Math.max(0, Math.floor((maintenant - debut) / 60_000))
}

export function TableauCuisine({
  notifications,
  restaurantId,
  commandes,
  plafond,
  postes,
  posteActif,
  titre,
}: {
  /** Le bouton d'abonnement aux notifications push (0047), rendu par la page. */
  notifications?: React.ReactNode
  restaurantId: string
  commandes: CommandeCuisine[]
  plafond: number
  /** Postes de préparation de l'établissement — Cuisine, Bar… */
  postes: { id: string; nom: string }[]
  posteActif: string | null
  /**
   * Titre de l'écran — le NOM DU POSTE quand il est épinglé.
   *
   * Un barman qui lit « Cuisine » en haut de son écran doute, à raison, de
   * regarder le bon. Le titre doit dire de lui-même à qui l'écran s'adresse.
   */
  titre: string
}) {
  const t = useT()
  const router = useRouter()
  const [enCours, demarrer] = useTransition()
  const [erreur, setErreur] = useState<string | null>(null)
  /**
   * Horloge locale, rafraîchie chaque minute.
   *
   * Elle n'est PAS initialisée à `Date.now()` : le serveur et le navigateur
   * rendraient alors deux minutages différents, et React signalerait une
   * divergence d'hydratation. On part de `null` et on n'affiche l'attente
   * qu'une fois côté client.
   */
  const [maintenant, setMaintenant] = useState<number | null>(null)

  useEffect(() => {
    setMaintenant(Date.now())
    const horloge = setInterval(() => setMaintenant(Date.now()), 30_000)
    return () => clearInterval(horloge)
  }, [])

  // Rafraîchissement des DONNÉES, distinct de l'horloge : `router.refresh()`
  // rejoue le composant serveur sans recharger la page, donc sans perdre le
  // défilement de la cuisine.
  useEffect(() => {
    const minuteur = setInterval(() => router.refresh(), PERIODE_MS)
    return () => clearInterval(minuteur)
  }, [router])

  /*
   * ── L'alerte d'arrivée ──────────────────────────────────────────────
   *
   * Une cuisine regarde ses casseroles, pas son écran. À chaque commande
   * NOUVELLE à préparer — ou chaque ajout sur une commande déjà prête — le
   * poste sonne, vibre, et notifie s'il n'est pas au premier plan.
   *
   * La clé est « commande : rang du dernier envoi » : un ajout change le
   * rang, donc la clé, donc sonne — exactement comme une commande neuve.
   * Le premier affichage ne sonne pas : ce qui était déjà là n'est pas une
   * nouvelle.
   */
  const [sonActif, setSonActif] = useState(false)
  useEffect(() => setSonActif(alerteActivee()), [])
  const vues = useRef<Set<string> | null>(null)
  const aFaire = commandes.filter((c) => !c.preteA)
  const cles = aFaire.map((c) => `${c.id}:${c.rangEnvoi ?? 0}`)
  useEffect(() => {
    const precedentes = vues.current
    vues.current = new Set(cles)
    if (precedentes === null) return
    const arrivees = aFaire.filter((c) => !precedentes.has(`${c.id}:${c.rangEnvoi ?? 0}`))
    if (arrivees.length === 0) return
    const premiere = arrivees[0]!
    const ou = premiere.table
      ? t('Table {table}', { table: premiere.table })
      : t(LIBELLE_TYPE[premiere.type] ?? premiere.type)
    alerter(
      premiere.ajout ? t('Ajout — {ou}', { ou }) : t('Nouvelle commande — {ou}', { ou }),
      premiere.lignes
        .filter((l) => !premiere.ajout || l.nouvelle)
        .map((l) => `${l.quantite}× ${l.designation}`)
        .join(', '),
    )
    // `cles` résume `aFaire` : le tableau lui-même change à chaque rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cles.join('|')])

  const agir = (action: () => Promise<{ erreur?: string }>) => {
    setErreur(null)
    demarrer(async () => {
      const resultat = await action()
      if (resultat.erreur) setErreur(resultat.erreur)
      else router.refresh()
    })
  }

  const enAttente = aFaire

  return (
    <section className="cuisine">
      <header className="cuisine-entete">
        <h1>
          {titre} <span className="compteur">{enAttente.length}</span>
        </h1>
        <p className="note">{t('Mise à jour automatique toutes les')}{' '}{PERIODE_MS / 1000}{' '}{t('secondes. Une commande sort de cet écran quand la caisse l\'encaisse ou l\'annule.')}</p>

        {/*
          Le son exige un premier toucher (politique des navigateurs), et la
          notification une permission : un bouton, une fois par appareil.
        */}
        <p>
          {sonActif ? (
            <button
              type="button"
              className="discret"
              onClick={() => {
                desactiverAlerte()
                setSonActif(false)
              }}
            >{t('🔔 Alerte sonore activée — couper')}</button>
          ) : (
            <button
              type="button"
              className="principal"
              onClick={() => {
                void activerAlerte().then(() => setSonActif(true))
              }}
            >{t('🔕 Activer l’alerte sonore et les notifications')}</button>
          )}
        </p>
        {notifications}

        {/*
          La caisse émet DÉJÀ un bon par poste (Cuisine, Bar). Ce filtre rend
          la même séparation à l'écran : le barman ne trie plus les pizzas à
          l'œil pour trouver ses cafés. « Tous les postes » reste le défaut —
          dans un snack à un seul écran, c'est ce qu'on veut.
        */}
        {postes.length > 1 && (
          <nav className="onglets-postes" aria-label={t('Poste de préparation')}>
            <Link
              href={destinationSure(`/${restaurantId}/preparation`)}
              className={posteActif === null ? 'actif' : ''}
            >{t('Tous les postes')}</Link>
            {postes.map((p) => (
              <Link
                key={p.id}
                href={destinationSure(`/${restaurantId}/preparation?poste=${p.id}`)}
                className={posteActif === p.id ? 'actif' : ''}
              >
                {p.nom}
              </Link>
            ))}
          </nav>
        )}
      </header>

      {erreur && <p className="message erreur">{t.m(erreur)}</p>}

      {commandes.length === 0 ? (
        <p className="vide">{t('Rien à préparer. Les commandes apparaissent ici dès qu\'un serveur les envoie en cuisine depuis la caisse.')}</p>
      ) : (
        <div className="cuisine-grille">
          {commandes.map((commande) => {
            const attente = maintenant ? minutesDepuis(commande.envoyeeA, maintenant) : null
            const urgence =
              attente === null ? '' : attente >= 20 ? 'tres-tard' : attente >= 10 ? 'tard' : ''
            return (
              <article
                key={commande.id}
                className={`bon ${commande.preteA ? 'prete' : ''} ${commande.ajout ? 'ajout' : ''} ${urgence}`}
              >
                <header>
                  <span className="place">
                    {commande.table ? t('Table {table}', { table: commande.table }) : t(LIBELLE_TYPE[commande.type] ?? commande.type)}
                    {commande.ajout && <span className="etiquette-ajout">{t('Ajout')}</span>}
                  </span>
                  <span className="attente">
                    {attente === null ? '—' : t('{attente} min', { attente })}
                  </span>
                </header>

                <p className="reference">
                  {commande.numero ?? '—'}
                  {commande.couverts ? t(' · {couverts} couverts', { couverts: commande.couverts }) : ''}
                </p>

                <ul className="plats">
                  {commande.lignes.map((ligne) => (
                    <li
                      key={ligne.id}
                      // Sur un AJOUT, ce qui est déjà parti reste lisible mais
                      // en retrait : la cuisine prépare le nouveau, et sait à
                      // quelle table il s'ajoute.
                      className={commande.ajout ? (ligne.nouvelle ? 'nouvelle' : 'deja-servie') : undefined}
                    >
                      <span className="quantite">{ligne.quantite}×</span>
                      <span className="designation">
                        {ligne.designation}
                        {ligne.options.length > 0 && (
                          <small className="options">{ligne.options.join(' · ')}</small>
                        )}
                        {ligne.note && <small className="note-plat">« {ligne.note} »</small>}
                      </span>
                      {commande.ajout && ligne.nouvelle && <span className="badge-nouveau">{t('nouveau')}</span>}
                    </li>
                  ))}
                  {commande.lignes.length === 0 && (
                    <li className="note">{t('Aucune ligne active — commande vidée en salle.')}</li>
                  )}
                </ul>

                {commande.preteA ? (
                  <button
                    type="button"
                    className="discret"
                    disabled={enCours}
                    onClick={() => agir(() => retirerPrete(restaurantId, commande.id))}
                  >{t('Annuler « prêt »')}</button>
                ) : (
                  <button
                    type="button"
                    className="principal"
                    disabled={enCours}
                    onClick={() => agir(() => marquerPrete(restaurantId, commande.id, commande.rangEnvoi))}
                  >{t('Prêt')}</button>
                )}
              </article>
            )
          })}
        </div>
      )}

      {commandes.length >= plafond && (
        <p className="note">{t('Seules les')}{' '}{plafond}{' '}{t('plus anciennes commandes sont affichées. Au-delà, ce n\'est plus un écran de cuisine mais un rapport — voir « Journée ».')}</p>
      )}
    </section>
  )
}
