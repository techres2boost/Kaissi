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
  retirerGraineSansEquivalentServeur,
  type EnregistrementOutbox,
  type EtatBascule,
} from '@kaissi/db-local'
import type { ResumeSync } from '@kaissi/sync-client'
import { useApp } from '../etat/contexte.js'
import { DemandePin } from '../composants/DemandePin.js'
import { expliquerEchecReseau } from '../donnees/diagnostic-reseau.js'
import { estNatif } from '../donnees/sqlite.js'
import { identifiantInstallation } from '../donnees/installation.js'
import { URL_SYNC_PAR_DEFAUT } from '../config.js'
import { dateLocale, t, tm } from '../i18n.js'

const LIBELLES_ETAT: Record<ResumeSync['etat'], string> = {
  inactif: t('En veille'),
  en_cours: t('Synchronisation…'),
  a_jour: t('À jour'),
  hors_ligne: t('Hors ligne'),
  erreur: t('Erreur'),
  bloque: t('Action requise'),
}

const EXPLICATIONS: Record<ResumeSync['etat'], string> = {
  inactif: t("La synchronisation n'a pas encore démarré."),
  en_cours: t('Envoi des ventes et récupération des autres terminaux.'),
  a_jour: t('Toutes les ventes sont enregistrées sur le serveur.'),
  hors_ligne: t(
    'Le serveur est injoignable. La caisse fonctionne normalement : les ventes sont conservées et repartiront seules au retour du réseau.',
  ),
  // Le serveur a RÉPONDU — par une erreur. Ce n'est pas le réseau : c'est
  // chez lui qu'il faut regarder, et le message ci-dessous le dit.
  erreur: t(
    'Le serveur répond, mais n’a pas pu enregistrer ces opérations. Les ventes sont conservées et repartiront seules dès que ce sera corrigé. Si cela dure, transmettez au support le message ci-dessous.',
  ),
  bloque: t(
    'Le serveur a refusé cet appareil. Les ventes sont conservées, mais elles ne partiront pas tant que le problème n’est pas réglé avec le gérant.',
  ),
}

/** Libellés des codes de rejet, en français, destinés au gérant. */
const LIBELLES_REJET: Record<string, string> = {
  commande_close: t('Commande déjà encaissée sur un autre terminal'),
  commande_annulee: t('Commande annulée entre-temps'),
  produit_inconnu: t('Produit retiré du catalogue'),
  appareil_etranger: t('Événement signé par un autre appareil'),
  charge_invalide: t('Données incohérentes'),
  type_inconnu: t('Opération inconnue du serveur — mise à jour requise'),
  lot_trop_grand: t('Trop d’opérations envoyées d’un coup'),
}

export function EcranSync() {
  const { app, sync, resumeSync, rafraichir, identite, employes } = useApp()
  /** Le PIN d'un gérant est demandé avant d'écarter des opérations refusées. */
  const [ecartDemande, setEcartDemande] = useState(false)
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
  /*
   * Le COMPTE qui a mis cette caisse en service — l'adresse, jamais le mot
   * de passe. Elle répond à la question qu'on se pose devant la tablette :
   * « avec quel compte j'ouvre le back-office ? ».
   */
  const [compteEmail, setCompteEmail] = useState<string | null>(null)

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
      const compte = await app.etat.lire('compte_email')
      if (!vivant) return
      setCompteEmail(compte || null)
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
      return `${e.type} · ${dateLocale(e.clientTs, { dateStyle: 'short', timeStyle: 'medium' })}`
    } catch {
      return enregistrement.eventId
    }
  }

  /*
   * Écarter les opérations refusées — décision d'un GÉRANT, pas un nettoyage.
   *
   * Un rejet ne repart jamais tout seul : c'est une règle métier (« commande
   * déjà encaissée sur un autre terminal »), et il reste affiché tant que
   * personne n'a décidé. Mais des rejets d'il y a trois jours, déjà réglés
   * en salle, finissaient par masquer ceux d'aujourd'hui. Le gérant les
   * écarte ; la vente, elle, reste dans le journal de la caisse.
   */
  const ecarterRejets = async () => {
    await app.journal.ecarterRejets(rejets.map((r) => r.eventId))
    setEcartDemande(false)
    rafraichir()
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
        <h2>{t('État de la synchronisation')}</h2>
        <div className={`verdict ${resumeSync.etat === 'a_jour' ? 'ok' : resumeSync.etat === 'bloque' ? 'ko' : ''}`}>
          <strong>{LIBELLES_ETAT[resumeSync.etat]}.</strong> {EXPLICATIONS[resumeSync.etat]}
        </div>

        <dl>
          <dt>{t('Opérations en attente')}</dt>
          <dd className={resumeSync.enAttente > 0 ? 'attention' : 'ok'}>
            {resumeSync.enAttente}
          </dd>
          <dt>{t('Opérations refusées')}</dt>
          <dd className={resumeSync.rejetes > 0 ? 'attention' : ''}>{resumeSync.rejetes}</dd>
          <dt>{t('Dernière synchronisation')}</dt>
          <dd>
            {resumeSync.derniereSyncA
              ? dateLocale(resumeSync.derniereSyncA, { dateStyle: 'short', timeStyle: 'short' })
              : t('jamais')}
          </dd>
          <dt>{t('Dernier changement reçu')}</dt>
          <dd>
            {catalogue.recuA
              ? `${dateLocale(catalogue.recuA, { dateStyle: 'short', timeStyle: 'short' })} · ${t('{n} employé(s)', { n: catalogue.employes })}`
              : t('aucun — catalogue local d’origine')}
          </dd>
          {resumeSync.tentatives > 0 && (
            <>
              <dt>{t('Tentatives échouées')}</dt>
              <dd className="attention">{resumeSync.tentatives}</dd>
            </>
          )}
        </dl>

        {resumeSync.derniereErreur && (
          <p className="note">{t('Dernier message du serveur :')}{' '}{tm(resumeSync.derniereErreur)}</p>
        )}

        <details className="details-techniques">
          <summary>{t('Détails techniques — à lire au support, si on vous les demande')}</summary>
          <dl>
            <dt>{t('Curseur événements')}</dt>
            <dd className="mono">{resumeSync.curseurEvenements}</dd>
            <dt>{t('Curseur catalogue')}</dt>
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
        <p className="note">{t('L\'envoi se fait')}{' '}<strong>{t('tout seul')}</strong>{t(', en continu, dès qu\'il y a du réseau. Vous n\'avez rien à déclencher : ce bouton ne sert qu\'à ne pas attendre les quelques secondes du prochain cycle.')}</p>

        <div className="actions">
          <button
            type="button"
            className="secondaire"
            disabled={resumeSync.etat === 'en_cours' || !sync}
            onClick={() => void sync?.cycle()}
          >
            {resumeSync.etat === 'en_cours' ? t('Envoi en cours…') : t('Ne pas attendre — envoyer maintenant')}
          </button>
        </div>
      </section>

      <section className="bloc">
        <h2>{t('Identité de cet appareil')}</h2>
        <dl>
          <dt>{t('Identifiant')}</dt>
          <dd className="mono">{identite.deviceId || '—'}</dd>
          {/*
            Le COMPTE, à côté de l'appareil — et pas confondu avec lui.
            Ce sont deux identités distinctes : l'appareil porte un jeton
            révocable, le compte ouvre le back-office. Les afficher ensemble
            est la seule façon de faire comprendre qu'une caisse ne « se
            déconnecte » pas d'un compte : elle se révoque, au back-office.
          */}
          <dt>{t('Compte du back-office')}</dt>
          <dd className="mono">{compteEmail ?? '—'}</dd>
        </dl>
        {compteEmail ? (
          <p className="note">{t('Cette caisse a été mise en service avec')}{' '}<strong>{compteEmail}</strong>{t('. C’est avec CE compte que le back-office montre ses ventes — un autre compte ouvrirait un autre établissement. Le mot de passe, lui, n’est jamais conservé ici.')}</p>
        ) : (
          <p className="note">{t('Cette caisse a été mise en service par une version antérieure, qui ne retenait pas l’adresse du compte. Elle apparaîtra au prochain ré-appairage.')}</p>
        )}
        <p className="note">{t('Le serveur fait autorité : au démarrage, le terminal adopte automatiquement l’identité que son jeton désigne. Si des ventes sont refusées pour « appareil étranger », c’est que cette adoption n’a pas encore eu lieu — relancez l’application, ou ré-appairez ci-dessous.')}</p>
        <p>
          <button type="button" onClick={() => void oublierAppairage()}>{t('Ré-appairer — ou changer d’établissement')}</button>
        </p>
        <p className="note">{t('Le formulaire réapparaîtra. Reconnectez-vous avec le compte du gérant : si celui-ci gère')}{' '}<strong>{t('plusieurs établissements')}</strong>{t(', la liste s’affichera et vous choisirez celui de cette caisse.')}</p>
        <p className="note">
          <strong>{t('Changer d’établissement vide la base locale')}</strong>{' '}{t('— carte, employés, stock et ventes de l’ancien. C’est indispensable : les curseurs de synchronisation sont communs à toute la base, et sans remise à zéro le catalogue du nouvel établissement ne serait jamais reçu. Rien n’est perdu côté serveur, où tout a déjà été remonté.')}</p>
        <p className="note">{t('Le changement est')}{' '}<strong>{t('refusé')}</strong>{' '}{t('tant qu’il reste des ventes à envoyer : elles portent l’identité de l’ancien terminal et seraient refusées définitivement. Synchronisez d’abord.')}</p>
      </section>

      {rejets.length > 0 && (
        <section className="bloc">
          <h2>{t('Opérations refusées — votre attention est requise')}</h2>
          <p className="note">{t('Ces opérations ne repartiront pas toutes seules. Chacune traduit une règle métier, pas une panne de réseau.')}</p>
          <table>
            <thead>
              <tr>
                <th>{t('Opération')}</th>
                <th>{t('Motif')}</th>
                <th>{t('Détail')}</th>
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

          <div className="actions-rejets">
            <p className="note">{t('Déjà réglées en salle ? Un gérant peut les écarter : elles quittent cette liste et cessent d’être envoyées. Rien n’est effacé du journal de la caisse.')}</p>
            <button type="button" className="secondaire" onClick={() => setEcartDemande(true)}>
              {t('Écarter ces {n} opération(s)…', { n: rejets.length })}
            </button>
          </div>

          {ecartDemande && (
            <DemandePin
              titre={t('Écarter les opérations refusées')}
              sousTitre={t('Un gérant pose son code : son geste est une décision, pas un nettoyage.')}
              candidats={employes.filter((e) => e.role === 'gerant' || e.role === 'admin')}
              onAnnuler={() => setEcartDemande(false)}
              onValide={() => void ecarterRejets()}
            />
          )}

          {rejets.some((r) => r.codeRejet === 'appareil_etranger') && (
            <div className="note" style={{ marginTop: '0.75rem' }}>
              <p>{t('Les opérations «')}{' '}{LIBELLES_REJET['appareil_etranger']}{' '}{t('» viennent d’un appairage précédent : elles portent l’ancien identifiant de ce terminal et ne pourront jamais partir. La vente reste enregistrée localement ; seule sa remontée au serveur est abandonnée.')}</p>
              <button type="button" onClick={() => void abandonnerEtrangers()}>{t('Abandonner ces opérations d’un ancien appairage')}</button>
            </div>
          )}
        </section>
      )}

      {enAttente.length > 0 && (
        <section className="bloc">
          <h2>{t('En attente d’envoi ({n})', { n: enAttente.length })}</h2>
          <p className="note">{t('Ces opérations sont enregistrées localement et partiront dès que le serveur sera joignable. Aucune n’est perdue.')}</p>
          <table>
            <thead>
              <tr>
                <th>{t('Opération')}</th>
                <th>{t('Tentatives')}</th>
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
            <strong>{t('Rien en attente.')}</strong>{' '}{t('Toutes les ventes de ce terminal sont enregistrées sur le serveur.')}</div>
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
export function FormulaireAppairage({ onAppaire }: { onAppaire: () => void }) {
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

    /**
     * Peut-on repartir sur un autre établissement, et sinon que dit-on ?
     *
     * Le MÊME verdict est prononcé à deux moments (voir plus bas pourquoi) :
     * il ne peut donc pas être écrit deux fois. Deux versions qui divergent
     * donneraient un refus avant l'appel et une acceptation après, ou
     * l'inverse — et le désaccord se verrait en clientèle, pas ici.
     *
     * Rend `false` quand il faut s'arrêter ; il a déjà tout affiché.
     */
    const bascultePossible = async (cible: string | undefined, nom: string) => {
      const attente = await app.journal.enAttente()
      if (peutBasculer(attente) || effacerLeLocal) return true

      /*
       * ── BASCULE, ou PREMIÈRE MISE EN SERVICE ? ────────────────────────
       *
       * PANNE OBSERVÉE. Une caisse qui a servi en local avant d'être mise en
       * service se voyait refuser sa mise en service, avec un conseil
       * impossible à suivre : « synchronisez, puis recommencez » — alors
       * qu'elle n'a pas de jeton et ne peut RIEN synchroniser. C'est
       * pourtant le parcours normal : on montre le POS au restaurateur, puis
       * on le met en service.
       *
       * La graine locale écrit l'identité de la caisse de DÉMONSTRATION :
       * toute caisse neuve paraît donc « changer d'établissement ». Ce qui
       * sépare vraiment les deux cas est le `device_id` — une caisse à qui
       * le SERVEUR en a attribué un a des ventes RÉCUPÉRABLES, et le refus
       * les protège. Une caisse encore sur celui de la démonstration n'en a
       * aucune : ses événements seraient refusés « appareil_etranger »,
       * définitivement.
       */
      if (dejaEnService(await app.etat.lire('device_id'))) {
        setEtat('erreur')
        setMessage(motifDeRefus(attente))
        return false
      }

      // On n'efface pas en silence pour autant : on dit ce qui disparaît, et
      // on attend un « oui ».
      setEtat('erreur')
      setAEffacer({ ...attente, ...(cible ? { restaurantId: cible } : {}), nom })
      return false
    }

    try {
      /*
       * Le refus se prononce AVANT d'appeler le serveur, quand la cible est
       * connue — c'est-à-dire dès qu'on a cliqué un établissement dans la
       * liste.
       *
       * Le contrôle existait déjà, mais après l'enrôlement : un clic refusé
       * créait donc un appareil dans l'établissement visé — avec son préfixe
       * de tickets — pour une bascule qui n'aurait pas lieu. Les clics
       * suivants réutilisent cette ligne, `installation_id` faisant son
       * travail (0021), donc la liste ne s'allonge pas ; il reste un terminal
       * fantôme, jamais vu, dans la liste des caisses du gérant.
       *
       * Le contrôle après l'appel RESTE : au premier appel, le compte peut
       * n'avoir qu'un établissement, et c'est le serveur qui le désigne — on
       * ne connaît la cible qu'en lisant sa réponse.
       */
      if (restaurantId) {
        const ancien = (await app.etat.lire('restaurant_id')) || null
        if (ancien && ancien !== restaurantId) {
          // Le nom vient de la liste qu'on vient d'afficher : à cet instant,
          // le serveur n'a encore rien dit de l'établissement visé.
          const nom = choix.find((e) => e.restaurantId === restaurantId)?.nom
          if (!(await bascultePossible(restaurantId, nom ?? t('cet établissement')))) return
        }
      }

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
        seqDevice?: number
        employeId?: string
        choix?: { restaurantId: string; nom: string }[]
        message?: string
      } | null

      if (!reponse.ok) {
        setEtat('erreur')
        setMessage(corps?.message ? tm(corps.message) : t('Le serveur a répondu {statut}.', { statut: reponse.status }))
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
          t("Le serveur n'a pas renvoyé de jeton. Mets à jour l'API de synchronisation (elle doit exposer /appairage)."),
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
        /*
         * Le MÊME verdict qu'avant l'appel — et il est indispensable ici
         * aussi : quand le compte n'a qu'un seul établissement, aucune liste
         * ne s'affiche, et c'est la réponse du serveur qui désigne la cible.
         * On ne pouvait donc pas la connaître plus tôt.
         */
        const nom = corps.nomEtablissement ?? t('cet établissement')
        if (!(await bascultePossible(corps.restaurantId, nom))) return

        // Rien en attente — ou un « oui » explicite sur des opérations qui
        // ne pouvaient de toute façon plus partir. Le journal d'une caisse
        // déjà en service, lui, est remonté : il reste au serveur, immuable.
        await reinitialiserPourAutreEtablissement(app.base.adaptateur)
      } else if (!dejaEnService(ancienDevice)) {
        /*
         * PREMIÈRE mise en service, dans l'établissement de la graine.
         *
         * Les produits de la graine portent les mêmes identifiants que ceux
         * du serveur : le premier pull les recouvre. Ses réductions et ses
         * clients, non — ils n'existent que sur la caisse. Les garder
         * affichait chaque réduction DEUX fois (celle de la graine, celle du
         * back-office), et choisir la mauvaise envoyait au serveur une
         * référence qu'il ne connaissait pas.
         */
        await retirerGraineSansEquivalentServeur(app.base.adaptateur)
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
      /*
       * Le COMPTEUR D'ÉVÉNEMENTS de ce terminal, vu du serveur — et on
       * reprend au-dessus.
       *
       * PANNE OBSERVÉE (23 octobre). Une caisse dont la base locale avait
       * été vidée gardait son `device_id` (le serveur la reconnaît par son
       * `installation_id`, migration 0021) mais repartait à `seq_device = 1`.
       * Le serveur avait déjà ses événements 1 à 143 : l'ancienne contrainte
       * d'unicité refusait l'insertion, tout le lot tombait, et plus AUCUNE
       * vente ne remontait — pour toujours.
       *
       * Postgres 0049 a retiré cette unicité, qui bloquait une caisse pour
       * un numéro d'ordre. Ici, on règle la cause : le compteur ne repart
       * jamais en arrière. Même principe que le préfixe de tickets.
       *
       * `Math.max` et jamais une écriture sèche : un serveur qui rendrait un
       * compteur plus BAS que le nôtre (lot pas encore remonté) ne doit pas
       * faire reculer le nôtre.
       */
      if (typeof corps.seqDevice === 'number' && corps.seqDevice > 0) {
        await app.journal.adopterSeq(corps.seqDevice)
      }
      /*
       * QUI vient de mettre ce terminal en service — pour lui proposer son
       * pavé PIN d'emblée, plutôt que la liste de toute l'équipe.
       *
       * Facultatif : un serveur antérieur ne renvoie pas ce champ, et la
       * prise de poste retombe alors sur la liste. Rien de ce qui n'est pas
       * une vente ne doit pouvoir faire échouer un appairage.
       */
      if (corps.employeId) await app.etat.ecrire('employe_appaireur', corps.employeId)
      /*
       * L'ADRESSE du compte qui a mis cette caisse en service.
       *
       * Elle n'ouvre rien — le mot de passe n'est jamais conservé — et ne
       * sert qu'à répondre à une question qu'on se pose devant la tablette :
       * « avec quel compte j'ouvre le back-office ? ». Sans elle, un gérant
       * qui a deux adresses essaie la mauvaise et conclut que le back-office
       * ne montre pas ses ventes.
       */
      await app.etat.ecrire('compte_email', email.trim())

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
          ? t(
              "Le serveur n'a pas répondu en 15 secondes. Il est probablement en cours de redéploiement — vérifie que {adresse}/sante répond, puis réessaie. La caisse fonctionne normalement en attendant.",
              { adresse: base },
            )
          : locale
            ? t(
                "La base locale de cette caisse a refusé l'opération : {detail}\n\nRien n'a été modifié — la transaction a été annulée. Le serveur n'est pas en cause. Relevez ce message sur l'écran Diagnostic avant de recommencer.",
                { detail: erreur.message },
              )
            : expliquerEchecReseau(erreur, url, estNatif()),
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
      ? t("l'adresse du serveur de synchronisation")
      : email.trim() === ''
        ? t("l'e-mail du gérant")
        : motDePasse === ''
          ? t('le mot de passe')
          : null

  const pretASoumettre = manquant === null && etat !== 'test'

  return (
    <div className="diagnostic">
      <section className="bloc">
        <h2>{t('Mettre cette caisse en service')}</h2>
        <p className="note">{t('Connectez-vous avec le compte du gérant. Ce terminal recevra automatiquement son identité — il n’y a aucun code à recopier.')}</p>
        <p className="note">{t('La caisse fonctionne déjà en local : cette étape ajoute la synchronisation entre terminaux et l’accès au back-office.')}</p>

        {/*
          Le message d'erreur est AU-DESSUS de la bifurcation, et c'est tout
          l'objet du correctif.
          
          PANNE OBSERVÉE. Il vivait dans la branche « formulaire » seulement.
          Un gérant qui gère deux établissements voyait donc la liste, cliquait
          « Snack Lack 2 »… et rien. Le refus était bien calculé — l'outbox
          n'était pas vide, ou le serveur répondait 403 — mais il s'écrivait
          dans un état que cette branche n'affichait pas. Le bouton restait là,
          muet, et on conclut que le second établissement n'existe pas.
          
          `pre-line` compte autant : `motifDeRefus()` sépare ses raisons par
          des lignes vides, et sans cette règle elles se collaient en un seul
          paragraphe illisible.
        */}
        {message && (
          <p className="erreur" style={{ whiteSpace: 'pre-line' }} role="alert">
            {message}
          </p>
        )}

        {choix.length > 0 ? (
          <>
            <p className="note">{t('Ce compte gère plusieurs établissements. Choisissez celui de cette caisse — ses ventes y seront rattachées.')}</p>
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
            {/*
              Une sortie. Sans elle, un mauvais compte ou un refus enferme sur
              cet écran : la liste ne propose que des établissements, et rien
              ne ramène à la saisie des identifiants.
            */}
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
              >{t('‹ Changer de compte')}</button>
            </div>
          </>
        ) : (
          <>
            <label className="champ-note">{t('E-mail du gérant')}<input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('gerant@monresto.tn')}
                autoComplete="username"
                spellCheck={false}
              />
            </label>

            <label className="champ-note">{t('Mot de passe')}<input
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
              <label className="champ-note">{t('Adresse du serveur de synchronisation')}<input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={t('https://…')}
                  autoComplete="off"
                  spellCheck={false}
                />
                <span className="note">{t('L’adresse de l’API de synchronisation, fournie par l’installateur — elle se termine souvent par')}<span className="mono">{' '}{t('.up.railway.app')}</span>{t('. À saisir une seule fois : elle sera mémorisée sur ce terminal.')}</span>
              </label>
            ) : (
              // Renseignée : on la replie, elle n'intéresse plus personne.
              <details>
                <summary className="note">{t('Serveur :')}{' '}<span className="mono">{url}</span>{' '}{t('— modifier')}</summary>
                <label className="champ-note">
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder={t('https://…')}
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
                {etat === 'test' ? t('Connexion…') : t('Mettre en service')}
              </button>
            </div>
            {manquant && (
              <p className="note">{t('Il manque encore {quoi}.', { quoi: manquant })}</p>
            )}
          </>
        )}

        {/*
          Hors du ternaire, comme le message ci-dessus, et pour la même
          raison : la liste des établissements ne rendait AUCUN retour. Un
          écran qui ne répond pas au clic est pire qu'un écran qui refuse —
          on reclique, et on conclut que l'établissement n'existe pas.
        */}
        {etat === 'test' && <p className="note">{t('Connexion au serveur…')}</p>}

        {aEffacer && (
          <div className="bloc">
            <p className="erreur" style={{ whiteSpace: 'pre-line' }}>
              {t(
                'Cette caisse a servi en local avant d’être mise en service.\n\nElle contient {n} opération(s) qui n’ont jamais été envoyées — et qui ne peuvent plus l’être : elles portent l’identité de la caisse de démonstration, qu’aucun serveur ne connaît.\n\nLa mise en service repart d’une base vide : la carte, les employés et le stock viendront de « {nom} ». Les commandes et les services de caisse enregistrés ici seront effacés.',
                { n: aEffacer.enAttente + aEffacer.rejetes, nom: aEffacer.nom },
              )}
            </p>
            <div className="actions">
              <button
                type="button"
                className="principal"
                disabled={etat === 'test'}
                onClick={() => void appairer(aEffacer.restaurantId, true)}
              >{t('Effacer et mettre en service')}</button>
              <button
                type="button"
                className="secondaire"
                disabled={etat === 'test'}
                onClick={() => setAEffacer(null)}
              >{t('Annuler')}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
