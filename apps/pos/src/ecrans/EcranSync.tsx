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
import type { EnregistrementOutbox } from '@kaissi/db-local'
import type { ResumeSync } from '@kaissi/sync-client'
import { useApp } from '../etat/contexte.js'
import { expliquerEchecReseau } from '../donnees/diagnostic-reseau.js'

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
  const { app, sync, resumeSync, rafraichir } = useApp()
  const [rejets, setRejets] = useState<EnregistrementOutbox[]>([])
  const [enAttente, setEnAttente] = useState<EnregistrementOutbox[]>([])

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
      if (!vivant) return
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
          <dt>Curseur événements</dt>
          <dd className="mono">{resumeSync.curseurEvenements}</dd>
          <dt>Curseur catalogue</dt>
          <dd className="mono">{resumeSync.curseurCatalogue}</dd>
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

        <div className="actions">
          <button
            type="button"
            className="principal"
            disabled={resumeSync.etat === 'en_cours' || !sync}
            onClick={() => void sync?.cycle()}
          >
            {resumeSync.etat === 'en_cours' ? 'Synchronisation…' : 'Synchroniser maintenant'}
          </button>
        </div>
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
 * Saisie du jeton d'appareil.
 *
 * Le jeton est fourni par le gérant, généré côté serveur
 * (`apps/sync/scripts/appairer.mjs`). Tant qu'il n'est pas saisi, la caisse
 * fonctionne parfaitement — simplement en local. C'est le mode des Phases
 * 0 et 1, et il reste un repli valide si le serveur est indisponible le
 * jour de l'installation.
 */
function FormulaireAppairage({ onAppaire }: { onAppaire: () => void }) {
  const { app } = useApp()
  const [url, setUrl] = useState('')
  const [jeton, setJeton] = useState('')
  const [etat, setEtat] = useState<'saisie' | 'test' | 'erreur'>('saisie')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void app.etat.lire('url_sync').then((u) => u && setUrl(u))
  }, [app])

  const appairer = async () => {
    setEtat('test')
    setMessage(null)
    try {
      // On VÉRIFIE le jeton avant de l'enregistrer : un appairage qui
      // échoue silencieusement se découvrirait au pire moment, en plein
      // service, quand le gérant n'est pas là.
      const reponse = await fetch(
        `${url.replace(/\/+$/, '')}/sync/pull?protocolVersion=1&depuisCatalogue=0&depuisEvenements=0&taillePage=1`,
        { headers: { authorization: `Bearer ${jeton.trim()}` } },
      )
      if (!reponse.ok) {
        const corps = (await reponse.json().catch(() => null)) as { message?: string } | null
        setEtat('erreur')
        setMessage(corps?.message ?? `Le serveur a répondu ${reponse.status}.`)
        return
      }
      await app.etat.ecrire('url_sync', url.replace(/\/+$/, ''))
      await app.etat.ecrire('jeton_appareil', jeton.trim())
      onAppaire()
    } catch (erreur) {
      setEtat('erreur')
      setMessage(expliquerEchecReseau(erreur, url))
    }
  }

  return (
    <div className="diagnostic">
      <section className="bloc">
        <h2>Appairer ce terminal</h2>
        <p className="note">
          Ce terminal n’est pas encore relié au serveur. La caisse fonctionne
          normalement en local ; l’appairage ajoute la synchronisation entre
          terminaux et l’accès au back-office.
        </p>

        <label className="champ-note">
          Adresse du serveur de synchronisation
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            autoComplete="off"
          />
        </label>

        <label className="champ-note">
          Jeton d’appareil (fourni par le gérant)
          <input
            type="text"
            value={jeton}
            onChange={(e) => setJeton(e.target.value)}
            placeholder="kdev_…"
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        {message && <p className="erreur">{message}</p>}

        <div className="actions">
          <button
            type="button"
            className="principal"
            disabled={etat === 'test' || url.trim() === '' || jeton.trim() === ''}
            onClick={() => void appairer()}
          >
            {etat === 'test' ? 'Vérification…' : 'Vérifier et appairer'}
          </button>
        </div>
      </section>
    </div>
  )
}
