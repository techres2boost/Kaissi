/**
 * Écran de synchronisation.
 *
 * Trois questions, et rien d'autre :
 *   • mes ventes sont-elles parties ?
 *   • le serveur a-t-il refusé quelque chose ?
 *   • depuis quand n'ai-je plus de contact ?
 *
 * Les rejets sont mis EN AVANT. Un rejet ne se répare pas tout seul : il
 * traduit une règle métier (commande déjà close, produit supprimé) et
 * demande une décision humaine. Le masquer serait faire disparaître une
 * vente sans le dire.
 */

import { useEffect, useState } from 'react'
import {
  dejaEnService,
  ErreurSqlite,
  motifDeRefus,
  peutBasculer,
  reinitialiserPourAutreEtablissement,
  type EnregistrementOutbox,
  type EtatBascule,
} from '@kaissi/db-local'
import type { ResumeSync } from '@kaissi/sync-client'
import { useApp } from '../etat/contexte.js'
import { expliquerEchecReseau } from '../donnees/diagnostic-reseau.js'
import { identifiantInstallation } from '../donnees/installation.js'
import { URL_SYNC_PAR_DEFAUT } from '../config.js'

const LIBELLES_ETAT: Record<ResumeSync['etat'], string> = {
  inactif: 'En veille',
  en_cours: 'Synchronisation…',
  a_jour: 'À jour',
  hors_ligne: 'Hors ligne',
  erreur: 'Erreur',
  bloque: 'Action requise',
}

const EXPLICATIONS: Record<ResumeSync['etat'], string> = {
  inactif: "La synchronisation n'a pas encore démarré.",
  en_cours: 'Envoi des ventes et récupération des autres terminaux.',
  a_jour: 'Toutes les ventes sont enregistrées sur le serveur.',
  hors_ligne:
    "Le serveur est injoignable. La caisse fonctionne normalement : les ventes " +
    'sont conservées et repartiront seules au retour du réseau.',
  erreur: 'Une erreur inattendue est survenue. Les ventes locales sont intactes.',
  bloque:
    "Le serveur a refusé cet appareil. Les ventes sont conservées, mais elles ne " +
    'partiront pas tant que le problème n’est pas réglé avec le gérant.',
}

/** Libellés des codes de rejet, en français, destinés au gérant. */
const LIBELLES_REJET: Record<string, string> = {
  commande_close: 'Commande déjà encaissée sur un autre terminal',
  commande_annulee: 'Commande annulée entre-temps',
  produit_inconnu: 'Produit retiré du catalogue',
  appareil_etranger: 'Événement signé par un autre appareil',
  charge_invalide: 'Données incohérentes',
  type_inconnu: 'Opération inconnue du serveur — mise à jour requise',
  lot_trop_grand: 'Trop d’opérations envoyées d’un coup',
}

export function EcranSync() {
  const { app, sync, resumeSync, rafraichir, identite } = useApp()
  const [rejets, setRejets] = useState<EnregistrementOutbox[]>([])
  const [enAttente, setEnAttente] = useState<EnregistrementOutbox[]>([])
  /*
   * Ce que la tablette a REÇU, et quand.
   *
   * Devant un code PIN tout juste réinitialisé au back-office et refusé par
   * la caisse, la seule question utile est « ce changement est-il arrivé
   * ici ? ». « Dernière synchronisation » n'y répond pas : elle dit qu'il y
   * a du réseau, pas que le catalogue a bougé.
   */
  const [catalogue, setCatalogue] = useState<{ recuA: string | null; employes: number }>({
    recuA: null,
    employes: 0,
  })

  useEffect(() => {
    let vivant = true
    void (async () => {
      const lot = await app.journal.lotAPousser(50)
      const tous = await app.base.adaptateur.lire<{
        event_id: string
        payload: string
        attempts: number
        last_error: string | null
        reject_code: string | null
        status: string
        created_at: string
      }>(`SELECT * FROM outbox WHERE status = 'rejete' ORDER BY created_at DESC LIMIT 50`)
      const recuA = await app.etat.lire('catalogue_applique_a')
      const employes = await app.employes.actifs()
      if (!vivant) return
      setCatalogue({ recuA: recuA || null, employes: employes.length })
      setEnAttente(lot)
      setRejets(
        tous.map((l) => ({
          eventId: l.event_id,
          payload: l.payload,
          tentatives: l.attempts,
          derniereErreur: l.last_error,
          codeRejet: l.reject_code,
          statut: 'rejete',
          creeA: l.created_at,
        })),
      )
    })()
    return () => {
      vivant = false
    }
  }, [app, resumeSync])

  const decrire = (enregistrement: EnregistrementOutbox): string => {
    try {
      const e = JSON.parse(enregistrement.payload) as { type: string; clientTs: string }
      return `${e.type} · ${new Date(e.clientTs).toLocaleString('fr-FR')}`
    } catch {
      return enregistrement.eventId
    }
  }

  const abandonnerEtrangers = async () => {
    await app.journal.abandonnerRejets('appareil_etranger')
    rafraichir()
  }

  /*
   * Oublie l'appairage pour réafficher le formulaire.
   *
   * L'écran d'appairage ne s'affiche QUE si le terminal n'est pas appairé.
   * Sans ce bouton, un terminal mal appairé était dans un état dont il ne
   * pouvait plus sortir : ni corriger l'adresse, ni changer de jeton.
   *
   * Rien n'est perdu : le journal des ventes et l'outbox restent intacts,
   * seuls l'adresse et le jeton sont effacés.
   */
  const oublierAppairage = async () => {
    await app.etat.ecrire('url_sync', '')
    await app.etat.ecrire('jeton_appareil', '')
    rafraichir()
  }

  // Sans appairage, il n'y a rien à synchroniser : on montre le formulaire
  // plutôt qu'un écran d'état vide et incompréhensible.
  if (!sync) {
    return <FormulaireAppairage onAppaire={rafraichir} />
  }

  return (
    <div className="diagnostic">
      <section className="bloc">
        <h2>État de la synchronisation</h2>
        <div className={`verdict ${resumeSync.etat === 'a_jour' ? 'ok' : resumeSync.etat === 'bloque' ? 'ko' : ''}`}>
          <strong>{LIBELLES_ETAT[resumeSync.etat]}.</strong> {EXPLICATIONS[resumeSync.etat]}
        </div>

        <dl>
          <dt>Opérations en attente</dt>
          <dd className={resumeSync.enAttente > 0 ? 'attention' : 'ok'}>
            {resumeSync.enAttente}
          </dd>
          <dt>Opérations refusées</dt>
          <dd className={resumeSync.rejetes > 0 ? 'attention' : ''}>{resumeSync.rejetes}</dd>
          <dt>Dernière synchronisation</dt>
          <dd>
            {resumeSync.derniereSyncA
              ? new Date(resumeSync.derniereSyncA).toLocaleString('fr-FR')
              : 'jamais'}
          </dd>
          <dt>Dernier changement reçu</dt>
          <dd>
            {catalogue.recuA
              ? `${new Date(catalogue.recuA).toLocaleString('fr-FR')} · ${catalogue.employes} employé(s)`
              : 'aucun — catalogue local d’origine'}
          </dd>
          {resumeSync.tentatives > 0 && (
            <>
              <dt>Tentatives échouées</dt>
              <dd className="attention">{resumeSync.tentatives}</dd>
            </>
          )}
        </dl>

        {resumeSync.derniereErreur && (
          <p className="note">Dernier message du serveur : {resumeSync.derniereErreur}</p>
        )}

        <details className="details-techniques">
          <summary>Détails techniques — à lire au support, si on vous les demande</summary>
          <dl>
            <dt>Curseur événements</dt>
            <dd className="mono">{resumeSync.curseurEvenements}</dd>
            <dt>Curseur catalogue</dt>
            <dd className="mono">{resumeSync.curseurCatalogue}</dd>
          </dl>
        </details>

        {/*
          L'envoi est AUTOMATIQUE — toutes les quinze secondes réseau
          disponible, avec recul exponentiel après un échec. Ce bouton ne
          « fait pas » la synchronisation : il avance le prochain cycle.
          Il reste utile dans un seul cas, mais un vrai : on veut vérifier
          quelque chose au back-office tout de suite, sans attendre.
          Le présenter comme l'action principale laissait croire que rien ne
          partait sans lui.
        */}
        <p className="note">
          L'envoi se fait <strong>tout seul</strong>, en continu, dès qu'il y a
          du réseau. Vous n'avez rien à déclencher : ce bouton ne sert qu'à ne
          pas attendre les quelques secondes du prochain cycle.
        </p>

        <div className="actions">
          <button
            type="button"
            className="secondaire"
            disabled={resumeSync.etat === 'en_cours' || !sync}
            onClick={() => void sync?.cycle()}
          >
            {resumeSync.etat === 'en_cours' ? 'Envoi en cours…' : 'Ne pas attendre — envoyer maintenant'}
          </button>
        </div>
      </section>

      <section className="bloc">
        <h2>Identité de cet appareil</h2>
        <dl>
          <dt>Identifiant</dt>
          <dd className="mono">{identite.deviceId || '—'}</dd>
        </dl>
        <p className="note">
          Le serveur fait autorité : au démarrage, le terminal adopte
          automatiquement l’identité que son jeton désigne. Si des ventes sont
          refusées pour « appareil étranger », c’est que cette adoption n’a pas
          encore eu lieu — relancez l’application, ou ré-appairez ci-dessous.
        </p>
        <p>
          <button type="button" onClick={() => void oublierAppairage()}>
            Ré-appairer — ou changer d’établissement
          </button>
        </p>
        <p className="note">
          Le formulaire réapparaîtra. Reconnectez-vous avec le compte du
          gérant : si celui-ci gère <strong>plusieurs établissements</strong>,
          la liste s’affichera et vous choisirez celui de cette caisse.
        </p>
        <p className="note">
          <strong>Changer d’établissement vide la base locale</strong> — carte,
          employés, stock et ventes de l’ancien. C’est indispensable : les
          curseurs de synchronisation sont communs à toute la base, et sans
          remise à zéro le catalogue du nouvel établissement ne serait jamais
          reçu. Rien n’est perdu côté serveur, où tout a déjà été remonté.
        </p>
        <p className="note">
          Le changement est <strong>refusé</strong> tant qu’il reste des ventes
          à envoyer : elles portent l’identité de l’ancien terminal et seraient
          refusées définitivement. Synchronisez d’abord.
        </p>
      </section>

      {rejets.length > 0 && (
        <section className="bloc">
          <h2>Opérations refusées — votre attention est requise</h2>
          <p className="note">
            Ces opérations ne repartiront pas toutes seules. Chacune traduit une
            règle métier, pas une panne de réseau.
          </p>
          <table>
            <thead>
              <tr>
                <th>Opération</th>
                <th>Motif</th>
                <th>Détail</th>
              </tr>
            </thead>
            <tbody>
              {rejets.map((r) => (
                <tr key={r.eventId}>
                  <td className="detail">{decrire(r)}</td>
                  <td>{LIBELLES_REJET[r.codeRejet ?? ''] ?? r.codeRejet ?? '—'}</td>
                  <td className="detail">{r.derniereErreur}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {rejets.some((r) => r.codeRejet === 'appareil_etranger') && (
            <div className="note" style={{ marginTop: '0.75rem' }}>
              <p>
                Les opérations « {LIBELLES_REJET['appareil_etranger']} » viennent
                d’un appairage précédent : elles portent l’ancien identifiant de
                ce terminal et ne pourront jamais partir. La vente reste
                enregistrée localement ; seule sa remontée au serveur est
                abandonnée.
              </p>
              <button type="button" onClick={() => void abandonnerEtrangers()}>
                Abandonner ces opérations d’un ancien appairage
              </button>
            </div>
          )}
        </section>
      )}

      {enAttente.length > 0 && (
        <section className="bloc">
          <h2>En attente d’envoi ({enAttente.length})</h2>
          <p className="note">
            Ces opérations sont enregistrées localement et partiront dès que le
            serveur sera joignable. Aucune n’est perdue.
          </p>
          <table>
            <thead>
              <tr>
                <th>Opération</th>
                <th>Tentatives</th>
              </tr>
            </thead>
            <tbody>
              {enAttente.slice(0, 20).map((e) => (
                <tr key={e.eventId}>
                  <td className="detail">{decrire(e)}</td>
                  <td className="nombre">{e.tentatives}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {rejets.length === 0 && enAttente.length === 0 && (
        <section className="bloc">
          <div className="verdict ok">
            <strong>Rien en attente.</strong> Toutes les ventes de ce terminal sont
            enregistrées sur le serveur.
          </div>
        </section>
      )}
    </div>
  )
}

// ─── Appairage ──────────────────────────────────────────────────────────────

/**
 * Mise en service du terminal — e-mail et mot de passe, rien d'autre.
 *
 * Aucun jeton à recopier : le gérant se connecte avec SON compte de
 * back-office, et le serveur remet au terminal son identité d'appareil.
 * L'adresse du serveur est déjà pré-remplie (`deploiement.json`).
 *
 * Cette étape ne se refait pas. L'identifiant d'installation conservé
 * localement fait que la même tablette, si on la remet en service, RETROUVE
 * son appareil au lieu d'en créer un de plus — donc son préfixe de tickets,
 * et surtout la validité des ventes encore en attente d'envoi.
 *
 * Tant qu'elle n'est pas faite, la caisse fonctionne parfaitement — en
 * local. C'est un repli valide si le serveur est indisponible le jour de
 * l'installation.
 */
function FormulaireAppairage({ onAppaire }: { onAppaire: () => void }) {
  const { app } = useApp()
  const [url, setUrl] = useState(URL_SYNC_PAR_DEFAUT)
  const [email, setEmail] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [etat, setEtat] = useState<'saisie' | 'test' | 'erreur'>('saisie')
  const [message, setMessage] = useState<string | null>(null)
  const [choix, setChoix] = useState<{ restaurantId: string; nom: string }[]>([])
  /*
   * Ce qu'une mise en service EFFACERAIT, quand la caisse n'a jamais été
   * appairée. Non nul = on attend un « oui » explicite, jamais un délai.
   */
  const [aEffacer, setAEffacer] = useState<
    (EtatBascule & { restaurantId?: string; nom: string }) | null
  >(null)

  useEffect(() => {
    void app.etat.lire('url_sync').then((u) => u && setUrl(u))
  }, [app])

  /**
   * Échange les identifiants du gérant contre un jeton d'appareil.
   *
   * `restaurantId` n'est fourni qu'au second appel, quand le compte gère
   * plusieurs établissements : enrôler la caisse dans le mauvais restaurant
   * enverrait ses ventes au mauvais endroit, donc on ne devine pas.
   */
  const appairer = async (restaurantId?: string, effacerLeLocal = false) => {
    setEtat('test')
    setMessage(null)
    setAEffacer(null)
    const base = url.replace(/\/+$/, '')
    try {
      // L'identité d'INSTALLATION, tirée une seule fois et conservée ici.
      //
      // C'est elle qui fait qu'une remise en service retrouve le MÊME
      // appareil au lieu d'en créer un de plus — et donc que les ventes
      // encore en attente dans l'outbox restent valides. Sans elle, elles
      // seraient refusées « appareil_etranger », définitivement.
      const installationId = await identifiantInstallation(app.etat)

      // DÉLAI MAXIMAL, comme le transport de synchronisation (15 s).
      //
      // Sans lui, une requête qui reste en suspens — serveur en cours de
      // redéploiement, préflight CORS sans réponse — laissait le bouton figé
      // sur « Vérification… » indéfiniment, sans message et sans issue autre
      // que recharger la page. C'est pourtant le seul endroit du produit où
      // un humain attend devant l'écran.
      const reponse = await fetch(`${base}/appairage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          motDePasse,
          restaurantId,
          installationId,
          libelle: 'Terminal',
        }),
        signal: AbortSignal.timeout(15_000),
      })

      const corps = (await reponse.json().catch(() => null)) as {
        jeton?: string
        deviceId?: string
        restaurantId?: string
        organizationId?: string
        nomEtablissement?: string
        prefixe?: string
        choix?: { restaurantId: string; nom: string }[]
        message?: string
      } | null

      if (!reponse.ok) {
        setEtat('erreur')
        setMessage(corps?.message ?? `Le serveur a répondu ${reponse.status}.`)
        return
      }

      // Plusieurs établissements : on demande lequel, on n'en choisit pas un.
      if (corps?.choix && corps.choix.length > 0) {
        setChoix(corps.choix)
        setEtat('saisie')
        return
      }

      if (!corps?.jeton || !corps.deviceId) {
        setEtat('erreur')
        setMessage(
          "Le serveur n'a pas renvoyé de jeton. Mets à jour l'API de " +
            'synchronisation (elle doit exposer /appairage).',
        )
        return
      }

      const ancienDevice = (await app.etat.lire('device_id')) || null

      /*
       * ── CHANGEMENT D'ÉTABLISSEMENT : la base locale doit être remise à zéro
       *
       * PANNE OBSERVÉE. Un gérant ouvre un second restaurant, y crée ses
       * employés, rouvre la caisse — et retrouve la carte, les employés et le
       * stock du PREMIER. L'appairage n'était pas en cause : c'est la base
       * locale qui restait celle de l'ancien établissement.
       *
       * Deux mécanismes la figeaient, et aucun ne se voyait :
       *
       *   • `last_catalog_seq` suit `change_log.seq`, un `bigserial` GLOBAL
       *     (RÈGLE 4). Le terminal l'avait déjà avancé loin ; les entrées du
       *     second restaurant, écrites avant, portent des `seq` inférieurs et
       *     n'étaient donc jamais tirées ;
       *   • les tables miroir contenaient encore l'ancien référentiel. Même
       *     en tirant le nouveau catalogue, on aurait obtenu l'UNION des
       *     deux : une carte mélangée, sur une caisse.
       *
       * ⚑ On REFUSE tant que l'outbox n'est pas vide. Les opérations en
       *   attente portent l'ancien `device_id` : le serveur les refuserait
       *   « appareil_etranger », et un rejet ne se réessaie jamais tout seul.
       *   Ces ventes n'arriveraient JAMAIS. Le refus est la bonne réponse —
       *   perdre une vente coûte infiniment plus cher qu'une synchronisation
       *   de plus.
       */
      const ancienResto = (await app.etat.lire('restaurant_id')) || null
      const changeDEtablissement =
        !!ancienResto && !!corps.restaurantId && ancienResto !== corps.restaurantId

      if (changeDEtablissement) {
        const attente = await app.journal.enAttente()
        if (!peutBasculer(attente) && !effacerLeLocal) {
          /*
           * ── BASCULE ou PREMIÈRE MISE EN SERVICE ? ─────────────────────
           *
           * PANNE OBSERVÉE. On clique sur son établissement, et il ne se
           * passe rien. La caisse avait servi en local avant d'être mise en
           * service : son outbox n'était pas vide, le garde-fou de bascule
           * refusait — et le refus ne s'affichait nulle part.
           *
           * Le garde-fou avait raison sur une VRAIE bascule : les opérations
           * en attente portent l'ancien `device_id`, mais ce device existe
           * chez le serveur, donc une synchronisation les fait partir.
           *
           * Il a tort sur la PREMIÈRE mise en service, et c'est un
           * cul-de-sac. La graine locale écrit `DEMO_RESTO` et `DEMO_DEVICE`
           * dans `sync_state` : tout terminal neuf paraît donc « changer
           * d'établissement ». Or ses opérations portent l'identité de la
           * caisse de DÉMONSTRATION, qu'aucun serveur n'a jamais délivrée.
           * Elles ne partiront jamais — « synchronisez puis recommencez »
           * envoie faire une chose impossible, indéfiniment.
           *
           * Ce qui sépare les deux cas n'est pas l'outbox : c'est que le
           * serveur ait DÉJÀ attribué un `device_id` à cette caisse.
           */
          if (dejaEnService(ancienDevice)) {
            setEtat('erreur')
            setMessage(motifDeRefus(attente))
            return
          }
          // Jamais en service : on n'efface pas en silence pour autant. On
          // dit ce qui va disparaître, et on attend un « oui ».
          setEtat('erreur')
          setAEffacer({
            ...attente,
            ...(restaurantId ? { restaurantId } : {}),
            nom: corps.nomEtablissement ?? 'cet établissement',
          })
          return
        }
        // Rien en attente — ou un « oui » explicite sur des opérations qui
        // ne pouvaient de toute façon plus partir. Le journal d'une caisse
        // déjà en service, lui, est remonté : il reste au serveur, immuable.
        await reinitialiserPourAutreEtablissement(app.base.adaptateur)
      }

      await app.etat.ecrire('url_sync', base)
      await app.etat.ecrire('jeton_appareil', corps.jeton)
      // On ADOPTE l'identité que le serveur vient d'attribuer. Les trois vont
      // ensemble — un appareil d'un autre établissement changerait aussi
      // restaurant_id et organization_id. Sans cette adoption, le terminal
      // signerait ses ventes avec l'identifiant de la graine de démonstration
      // et le serveur les refuserait toutes avec « appareil_etranger ».
      await app.etat.ecrire('device_id', corps.deviceId)
      if (corps.restaurantId) await app.etat.ecrire('restaurant_id', corps.restaurantId)
      if (corps.organizationId) await app.etat.ecrire('organization_id', corps.organizationId)
      // Le PRÉFIXE DE TICKETS aussi — et c'est loin d'être un détail.
      //
      // Sans cette ligne, chaque terminal gardait le « P1 » de la graine de
      // démonstration, quel que soit le préfixe que le serveur lui attribuait.
      // Deux tablettes émettaient donc toutes les deux P1-000002, la
      // contrainte d'unicité refusait la seconde, et sa vente n'apparaissait
      // JAMAIS au back-office — alors que ses événements étaient bien arrivés.
      //
      // C'est exactement ce que le préfixe existe pour empêcher : deux
      // appareils hors ligne ne doivent pas pouvoir produire le même numéro.
      // Encore fallait-il l'appliquer.
      if (corps.prefixe) await app.etat.ecrire('ticket_prefix', corps.prefixe)

      // Le device_id est lu UNE fois au montage du contexte, puis figé dans la
      // session de caisse. S'il vient de changer, un simple rafraîchir ne
      // suffit pas : on recharge la page pour que les ventes suivantes soient
      // signées correctement. La base est persistante, rien n'est perdu.
      if (changeDEtablissement || (ancienDevice && ancienDevice !== corps.deviceId)) {
        window.location.reload()
        return
      }
      setEtat('saisie')
      onAppaire()
    } catch (erreur) {
      setEtat('erreur')
      // La trace complète, toujours : le message ci-dessous est écrit pour un
      // gérant, pas pour celui qui devra un jour comprendre la panne.
      console.error('appairage', erreur)
      // Un abandon sur délai n'est pas une adresse fausse : le distinguer
      // évite d'envoyer chercher l'erreur là où elle n'est pas.
      const expire =
        erreur instanceof DOMException &&
        (erreur.name === 'TimeoutError' || erreur.name === 'AbortError')
      /*
       * ── Une panne LOCALE n'est pas une panne de réseau ────────────────
       *
       * Tout ce bloc ne faisait pas que des requêtes : il vide aussi la base
       * locale. Un échec de ce côté-là ressortait en « blocage CORS » —
       * un diagnostic qui envoie fouiller la configuration du serveur pendant
       * que la cause est dans la tablette. `ErreurSqlite` le dit.
       */
      const locale = erreur instanceof ErreurSqlite
      setMessage(
        expire
          ? `Le serveur n'a pas répondu en 15 secondes. Il est probablement en ` +
            `cours de redéploiement — vérifie que ${base}/sante répond, puis ` +
            `réessaie. La caisse fonctionne normalement en attendant.`
          : locale
            ? `La base locale de cette caisse a refusé l'opération : ` +
              `${erreur.message}\n\nRien n'a été modifié — la transaction a été ` +
              `annulée. Le serveur n'est pas en cause. Relevez ce message sur ` +
              `l'écran Diagnostic avant de recommencer.`
            : expliquerEchecReseau(erreur, url),
      )
    }
  }

  /**
   * Ce qui manque encore, en toutes lettres.
   *
   * Un bouton grisé sans explication est un cul-de-sac : on clique, rien ne
   * bouge, et rien ne dit pourquoi. Le cas s'est produit avec l'adresse du
   * serveur — un champ OBLIGATOIRE que j'avais replié dans un volet fermé.
   */
  const manquant =
    url.trim() === ''
      ? "l'adresse du serveur de synchronisation"
      : email.trim() === ''
        ? "l'e-mail du gérant"
        : motDePasse === ''
          ? 'le mot de passe'
          : null

  const pretASoumettre = manquant === null && etat !== 'test'

  return (
    <div className="diagnostic">
      <section className="bloc">
        <h2>Mettre cette caisse en service</h2>
        <p className="note">
          Connectez-vous avec le compte du gérant. Ce terminal recevra
          automatiquement son identité — il n’y a aucun code à recopier.
        </p>
        <p className="note">
          La caisse fonctionne déjà en local : cette étape ajoute la
          synchronisation entre terminaux et l’accès au back-office.
        </p>

        {choix.length > 0 ? (
          <>
            <p className="note">
              Ce compte gère plusieurs établissements. Choisissez celui de
              cette caisse — ses ventes y seront rattachées.
            </p>
            <div className="actions" style={{ flexDirection: 'column' }}>
              {choix.map((e) => (
                <button
                  key={e.restaurantId}
                  type="button"
                  className="principal"
                  disabled={etat === 'test'}
                  onClick={() => void appairer(e.restaurantId)}
                >
                  {e.nom}
                </button>
              ))}
            </div>
            <div className="actions">
              <button
                type="button"
                className="secondaire"
                disabled={etat === 'test'}
                onClick={() => {
                  setChoix([])
                  setMessage(null)
                  setAEffacer(null)
                  setEtat('saisie')
                }}
              >
                Revenir aux identifiants
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="champ-note">
              E-mail du gérant
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="gerant@monresto.tn"
                autoComplete="username"
                spellCheck={false}
              />
            </label>

            <label className="champ-note">
              Mot de passe
              <input
                type="password"
                value={motDePasse}
                onChange={(e) => setMotDePasse(e.target.value)}
                autoComplete="current-password"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && pretASoumettre) void appairer()
                }}
              />
            </label>

            {url.trim() === '' ? (
              <label className="champ-note">
                Adresse du serveur de synchronisation
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://…"
                  autoComplete="off"
                  spellCheck={false}
                />
                <span className="note">
                  L’adresse de l’API de synchronisation, fournie par
                  l’installateur — elle se termine souvent par
                  <span className="mono"> .up.railway.app</span>. À saisir une
                  seule fois : elle sera mémorisée sur ce terminal.
                </span>
              </label>
            ) : (
              // Renseignée : on la replie, elle n'intéresse plus personne.
              <details>
                <summary className="note">
                  Serveur : <span className="mono">{url}</span> — modifier
                </summary>
                <label className="champ-note">
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://…"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
              </details>
            )}

            <div className="actions">
              <button
                type="button"
                className="principal"
                disabled={!pretASoumettre}
                onClick={() => void appairer()}
              >
                {etat === 'test' ? 'Connexion…' : 'Mettre en service'}
              </button>
            </div>
            {manquant && (
              <p className="note">Il manque encore {manquant}.</p>
            )}
          </>
        )}

        {/*
          * Hors du ternaire, et c'est tout le correctif.
          *
          * PANNE OBSERVÉE. Ce message ne vivait que dans la branche du
          * FORMULAIRE. Dans la liste des établissements, on cliquait sur le
          * sien et il ne se passait rien : le refus était calculé, rangé
          * dans `message`, et jamais rendu. Un écran qui ne répond pas au
          * clic est pire qu'un écran qui refuse — on reclique, on conclut
          * que le second restaurant n'existe pas.
          *
          * `pre-line` parce que ces messages ont des paragraphes ; sans
          * cela, tout se recolle en une seule ligne illisible.
          */}
        {etat === 'test' && <p className="note">Connexion au serveur…</p>}
        {message && (
          <p className="erreur" style={{ whiteSpace: 'pre-line' }}>
            {message}
          </p>
        )}

        {aEffacer && (
          <div className="bloc">
            <p className="erreur" style={{ whiteSpace: 'pre-line' }}>
              {`Cette caisse a servi en local avant d’être mise en service.\n\n` +
                `Elle contient ${aEffacer.enAttente + aEffacer.rejetes} opération(s) ` +
                `qui n’ont jamais été envoyées — et qui ne peuvent plus l’être : ` +
                `elles portent l’identité de la caisse de démonstration, qu’aucun ` +
                `serveur ne connaît.\n\n` +
                `La mise en service repart d’une base vide : la carte, les employés ` +
                `et le stock viendront de « ${aEffacer.nom} ». Les commandes et les ` +
                `services de caisse enregistrés ici seront effacés.`}
            </p>
            <div className="actions">
              <button
                type="button"
                className="principal"
                disabled={etat === 'test'}
                onClick={() => void appairer(aEffacer.restaurantId, true)}
              >
                Effacer et mettre en service
              </button>
              <button
                type="button"
                className="secondaire"
                disabled={etat === 'test'}
                onClick={() => setAEffacer(null)}
              >
                Annuler
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
