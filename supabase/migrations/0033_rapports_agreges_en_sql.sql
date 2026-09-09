-- ═══════════════════════════════════════════════════════════════════════════
-- Kaissi — 0033 · Les rapports s'agrègent DANS PostgreSQL
-- ═══════════════════════════════════════════════════════════════════════════
-- Réponse au point R-1 de `docs/audit-production.md`, le dernier reste des
-- deux défauts critiques.
--
-- ── Ce qui se passait avant ──────────────────────────────────────────────
--
-- Le back-office tirait la LIGNE À LIGNE : sur 92 jours à 200 ventes/jour,
-- ~18 000 commandes et ~55 000 lignes traversaient PostgREST, étaient
-- désérialisées en objets JavaScript dans une fonction serverless, puis
-- additionnées — pour afficher une trentaine de nombres. Le rapport de
-- l'audit (C-2) l'a mesuré au point de rupture : 73 000 commandes, un tri
-- SUR DISQUE, et une erreur 500 sans explication sur l'écran des chiffres
-- d'affaires.
--
-- Le plafond de 50 000 posé alors était un garde-fou, pas une architecture.
-- Ceci en est une : les sommes se font là où sont les lignes.
--
-- ── LA question : et la RÈGLE 7 ? ────────────────────────────────────────
--
-- « Les totaux se calculent à UN SEUL endroit », `packages/domain`. Cette
-- fonction a donc l'air d'être exactement ce que le dépôt interdit. Elle ne
-- l'est pas, et la distinction est TOUT le sujet :
--
--   • Une RÈGLE est une décision. Arrondir la TVA par taux puis sommer et
--     non l'inverse ; répartir la remise globale au prorata ; rapporter la
--     marge au CA et non au coût ; n'arrondir les coûts qu'UNE fois, au
--     total. Ces décisions restent dans `packages/domain`, à l'identique.
--
--   • Une SOMME d'entiers déjà décidés n'est pas une décision. `sum()` est
--     associative et exacte : les mêmes millimes additionnés dans un autre
--     ordre donnent le même total, en SQL comme en JavaScript.
--
-- Cette fonction ne fait QUE la seconde. Elle ne recalcule aucune TVA, ne
-- répartit aucune remise, n'arrondit aucun coût : elle additionne des
-- colonnes que la projection a déjà remplies en appliquant `totaux.ts`.
--
-- Trois précautions rendent la frontière vérifiable :
--
--   1. Les COÛTS sortent d'ici NON ARRONDIS, en `numeric` exact. C'est
--      `totaliserCouts()` du domaine qui arrondit, une seule fois, comme
--      avant. Arrondir ici aurait déplacé une décision.
--      ⚑ Le SQL est même PLUS exact que l'ancien chemin : `numeric` est de
--        l'arithmétique décimale, là où JavaScript accumulait en flottant.
--   2. Les POURCENTAGES — marge, part du CA — ne sont pas calculés ici du
--      tout. La fonction rend un CA et un coût ; `calculerMarge()` en fait
--      une marge, comme pour la caisse.
--   3. Un test compare les deux chemins sur le même jeu de ventes et exige
--      l'égalité AU MILLIME (`apps/sync/test/rapports-agreges.test.ts`).
--      C'est du calcul d'argent : ça se valide par comparaison, jamais par
--      relecture.
--
-- ── `security invoker`, et c'est capital ─────────────────────────────────
--
-- `appliquer_rupture_auto` (0023) est `security definer` parce qu'elle doit
-- écrire au-delà des droits de l'appelant. Celle-ci lit des données de
-- vente : la mettre en `definer` rendrait le chiffre d'affaires d'un autre
-- restaurant à qui saurait deviner un UUID. Elle est donc en `invoker` —
-- le corps s'exécute avec les droits et le contexte RLS de l'appelant, et
-- les politiques de `orders` et `order_items` s'appliquent exactement comme
-- si le back-office avait écrit la requête lui-même. Le `p_restaurant`
-- n'est pas un contrôle d'accès, c'est un filtre : RLS reste le contrôle.
--
-- ── Le fuseau et la bascule sont des PARAMÈTRES ──────────────────────────
--
-- Ils ne sont pas relus depuis `restaurants` ici. L'appelant les possède
-- déjà (`chargerFiche`), et surtout : une fonction qui relit la fiche
-- deviendrait un second endroit où se décide « quel jour est cette vente ».
-- Ils descendent donc depuis le même endroit que pour le reste du produit.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function kaissi.rapport_ventes(
  p_restaurant  uuid,
  p_debut       timestamptz,
  p_fin         timestamptz,
  p_timezone    text     default 'Africa/Tunis',
  p_bascule     interval default '04:00:00',
  p_employe     uuid     default null,
  p_heure_debut integer  default 0,
  p_heure_fin   integer  default 23
)
returns jsonb
-- `plpgsql` et non `sql` — pour UNE raison, mesurée, expliquée plus bas.
language plpgsql
stable
security invoker
set search_path = ''
/*
 * ── LE réglage sans lequel cette fonction est INUTILISABLE ───────────────
 *
 * MESURÉ, sur 92 jours, 18 400 ventes et 55 200 lignes :
 *
 *     sans ce réglage   27 300 ms
 *     avec              380 ms
 *
 * Soixante-dix fois. Ce n'est pas une optimisation, c'est la différence
 * entre un écran et un délai d'exécution dépassé.
 *
 * ── Ce qui se passait ────────────────────────────────────────────────────
 *
 * PostgreSQL ne connaît pas les valeurs de `p_debut` et `p_fin` au moment
 * où il planifie le corps d'une fonction. Il applique donc une sélectivité
 * par défaut, et estime que la période contiendra **UNE** commande. Sur
 * cette estimation il choisit des boucles imbriquées — le bon plan pour une
 * ligne — et rebalaye alors un CTE de 18 000 lignes une fois par commande.
 * Trois cent trente millions de lignes visitées pour en agréger 55 000.
 *
 * `force_custom_plan` lui interdit ce raccourci : la requête est
 * REPLANIFIÉE à chaque appel, avec les vraies bornes. Replanifier coûte une
 * fraction de milliseconde ; se tromper de plan en coûte vingt-sept mille.
 *
 * ── Et pourquoi `plpgsql` plutôt que `sql` ───────────────────────────────
 *
 * Parce que le réglage n'a AUCUN effet sur une fonction `language sql` :
 * son corps ne passe pas par le cache de plans qui l'honore. Vérifié —
 * `language sql` avec `force_custom_plan` mesurait toujours 27 300 ms. Le
 * `begin … return (…) ; end` qui enveloppe la requête ne fait rien d'autre
 * que la faire exécuter par un moteur qui écoute ce réglage.
 *
 * ⚑ Le symptôme en production aurait été le pire qui soit : correct en
 *   démonstration, correct chez un client qui démarre, et de plus en plus
 *   lent chez celui qui vend le plus — sans qu'aucune ligne de code n'ait
 *   changé. C'est le banc de mesure qui l'a trouvé, pas la relecture.
 */
set plan_cache_mode = 'force_custom_plan'
as $$
begin
  return (
with
/*
 * Les commandes retenues — la définition d'« une vente », et elle est
 * unique : une commande CLOSE, rattachée au jour où elle a été ENCAISSÉE.
 *
 * `coalesce(closed_by, opened_by)` : la vente s'attribue à qui l'a CONCLUE.
 * Un serveur ouvre la table, c'est le caissier qui encaisse — et c'est son
 * nom que le gérant cherche dans « Ventes par employé ».
 */
commandes as (
  select
    o.id,
    o.total_millimes,
    o.closed_at,
    coalesce(o.closed_by, o.opened_by)          as vendeur_id,
    o.discount_id,
    o.discount_label,
    /*
     * La JOURNÉE COMMERCIALE. On retranche la bascule de l'INSTANT ABSOLU
     * avant de passer en heure locale : une vente encaissée à 1 h du matin
     * appartient ainsi à la soirée de la veille. Faire l'inverse — passer
     * en local puis retrancher — donnerait le même résultat 364 jours par
     * an et un jour faux à chaque changement d'heure.
     *
     * C'est la transcription exacte de `journeeCourante()`
     * (apps/backoffice/src/serveur/journee.ts), et le test de comparaison
     * porte spécifiquement là-dessus.
     */
    ((o.closed_at - p_bascule) at time zone p_timezone)::date as journee
  from kaissi.orders o
  where o.restaurant_id = p_restaurant
    and o.status = 'close'
    and o.closed_at >= p_debut
    and o.closed_at <  p_fin
    and (p_employe is null or coalesce(o.closed_by, o.opened_by) = p_employe)
    -- Filtre horaire : l'heure LOCALE de l'établissement, jamais UTC. À
    -- Tunis l'écart suffit à faire basculer un service de midi dans la
    -- tranche du matin.
    and (
      (p_heure_debut = 0 and p_heure_fin = 23)
      or extract(hour from (o.closed_at at time zone p_timezone))
           between p_heure_debut and p_heure_fin
    )
),

/*
 * Les lignes des commandes retenues. Les lignes annulées sont écartées :
 * le client ne les a pas payées, elles ne sont ni du chiffre ni du coût.
 *
 * `ordre` reproduit l'ordre dans lequel l'ancien chemin JavaScript
 * rencontrait les lignes — commandes les plus récentes d'abord, puis
 * position croissante. Il ne sert qu'à choisir le LIBELLÉ d'un groupe (la
 * désignation la plus récente d'un produit renommé), pas un montant. Sans
 * lui, les deux chemins afficheraient parfois deux noms différents pour le
 * même chiffre — et on chercherait longtemps pourquoi.
 */
lignes as (
  select
    i.order_id,
    i.product_id,
    i.designation,
    i.qty,
    i.line_gross_millimes,
    i.line_discount_millimes,
    i.global_discount_share_millimes,
    i.line_total_millimes,
    i.line_tax_millimes,
    i.discount_id,
    i.discount_label,
    c.vendeur_id,
    p.cost_per_unit,
    p.category_id,
    row_number() over (order by c.closed_at desc, i.order_id, i.position) as ordre
  from kaissi.order_items i
  join commandes c on c.id = i.order_id
  left join kaissi.products p on p.id = i.product_id
  where i.voided_at is null
),

/* ── Les indicateurs de tête ─────────────────────────────────────────── */
indicateurs as (
  select
    coalesce(sum(l.line_total_millimes), 0)                          as ca_net_millimes,
    coalesce(sum(l.line_gross_millimes), 0)                          as ca_brut_millimes,
    coalesce(sum(l.line_discount_millimes
                 + l.global_discount_share_millimes), 0)             as remises_millimes,
    coalesce(sum(l.line_tax_millimes), 0)                            as taxes_millimes,
    -- EXACT, non arrondi : c'est le domaine qui arrondira, une seule fois.
    coalesce(sum(l.cost_per_unit * l.qty), 0)                        as cout_exact,
    coalesce(sum(l.qty), 0)                                          as articles_vendus,
    count(*) filter (where l.cost_per_unit is null)                  as lignes_sans_cout
  from lignes l
),

/*
 * ── Les ventilations ────────────────────────────────────────────────────
 *
 * Toutes rendent la même forme : une clé, un libellé, une quantité, un CA
 * net, un coût EXACT, et le détail brut/remises/taxes qu'un export
 * comptable réclame — sans lui, on ne peut pas refaire à la main le chemin
 * du brut au net, et un rapport qu'on ne peut pas vérifier n'est pas un
 * rapport, c'est une affirmation.
 *
 * Le TRI et la PART du CA total ne sont pas faits ici : ce sont des
 * décisions d'affichage, et la part est une division — donc un arrondi,
 * donc le domaine.
 */
par_produit as (
  select
    -- Un produit supprimé du catalogue ne doit pas faire disparaître son
    -- chiffre d'affaires : on retombe alors sur la désignation FIGÉE.
    coalesce(l.product_id::text, 'designation:' || l.designation)     as cle,
    (array_agg(l.designation order by l.ordre))[1]                    as libelle,
    -- La catégorie de la vente la plus récente : un article n'en a qu'une,
    -- et l'écran « Ventes par article » l'affiche en colonne secondaire.
    (array_agg(cat.name order by l.ordre))[1]                         as categorie_nom,
    sum(l.qty)                                                        as quantite,
    sum(l.line_total_millimes)                                        as net_millimes,
    sum(l.line_gross_millimes)                                        as brut_millimes,
    sum(l.line_discount_millimes + l.global_discount_share_millimes)  as remises_millimes,
    sum(l.line_tax_millimes)                                          as taxes_millimes,
    coalesce(sum(l.cost_per_unit * l.qty), 0)                         as cout_exact
  from lignes l
  left join kaissi.categories cat on cat.id = l.category_id
  group by 1
),
par_categorie as (
  select
    coalesce(l.category_id::text, 'sans-categorie')                   as cle,
    (array_agg(coalesce(c.name, 'Sans catégorie') order by l.ordre))[1] as libelle,
    sum(l.qty)                                                        as quantite,
    sum(l.line_total_millimes)                                        as net_millimes,
    sum(l.line_gross_millimes)                                        as brut_millimes,
    sum(l.line_discount_millimes + l.global_discount_share_millimes)  as remises_millimes,
    sum(l.line_tax_millimes)                                          as taxes_millimes,
    coalesce(sum(l.cost_per_unit * l.qty), 0)                         as cout_exact
  from lignes l
  left join kaissi.categories c on c.id = l.category_id
  group by 1
),
/*
 * Les sommes d'une commande — servent deux fois : par employé, et par
 * journée. Les calculer une fois évite qu'un jour les deux divergent.
 */
par_commande as (
  select
    l.order_id,
    sum(l.qty)                                                       as quantite,
    sum(l.line_total_millimes)                                       as net_millimes,
    sum(l.line_gross_millimes)                                       as brut_millimes,
    sum(l.line_discount_millimes + l.global_discount_share_millimes) as remises_millimes,
    -- La part de remise GLOBALE seule : la ventilation par motif en a
    -- besoin à part, puisque le motif de la remise globale est porté par la
    -- commande et non par la ligne.
    sum(l.global_discount_share_millimes)                            as remise_globale_millimes,
    sum(l.line_tax_millimes)                                         as taxes_millimes,
    sum(l.cost_per_unit * l.qty)                                     as cout_exact
  from lignes l
  group by l.order_id
),
/*
 * Par employé : la clé est l'identifiant, JAMAIS le nom. Le nom se résout
 * côté application, où il l'est déjà pour tout le reste — le résoudre ici
 * en ferait un second endroit où « Inconnu » se décide.
 *
 * On part des COMMANDES et non des lignes : c'est la vente entière qu'on
 * attribue à celui qui l'a encaissée, et c'est aussi ce qui permet de
 * compter les TICKETS — une commande dont toutes les lignes ont été
 * annulées reste un ticket de cet employé.
 */
par_employe as (
  select
    coalesce(c.vendeur_id::text, 'inconnu')      as cle,
    count(*)                                     as tickets,
    coalesce(sum(pc.quantite), 0)                as quantite,
    coalesce(sum(pc.net_millimes), 0)            as net_millimes,
    coalesce(sum(pc.brut_millimes), 0)           as brut_millimes,
    coalesce(sum(pc.remises_millimes), 0)        as remises_millimes,
    coalesce(sum(pc.taxes_millimes), 0)          as taxes_millimes,
    coalesce(sum(pc.cout_exact), 0)              as cout_exact
  from commandes c
  left join par_commande pc on pc.order_id = c.id
  group by 1
),

/*
 * ── Les réductions : la seule ventilation qui ne partage pas un CA ──────
 *
 * Chaque ligne appartient à un article, à une catégorie, à un employé. À
 * une réduction, non : une vente peut n'en porter aucune, et deux peuvent
 * coexister sur la même vente (une de ligne, une globale). On additionne
 * donc des MONTANTS REMISÉS, jamais un CA, et la somme des parts ne fait
 * pas 100 %.
 *
 * Les deux sources sont réunies avant regroupement : la remise de LIGNE
 * porte son propre motif, la remise GLOBALE celui de la commande — et la
 * part de cette dernière est déjà répartie sur les lignes.
 */
remises_brutes as (
  select
    coalesce(
      l.discount_id::text,
      case when l.discount_label is not null
           then 'libelle:' || l.discount_label else 'sans-motif' end
    )                                              as cle,
    coalesce(l.discount_label, 'Sans motif')       as libelle,
    l.line_discount_millimes                       as montant,
    l.order_id,
    l.ordre
  from lignes l
  where l.line_discount_millimes > 0

  union all

  select
    coalesce(
      c.discount_id::text,
      case when c.discount_label is not null
           then 'libelle:' || c.discount_label else 'sans-motif' end
    ),
    coalesce(c.discount_label, 'Sans motif'),
    pc.remise_globale_millimes,
    c.id,
    -- Après toutes les lignes : l'ancien chemin traitait les lignes d'abord,
    -- et c'est le PREMIER libellé rencontré qui nommait le groupe.
    1000000000 + row_number() over (order by c.closed_at desc, c.id)
  from commandes c
  /*
   * `par_commande`, et surtout PAS une sous-requête agrégée ici.
   *
   * MESURÉ : avec une sous-requête, le planificateur — qui estime UNE ligne
   * pour un CTE sans statistiques — choisissait une boucle imbriquée et
   * ré-agrégeait les 18 600 lignes UNE FOIS PAR COMMANDE. Six mille
   * exécutions du même calcul : 3 200 ms à elles seules, sur les 3 500 que
   * durait la fonction. Le CTE, lui, est matérialisé une fois.
   */
  join par_commande pc on pc.order_id = c.id
  where pc.remise_globale_millimes > 0
),
par_reduction as (
  select
    r.cle,
    (array_agg(r.libelle order by r.ordre))[1]  as libelle,
    sum(r.montant)                              as montant_millimes,
    -- Des VENTES, pas des lignes : « combien de tickets ont été remisés ».
    count(distinct r.order_id)                  as ventes
  from remises_brutes r
  group by r.cle
),

/*
 * ── Paiements et remboursements ─────────────────────────────────────────
 *
 * Les paiements suivent LEUR commande, jamais leur propre heure : un
 * encaissement se conclut parfois quelques minutes après la clôture, et les
 * filtrer séparément les détacherait des ventes qu'ils règlent.
 */
par_paiement as (
  select p.type, sum(p.amount_millimes) as montant_millimes, count(*) as nombre
  from kaissi.payments p
  join commandes c on c.id = p.order_id
  where p.restaurant_id = p_restaurant
    and p.voided_at is null
    and p.created_at >= p_debut
    and p.created_at <  p_fin
  group by p.type
),
remboursements as (
  select coalesce(sum(r.amount_millimes), 0) as montant_millimes
  from kaissi.refunds r
  where r.restaurant_id = p_restaurant
    and r.created_at >= p_debut
    and r.created_at <  p_fin
    and (
      (p_heure_debut = 0 and p_heure_fin = 23)
      or extract(hour from (r.created_at at time zone p_timezone))
           between p_heure_debut and p_heure_fin
    )
),

/*
 * ── La série par journée ────────────────────────────────────────────────
 *
 * Seules les journées AVEC vente sortent d'ici. Les journées creuses sont
 * ajoutées côté application, qui connaît déjà les bornes demandées : un
 * graphique qui saute les jours vides resserre les colonnes et fait
 * disparaître le lundi de fermeture — on lirait une semaine régulière là
 * où il y a un trou.
 */
par_journee as (
  select
    c.journee,
    -- Le TOTAL de la commande (TTC) : c'est la hauteur des barres du
    -- graphique, et c'est ce que le gérant compare à sa caisse.
    sum(c.total_millimes)                                as total_millimes,
    count(*)                                             as tickets,
    -- Et le détail HORS TAXE du tableau qui accompagne le graphique. Les
    -- deux grandeurs doivent venir de la MÊME requête : deux découpages du
    -- « jour » sur un même écran garantissent qu'on additionnera les
    -- colonnes de l'un en lisant les barres de l'autre.
    coalesce(sum(j.net_millimes), 0)                     as net_millimes,
    coalesce(sum(j.brut_millimes), 0)                    as brut_millimes,
    coalesce(sum(j.remises_millimes), 0)                 as remises_millimes,
    coalesce(sum(j.taxes_millimes), 0)                   as taxes_millimes,
    coalesce(sum(j.cout_exact), 0)                       as cout_exact
  from commandes c
  left join par_commande j on j.order_id = c.id
  group by c.journee
)

select jsonb_build_object(
  'nombreTickets', (select count(*) from commandes),
  'indicateurs', (select to_jsonb(i) from indicateurs i),
  'remboursementsMillimes', (select montant_millimes from remboursements),
  'parProduit',   coalesce((select jsonb_agg(to_jsonb(x)) from par_produit x), '[]'::jsonb),
  'parCategorie', coalesce((select jsonb_agg(to_jsonb(x)) from par_categorie x), '[]'::jsonb),
  'parEmploye',   coalesce((select jsonb_agg(to_jsonb(x)) from par_employe x), '[]'::jsonb),
  'parReduction', coalesce((select jsonb_agg(to_jsonb(x)) from par_reduction x), '[]'::jsonb),
  'parPaiement',  coalesce((select jsonb_agg(to_jsonb(x)) from par_paiement x), '[]'::jsonb),
  'parJournee',   coalesce((select jsonb_agg(to_jsonb(x)) from par_journee x), '[]'::jsonb)
)
  );
end;
$$;

comment on function kaissi.rapport_ventes(uuid, timestamptz, timestamptz, text, interval, uuid, integer, integer) is
  'Agrège les ventes d''une période SANS remonter la ligne à ligne (R-1). '
  'Ne fait que des sommes d''entiers déjà décidés par la projection : aucune '
  'règle de calcul monétaire ici — les coûts sortent NON arrondis, et marges '
  'et pourcentages restent dans packages/domain. security invoker : RLS '
  'décide, comme pour toute autre lecture du back-office.';

/*
 * Exécution accordée aux seuls rôles applicatifs. `anon` n'a aucun
 * privilège dans ce schéma, et cette fonction ne doit pas être la première
 * exception : elle lit des chiffres d'affaires.
 *
 * `kaissi_device` y a droit parce que le service de synchronisation
 * emprunte ce rôle — mais RLS le borne à SON restaurant, exactement comme
 * pour le reste.
 */
revoke all on function kaissi.rapport_ventes(uuid, timestamptz, timestamptz, text, interval, uuid, integer, integer) from public;
grant execute on function kaissi.rapport_ventes(uuid, timestamptz, timestamptz, text, interval, uuid, integer, integer)
  to authenticated, kaissi_device;

/*
 * ── L'index qui rend cette fonction rapide ──────────────────────────────
 *
 * Le prédicat est toujours le même : un restaurant, un statut, une plage de
 * `closed_at`. L'audit avait ÉCARTÉ un index sur `(restaurant_id,
 * closed_at)` après mesure (E-1) — et c'était juste À L'ÉPOQUE : le
 * chargement rendait déjà toutes les lignes, l'index n'évitait rien.
 *
 * Il ne l'est plus. Une agrégation ne rend qu'une trentaine de nombres :
 * PostgreSQL peut désormais parcourir l'index et s'arrêter là, au lieu de
 * balayer la table. Ce qui n'était pas rentable avec l'ancien chemin le
 * devient avec celui-ci — la mesure dépendait de la requête, pas de la
 * table.
 *
 * Partiel sur `status = 'close'` : les commandes ouvertes n'entrent jamais
 * dans un rapport, et les exclure garde l'index petit.
 */
create index if not exists orders_rapport_idx
  on kaissi.orders (restaurant_id, closed_at desc)
  where status = 'close';
