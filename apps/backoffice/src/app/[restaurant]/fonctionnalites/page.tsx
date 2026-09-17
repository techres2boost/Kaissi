/**
 * Paramètres → Fonctionnalités.
 *
 * ── Ce que cet écran répond, et que rien d'autre ne répondait ─────────────
 *
 * « Qu'est-ce que ce logiciel fait, au juste ? » — la question d'un
 * restaurateur qui l'évalue, et celle d'un gérant qui cherche un réglage
 * depuis vingt minutes. Il fallait jusqu'ici ouvrir douze écrans pour y
 * répondre, et deux des réponses n'étaient nulle part : l'impression est
 * éteinte dans cette version, et la fidélité n'existe pas.
 *
 * ── Les états ne sont pas écrits en dur ───────────────────────────────────
 *
 * Ils se LISENT. « Vous avez 3 postes dont 1 avec imprimante », « 8 articles
 * suivis en stock », « aucune réduction enregistrée » : un écran qui
 * affirmerait « Stock : actif » sur un établissement qui ne suit aucun article
 * dirait quelque chose de vrai et d'inutile. Ce qu'on veut savoir, c'est ce
 * que CE restaurant a réellement mis en place.
 */

import Link from 'next/link'
import { ecranReserve, etablissementObligatoire } from '../../../serveur/session.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import { moduleOuvert } from '@kaissi/domain'
import { abonnementDe } from '../../../serveur/abonnement.js'
import {
  ICONES,
  ListeFonctionnalites,
  type Fonctionnalite,
} from '../../../composants/ListeFonctionnalites.js'

export const dynamic = 'force-dynamic'

/**
 * Compte les lignes ACTIVES d'une table pour cet établissement.
 *
 * `head: true` ne rend que le total : aucune ligne ne remonte, et un
 * établissement à quarante mille clients ne coûte pas plus cher qu'un autre.
 * Cette page est ouverte pour être LUE, pas pour tirer des données.
 */
async function actives(
  supabase: Awaited<ReturnType<typeof supabaseServeur>>,
  table:
    | 'stations'
    | 'discounts'
    | 'customers'
    | 'products'
    | 'payment_methods'
    | 'modifier_groups'
    | 'suppliers'
    | 'memberships',
  restaurantId: string,
  colonneRetrait: 'archived_at' | 'revoked_at' = 'archived_at',
): Promise<number> {
  const { count } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId)
    .is(colonneRetrait, null)
  return count ?? 0
}

export default async function PageFonctionnalites({
  params,
}: {
  params: Promise<{ restaurant: string }>
}) {
  const { restaurant } = await params
  const { etablissement } = await etablissementObligatoire(restaurant)
  ecranReserve(etablissement, 'gestion')
  const supabase = await supabaseServeur()

  const [
    postes,
    postesImprimante,
    reductions,
    groupesModif,
    clients,
    suivis,
    modes,
    equipe,
    options,
  ] = await Promise.all([
    actives(supabase, 'stations', restaurant),
    // Les postes qui portent VRAIMENT une adresse d'imprimante : c'est la
    // seule mesure qui distingue « configuré » de « créé ».
    supabase
      .from('stations')
      .select('id', { count: 'exact', head: true })
      .eq('restaurant_id', restaurant)
      .is('archived_at', null)
      .not('printer_host', 'is', null)
      .then((r) => r.count ?? 0),
    actives(supabase, 'discounts', restaurant),
    actives(supabase, 'modifier_groups', restaurant),
    actives(supabase, 'customers', restaurant),
    supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('restaurant_id', restaurant)
      .is('archived_at', null)
      .eq('track_stock', true)
      .then((r) => r.count ?? 0),
    actives(supabase, 'payment_methods', restaurant),
    /*
     * L'équipe DE CE RESTAURANT, donc `memberships` et non `users`.
     *
     * `users` est porté par l'ORGANISATION : sur un client à deux
     * établissements, le compter rendrait le personnel des deux, et l'écran
     * annoncerait douze personnes à un patron qui en emploie cinq ici.
     */
    actives(supabase, 'memberships', restaurant, 'revoked_at'),
    supabase
      .from('restaurants')
      .select('service_rate_bp, stamp_duty_millimes')
      .eq('id', restaurant)
      .single(),
  ])

  /*
   * La formule, lue APRÈS les comptages : elle porte sur l'organisation et
   * non sur l'établissement, donc elle ne se glisse pas dans le `Promise.all`
   * ci-dessus, qui compte des lignes par restaurant.
   */
  const abonnement = await abonnementDe(etablissement.organizationId)
  // Les fiches ne se comptent que si le module est ouvert : sans lui, l'écran
  // n'en montre aucune, et annoncer « 4 fiches » à qui ne peut pas les ouvrir
  // serait une promesse à rebours.
  const fournisseurs = moduleOuvert(abonnement, 'inventaire_avance')
    ? await actives(supabase, 'suppliers', restaurant)
    : 0

  const service = Number(options.data?.service_rate_bp ?? 0)
  const timbre = Number(options.data?.stamp_duty_millimes ?? 0)

  const fonctionnalites: Fonctionnalite[] = [
    {
      cle: 'tickets-ouverts',
      nom: 'Tickets ouverts',
      icone: ICONES.Ticket,
      etat: 'structurelle',
      quoi:
        'Une commande reste ouverte sur une table, s’enrichit au fil du service, ' +
        'et ne s’encaisse qu’à la fin.',
      pourquoi:
        'Non débrayable, parce que ce n’est pas une option chez Kaissi : la salle ' +
        'est BÂTIE dessus. Une commande est un journal d’événements, pas une ligne ' +
        'qu’on remplit d’un coup — c’est ce qui permet à deux tablettes hors ligne ' +
        'd’ajouter chacune un article à la table 12 sans le moindre conflit.',
      chemin: 'preparation',
      lien: 'Voir les commandes en cours',
    },
    {
      cle: 'modes-paiement',
      nom: 'Modes de paiement',
      icone: ICONES.CreditCard,
      etat: 'active',
      quoi: 'Espèces, carte, paiement en ligne, et tout libellé que vous ajoutez.',
      pourquoi:
        'Le nom sert au caissier et au ticket ; le type sert au rapport, qui regroupe. ' +
        '« Flouci » et « D17 » sont deux noms pour un même type.',
      constat: `${modes} mode(s) actif(s).`,
      chemin: 'paiements',
      lien: 'Régler les modes de paiement',
    },
    {
      cle: 'reductions',
      nom: 'Réductions prédéfinies',
      icone: ICONES.Tag,
      etat: 'active',
      quoi:
        'Des remises nommées, en pourcentage ou en montant, proposées au caissier ' +
        'et retrouvées telles quelles dans les rapports.',
      pourquoi:
        'Le nom est RECOPIÉ sur la vente, jamais joint : renommer une réduction ne ' +
        'réécrit pas ce qui a été accordé l’an dernier.',
      constat:
        reductions === 0
          ? 'Aucune réduction enregistrée — le caissier ne peut accorder qu’une remise libre, s’il en a le droit.'
          : `${reductions} réduction(s) enregistrée(s).`,
      chemin: 'reductions/gestion',
      lien: 'Gérer les réductions',
    },
    {
      cle: 'modificateurs',
      nom: 'Modificateurs',
      icone: ICONES.UtensilsCrossed,
      etat: groupesModif === 0 ? 'absente' : 'active',
      quoi:
        'La cuisson d’une viande, les suppléments d’une pizza — proposés au caissier ' +
        'quand il touche l’article.',
      pourquoi:
        'Ils s’ajoutent au prix de la LIGNE, jamais à la taxe ni au stock : le taux de ' +
        'l’article s’applique au tout, et un supplément n’est pas un article vendu. ' +
        'Un choix peut être négatif — « sans fromage −0,500 ».',
      constat:
        groupesModif === 0
          ? 'Aucun groupe : les articles se vendent tels quels, sans choix proposé.'
          : `${groupesModif} groupe(s) de modificateurs.`,
      chemin: 'modificateurs',
      lien: 'Gérer les modificateurs',
    },
    {
      cle: 'inventaire',
      nom: 'Inventaire avancé',
      icone: ICONES.Truck,
      etat: moduleOuvert(abonnement, 'inventaire_avance') ? 'active' : 'absente',
      quoi:
        'La valeur d’achat de votre stock, et des fiches fournisseurs rattachées aux ' +
        'réceptions.',
      pourquoi:
        'C’est le seul module que la formule peut fermer, avec la profondeur d’historique ' +
        'des rapports. Le stock lui-même — comptages, mouvements, seuils, retrait ' +
        'automatique de la carte — reste entier quelle que soit la formule, et la caisse ' +
        'n’est jamais concernée.',
      constat: moduleOuvert(abonnement, 'inventaire_avance')
        ? `${fournisseurs} fiche(s) fournisseur.`
        : `Fermé avec la formule « ${abonnement.nom} ».`,
      chemin: 'inventaire',
      lien: moduleOuvert(abonnement, 'inventaire_avance')
        ? 'Ouvrir l’inventaire avancé'
        : 'Voir ce qu’il ajoute',
    },
    {
      cle: 'clients',
      nom: 'Fiches clients',
      icone: ICONES.Contact,
      etat: 'active',
      quoi:
        'Un carnet d’adresses : rappeler quelqu’un pour une commande à emporter, ' +
        'reconnaître un habitué, rattacher une vente à un nom.',
      pourquoi:
        'Les visites et le total dépensé ne sont pas stockés — ils se CALCULENT à la ' +
        'lecture. Un compteur entretenu par déclencheur dériverait en silence à chaque ' +
        'reprojection, et personne ne saurait depuis quand.',
      constat: `${clients} fiche(s) client.`,
      chemin: 'clients',
      lien: 'Ouvrir le carnet',
    },
    {
      cle: 'stock',
      nom: 'Suivi du stock',
      icone: ICONES.Package,
      etat: 'active',
      quoi:
        'Comptage de référence, mouvements, alerte de seuil, et retrait automatique ' +
        'de la carte à zéro.',
      pourquoi:
        'Le stock ne BLOQUE jamais une vente hors ligne : la tablette travaille sur un ' +
        'souvenir, refuser de vendre sur une donnée périmée serait le pire des deux ' +
        'mondes. C’est le SERVEUR qui retire un produit de la carte, sur le stock ' +
        'calculé à l’instant.',
      constat:
        suivis === 0
          ? 'Aucun article suivi — activez le suivi article par article dans le stock.'
          : `${suivis} article(s) suivi(s).`,
      chemin: 'stock',
      lien: 'Ouvrir le stock',
    },
    {
      cle: 'equipe',
      nom: 'Employés et code PIN',
      icone: ICONES.Users,
      etat: 'active',
      quoi:
        'Chaque action de caisse porte le nom de qui l’a faite, via un code PIN validé ' +
        'HORS LIGNE.',
      pourquoi:
        'Le PIN TRACE, il ne protège pas : quatre chiffres n’ont que dix mille ' +
        'combinaisons. Ce qui protège l’argent, c’est le jeton d’appareil révocable, ' +
        'RLS, et le journal d’audit.',
      constat: `${equipe} personne(s) dans l’équipe.`,
      chemin: 'employes',
      lien: 'Gérer l’équipe',
    },
    {
      cle: 'postes',
      nom: 'Postes de préparation',
      icone: ICONES.UtensilsCrossed,
      etat: postes === 0 ? 'absente' : 'active',
      quoi: 'Cuisine, bar, pâtisserie : chaque poste voit les lignes qu’il prépare, et rien d’autre.',
      pourquoi:
        'Le poste vient de la CATÉGORIE, pas de l’article : le porter sur le produit ' +
        'obligeait à s’en souvenir à chaque création, et un produit sans poste ' +
        'n’apparaît sur AUCUN écran — ce qui ne se voit qu’en plein service.',
      constat:
        postes === 0
          ? 'Aucun poste : l’écran de préparation restera vide.'
          : `${postes} poste(s), dont ${postesImprimante} avec une imprimante réglée.`,
      chemin: 'categories',
      lien: 'Régler les postes et leurs catégories',
    },
    {
      cle: 'restauration',
      nom: 'Service et droit de timbre',
      icone: ICONES.HandPlatter,
      etat: 'active',
      quoi: 'Des frais de service en pourcentage, et un montant fixe par ticket.',
      pourquoi:
        'Kaissi n’applique que ce que vous saisissez, et ne propose aucune valeur par ' +
        'défaut : ce sont des paramètres réglementaires, à valider avec votre comptable.',
      constat:
        service === 0 && timbre === 0
          ? 'Ni service ni timbre : les tickets portent le total des articles et de leurs taxes.'
          : `Service ${(service / 100).toString().replace('.', ',')} %` +
            (timbre > 0 ? ` · timbre ${(timbre / 1000).toFixed(3).replace('.', ',')} TND` : ''),
      chemin: 'restauration',
      lien: 'Régler les options de restauration',
    },
    {
      cle: 'impression',
      nom: 'Impression des tickets et bons',
      icone: ICONES.Printer,
      etat: 'eteinte',
      quoi:
        'Ticket client et bon de cuisine envoyés à une imprimante réseau, par une file ' +
        'persistante qui survit au redémarrage.',
      pourquoi:
        'Le module est ÉCRIT, TESTÉ et embarqué — simplement pas allumé dans cette ' +
        'version des caisses. Le bon s’affiche à l’écran, et la cuisine lit ses ' +
        'commandes dans Préparation. Les adresses d’imprimante que vous réglez sont ' +
        'conservées et descendent déjà : elles serviront telles quelles le jour où ' +
        'l’impression sera activée.',
      chemin: 'imprimantes',
      lien: 'Régler les imprimantes malgré tout',
    },
    {
      cle: 'fidelite',
      nom: 'Programme de fidélité',
      icone: ICONES.Percent,
      etat: 'absente',
      quoi: 'Points cumulés par client, et récompenses à dépenser en caisse.',
      pourquoi:
        'Rien n’existe en base pour le porter — ni les points, ni leur historique, ni ' +
        'les règles de cumul. Le carnet clients n’en est pas un début : il ne compte ' +
        'rien. Annoncer la fonctionnalité en attendant reviendrait à la vendre deux ' +
        'fois, dont une qui n’arrive pas.',
      chemin: 'clients',
      lien: 'Voir ce qui existe : le carnet clients',
    },
    {
      cle: 'assistance',
      nom: 'Assistance',
      icone: ICONES.BookOpen,
      etat: 'active',
      quoi:
        'Les trois écrans à regarder quand quelque chose ne va pas, et par où nous joindre.',
      pourquoi:
        'La foire aux questions vit sur une page PUBLIQUE, qui s’ouvre depuis n’importe ' +
        'quel téléphone — y compris quand personne n’arrive plus à se connecter au ' +
        'back-office, c’est-à-dire précisément le jour où l’on en a besoin.',
      /*
       * Le constat disait « prévu avec les abonnements, qui n'existent pas
       * encore ». Les abonnements existent depuis la migration 0040 : la
       * phrase promettait donc un chat qui arriverait « avec » quelque chose
       * de déjà arrivé. Ce qui manque, c'est le chat.
       */
      constat:
        'Pas de chat en direct : aucune formule n’en ouvre un, et il n’y a pas ' +
        'd’équipe pour le tenir.',
      chemin: 'aide',
      lien: 'Ouvrir l’aide',
    },
    {
      cle: 'abonnement',
      nom: 'Abonnement',
      icone: ICONES.Wallet,
      etat: 'active',
      quoi:
        'La formule de votre compte, ce qu’elle ouvre, et ce qu’elle laisse fermé — ' +
        'aujourd’hui l’inventaire avancé et la profondeur d’historique des rapports.',
      pourquoi:
        'Une formule ne ferme JAMAIS un geste de caisse. La tablette encaisse hors ligne ' +
        'quelle que soit la formule, et même expirée : son code est dans l’application, ' +
        'il n’interroge aucun abonnement, et lui apprendre à le faire reviendrait à ' +
        'écrire de quoi arrêter un service un vendredi soir.',
      constat: abonnement.enEssai
        ? `Essai en cours — ${abonnement.joursRestants} jour(s) restant(s), tout est ouvert.`
        : abonnement.essaiExpire
          ? 'Essai terminé : vous avez les droits de la formule « Gratuit ».'
          : `Formule « ${abonnement.nom} ».`,
      chemin: 'abonnement',
      lien: 'Voir la formule',
    },
    {
      cle: 'facturation',
      nom: 'Factures et prélèvement',
      icone: ICONES.BookOpen,
      etat: 'absente',
      quoi: 'Échéances, factures téléchargeables et moyen de paiement enregistré.',
      pourquoi:
        'Kaissi ne conserve aucun moyen de paiement et ne prélève rien tout seul : un ' +
        'abonnement se règle avec quelqu’un. Afficher un échéancier qui ne déclenche ' +
        'aucun prélèvement ferait croire que la facturation tourne.',
      chemin: 'abonnement',
      lien: 'Voir la formule en cours',
    },
  ]

  return (
    <>
      <h1>Fonctionnalités</h1>
      <p className="sous-titre">
        Ce que Kaissi fait pour <strong>{etablissement.nom}</strong> aujourd’hui,
        et ce qu’il ne fait pas. Les états sont lus dans vos données — ce n’est
        pas une plaquette.
      </p>

      {/*
        Le paragraphe qui explique l'absence d'interrupteurs. Sans lui, un
        restaurateur qui vient de Loyverse cherche les bascules et conclut que
        l'écran est cassé.
      */}
      <div className="message info">
        <strong>Pas d’interrupteurs sur cette page, et c’est voulu.</strong> Une
        fonctionnalité se règle là où elle vit — les modes de paiement dans{' '}
        <Link href={{ pathname: `/${restaurant}/paiements` }}>Modes de paiement</Link>,
        le suivi article par article dans{' '}
        <Link href={{ pathname: `/${restaurant}/stock` }}>Stock</Link>. Une
        bascule ici, qu’il faudrait tenir d’accord avec le réglage réel, finirait
        par dire le contraire de ce qui se passe vraiment.
      </div>

      <ListeFonctionnalites restaurantId={restaurant} fonctionnalites={fonctionnalites} />
    </>
  )
}
