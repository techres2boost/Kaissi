'use client'

/**
 * Les terminaux appairés à l'établissement — et le bouton qui en coupe un.
 *
 * ── Pourquoi « Dernière synchronisation » est la colonne qui décide ───────
 *
 * Révoquer une caisse qui a encore des ventes dans son outbox les perd
 * définitivement : le serveur répondra 403, et un rejet ne se réessaie
 * jamais tout seul. Le gérant n'a pas accès à l'outbox de la tablette
 * depuis ici — mais une caisse qui a synchronisé il y a deux minutes n'a
 * rien en attente, et une caisse muette depuis trois jours en a
 * probablement. Cette colonne est donc le seul élément de décision honnête
 * que cet écran puisse donner, et elle est affichée à côté du bouton.
 */

import { useActionState } from 'react'
import { Tablet, TabletSmartphone, TriangleAlert } from 'lucide-react'
import { revoquerCaisse, renommerCaisse, type Resultat } from '../app/[restaurant]/caisses/actions.js'
import { useT } from '../i18n/client.js'
import type { Traduction } from '../i18n/commun.js'

export interface CaisseAppairee {
  id: string
  libelle: string
  /** « P2 » → P2-000431. */
  prefixe: string
  derniereSynchro: string | null
  appaireeLe: string
  revoqueeLe: string | null
  versionApplication: string | null
}

/** « il y a 4 min », « il y a 3 j » — ou « jamais ». */
function depuis(t: Traduction, iso: string | null): string {
  if (!iso) return t('jamais')
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (!Number.isFinite(minutes) || minutes < 0) return t.date(iso, { dateStyle: 'short', timeStyle: 'short' })
  if (minutes < 2) return t('à l’instant')
  if (minutes < 60) return t('il y a {n} min', { n: minutes })
  const heures = Math.floor(minutes / 60)
  if (heures < 48) return t('il y a {n} h', { n: heures })
  return t('il y a {n} jours', { n: Math.floor(heures / 24) })
}

function LigneCaisse({
  restaurantId,
  caisse,
  modifiable,
}: {
  restaurantId: string
  caisse: CaisseAppairee
  modifiable: boolean
}) {
  const t = useT()
  const [renommage, actionRenommer] = useActionState(
    renommerCaisse.bind(null, restaurantId, caisse.id),
    null as Resultat | null,
  )
  const [revocation, actionRevoquer, revocationEnCours] = useActionState(
    revoquerCaisse.bind(null, restaurantId, caisse.id),
    null as Resultat | null,
  )
  const revoquee = caisse.revoqueeLe !== null
  const Icone = revoquee ? Tablet : TabletSmartphone

  return (
    <li className={revoquee ? 'caisse-revoquee' : undefined}>
      <div className="caisse-entete">
        <span className="caisse-nom">
          <Icone size={18} strokeWidth={1.9} aria-hidden="true" />
          {caisse.libelle}
        </span>
        <span className="etiquette">{caisse.prefixe}</span>
        {revoquee ? (
          <span className="etiquette">{t('révoquée le {date}', { date: t.date(caisse.revoqueeLe!, { dateStyle: 'short' }) })}</span>
        ) : (
          <span className="detail">{t('dernière synchronisation : {quand}', { quand: depuis(t, caisse.derniereSynchro) })}</span>
        )}
      </div>

      <div className="caisse-details detail">
        {t('Appairée le {date}', { date: t.date(caisse.appaireeLe, { dateStyle: 'short' }) })}
        {caisse.versionApplication ? ` · ${caisse.versionApplication}` : ''}
      </div>

      {!revoquee && modifiable && (
        <div className="caisse-actions">
          <form action={actionRenommer}>
            <input
              name="libelle"
              defaultValue={caisse.libelle}
              aria-label={t('Nom de la caisse {nom}', { nom: caisse.libelle })}
              maxLength={100}
              autoComplete="off"
            />
            <button type="submit" className="discret">{t('Renommer')}</button>
          </form>

          <form
            action={actionRevoquer}
            onSubmit={(e) => {
              /*
               * Une confirmation qui NOMME la caisse et dit ce qu'on perd.
               * Le geste est irréversible et sa conséquence invisible depuis
               * cet écran — c'est exactement le cas où une boîte de dialogue
               * vaut mieux qu'un bouton rouge.
               */
              if (
                !confirm(
                  t(
                    'Révoquer « {nom} » ?\n\nCette tablette ne pourra plus synchroniser, et ses ventes PAS ENCORE remontées seront perdues. Vérifiez d’abord que son écran Synchronisation affiche 0 en attente.\n\nLa révocation est définitive : remettre cette tablette en service créera une nouvelle caisse, avec un nouveau préfixe de tickets.',
                    { nom: caisse.libelle },
                  ),
                )
              ) {
                e.preventDefault()
              }
            }}
          >
            <button type="submit" className="danger" disabled={revocationEnCours}>
              {revocationEnCours ? t('Révocation…') : t('Révoquer')}
            </button>
          </form>
        </div>
      )}

      {renommage?.erreur && <p className="message erreur">{t.m(renommage.erreur)}</p>}
      {renommage?.succes && <p className="message succes">{t.m(renommage.succes)}</p>}
      {revocation?.erreur && <p className="message erreur">{t.m(revocation.erreur)}</p>}
      {revocation?.succes && <p className="message succes">{t.m(revocation.succes)}</p>}
    </li>
  )
}

export function GestionCaisses({
  restaurantId,
  caisses,
  modifiable,
}: {
  restaurantId: string
  caisses: readonly CaisseAppairee[]
  modifiable: boolean
}) {
  const t = useT()
  const actives = caisses.filter((c) => c.revoqueeLe === null)
  const revoquees = caisses.filter((c) => c.revoqueeLe !== null)

  return (
    <>
      <section className="carte">
        <h2>{t('En service')}</h2>
        {actives.length === 0 ? (
          <p className="indication">{t('Aucune caisse appairée. Sur la tablette : menu ☰ → Synchronisation → e-mail et mot de passe.')}</p>
        ) : (
          <ul className="liste-caisses">
            {actives.map((c) => (
              <LigneCaisse key={c.id} restaurantId={restaurantId} caisse={c} modifiable={modifiable} />
            ))}
          </ul>
        )}
      </section>

      {revoquees.length > 0 && (
        <section className="carte">
          <h2>{t('Révoquées')}</h2>
          <ul className="liste-caisses">
            {revoquees.map((c) => (
              <LigneCaisse key={c.id} restaurantId={restaurantId} caisse={c} modifiable={modifiable} />
            ))}
          </ul>
          <p className="indication">
            <TriangleAlert size={15} strokeWidth={2} aria-hidden="true" />{' '}
            {t('Elles restent listées, et leurs ventes restent dans les rapports : une caisse révoquée n’efface rien. Leur préfixe de tickets, lui, ne sera jamais réattribué.')}
          </p>
        </section>
      )}
    </>
  )
}
