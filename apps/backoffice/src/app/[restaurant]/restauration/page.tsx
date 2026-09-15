/**
 * Paramètres → Options de restauration.
 *
 * Les deux réglages qui s'ajoutent au TOTAL : les frais de service et le
 * droit de timbre. Ils existaient en base depuis la migration 0002 et
 * n'étaient lus par AUCUN calcul — ni côté caisse, ni côté serveur. La
 * migration 0036 a branché la chaîne ; cet écran en est l'entrée.
 */

import Link from 'next/link'
import { ecranReserve, etablissementObligatoire } from '../../../serveur/session.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import { OptionsRestauration } from '../../../composants/OptionsRestauration.js'

export const dynamic = 'force-dynamic'

export default async function PageRestauration({
  params,
}: {
  params: Promise<{ restaurant: string }>
}) {
  const { restaurant } = await params
  const { etablissement } = await etablissementObligatoire(restaurant)
  ecranReserve(etablissement, 'gestion')
  const supabase = await supabaseServeur()

  const [etabRes, tauxRes] = await Promise.all([
    supabase
      .from('restaurants')
      .select(
        'service_rate_bp, service_taxable, service_tax_rate_id, stamp_duty_millimes',
      )
      .eq('id', restaurant)
      .single(),
    supabase
      .from('tax_rates')
      .select('id, name, rate_bp, is_included')
      .eq('restaurant_id', restaurant)
      .is('archived_at', null)
      .order('rate_bp'),
  ])

  const erreur = etabRes.error ?? tauxRes.error

  return (
    <>
      <h1>Options de restauration</h1>
      <p className="sous-titre">
        Les frais de service et le droit de timbre. Ce sont les deux seuls
        réglages de cette rubrique — avec les{' '}
        <Link href={{ pathname: `/${restaurant}/taxes` }}>taxes</Link> — qui
        changent le montant que le client paie.
      </p>

      {erreur && <p className="message erreur">Lecture impossible : {erreur.message}</p>}

      {!etablissement.gestionnaire && (
        <p className="sous-titre">
          Consultation seule : le rôle « {etablissement.role} » ne modifie pas
          les options de restauration.
        </p>
      )}

      <OptionsRestauration
        restaurantId={restaurant}
        modifiable={etablissement.gestionnaire}
        valeurs={{
          tauxServiceBp: Number(etabRes.data?.service_rate_bp ?? 0),
          serviceTaxable: Boolean(etabRes.data?.service_taxable),
          serviceTauxTaxeId: (etabRes.data?.service_tax_rate_id as string | null) ?? null,
          timbreMillimes: Number(etabRes.data?.stamp_duty_millimes ?? 0),
        }}
        taux={(tauxRes.data ?? []).map((t) => ({
          id: t.id as string,
          nom: t.name as string,
          tauxBp: (t.rate_bp as number) ?? 0,
          incluse: Boolean(t.is_included),
        }))}
      />

      <div className="carte note-imprimantes">
        <h2>Ce qui se passe quand vous enregistrez</h2>
        <p>
          Le réglage descend aux caisses par le <strong>catalogue</strong>,
          exactement comme un changement de prix — aucune ressaisie sur les
          tablettes, et rien à redémarrer. Une caisse hors ligne l’appliquera à
          sa prochaine synchronisation.
        </p>
        <p>
          Les ventes <strong>déjà encaissées ne bougent pas</strong> : chaque
          commande porte le total calculé au moment de la vente. Un rapport qui
          changerait parce qu’on modifie un réglage ne serait plus un
          historique.
        </p>
      </div>
    </>
  )
}
