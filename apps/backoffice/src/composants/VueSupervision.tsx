/**
 * Éditeur → Supervision : le centre d'exploitation de Kaissi.
 *
 * ── Ce qui le distingue de « Surveillance » ───────────────────────────────
 *
 * Surveillance dit l'état MAINTENANT, en mémoire du service. Supervision y
 * ajoute la MÉMOIRE : séries sur 1 h à 30 jours, incidents avec leur cycle
 * (ouvert → pris en charge → résolu), journal des événements de sécurité et
 * d'exploitation, et l'état de chaque terminal. Tout vient de
 * l'instrumentation du service (`apps/sync/src/supervision.ts`), écrite une
 * fois par période — jamais une ligne par vente (migration 0050).
 *
 * ── Ce qu'il ne montre PAS, et le dit ─────────────────────────────────────
 *
 * Les erreurs du navigateur et les plantages de la caisse ne remontent pas
 * encore : une caisse qui plante redémarre et garde ses ventes dans son
 * outbox, ce qui se voit ici comme un terminal qui se tait puis reprend.
 * L'écran le dit en clair plutôt que d'afficher un compteur à zéro qui
 * aurait l'air d'une bonne nouvelle.
 *
 * ── Données sensibles ─────────────────────────────────────────────────────
 *
 * Aucune adresse IP complète (tronquée au réseau), aucune adresse e-mail en
 * clair dans le journal, aucun jeton, aucun montant. L'éditeur voit la santé
 * du système, pas le chiffre d'affaires de ses clients.
 */

import Link from 'next/link'
import type { Route } from 'next'
import { aTraduire } from '@kaissi/i18n'
import { RafraichirPeriodiquement } from './RafraichirPeriodiquement.js'
import { CourbeSupervision, type PointCourbe } from './CourbeSupervision.js'
import { ActionsIncident } from './ActionsIncident.js'
import type {
  FenetreSupervision,
  IncidentSupervision,
  SeauSupervision,
  Supervision,
} from '../app/editeur/actions.js'
import type { Traduction } from '../i18n/commun.js'

export const FENETRES: { valeur: FenetreSupervision; libelle: string }[] = [
  { valeur: '1h', libelle: aTraduire('1 heure') },
  { valeur: '6h', libelle: aTraduire('6 heures') },
  { valeur: '24h', libelle: aTraduire('24 heures') },
  { valeur: '7j', libelle: aTraduire('7 jours') },
  { valeur: '30j', libelle: aTraduire('30 jours') },
]

export const CATEGORIES: { valeur: string | null; libelle: string }[] = [
  { valeur: null, libelle: aTraduire('Toutes') },
  { valeur: 'securite', libelle: aTraduire('Sécurité') },
  { valeur: 'application', libelle: aTraduire('Application') },
  { valeur: 'synchronisation', libelle: aTraduire('Synchronisation') },
  { valeur: 'terminal', libelle: aTraduire('Terminaux') },
]

export const NIVEAUX: { valeur: string | null; libelle: string }[] = [
  { valeur: null, libelle: aTraduire('Tous niveaux') },
  { valeur: 'critique', libelle: aTraduire('Critique') },
  { valeur: 'attention', libelle: aTraduire('Attention') },
  { valeur: 'info', libelle: aTraduire('Information') },
]

const TYPES: Record<string, string> = {
  limite_de_debit: aTraduire('Limite de débit atteinte'),
  echec_authentification: aTraduire('Identifiants refusés'),
  jeton_appareil_refuse: aTraduire('Jeton d’appareil refusé'),
  appareil_revoque: aTraduire('Appareil révoqué'),
  acces_refuse: aTraduire('Accès d’administration refusé'),
  erreur_serveur: aTraduire('Erreur serveur'),
  service_indisponible: aTraduire('Service indisponible'),
  demarrage: aTraduire('Démarrage du service'),
  evenements_ignores: aTraduire('Événements ignorés (plafond atteint)'),
  operation_rejetee: aTraduire('Opération rejetée'),
  terminal_mis_en_service: aTraduire('Terminal mis en service'),
}

const STATUTS: Record<IncidentSupervision['statut'], string> = {
  ouvert: aTraduire('Ouvert'),
  pris_en_charge: aTraduire('Pris en charge'),
  resolu: aTraduire('Résolu'),
}

function octets(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} Go`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} Mo`
  if (n >= 1024) return `${Math.round(n / 1024)} ko`
  return `${n} o`
}
const ms = (n: number) => `${Math.round(n)} ms`
const pourcent = (n: number) => `${Math.round(n * 10) / 10} %`
const entier = (n: number) => String(Math.round(n))

export function VueSupervision({
  etat,
  fenetre,
  categorie,
  niveau,
  t,
}: {
  etat: Supervision | string
  fenetre: FenetreSupervision
  categorie: string | null
  niveau: string | null
  t: Traduction
}) {
  const lien = (changement: { fenetre?: string; categorie?: string | null; niveau?: string | null }) => {
    const p = new URLSearchParams()
    p.set('fenetre', changement.fenetre ?? fenetre)
    const c = changement.categorie === undefined ? categorie : changement.categorie
    const n = changement.niveau === undefined ? niveau : changement.niveau
    if (c) p.set('categorie', c)
    if (n) p.set('niveau', n)
    return `/editeur/supervision?${p.toString()}` as Route
  }

  const enTete = (
    <>
      <h1>{t('Supervision')}</h1>
      <p className="sous-titre">{t('Centre d’exploitation : santé du service, de la base et des terminaux, historique, incidents et journal de sécurité. Mesures collectées par le service lui-même, jamais simulées.')}</p>
      <p>
        <Link href="/editeur">{t('‹ Clients et formules')}</Link>{' · '}
        <Link href="/editeur/surveillance">{t('État instantané du service ›')}</Link>{' · '}
        <RafraichirPeriodiquement secondes={30} />
      </p>
    </>
  )

  if (typeof etat === 'string') {
    return (
      <main className="enveloppe">
          {enTete}
          <div className="message erreur">
            <strong>{t('Le service de synchronisation ne répond pas.')}</strong>{' '}{etat}
          </div>
          <p className="indication">{t('Les caisses continuent d’encaisser et gardent leurs ventes : elles partiront dès que le service répondra. Vérifiez le déploiement chez l’hébergeur (Railway), puis /sante.')}</p>
        </main>
    )
  }

  const { vivant, historique } = etat
  const critiquesVivantes = vivant.alertes.filter((a) => a.niveau === 'critique')
  const heure = (iso: string) =>
    fenetre === '7j' || fenetre === '30j'
      ? t.date(iso, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      : t.date(iso, { hour: '2-digit', minute: '2-digit' })
  const serie = (choisir: (s: SeauSupervision) => number | null): PointCourbe[] =>
    (historique?.serie ?? []).map((s) => ({ libelle: heure(s.debut), valeur: choisir(s) }))
  const max = (v: string) => t('max {valeur}', { valeur: v })
  const ouverts = historique?.incidentsOuverts ?? []
  const totaux = historique?.totaux
  const comptes = (cat: string) =>
    (historique?.comptesEvenements ?? []).filter((c) => c.categorie === cat).reduce((s, c) => s + c.n, 0)
  const maintenant = Date.parse(etat.horodatage)

  return (
    <main className="enveloppe supervision">
        {enTete}

        {/* ── Filtres : une seule rangée, au-dessus de tout ce qu'ils règlent ── */}
        <nav className="filtres-supervision" aria-label={t('Période et filtres')}>
          <div className="groupe-filtres">
            <span className="indication">{t('Période')}</span>
            {FENETRES.map((f) => (
              <Link key={f.valeur} href={lien({ fenetre: f.valeur })} className={`puce-filtre${f.valeur === fenetre ? ' actif' : ''}`} aria-current={f.valeur === fenetre ? 'true' : undefined}>
                {t(f.libelle)}
              </Link>
            ))}
          </div>
          <div className="groupe-filtres">
            <span className="indication">{t('Journal')}</span>
            {CATEGORIES.map((c) => (
              <Link key={c.valeur ?? 'toutes'} href={lien({ categorie: c.valeur })} className={`puce-filtre${c.valeur === categorie ? ' actif' : ''}`} aria-current={c.valeur === categorie ? 'true' : undefined}>
                {t(c.libelle)}
              </Link>
            ))}
          </div>
          <div className="groupe-filtres">
            {NIVEAUX.map((n) => (
              <Link key={n.valeur ?? 'tous'} href={lien({ niveau: n.valeur })} className={`puce-filtre${n.valeur === niveau ? ' actif' : ''}`} aria-current={n.valeur === niveau ? 'true' : undefined}>
                {t(n.libelle)}
              </Link>
            ))}
          </div>
        </nav>

        {/* ── État global ─────────────────────────────────────────────────── */}
        {critiquesVivantes.length > 0 ? (
          <div className="message erreur" role="status">
            <strong>{t('⛔ {n} alerte(s) critique(s) en ce moment.', { n: critiquesVivantes.length })}</strong>{' '}
            {critiquesVivantes.map((a) => a.sujet).join(' · ')}
          </div>
        ) : vivant.alertes.length > 0 ? (
          <div className="message avertissement" role="status">
            <strong>{t('⚠ {n} point(s) à surveiller.', { n: vivant.alertes.length })}</strong>{' '}
            {vivant.alertes.map((a) => a.sujet).join(' · ')}
          </div>
        ) : (
          <div className="message succes" role="status">{t('✓ Aucun seuil franchi en ce moment : service, base et terminaux vont bien.')}</div>
        )}

        {etat.erreurHistorique && (
          <p className="message avertissement">{t('Historique indisponible :')}{' '}{t.m(etat.erreurHistorique)}</p>
        )}
        {etat.collecteur === null ? (
          <p className="message avertissement">{t('Le collecteur de supervision est désactivé sur ce service (SYNC_SUPERVISION=0) : aucun historique n’est écrit.')}</p>
        ) : etat.collecteur.derniereEcriture && !etat.collecteur.derniereEcriture.ok ? (
          <p className="message avertissement">
            {t('La dernière écriture de l’historique a échoué :')}{' '}{etat.collecteur.derniereEcriture.erreur}
          </p>
        ) : null}

        {/* ── Indicateurs de la période ─────────────────────────────────────── */}
        <div className="cartes-kpi">
          <div className={`kpi ${totaux && totaux.disponibilitePourcent !== null && totaux.disponibilitePourcent < 99 ? 'alerte' : 'fort'}`}>
            <span className="kpi-libelle">{t('Disponibilité')}</span>
            <span className="kpi-valeur">{totaux?.disponibilitePourcent == null ? '—' : pourcent(totaux.disponibilitePourcent)}</span>
            <span className="kpi-aide">{t('Part des requêtes servies sans erreur 5xx sur la période.')}</span>
          </div>
          <div className="kpi">
            <span className="kpi-libelle">{t('Requêtes')}</span>
            <span className="kpi-valeur">{totaux ? totaux.requetes : '—'}</span>
            <span className="kpi-aide">{t('Reçues par le service sur la période.')}</span>
          </div>
          <div className={`kpi ${totaux && totaux.erreurs5xx > 0 ? 'alerte' : ''}`}>
            <span className="kpi-libelle">{t('Erreurs serveur')}</span>
            <span className="kpi-valeur">{totaux ? totaux.erreurs5xx : '—'}<small>{totaux ? ` / ${t('{n} refus 4xx', { n: totaux.erreurs4xx })}` : ''}</small></span>
            <span className="kpi-aide">{t('Réponses 5xx, puis refus 4xx (saisie, droits).')}</span>
          </div>
          <div className={`kpi ${totaux && totaux.echecsAuthentification > 20 ? 'attention' : ''}`}>
            <span className="kpi-libelle">{t('Échecs d’authentification')}</span>
            <span className="kpi-valeur">{totaux ? totaux.echecsAuthentification : '—'}</span>
            <span className="kpi-aide">{t('Mots de passe et jetons d’appareil refusés.')}</span>
          </div>
          <div className={`kpi ${totaux && totaux.limitesDeDebit > 0 ? 'attention' : ''}`}>
            <span className="kpi-libelle">{t('Limites de débit')}</span>
            <span className="kpi-valeur">{totaux ? totaux.limitesDeDebit : '—'}</span>
            <span className="kpi-aide">{t('Requêtes refusées pour excès de tentatives.')}</span>
          </div>
          <div className={`kpi ${totaux && totaux.redemarrages > 1 ? 'attention' : ''}`}>
            <span className="kpi-libelle">{t('Redémarrages')}</span>
            <span className="kpi-valeur">{totaux ? totaux.redemarrages : '—'}</span>
            <span className="kpi-aide">{t('Démarrages du service sur la période (déploiements compris).')}</span>
          </div>
          <div className={`kpi ${ouverts.some((i) => i.niveau === 'critique') ? 'alerte' : ouverts.length > 0 ? 'attention' : ''}`}>
            <span className="kpi-libelle">{t('Incidents ouverts')}</span>
            <span className="kpi-valeur">{historique ? ouverts.length : '—'}</span>
            <span className="kpi-aide">{t('Alertes persistantes, non résolues.')}</span>
          </div>
          {vivant.base && (
            <div className={`kpi ${vivant.base.metier.caissesMuettes24h > 0 ? 'attention' : 'fort'}`}>
              <span className="kpi-libelle">{t('Caisses en ligne')}</span>
              <span className="kpi-valeur">{vivant.base.metier.caissesVues15min}<small>{' / '}{vivant.base.metier.caisses}</small></span>
              <span className="kpi-aide">{t('Vues dans les 15 dernières minutes, sur les caisses actives.')}</span>
            </div>
          )}
        </div>

        {/* ── Incidents ─────────────────────────────────────────────────────── */}
        <section className="carte">
          <h2>{t('Incidents en cours')}</h2>
          <p className="indication">{t('Une alerte qui persiste devient un incident, compté à chaque période où elle est revue. Il se résout seul quand sa cause disparaît ; le prendre en charge dit aux autres que quelqu’un s’en occupe.')}</p>
          {!historique ? (
            <p className="indication">—</p>
          ) : ouverts.length === 0 ? (
            <p className="message succes">{t('Aucun incident ouvert.')}</p>
          ) : (
            <ul className="liste-incidents">
              {ouverts.map((i) => (
                <li key={i.id} className={`incident niveau-${i.niveau}`}>
                  <details>
                    <summary>
                      <span className={`etiquette-niveau ${i.niveau}`}>{i.niveau === 'critique' ? t('⛔ Critique') : t('⚠ Attention')}</span>
                      <strong>{i.sujet}</strong>
                      <span className="indication">{' — '}{t(STATUTS[i.statut])}{' · '}{t('depuis {heure}', { heure: t.date(i.ouvertLe, { dateStyle: 'short', timeStyle: 'short' }) })}{' · '}{t('{n} occurrence(s)', { n: i.occurrences })}</span>
                    </summary>
                    <DetailIncident incident={i} t={t} />
                    <ActionsIncident id={i.id} statut={i.statut} />
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Performance & charge ─────────────────────────────────────────── */}
        <section className="carte">
          <h2>{t('Performance et charge')}</h2>
          {historique && historique.serie.length === 0 && (
            <p className="indication">{t('Aucune mesure sur cette période : le service n’a encore rien écrit.')}</p>
          )}
          <div className="grille-courbes">
            <CourbeSupervision titre={t('Requêtes par période')} points={serie((s) => s.requetes)} forme="colonnes" formater={entier} libelleMax={max} />
            <CourbeSupervision titre={t('Erreurs 5xx par période')} points={serie((s) => s.erreurs5xx)} forme="colonnes" formater={entier} libelleMax={max} />
            <CourbeSupervision titre={t('Envoi des ventes — 95e centile')} points={serie((s) => s.pushP95Ms)} forme="ligne" formater={ms} seuil={2000} libelleMax={max} aide={t('Pointillé : seuil d’alerte (2 s).')} />
            <CourbeSupervision titre={t('Réception — 95e centile')} points={serie((s) => s.pullP95Ms)} forme="ligne" formater={ms} libelleMax={max} />
            <CourbeSupervision titre={t('Requêtes simultanées (pic)')} points={serie((s) => s.concurrenceMax)} forme="ligne" formater={entier} libelleMax={max} />
            <CourbeSupervision titre={t('Événements de vente reçus')} points={serie((s) => s.evenementsRecus)} forme="colonnes" formater={entier} libelleMax={max} />
          </div>
        </section>

        {/* ── Infrastructure ──────────────────────────────────────────────── */}
        <section className="carte">
          <h2>{t('Infrastructure — service et base de données')}</h2>
          <div className="grille-courbes">
            <CourbeSupervision titre={t('Processeur du service')} points={serie((s) => s.cpuPourcent)} forme="ligne" formater={pourcent} seuil={90} libelleMax={max} aide={t('Part d’un cœur. Pointillé : seuil d’alerte.')} />
            <CourbeSupervision titre={t('Mémoire du service')} points={serie((s) => s.rssOctets)} forme="ligne" formater={octets} libelleMax={max} />
            <CourbeSupervision titre={t('Réactivité (boucle, 99e centile)')} points={serie((s) => s.boucleP99Ms)} forme="ligne" formater={ms} seuil={200} libelleMax={max} />
            <CourbeSupervision titre={t('Base — latence')} points={serie((s) => s.baseLatenceMs)} forme="ligne" formater={ms} seuil={500} libelleMax={max} />
            <CourbeSupervision titre={t('Base — connexions ouvertes')} points={serie((s) => s.baseConnexions)} forme="ligne" formater={entier} libelleMax={max} />
            <CourbeSupervision titre={t('Pool — requêtes en attente')} points={serie((s) => s.poolEnAttente)} forme="ligne" formater={entier} libelleMax={max} />
            <CourbeSupervision titre={t('Base — cache')} points={serie((s) => s.cachePourcent)} forme="ligne" formater={pourcent} libelleMax={max} />
            <CourbeSupervision titre={t('Base — taille')} points={serie((s) => s.baseTailleOctets)} forme="ligne" formater={octets} libelleMax={max} />
          </div>
          {vivant.base && (
            <dl className="lignes-chiffres">
              <dt>{t('Connexions — ouvertes / max')}</dt>
              <dd>{`${vivant.base.connexions} / ${vivant.base.connexionsMax}`}</dd>
              <dt>{t('Pool du service — ouvertes / libres / en attente / max')}</dt>
              <dd>{`${vivant.base.pool.total} / ${vivant.base.pool.libres} / ${vivant.base.pool.enAttente} / ${vivant.base.pool.max}`}</dd>
              <dt>{t('Requête la plus longue en cours')}</dt>
              <dd>{`${vivant.base.requetePlusLongueSecondes} s`}</dd>
              <dt>{t('Transactions validées / annulées / interblocages')}</dt>
              <dd>{`${vivant.base.validations} / ${vivant.base.annulations} / ${vivant.base.interblocages}`}</dd>
              <dt>{t('Ventes sans projection (invisibles au back-office)')}</dt>
              <dd className={vivant.base.metier.projectionsManquantes > 0 ? 'attention' : undefined}>{vivant.base.metier.projectionsManquantes}</dd>
              <dt>{t('Migrations manquantes')}</dt>
              <dd className={vivant.migrationsManquantes.length > 0 ? 'attention' : undefined}>
                {vivant.migrationsManquantes.length > 0 ? vivant.migrationsManquantes.join(', ') : '—'}
              </dd>
              <dt>{t('Charge système (1 / 5 / 15 min)')}</dt>
              <dd>{vivant.processus.chargeSysteme.join(' / ')}</dd>
              <dt>{t('Mémoire de la machine — libre / totale')}</dt>
              <dd>{`${octets(vivant.processus.memoireLibreOctets)} / ${octets(vivant.processus.memoireSystemeOctets)}`}</dd>
            </dl>
          )}
          {vivant.erreurBase && (
            <p className="message erreur">{t('Mesures de la base illisibles :')}{' '}{vivant.erreurBase}</p>
          )}
        </section>

        {/* ── Sécurité ────────────────────────────────────────────────────── */}
        <section className="carte">
          <h2>{t('Sécurité')}</h2>
          <div className="grille-courbes">
            <CourbeSupervision titre={t('Échecs d’authentification')} points={serie((s) => s.echecsAuthentification)} forme="colonnes" formater={entier} libelleMax={max} />
            <CourbeSupervision titre={t('Limites de débit')} points={serie((s) => s.limitesDeDebit)} forme="colonnes" formater={entier} libelleMax={max} />
            <CourbeSupervision titre={t('Accès refusés et appareils révoqués')} points={serie((s) => s.accesRefuses)} forme="colonnes" formater={entier} libelleMax={max} />
          </div>
          <p className="indication">{t('Les adresses sont tronquées à leur réseau (/24) et les adresses e-mail masquées : le journal dit d’où vient une rafale, pas qui l’a tapée. Aucun mot de passe ni jeton n’y entre.')}</p>
        </section>

        {/* ── Terminaux ───────────────────────────────────────────────────── */}
        <section className="carte">
          <h2>{t('Terminaux')}</h2>
          <p className="indication">{t('Une caisse qui se tait n’a pas forcément un problème — elle encaisse hors ligne et enverra tout au retour du réseau. Une caisse muette depuis un jour d’ouverture mérite un appel.')}</p>
          {!historique || historique.terminaux.length === 0 ? (
            <p className="indication">{t('Aucun terminal actif.')}</p>
          ) : (
            <div className="tableau-defilant">
              <table>
                <thead>
                  <tr>
                    <th>{t('Terminal')}</th>
                    <th>{t('Établissement')}</th>
                    <th>{t('État')}</th>
                    <th>{t('Dernier contact')}</th>
                    <th>{t('Dernier envoi')}</th>
                    <th>{t('Version')}</th>
                    <th>{t('Rejets 24 h')}</th>
                  </tr>
                </thead>
                <tbody>
                  {historique.terminaux.map((tm) => {
                    const age = tm.vuLe ? (maintenant - Date.parse(tm.vuLe)) / 60_000 : null
                    const etatTerminal =
                      age === null ? t('Jamais vu') : age <= 15 ? t('En ligne') : age <= 24 * 60 ? t('Silencieux') : t('Muet')
                    return (
                      <tr key={tm.deviceId}>
                        <td><strong>{tm.libelle}</strong></td>
                        <td>{tm.restaurant}</td>
                        <td className={age === null || age > 24 * 60 ? 'attention' : undefined}>{etatTerminal}</td>
                        <td>{tm.vuLe ? t.date(tm.vuLe, { dateStyle: 'short', timeStyle: 'short' }) : '—'}</td>
                        <td>{tm.dernierEnvoi ? t.date(tm.dernierEnvoi, { dateStyle: 'short', timeStyle: 'short' }) : '—'}</td>
                        <td>{tm.version ?? '—'}</td>
                        <td className={tm.rejets24h > 0 ? 'attention' : undefined}>{tm.rejets24h}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Journal ─────────────────────────────────────────────────────── */}
        <section className="carte">
          <h2>{t('Journal des événements')}</h2>
          <p className="indication">
            {t('Sur la période : sécurité {s}, application {a}, synchronisation {y}, terminaux {m}.', {
              s: comptes('securite'),
              a: comptes('application'),
              y: comptes('synchronisation'),
              m: comptes('terminal'),
            })}
          </p>
          {!historique || historique.evenements.length === 0 ? (
            <p className="indication">{t('Aucun événement pour ces filtres.')}</p>
          ) : (
            <div className="tableau-defilant">
              <table>
                <thead>
                  <tr>
                    <th>{t('Heure')}</th>
                    <th>{t('Niveau')}</th>
                    <th>{t('Événement')}</th>
                    <th>{t('Origine')}</th>
                    <th>{t('Message')}</th>
                  </tr>
                </thead>
                <tbody>
                  {historique.evenements.map((e) => (
                    <tr key={e.id}>
                      <td>{t.date(e.instant, { dateStyle: 'short', timeStyle: 'medium' })}</td>
                      <td><span className={`etiquette-niveau ${e.niveau}`}>{e.niveau === 'critique' ? t('⛔ Critique') : e.niveau === 'attention' ? t('⚠ Attention') : t('ⓘ Info')}</span></td>
                      <td>{TYPES[e.type] ? t(TYPES[e.type]!) : e.type}</td>
                      <td>{[e.restaurant, e.terminal, e.origine].filter(Boolean).join(' · ') || '—'}</td>
                      <td>
                        {e.message}
                        {Object.keys(e.detail).length > 0 && (
                          <details className="detail-evenement">
                            <summary>{t('Détail')}</summary>
                            <code>{JSON.stringify(e.detail)}</code>
                          </details>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="indication">{t('Pas encore collectés : les erreurs du navigateur au back-office et les plantages de l’application de caisse. Une caisse qui redémarre garde ses ventes ; elle se voit ici comme un terminal qui se tait puis reprend.')}</p>
        </section>

        {/* ── Historique des incidents ────────────────────────────────────── */}
        <section className="carte">
          <h2>{t('Incidents résolus sur la période')}</h2>
          {!historique || historique.incidentsRecents.length === 0 ? (
            <p className="indication">{t('Aucun incident résolu sur cette période.')}</p>
          ) : (
            <ul className="liste-incidents">
              {historique.incidentsRecents.map((i) => (
                <li key={i.id} className={`incident niveau-${i.niveau} resolu`}>
                  <details>
                    <summary>
                      <span className="etiquette-niveau resolu">{t('✓ Résolu')}</span>
                      <strong>{i.sujet}</strong>
                      <span className="indication">{' — '}{i.resoluLe ? t.date(i.resoluLe, { dateStyle: 'short', timeStyle: 'short' }) : ''}{' · '}{i.resolution === 'automatique' ? t('cause disparue') : t('par {qui}', { qui: i.resoluPar ?? '—' })}</span>
                    </summary>
                    <DetailIncident incident={i} t={t} />
                    <ActionsIncident id={i.id} statut={i.statut} />
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
  )
}

function DetailIncident({
  incident: i,
  t,
}: {
  incident: IncidentSupervision
  t: Traduction
}) {
  const date = (v: string | null) => (v ? t.date(v, { dateStyle: 'short', timeStyle: 'medium' }) : '—')
  return (
    <dl className="lignes-chiffres detail-incident">
      <dt>{t('Constat')}</dt>
      <dd>{i.message}</dd>
      <dt>{t('Clé de l’alerte')}</dt>
      <dd><code>{i.cle}</code></dd>
      <dt>{t('Ouvert le')}</dt>
      <dd>{date(i.ouvertLe)}</dd>
      <dt>{t('Vu pour la dernière fois')}</dt>
      <dd>{date(i.dernierVuLe)}</dd>
      <dt>{t('Pris en charge')}</dt>
      <dd>{i.prisEnChargePar ? `${i.prisEnChargePar} — ${date(i.prisEnChargeLe)}` : '—'}</dd>
      <dt>{t('Résolu')}</dt>
      <dd>{i.resoluLe ? `${date(i.resoluLe)} — ${i.resolution === 'automatique' ? t('cause disparue') : (i.resoluPar ?? '—')}` : '—'}</dd>
      <dt>{t('Note')}</dt>
      <dd>{i.note ?? '—'}</dd>
    </dl>
  )
}
