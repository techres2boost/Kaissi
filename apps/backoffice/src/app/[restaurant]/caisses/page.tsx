/**
 * Paramètres → Caisses.
 *
 * ── La question à laquelle cet écran répond ──────────────────────────────
 *
 * « Comment je déconnecte une caisse ? » — posée dès qu'une tablette est
 * remplacée, prêtée, perdue. La réponse n'est pas un bouton sur la tablette :
 * c'est ici, parce qu'une caisse ne porte pas la session d'un utilisateur
 * mais un JETON D'APPAREIL, et que celui qui tient une tablette volée ne va
 * pas appuyer dessus.
 *
 * L'écran sert aussi, et peut-être surtout, à RELIER : voir qu'un terminal a
 * synchronisé il y a deux minutes répond à la moitié des « mes ventes
 * n'arrivent pas au back-office » sans ouvrir la tablette.
 */

import Link from 'next/link'
import { Info } from 'lucide-react'
import { ecranReserve, etablissementObligatoire } from '../../../serveur/session.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import { GestionCaisses, type CaisseAppairee } from '../../../composants/GestionCaisses.js'
import { traduction } from '../../../i18n/serveur.js'

export const dynamic = 'force-dynamic'

export default async function PageCaisses({
  params,
}: {
  params: Promise<{ restaurant: string }>
}) {
  const t = await traduction()
  const { restaurant } = await params
  const { etablissement } = await etablissementObligatoire(restaurant)
  ecranReserve(etablissement, 'gestion')
  const supabase = await supabaseServeur()

  /*
   * `token_hash` n'est PAS demandé, et c'est délibéré : le back-office n'a
   * aucune raison de voir l'empreinte d'un jeton, même hachée. Les colonnes
   * dont dépend cet écran sont déclarées dans `serveur/schema.ts` — une
   * migration qui en renommerait une casse la compilation, pas la page.
   */
  const { data, error } = await supabase
    .from('devices')
    .select('id, label, ticket_prefix, last_seen_at, created_at, revoked_at, app_version')
    .eq('restaurant_id', restaurant)
    .eq('type', 'pos')
    // Les actives d'abord, puis les plus récemment appairées.
    .order('revoked_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: false })

  const caisses: CaisseAppairee[] = (data ?? []).map((d) => ({
    id: d.id as string,
    libelle: d.label as string,
    prefixe: d.ticket_prefix as string,
    derniereSynchro: (d.last_seen_at as string | null) ?? null,
    appaireeLe: d.created_at as string,
    revoqueeLe: (d.revoked_at as string | null) ?? null,
    versionApplication: (d.app_version as string | null) ?? null,
  }))

  return (
    <>
      <h1>{t('Caisses')}</h1>
      <p className="sous-titre">{t('Les tablettes appairées à cet établissement, et la dernière fois que chacune a parlé au serveur.')}</p>

      {/*
        ── La distinction que tout le monde se pose, dite une fois ─────────

        « Se déconnecter » du back-office ferme une session de navigateur.
        Cela ne touche AUCUNE caisse, et ne doit pas : une caisse qui
        s'arrêterait parce qu'un gérant a fermé son navigateur au bureau,
        c'est le service qui s'arrête.
      */}
      <div className="message info">
        <Info size={16} strokeWidth={2} aria-hidden="true" />{' '}
        <strong>{t('Une caisse ne « se déconnecte » pas : elle se révoque, d’ici.')}</strong>{' '}
        {t('Se déconnecter du back-office ferme votre session de navigateur et ne touche à aucune tablette — une caisse qui s’arrêterait parce qu’un gérant a fermé son navigateur, ce serait le service qui s’arrête. Sur la tablette, « Verrouiller » rend la caisse à l’équipe ; le code PIN dit qui agit.')}</div>

      {error && <p className="message erreur">{t('Lecture impossible :')}{' '}{error.message}</p>}

      {!etablissement.gestionnaire && (
        <p className="sous-titre">{t('Consultation seule : le rôle « {role} » ne révoque pas de caisse.', { role: t.role(etablissement.role) })}</p>
      )}

      <GestionCaisses
        restaurantId={restaurant}
        caisses={caisses}
        modifiable={etablissement.gestionnaire}
      />

      <div className="carte">
        <h2>{t('Avant de révoquer une caisse')}</h2>
        <p>
          <strong>{t('Videz-la d’abord.')}</strong>{' '}{t('Sur la tablette : menu ☰ → Synchronisation → « En attente » doit valoir 0. Une vente encore dans la tablette au moment de la révocation ne remontera JAMAIS : le serveur la refusera, et un rejet ne se réessaie jamais tout seul.')}</p>
        <p>
          <strong>{t('C’est définitif.')}</strong>{' '}{t('Remettre la même tablette en service créera une NOUVELLE caisse, avec un nouveau préfixe de tickets. Les ventes déjà remontées, elles, restent intactes et gardent leur numéro.')}</p>
        <p>
          <strong>{t('Changer d’établissement n’est pas une révocation.')}</strong>{' '}{t('Si la tablette doit servir un autre restaurant, faites-le depuis la tablette : Synchronisation → « Ré-appairer — ou changer d’établissement ». Elle garde alors son identité et ses ventes en attente partent d’abord.')}</p>
        <p className="indication">{t('Qui peut ouvrir le back-office se règle dans')}{' '}
          <Link href={{ pathname: `/${restaurant}/employes` }}>{t('Employés')}</Link>{t(' — un compte et une caisse sont deux choses différentes.')}</p>
      </div>
    </>
  )
}
