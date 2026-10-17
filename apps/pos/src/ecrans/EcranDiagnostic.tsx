/**
 * Écran Diagnostic — deux écrans en un, et c'est délibéré.
 *
 * EN HAUT, quatre phrases qu'un caissier comprend : est-ce que la carte est
 * là, est-ce que mes ventes sont en sécurité, est-ce que j'ai Internet,
 * est-ce qu'il reste des ventes à envoyer. Rien d'autre. La première version
 * ouvrait sur « Mode avion — critère de sortie de la Phase 0 » et « SQLite
 * persisté dans IndexedDB » : vrai, utile au support, illisible pour la
 * personne qui tient la caisse à 20 h.
 *
 * EN DESSOUS, replié, tout le reste — mode de stockage, version de schéma,
 * migrations, étapes de démarrage, identité locale. On ne peut pas envoyer
 * quelqu'un à Sfax pour comprendre pourquoi une tablette ne démarre pas :
 * ces informations doivent rester SUR l'appareil, lisibles au téléphone.
 *
 * Replier n'est pas cacher. Le caissier n'a pas à les lire ; le support doit
 * pouvoir les dicter en trois secondes.
 */

import { useCallback, useEffect, useState } from 'react'
import { expliquerErreurImpression } from '@kaissi/printing'
import type { Station, TravailImpression } from '@kaissi/db-local'
import type { ContexteApplication } from '../donnees/demarrage.js'
import type { EtatReseau } from '../donnees/reseau.js'
import { ImprimanteReseau } from '../plugins/imprimante.js'
import { IMPRESSION_ACTIVE } from '../config.js'
import { BUILD_COMMIT, BUILD_DATE } from '../config.js'
import { dateLocale, t, tm } from '../i18n.js'

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
      setEssais((e) => ({ ...e, [station.id]: t('Aucune adresse saisie.') }))
      return
    }
    setEssais((e) => ({ ...e, [station.id]: t('Essai en cours…') }))
    try {
      const r = await ImprimanteReseau.tester({ hote: station.hote, port: station.port })
      setEssais((e) => ({
        ...e,
        [station.id]: r.joignable
          ? t('Joignable en {duree} ms', { duree: r.dureeMs })
          : t('Injoignable — {raison}', {
              raison: erreurImpression(r.erreur ?? 'raison inconnue'),
            }),
      }))
    } catch (erreur) {
      setEssais((e) => ({
        ...e,
        [station.id]: erreurImpression(erreur instanceof Error ? erreur.message : String(erreur)),
      }))
    }
  }, [])

  const toutVaBien =
    produits > 0 && contexte.base.persistant && compteurs.rejetes === 0

  return (
    <div className="diagnostic">
      <section className="bloc">
        <h2>{t('État de cet appareil')}</h2>
        <div className={`verdict ${toutVaBien ? 'ok' : 'ko'}`}>
          {toutVaBien ? (
            <>
              <strong>{t('Tout va bien.')}</strong>{' '}{t('Vous pouvez encaisser, même sans Internet.')}</>
          ) : (
            <>
              {/*
                « en rouge » et non « en orange » : la couleur d'alerte était
                un corail chaud (#E4756A) qui se lisait comme de l'orange sur
                fond sombre. Passée au rouge franc pour tenir le contraste sur
                fond clair, elle a rendu cette phrase FAUSSE — elle envoie
                chercher une ligne d'une couleur qui n'existe plus à l'écran.
                Un texte qui nomme une couleur se relit quand la palette
                change.
              */}
              <strong>{t('Un point demande votre attention.')}</strong>{' '}{t('Voyez la ligne en rouge ci-dessous.')}</>
          )}
        </div>

        <dl className="etat-simple">
          <dt>{t('La carte')}</dt>
          <dd className={produits > 0 ? 'ok' : 'attention'}>
            {produits > 0
              ? t("{n} produits enregistrés sur l'appareil.", { n: produits })
              : t('Aucun produit : la caisse ne peut rien afficher. Prévenez le gérant.')}
          </dd>

          <dt>{t('Vos ventes')}</dt>
          <dd className={contexte.base.persistant ? 'ok' : 'attention'}>
            {contexte.base.persistant
              ? t('Enregistrées sur l’appareil. Elles survivent à une coupure de courant.')
              : t('NON enregistrées — cette page est une démonstration, pas une caisse.')}
          </dd>

          <dt>{t('Internet')}</dt>
          <dd className={reseau.connecte ? 'ok' : ''}>
            {reseau.connecte
              ? t('Connecté.')
              : t('Absent — la caisse fonctionne quand même. Rien n’est perdu.')}
          </dd>

          <dt>{t('Envoi au bureau')}</dt>
          <dd className={compteurs.rejetes > 0 ? 'attention' : ''}>
            {compteurs.rejetes > 0
              ? t('{n} opération(s) refusée(s) — à montrer au gérant.', { n: compteurs.rejetes })
              : compteurs.enAttente > 0
                ? t('{n} vente(s) en attente. Elles partiront seules.', { n: compteurs.enAttente })
                : t('Tout est arrivé au bureau.')}
          </dd>
        </dl>

        {contexte.base.avertissement && (
          <p className="note attention">{tm(contexte.base.avertissement)}</p>
        )}
      </section>

      {!IMPRESSION_ACTIVE && (
        <section className="bloc">
          <h2>{t('Impression — désactivée')}</h2>
          <p className="note">{t('Ce build n\'imprime pas. Les tickets s\'affichent à l\'écran et la cuisine lit ses commandes au back-office. Le module ESC/POS, la file persistante et le plugin natif sont intacts : un build avec')}{' '}
            <code>{t('VITE_IMPRESSION=1')}</code>{' '}{t('les rallume, et cet écran retrouve la configuration des imprimantes.')}</p>
        </section>
      )}

      {IMPRESSION_ACTIVE && (
        <section className="bloc">
          <h2>{t('Imprimantes')}</h2>
          <p className="note">{t('L\'adresse est celle de l\'imprimante sur le réseau du restaurant, et le port est presque toujours 9100. Sur un émulateur, la machine qui fait tourner l\'imprimante virtuelle se désigne par')}{' '}
            <code>10.0.2.2</code> — <code>{t('localhost')}</code>{' '}{t('désignerait l\'émulateur lui-même.')}</p>
          {stations.length === 0 ? (
            <p className="note">{t('Aucune station configurée.')}</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>{t('Station')}</th>
                  <th>{t('Adresse')}</th>
                  <th>{t('Port')}</th>
                  <th />
                  <th>{t('Dernier essai')}</th>
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
                      <button type="button" onClick={() => void testerStation(s)}>{t('Tester')}</button>
                    </td>
                    <td className="detail">{essais[s.id] ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="note">{t('La saisie est enregistrée sur cet appareil. Une fois la tablette appairée,')}{' '}<code>{t('stations')}</code>{' '}{t('devient un référentiel tiré du serveur : c\'est le back-office qui fait alors autorité, sinon deux tablettes du même restaurant imprimeraient à deux endroits différents.')}</p>
        </section>
      )}

      <details className="details-techniques">
        <summary>{t('Détails techniques — à lire au support, si on vous les demande')}</summary>

      <section className="bloc">
        <h2>{t('Démarrage')}</h2>
        <table>
          <thead>
            <tr>
              <th>{t('Étape')}</th>
              <th>{t('État')}</th>
              <th>{t('Durée')}</th>
              <th>{t('Détail')}</th>
            </tr>
          </thead>
          <tbody>
            {contexte.etapes.map((e) => (
              <tr key={e.nom}>
                <td>{e.nom}</td>
                <td className={e.statut}>{e.statut === 'ok' ? '✓' : '✗'}</td>
                <td className="nombre">{e.dureeMs}{' '}{t('ms')}</td>
                <td className="detail">{e.detail}</td>
              </tr>
            ))}
            <tr className="total">
              <td>{t('Total')}</td>
              <td />
              <td className="nombre">{contexte.dureeTotaleMs}{' '}{t('ms')}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </section>

      <section className="bloc">
        <h2>{t('Stockage')}</h2>
        <dl>
          <dt>{t('Mode')}</dt>
          <dd>{contexte.base.mode}</dd>
          <dt>{t('Persistance')}</dt>
          <dd className={contexte.base.persistant ? 'ok' : 'attention'}>
            {contexte.base.persistant
              ? t('Oui — les ventes survivent au redémarrage')
              : t('NON — base en mémoire, développement uniquement')}
          </dd>
          <dt>{t('Détail')}</dt>
          <dd>{tm(contexte.base.detail)}</dd>
          {contexte.base.avertissement && (
            <>
              <dt>{t('Réserve')}</dt>
              <dd className="attention">{contexte.base.avertissement}</dd>
            </>
          )}
          <dt>{t('Version de schéma')}</dt>
          <dd>{contexte.versionSchema}</dd>
        </dl>
      </section>

      <section className="bloc">
        <h2>{t('Migrations locales appliquées')}</h2>
        <table>
          <thead>
            <tr>
              <th>{t('Version')}</th>
              <th>{t('Nom')}</th>
              <th>{t('Appliquée le')}</th>
              <th>{t('Durée')}</th>
            </tr>
          </thead>
          <tbody>
            {contexte.migrations.map((m) => (
              <tr key={m.version}>
                <td className="nombre">{m.version}</td>
                <td>{m.nom}</td>
                <td className="detail">{m.appliqueA}</td>
                <td className="nombre">{m.dureeMs}{' '}{t('ms')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="bloc">
        <h2>{t('Synchronisation')}</h2>
        <dl>
          <dt>{t('Réseau')}</dt>
          <dd className={reseau.connecte ? 'ok' : 'attention'}>
            {reseau.connecte ? t('En ligne ({type})', { type: reseau.type }) : t('Hors ligne')}
          </dd>
          <dt>{t('Opérations en attente')}</dt>
          <dd>{compteurs.enAttente}</dd>
          <dt>{t('Opérations rejetées')}</dt>
          <dd className={compteurs.rejetes > 0 ? 'attention' : ''}>
            {compteurs.rejetes}
            {compteurs.rejetes > 0 && ` — ${t('nécessitent votre attention')}`}
          </dd>
        </dl>
        <p className="note">{t('L\'envoi est AUTOMATIQUE et continu : rien à déclencher à la main. Une opération ne quitte la file que sur accusé de réception du serveur — jamais au bout d\'un délai, jamais « au bout de N essais ». Un rejet, lui, ne se réessaie jamais tout seul : c\'est une règle de gestion, et elle remonte au gérant.')}</p>
      </section>

      {IMPRESSION_ACTIVE && (
        <section className="bloc">
          <h2>{t('File d\'impression')}</h2>
          <dl>
            <dt>{t('En attente')}</dt>
            <dd className={impression.enAttente > 0 ? 'attention' : ''}>
              {impression.enAttente}
            </dd>
            <dt>{t('En échec')}</dt>
            <dd className={impression.echecs > 0 ? 'attention' : ''}>{impression.echecs}</dd>
          </dl>
          {echecs.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>{t('Type')}</th>
                  <th>{t('Imprimante')}</th>
                  <th>{t('Tentatives')}</th>
                  <th>{t('Erreur')}</th>
                </tr>
              </thead>
              <tbody>
                {echecs.map((elt) => (
                  <tr key={elt.id}>
                    <td>{elt.kind}</td>
                    <td className="mono">
                      {elt.hote ?? '—'}:{elt.port}
                    </td>
                    <td className="nombre">{elt.tentatives}</td>
                    <td className="detail">
                      {elt.derniereErreur ? erreurImpression(elt.derniereErreur) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {impression.echecs > 0 && (
            <p>
              <button type="button" onClick={() => void relancerImpressions()}>{t('Relancer les {n} ticket(s) en échec', { n: impression.echecs })}</button>
            </p>
          )}
          <p className="note">{t('Un ticket en échec n\'est jamais supprimé : il reste ici jusqu\'à ce qu\'un responsable le relance ou l\'abandonne explicitement. Après cinq tentatives, la file cesse de réessayer seule — sinon une panne durable resterait invisible derrière des essais sans fin.')}</p>
        </section>
      )}

      <section className="bloc">
        <h2>{t('Version en cours d’exécution')}</h2>
        <dl>
          <dt>{t('Construit le')}</dt>
          <dd>
            {BUILD_DATE ? dateLocale(BUILD_DATE, { dateStyle: 'short', timeStyle: 'short' }) : t('inconnu')}
          </dd>
          <dt>{t('Commit')}</dt>
          <dd className="mono">{BUILD_COMMIT || '—'}</dd>
        </dl>
        <p className="note">{t('À comparer au dernier déploiement avant de chercher un bug : une correction poussée il y a deux minutes n’est peut-être pas encore celle qui tourne ici.')}</p>
      </section>

      <section className="bloc">
        <h2>{t('Identité locale')}</h2>
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

      </details>
    </div>
  )
}

/**
 * Une panne d'impression, expliquée dans la langue de la caisse.
 *
 * L'explication se traduit ; le message d'ORIGINE, non — c'est lui qu'on
 * recopie au support, et il doit rester celui que le système a produit.
 */
function erreurImpression(message: string): string {
  const { explication, origine } = expliquerErreurImpression(message)
  return explication ? `${tm(explication)} (${origine})` : tm(origine)
}
