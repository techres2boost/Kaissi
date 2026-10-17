/**
 * Éditeur → Surveillance : l'état du service, maintenant.
 *
 * ── Ce que cet écran montre, et ce qu'il ne montre pas ────────────────────
 *
 * Le SERVICE DE SYNCHRONISATION (processeur, mémoire, réactivité, chaque
 * route chronométrée) et la BASE (taille, connexions, cache, ventes reçues,
 * projections manquantes, caisses muettes). C'est le chemin de chaque vente :
 * s'il va bien, l'encaissement remonte.
 *
 * Il ne montre PAS le back-office lui-même (Vercel le surveille) ni
 * l'historique au-delà d'une heure : les mesures vivent en mémoire du
 * service et repartent de zéro à chaque redémarrage — écrire une métrique
 * par vente dans la base qu'on surveille ajouterait une écriture à chaque
 * encaissement pour savoir si les encaissements vont bien.
 *
 * Les SEUILS sont calculés par le service (`apps/sync/src/surveillance.ts`) :
 * cent chiffres sans seuil ne se regardent plus au bout d'une semaine.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { sessionObligatoire } from '../../../serveur/session.js'
import { BarreCompte } from '../../../composants/BarreCompte.js'
import { RafraichirPeriodiquement } from '../../../composants/RafraichirPeriodiquement.js'
import { lireSurveillance } from '../actions.js'
import { traduction } from '../../../i18n/serveur.js'

export const dynamic = 'force-dynamic'

function octets(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} Go`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} Mo`
  if (n >= 1024) return `${Math.round(n / 1024)} ko`
  return `${n} o`
}

/** Une durée en millisecondes — l'unité reste le symbole international. */
function ms(n: number): string {
  return `${n} ms`
}

function duree(secondes: number): string {
  const j = Math.floor(secondes / 86_400)
  const h = Math.floor((secondes % 86_400) / 3_600)
  const m = Math.floor((secondes % 3_600) / 60)
  return j > 0 ? `${j} j ${h} h` : h > 0 ? `${h} h ${m} min` : `${m} min`
}

export default async function PageSurveillance() {
  const t = await traduction()
  const session = await sessionObligatoire()
  const etat = await lireSurveillance()
  if (etat === null) notFound()

  const enTete = (
    <>
      <h1>{t('Surveillance')}</h1>
      <p className="sous-titre">{t('Le service de synchronisation et sa base — le chemin de chaque vente. Mesures en mémoire du service, sur la dernière heure.')}</p>
      <p>
        <Link href="/editeur">{t('‹ Clients et formules')}</Link>{' · '}
        <RafraichirPeriodiquement secondes={15} />
      </p>
    </>
  )

  // Le service n'a pas répondu : c'est EXACTEMENT ce que l'écran doit dire.
  if (typeof etat === 'string') {
    return (
      <>
        <BarreCompte session={session} />
        <main className="enveloppe">
          {enTete}
          <div className="message erreur">
            <strong>{t('Le service de synchronisation ne répond pas.')}</strong>{' '}{etat}
          </div>
          <p className="indication">{t('Les caisses continuent d’encaisser et gardent leurs ventes : elles partiront dès que le service répondra. Vérifiez le déploiement chez l’hébergeur (Railway), puis /sante.')}</p>
        </main>
      </>
    )
  }

  const { base, processus, requetes } = etat
  const dernier = processus.historique[processus.historique.length - 1]
  const push = requetes.familles15min.find((f) => f.famille === 'push')
  const total15 = requetes.familles15min.reduce((s, f) => s + f.requetes, 0)
  const erreurs15 = requetes.familles15min.reduce((s, f) => s + f.erreurs5xx, 0)
  const critiques = etat.alertes.filter((a) => a.niveau === 'critique')

  return (
    <>
      <BarreCompte session={session} />
      <main className="enveloppe">
        {enTete}

        {etat.alertes.length === 0 ? (
          <div className="message succes">{t('Aucun seuil franchi. Le service et sa base vont bien.')}</div>
        ) : (
          <section className="carte">
            <h2>{critiques.length > 0 ? t('À traiter maintenant') : t('À surveiller')}</h2>
            {etat.alertes.map((a, i) => (
              <p key={i} className={`message ${a.niveau === 'critique' ? 'erreur' : 'info'}`}>
                <strong>{a.sujet}</strong>{' — '}{a.message}
              </p>
            ))}
          </section>
        )}

        <div className="cartes-kpi">
          <div className={`kpi ${push && push.erreurs5xx > 0 ? 'alerte' : 'fort'}`}>
            <span className="kpi-libelle">{t('Envoi des ventes')}</span>
            <span className="kpi-valeur">{push ? ms(push.p95Ms) : '—'}</span>
            <span className="kpi-aide">{t('95 % des envois sous cette durée (15 min).')}</span>
          </div>
          <div className={`kpi ${erreurs15 > 0 ? 'alerte' : ''}`}>
            <span className="kpi-libelle">{t('Erreurs serveur')}</span>
            <span className="kpi-valeur">{erreurs15}<small>{' / '}{total15}</small></span>
            <span className="kpi-aide">{t('Réponses 5xx sur les requêtes des 15 dernières minutes.')}</span>
          </div>
          <div className={`kpi ${dernier && dernier.cpuPourcent > 80 ? 'attention' : ''}`}>
            <span className="kpi-libelle">{t('Processeur')}</span>
            <span className="kpi-valeur">{dernier ? `${dernier.cpuPourcent} %` : '—'}</span>
            <span className="kpi-aide">{t('Part d’un cœur occupée par le service ({n} cœur(s)).', { n: processus.coeurs })}</span>
          </div>
          <div className="kpi">
            <span className="kpi-libelle">{t('Mémoire')}</span>
            <span className="kpi-valeur">{octets(processus.rssOctets)}</span>
            <span className="kpi-aide">{t('Tas JavaScript : {tas} sur {total}.', { tas: octets(processus.tasOctets), total: octets(processus.tasTotalOctets) })}</span>
          </div>
          <div className={`kpi ${dernier && dernier.boucleP99Ms > 200 ? 'alerte' : ''}`}>
            <span className="kpi-libelle">{t('Réactivité')}</span>
            <span className="kpi-valeur">{dernier ? ms(dernier.boucleP99Ms) : '—'}</span>
            <span className="kpi-aide">{t('Retard de la boucle d’événements (99e centile).')}</span>
          </div>
          {base && (
            <>
              <div className={`kpi ${base.latenceMs > 500 ? 'attention' : ''}`}>
                <span className="kpi-libelle">{t('Base — latence')}</span>
                <span className="kpi-valeur">{ms(base.latenceMs)}</span>
                <span className="kpi-aide">{t('Aller-retour d’une requête triviale.')}</span>
              </div>
              <div className={`kpi ${base.connexions / Math.max(1, base.connexionsMax) > 0.8 ? 'alerte' : ''}`}>
                <span className="kpi-libelle">{t('Connexions')}</span>
                <span className="kpi-valeur">{base.connexions}<small>{' / '}{base.connexionsMax}</small></span>
                <span className="kpi-aide">{t('Ouvertes sur la base, sur le maximum autorisé.')}</span>
              </div>
              <div className={`kpi ${base.cachePourcent !== null && base.cachePourcent < 95 ? 'attention' : ''}`}>
                <span className="kpi-libelle">{t('Cache')}</span>
                <span className="kpi-valeur">{base.cachePourcent === null ? '—' : `${base.cachePourcent} %`}</span>
                <span className="kpi-aide">{t('Lectures servies depuis la mémoire de la base.')}</span>
              </div>
              <div className="kpi fort">
                <span className="kpi-libelle">{t('Commandes reçues')}</span>
                <span className="kpi-valeur">{base.metier.commandes1h}</span>
                <span className="kpi-aide">{t('Dans la dernière heure, tous restaurants.')}</span>
              </div>
              <div className={`kpi ${base.metier.caissesMuettes24h > 0 ? 'attention' : ''}`}>
                <span className="kpi-libelle">{t('Caisses en ligne')}</span>
                <span className="kpi-valeur">{base.metier.caissesVues15min}<small>{' / '}{base.metier.caisses}</small></span>
                <span className="kpi-aide">{t('Vues dans les 15 dernières minutes, sur les caisses actives.')}</span>
              </div>
            </>
          )}
        </div>

        {etat.erreurBase && (
          <p className="message erreur">{t('Mesures de la base illisibles :')}{' '}{etat.erreurBase}</p>
        )}

        <section className="carte">
          <h2>{t('Requêtes, par route (15 min)')}</h2>
          {requetes.familles15min.length === 0 ? (
            <p className="indication">{t('Aucune requête depuis le démarrage du service.')}</p>
          ) : (
            <div className="tableau-defilant">
              <table>
                <thead>
                  <tr>
                    <th>{t('Route')}</th>
                    <th>{t('Requêtes')}</th>
                    <th>{t('Erreurs 5xx')}</th>
                    <th>{t('Refus 4xx')}</th>
                    <th>{t('Médiane')}</th>
                    <th>{t('95e centile')}</th>
                    <th>{t('99e centile')}</th>
                    <th>{t('Max')}</th>
                  </tr>
                </thead>
                <tbody>
                  {requetes.familles15min.map((f) => (
                    <tr key={f.famille}>
                      <td><strong>{f.famille}</strong></td>
                      <td>{f.requetes}</td>
                      <td>{f.erreurs5xx}</td>
                      <td>{f.erreurs4xx}</td>
                      <td>{ms(f.p50Ms)}</td>
                      <td>{ms(f.p95Ms)}</td>
                      <td>{ms(f.p99Ms)}</td>
                      <td>{ms(f.maxMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {base && (
          <section className="carte">
            <h2>{t('Activité et base de données')}</h2>
            <dl className="lignes-chiffres">
              <dt>{t('Événements reçus — 1 h / 24 h')}</dt>
              <dd>{`${base.metier.evenements1h} / ${base.metier.evenements24h}`}</dd>
              <dt>{t('Ventes sans projection (invisibles au back-office)')}</dt>
              <dd className={base.metier.projectionsManquantes > 0 ? 'attention' : undefined}>{base.metier.projectionsManquantes}</dd>
              <dt>{t('Opérations rejetées — 24 h')}</dt>
              <dd className={base.metier.rejets24h > 0 ? 'attention' : undefined}>{base.metier.rejets24h}</dd>
              <dt>{t('Caisses muettes depuis 24 h')}</dt>
              <dd className={base.metier.caissesMuettes24h > 0 ? 'attention' : undefined}>{base.metier.caissesMuettes24h}</dd>
              <dt>{t('Migrations manquantes')}</dt>
              <dd className={etat.migrationsManquantes.length > 0 ? 'attention' : undefined}>
                {etat.migrationsManquantes.length > 0 ? etat.migrationsManquantes.join(', ') : '—'}
              </dd>
              <dt>{t('Taille de la base')}</dt>
              <dd>{octets(base.tailleOctets)}</dd>
              <dt>{t('Connexions actives / en attente de verrou')}</dt>
              <dd>{`${base.connexionsActives} / ${base.attentesVerrou}`}</dd>
              <dt>{t('Requête la plus longue en cours')}</dt>
              <dd>{`${base.requetePlusLongueSecondes} s`}</dd>
              <dt>{t('Pool du service — ouvertes / libres / en attente / max')}</dt>
              <dd>{`${base.pool.total} / ${base.pool.libres} / ${base.pool.enAttente} / ${base.pool.max}`}</dd>
              <dt>{t('Transactions validées / annulées / interblocages')}</dt>
              <dd>{`${base.validations} / ${base.annulations} / ${base.interblocages}`}</dd>
            </dl>
            <h3>{t('Tables les plus lourdes')}</h3>
            <div className="tableau-defilant">
              <table>
                <thead>
                  <tr>
                    <th>{t('Table')}</th>
                    <th>{t('Taille')}</th>
                    <th>{t('Lignes (estimation)')}</th>
                  </tr>
                </thead>
                <tbody>
                  {base.tables.map((tb) => (
                    <tr key={tb.nom}>
                      <td>{tb.nom}</td>
                      <td>{octets(tb.tailleOctets)}</td>
                      <td>{tb.lignesEstimees}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="carte">
          <h2>{t('Processus')}</h2>
          <dl className="lignes-chiffres">
            <dt>{t('En service depuis')}</dt>
            <dd>{duree(etat.dureeVieSecondes)}</dd>
            <dt>{t('Version de Node.js')}</dt>
            <dd>{processus.node}</dd>
            <dt>{t('Charge système (1 / 5 / 15 min)')}</dt>
            <dd>{processus.chargeSysteme.join(' / ')}</dd>
            <dt>{t('Mémoire de la machine — libre / totale')}</dt>
            <dd>{`${octets(processus.memoireLibreOctets)} / ${octets(processus.memoireSystemeOctets)}`}</dd>
          </dl>
        </section>

        <section className="carte">
          <h2>{t('Requêtes par minute')}</h2>
          <div className="tableau-defilant">
            <table>
              <thead>
                <tr>
                  <th>{t('Minute')}</th>
                  <th>{t('Requêtes')}</th>
                  <th>{t('Erreurs 5xx')}</th>
                  <th>{t('Refus 4xx')}</th>
                  <th>{t('Durée moyenne')}</th>
                </tr>
              </thead>
              <tbody>
                {[...requetes.parMinute].reverse().slice(0, 15).map((m) => (
                  <tr key={m.minute}>
                    <td>{t.date(m.minute, { timeStyle: 'short' })}</td>
                    <td>{m.total}</td>
                    <td>{m.erreurs5xx}</td>
                    <td>{m.erreurs4xx}</td>
                    <td>{ms(m.dureeMoyenneMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="carte">
          <h2>{t('Erreurs récentes')}</h2>
          {etat.erreursRecentes.length === 0 ? (
            <p className="indication">{t('Aucune erreur serveur depuis le démarrage du service.')}</p>
          ) : (
            <div className="tableau-defilant">
              <table>
                <thead>
                  <tr>
                    <th>{t('Heure')}</th>
                    <th>{t('Route')}</th>
                    <th>{t('Statut')}</th>
                    <th>{t('Message')}</th>
                  </tr>
                </thead>
                <tbody>
                  {etat.erreursRecentes.map((e, i) => (
                    <tr key={i}>
                      <td>{t.date(e.instant, { timeStyle: 'medium' })}</td>
                      <td>{e.famille}</td>
                      <td>{e.statut}</td>
                      <td>{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </>
  )
}
