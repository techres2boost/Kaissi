/**
 * Écran Diagnostic.
 *
 * Tu ne peux pas envoyer quelqu'un à Sfax pour comprendre pourquoi une
 * tablette ne démarre pas. Cet écran donne, sur l'appareil, tout ce qu'il
 * faut pour qualifier un incident au téléphone : mode de stockage, version
 * de schéma, migrations appliquées, contenu du catalogue, état de l'outbox.
 *
 * C'est aussi l'écran qui PROUVE le mode avion : « Réseau : hors ligne » et
 * « 17 produits lus depuis SQLite » sur la même page.
 */

import { useCallback, useEffect, useState } from 'react'
import { formaterErreurImpression } from '@kaissi/printing'
import type { Station, TravailImpression } from '@kaissi/db-local'
import type { ContexteApplication } from '../donnees/demarrage.js'
import type { EtatReseau } from '../donnees/reseau.js'
import { ImprimanteReseau } from '../plugins/imprimante.js'
import { IMPRESSION_ACTIVE } from '../config.js'

interface Props {
  contexte: ContexteApplication
  reseau: EtatReseau
}

export function EcranDiagnostic({ contexte, reseau }: Props) {
  const [etatLocal, setEtatLocal] = useState<Record<string, string | null>>({})
  const [compteurs, setCompteurs] = useState({ enAttente: 0, rejetes: 0 })
  const [produits, setProduits] = useState(0)
  const [impression, setImpression] = useState({ enAttente: 0, echecs: 0 })
  const [echecs, setEchecs] = useState<TravailImpression[]>([])
  const [stations, setStations] = useState<Station[]>([])
  const [essais, setEssais] = useState<Record<string, string>>({})

  useEffect(() => {
    let vivant = true
    void (async () => {
      const [e, c, p, i, ech, st] = await Promise.all([
        contexte.etat.tout(),
        contexte.journal.enAttente(),
        contexte.catalogue.nombreProduits(),
        contexte.fileImpression.compteurs(),
        contexte.fileImpression.enEchec(),
        contexte.stations.toutes(),
      ])
      if (!vivant) return
      setEtatLocal(e)
      setCompteurs(c)
      setProduits(p)
      setImpression(i)
      setEchecs(ech)
      setStations(st)
    })()
    return () => {
      vivant = false
    }
  }, [contexte])

  /**
   * Écrit la saisie tout de suite : une adresse d'imprimante saisie puis
   * perdue parce qu'on a changé d'onglet est exactement le genre de détail
   * qui fait perdre une demi-heure en service.
   */
  const majStation = useCallback(
    (id: string, champs: { hote?: string; port?: number }) => {
      setStations((actuelles) => {
        const suivantes = actuelles.map((s) => (s.id === id ? { ...s, ...champs } : s))
        const modifiee = suivantes.find((s) => s.id === id)
        if (modifiee) {
          void contexte.stations.definirImprimante(id, modifiee.hote, modifiee.port)
        }
        return suivantes
      })
    },
    [contexte],
  )

  const relancerImpressions = useCallback(async () => {
    await contexte.fileImpression.reessayerTout()
    const [i, ech] = await Promise.all([
      contexte.fileImpression.compteurs(),
      contexte.fileImpression.enEchec(),
    ])
    setImpression(i)
    setEchecs(ech)
  }, [contexte])

  const testerStation = useCallback(async (station: Station) => {
    if (!station.hote) {
      setEssais((e) => ({ ...e, [station.id]: 'Aucune adresse saisie.' }))
      return
    }
    setEssais((e) => ({ ...e, [station.id]: 'Essai en cours…' }))
    try {
      const r = await ImprimanteReseau.tester({ hote: station.hote, port: station.port })
      setEssais((e) => ({
        ...e,
        [station.id]: r.joignable
          ? `Joignable en ${r.dureeMs} ms`
          : `Injoignable — ${formaterErreurImpression(r.erreur ?? 'raison inconnue')}`,
      }))
    } catch (erreur) {
      setEssais((e) => ({
        ...e,
        [station.id]: formaterErreurImpression(
          erreur instanceof Error ? erreur.message : String(erreur),
        ),
      }))
    }
  }, [])

  return (
    <div className="diagnostic">
      <section className="bloc">
        <h2>Mode avion — critère de sortie de la Phase 0</h2>
        <div className={`verdict ${produits > 0 ? 'ok' : 'ko'}`}>
          {produits > 0 ? (
            <>
              <strong>Réussi.</strong> {produits} produits lus depuis SQLite
              local, réseau {reseau.connecte ? 'disponible mais non sollicité' : 'INDISPONIBLE'}.
              Aucune requête n'a été émise au démarrage.
            </>
          ) : (
            <>
              <strong>Échec.</strong> Le catalogue local est vide : l'écran de
              caisse ne peut rien afficher.
            </>
          )}
        </div>
      </section>

      {!IMPRESSION_ACTIVE && (
        <section className="bloc">
          <h2>Impression — désactivée</h2>
          <p className="note">
            Ce build n'imprime pas. Les tickets s'affichent à l'écran et la
            cuisine lit ses commandes au back-office. Le module ESC/POS, la
            file persistante et le plugin natif sont intacts : un build avec{' '}
            <code>VITE_IMPRESSION=1</code> les rallume, et cet écran retrouve
            la configuration des imprimantes.
          </p>
        </section>
      )}

      {IMPRESSION_ACTIVE && (
        <section className="bloc">
          <h2>Imprimantes</h2>
          <p className="note">
            L'adresse est celle de l'imprimante sur le réseau du restaurant, et
            le port est presque toujours 9100. Sur un émulateur, la machine qui
            fait tourner l'imprimante virtuelle se désigne par{' '}
            <code>10.0.2.2</code> — <code>localhost</code> désignerait
            l'émulateur lui-même.
          </p>
          {stations.length === 0 ? (
            <p className="note">Aucune station configurée.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Station</th>
                  <th>Adresse</th>
                  <th>Port</th>
                  <th />
                  <th>Dernier essai</th>
                </tr>
              </thead>
              <tbody>
                {stations.map((s) => (
                  <tr key={s.id}>
                    <td>{s.nom}</td>
                    <td>
                      <input
                        className="mono"
                        value={s.hote ?? ''}
                        placeholder="192.168.1.50"
                        onChange={(ev) => majStation(s.id, { hote: ev.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="mono port"
                        inputMode="numeric"
                        value={String(s.port)}
                        onChange={(ev) =>
                          majStation(s.id, { port: Number(ev.target.value) || 0 })
                        }
                      />
                    </td>
                    <td>
                      <button type="button" onClick={() => testerStation(s)}>
                        Tester
                      </button>
                    </td>
                    <td className="detail">{essais[s.id] ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="note">
            La saisie est enregistrée sur cet appareil. Une fois la tablette
            appairée, <code>stations</code> devient un référentiel tiré du
            serveur : c'est le back-office qui fait alors autorité, sinon deux
            tablettes du même restaurant imprimeraient à deux endroits
            différents.
          </p>
        </section>
      )}

      <section className="bloc">
        <h2>Démarrage</h2>
        <table>
          <thead>
            <tr>
              <th>Étape</th>
              <th>État</th>
              <th>Durée</th>
              <th>Détail</th>
            </tr>
          </thead>
          <tbody>
            {contexte.etapes.map((e) => (
              <tr key={e.nom}>
                <td>{e.nom}</td>
                <td className={e.statut}>{e.statut === 'ok' ? '✓' : '✗'}</td>
                <td className="nombre">{e.dureeMs} ms</td>
                <td className="detail">{e.detail}</td>
              </tr>
            ))}
            <tr className="total">
              <td>Total</td>
              <td />
              <td className="nombre">{contexte.dureeTotaleMs} ms</td>
              <td />
            </tr>
          </tbody>
        </table>
      </section>

      <section className="bloc">
        <h2>Stockage</h2>
        <dl>
          <dt>Mode</dt>
          <dd>{contexte.base.mode}</dd>
          <dt>Persistance</dt>
          <dd className={contexte.base.persistant ? 'ok' : 'attention'}>
            {contexte.base.persistant
              ? 'Oui — les ventes survivent au redémarrage'
              : 'NON — base en mémoire, développement uniquement'}
          </dd>
          <dt>Détail</dt>
          <dd>{contexte.base.detail}</dd>
          {contexte.base.avertissement && (
            <>
              <dt>Réserve</dt>
              <dd className="attention">{contexte.base.avertissement}</dd>
            </>
          )}
          <dt>Version de schéma</dt>
          <dd>{contexte.versionSchema}</dd>
        </dl>
      </section>

      <section className="bloc">
        <h2>Migrations locales appliquées</h2>
        <table>
          <thead>
            <tr>
              <th>Version</th>
              <th>Nom</th>
              <th>Appliquée le</th>
              <th>Durée</th>
            </tr>
          </thead>
          <tbody>
            {contexte.migrations.map((m) => (
              <tr key={m.version}>
                <td className="nombre">{m.version}</td>
                <td>{m.nom}</td>
                <td className="detail">{m.appliqueA}</td>
                <td className="nombre">{m.dureeMs} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="bloc">
        <h2>Synchronisation</h2>
        <dl>
          <dt>Réseau</dt>
          <dd className={reseau.connecte ? 'ok' : 'attention'}>
            {reseau.connecte ? `En ligne (${reseau.type})` : 'Hors ligne'}
          </dd>
          <dt>Opérations en attente</dt>
          <dd>{compteurs.enAttente}</dd>
          <dt>Opérations rejetées</dt>
          <dd className={compteurs.rejetes > 0 ? 'attention' : ''}>
            {compteurs.rejetes}
            {compteurs.rejetes > 0 && ' — nécessitent votre attention'}
          </dd>
        </dl>
        <p className="note">
          Le moteur de synchronisation (push / pull / curseurs) est la Phase 2.
          En Phase 0, l'outbox se remplit mais rien n'est envoyé : c'est voulu.
        </p>
      </section>

      {IMPRESSION_ACTIVE && (
        <section className="bloc">
          <h2>File d'impression</h2>
          <dl>
            <dt>En attente</dt>
            <dd className={impression.enAttente > 0 ? 'attention' : ''}>
              {impression.enAttente}
            </dd>
            <dt>En échec</dt>
            <dd className={impression.echecs > 0 ? 'attention' : ''}>{impression.echecs}</dd>
          </dl>
          {echecs.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Imprimante</th>
                  <th>Tentatives</th>
                  <th>Erreur</th>
                </tr>
              </thead>
              <tbody>
                {echecs.map((t) => (
                  <tr key={t.id}>
                    <td>{t.kind}</td>
                    <td className="mono">
                      {t.hote ?? '—'}:{t.port}
                    </td>
                    <td className="nombre">{t.tentatives}</td>
                    <td className="detail">
                      {t.derniereErreur ? formaterErreurImpression(t.derniereErreur) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {impression.echecs > 0 && (
            <p>
              <button type="button" onClick={() => void relancerImpressions()}>
                Relancer les {impression.echecs} ticket(s) en échec
              </button>
            </p>
          )}
          <p className="note">
            Un ticket en échec n'est jamais supprimé : il reste ici jusqu'à ce
            qu'un responsable le relance ou l'abandonne explicitement. Après cinq
            tentatives, la file cesse de réessayer seule — sinon une panne
            durable resterait invisible derrière des essais sans fin.
          </p>
        </section>
      )}

      <section className="bloc">
        <h2>Identité locale</h2>
        <table>
          <tbody>
            {Object.entries(etatLocal).map(([cle, valeur]) => (
              <tr key={cle}>
                <td>{cle}</td>
                <td className="detail mono">{valeur || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
