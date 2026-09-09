# Audit de production — Kaissi

**Date** : 7–8 septembre 2026 · **Périmètre** : dépôt entier, base de
production, chaîne de déploiement · **Méthode** : mesure, pas impression.

Chaque constat porte le chiffre qui l'a produit. Quand une mesure a contredit
l'hypothèse de départ, c'est la mesure qui est retenue et l'hypothèse qui est
écrite — parce qu'un audit qui ne se trompe jamais est un audit qui n'a rien
essayé.

---

## Résumé — ce qu'on a trouvé, et ce qu'on n'a pas trouvé

| | Constat |
|---|---|
| **Critique** | 2 — tous deux corrigés |
| **Haute** | 4 — tous corrigés |
| **Moyenne** | 6 — 3 corrigés, 3 documentés |
| **Basse / écartée** | 5 — mesurées puis écartées, avec la raison |
| **Reste à faire** | 5 — dont **R-1, le plus rentable, désormais FAIT** |

**Ce qui était déjà solide, et mérite d'être dit.** Un audit qui ne signale
que des défauts donne une image fausse et fait refaire ce qui marche.

- **RLS** : 37 tables, **toutes** avec `ROW LEVEL SECURITY` *et*
  `FORCE ROW LEVEL SECURITY` — le forçage s'applique même au propriétaire de
  la table, ce que la plupart des projets Supabase oublient. **Zéro** politique
  permissive (`using (true)`), **zéro** privilège accordé à `anon`.
- **TypeScript** : `strict` et `noUncheckedIndexedAccess` partout, **un seul**
  `any` dans 47 000 lignes (corrigé), **zéro** `@ts-ignore`.
- **Comparaison de jetons** : déjà en temps constant (`timingSafeEqual`).
- **Poids du JavaScript** : 102–112 ko par page. Rien à optimiser — pas de
  bibliothèque de graphiques, pas de `moment.js`.
- **Contrôle de santé** : `/sante` joint réellement la base, il ne répond pas
  « ok » parce que Node tourne.
- **Analyseur de sécurité Supabase** : un seul avertissement, et c'est un
  réglage de tableau de bord (voir M-4).

---

# CRITIQUE

## C-1 · Aucune limitation de débit sur l'authentification ✅ corrigé

**Le constat.** `POST /appairage` accepte un e-mail et un mot de passe **sans
authentification préalable**, et n'avait aucune limite. C'est le seul endroit
du produit où l'on peut essayer un mot de passe.

**Ce qui rend ce défaut plus grave qu'il n'en a l'air.** Le bourrage
d'identifiants est le risque évident. Le vrai est ailleurs : chacune de nos
tentatives appelle GoTrue, dont **le quota est par projet Supabase** — et
c'est notre serveur qu'il voit. Un attaquant n'avait donc pas besoin de
trouver un mot de passe : saturer suffisait pour que **les vrais gérants ne
puissent plus appairer**. L'endpoint était un amplificateur de déni de
service.

**La correction.** Deux limiteurs, deux dimensions, parce qu'ils arrêtent deux
attaques différentes : par IP contre le balayage depuis une machine, par
adresse e-mail contre le bourrage — où l'attaquant change d'IP mais garde sa
cible. L'un sans l'autre en laisse passer la moitié.

**Ce qui n'est délibérément PAS limité** : `/sync/*`. Une caisse qui rattrape
trois semaines hors ligne envoie des dizaines de lots à la suite ; la freiner
retarderait des encaissements déjà faits. Le jeton d'appareil fait 32 octets
aléatoires — il n'y a rien à protéger contre la force brute. *L'encaissement
ne doit jamais s'arrêter* vaut aussi contre nos propres garde-fous, et c'est
le test le plus important du fichier.

**Deux défauts trouvés dans le correctif lui-même**, avant qu'il ne parte :
le limiteur devenait O(n log n) **par requête** une fois son plafond atteint —
sous l'attaque qu'il devait absorber (8 s pour 25 000 clés → 54 ms) ; et il
utilisait une propriété de paramètre, que le *type stripping* de Node refuse,
donc **le service n'aurait pas démarré**.

> **Limite connue et assumée** : le compteur est en mémoire, donc par
> processus. Avec plusieurs instances, un attaquant obtient N fois le quota.
> Le jour du passage à l'échelle horizontale, il doit descendre dans Postgres
> ou Redis. Un limiteur qu'on croit distribué sans l'être est pire que pas de
> limiteur, parce qu'on cesse de regarder.

## C-2 · Rapports non bornés — 73 000 lignes dans une lambda ✅ corrigé

**Mesuré**, sur un jeu réaliste de 200 ventes/jour :

```
Rapport annuel : 73 000 commandes rendues
Tri PostgreSQL : external merge, Disk: 4144 kB
Lignes         : ~220 000, tirées en 365 requêtes SÉQUENTIELLES
```

Dans une fonction serverless, ce n'est pas une page lente : c'est une **erreur
500 sans explication**, sur l'écran des chiffres d'affaires. Et le calendrier
ajouté juste avant cet audit rend cette période accessible en deux clics — le
déclencheur avait été rendu facile sans que le coût soit mesuré.

**Trois corrections.** Les tranches partent **six de front** (pas trois cents :
`Promise.all` sur toutes épuiserait le pool de connexions du projet et ferait
échouer les autres écrans). Un plafond de **50 000 commandes**. Et surtout le
drapeau `tronque`.

**Le point qui compte.** Une fois le plafond posé, le vrai risque devient
**tronquer en silence** : un chiffre d'affaires amputé ressemble exactement à
un chiffre d'affaires complet, ne déclenche aucun soupçon, et part chez le
comptable. Les huit écrans affichent donc une bannière **avant** les totaux,
et l'export **refuse** (413) plutôt que de livrer un fichier amputé — un
fichier quitte l'application, il n'a plus de bannière pour se contredire.

> **Le premier plafond choisi (20 000) a été refusé par son propre test** :
> un établissement ordinaire fait 55 ventes/jour, soit 20 075 par an, et se
> serait heurté au plafond sur son bilan annuel. Une limite qui gêne tout le
> monde n'est pas un garde-fou.

**Ce plafond était un garde-fou, pas une architecture — et R-1 l'a remplacé.**
Depuis la migration `0033`, sept écrans sur neuf ne chargent plus aucune ligne
et n'ont donc plus rien à tronquer. Le plafond et sa bannière ne subsistent
que sur les deux écrans qui affichent une **liste** de tickets, où une ligne
écrite est une ligne lue.

---

# HAUTE

## H-1 · Aucun en-tête de sécurité ✅ corrigé

Le back-office n'envoyait **rien** : ni HSTS, ni CSP, ni `X-Frame-Options`. Il
était encadrable dans une iframe — donc détournable au clic — et son
navigateur n'avait aucune consigne sur ce qu'il avait le droit de charger.

Posés : HSTS (2 ans, sous-domaines, preload), `nosniff`, `X-Frame-Options:
DENY`, `Referrer-Policy` (nos URL contiennent l'identifiant d'établissement et
les filtres — les laisser partir dans un `Referer`, c'est publier qui consulte
quoi), `Permissions-Policy`, COOP, et `poweredByHeader: false`.

**La CSP porte un nonce renouvelé à chaque réponse**, posé par le middleware :
une valeur écrite dans la configuration serait constante, donc devinable, donc
exactement aussi utile que `'unsafe-inline'`.

Elle ne remplace pas RLS, **elle échoue différemment** : RLS empêche un client
de *lire* les données d'un autre ; la CSP empêche du script injecté de
s'exécuter *dans la session* d'un gérant légitime — à qui RLS rendrait
volontiers tout ce qui lui est dû.

**Vérifié dans un vrai navigateur**, en mode développement *et* en mode
production : zéro violation, hydratation vivante, page identique. Une CSP
qu'on n'a pas chargée dans un navigateur est une hypothèse.

## H-2 · Aucune frontière d'erreur ✅ corrigé

Ce qu'un client a vu en production :

> Application error: a server-side exception has occurred (see the server logs
> for more information). Digest: 857891440

En anglais, sans issue, sans bouton — et « voir les journaux du serveur »
s'adresse à quelqu'un qui n'est pas là.

Trois écrans ajoutés. Le principal dit, dans cet ordre : que **les données ne
sont pas perdues** — la première inquiétude devant une caisse cassée —, ce
qu'on peut faire tout de suite, puis le code à donner au support.
`global-error.tsx` ne dépend d'**aucune** feuille de style : c'est précisément
le CSS qui peut manquer.

## H-3 · `pnpm lint` était un no-op ✅ corrigé

`turbo run lint` sur huit paquets dont **aucun** ne définissait de script
`lint`, et pas une ligne de configuration ESLint dans le dépôt. Le monorepo
n'avait **aucun** linter.

Les règles retenues correspondent chacune à une panne réelle d'ici :

- **`no-floating-promises`** — le bouton « Suspendre » appelait son action
  sans lire ce qu'elle rendait ; quand elle échouait, il ne se passait *rien*
  à l'écran. La règle a trouvé la **même classe de défaut à deux endroits
  encore ouverts** : « Nouvelle commande » sur la caisse et « Tester » dans
  Diagnostic.
- **`parameter-properties` / `enum` / `namespace`**, portés sur `apps/sync`
  seulement — la contrainte du *type stripping* qui aurait empêché le service
  de démarrer.

> **Le premier passage rendait 186 signalements.** Ce n'est pas un résultat,
> c'est un linter qu'on désactive au bout d'une semaine — et ce jour-là on
> perd aussi les règles utiles. 143 venaient de trois règles de style sans un
> seul bogue derrière. Éteintes, avec la raison écrite. Reste **0 erreur**.

## H-4 · CI sans audit de dépendances ni scan de secrets ✅ corrigé

Deux jobs ajoutés. Le scan de secrets porte sur l'**historique complet** : un
secret commité puis retiré reste dans les objets git, et c'est celui-là qu'on
cherche.

L'audit a d'abord été écrit en `--prod`. **Vérifié : dans un monorepo pnpm,
`--prod` ne filtre pas** — la CI aurait été rouge dès le premier jour sur
quatre alertes `postcss` non exploitables. Il passe donc par
`pnpm.auditConfig.ignoreGhsas`, où chaque avis écarté porte **sa raison et sa
date de revue**. Ce n'est pas une liste d'exceptions, c'est la trace d'une
décision : tout avis non listé fait échouer la construction.

---

# MOYENNE

## M-1 · Journalisation non structurée ✅ corrigé

16 `console.*` en texte libre, indistinguables du reste sur un tableau de bord
d'hébergeur : ni filtre par niveau, ni suivi d'une requête, ni comptage.

Remplacés par du JSONL. Ce qui compte n'est pas le format mais **ce qui ne
doit pas y entrer** : un journal finit chez un hébergeur, dans un agrégateur,
parfois collé dans un ticket. Le masquage porte sur le **nom du champ**, en
profondeur — une expression régulière sur la valeur laisserait toujours passer
le format non prévu. Profondeur **bornée**, parce qu'une erreur `pg` porte sa
connexion qui se porte elle-même, et une trace qui tue le processus est pire
que la panne qu'elle décrit.

## M-2 · Le dernier `any` ✅ corrigé

`versEvenement(r: any)`, sur le chemin de la synchronisation. Il désactivait
le compilateur là où une faute de frappe dans un nom de colonne ne se voit
qu'en production : l'événement se construit avec un champ `undefined`, la
projection l'écrit, et la vente est fausse **sans que rien n'échoue**.

## M-3 · `users` lue sans filtre par les rapports ⚠ documenté

`chargerVentes` fait `from('users').select('id, full_name')` **sans `where`**
— c'est RLS qui borne. Ce n'est pas une fuite (le pire cas est une page vide,
c'est tout l'intérêt de la clé publique), mais c'est non borné : à 5 000
restaurants, un gérant multi-établissements charge tous les employés de son
organisation à chaque rapport.

**Non corrigé délibérément** : la correction demande de restreindre à
`restaurant_id`, ce qui changerait le comportement de l'écran « Employés » qui
dépend de la portée large.

**Fortement atténué par R-1.** Les rapports ne lisent plus `users` pour
NOMMER chaque ligne — l'agrégat SQL ne rend qu'un identifiant d'employé, et un
seul chargement de noms sert tout l'écran. La lecture non bornée subsiste, sa
fréquence a chuté.

## M-4 · Protection « mot de passe compromis » désactivée ⚠ action requise

Seul avertissement de l'analyseur de sécurité Supabase. Il ne se corrige pas
par une migration : **Supabase → Authentication → Policies → activer *Leaked
password protection***. Supabase vérifie alors les mots de passe contre
HaveIBeenPwned au moment de leur choix.

Coût : zéro. À faire.

## M-5 · Aucune rétention sur les journaux ⚠ documenté

`change_log`, `order_events`, `sync_mutations` et `audit_events` grossissent
sans limite. Seuls les marqueurs `kitchen_ready` sont purgés (7 jours).

Ce n'est **pas** un défaut à corriger aveuglément : `order_events` est la
source de vérité, il ne se purge jamais ; `audit_events` est chaîné par hash,
une purge casserait la chaîne. Le seul candidat réel est `sync_mutations`,
dont l'utilité expire une fois l'événement projeté — mais il porte
l'idempotence, donc la purge doit être plus longue que la plus longue
déconnexion plausible (recommandation : **90 jours**).

## M-6 · Aucun collecteur d'erreurs ⚠ recommandé

Pas de Sentry ni d'OpenTelemetry. `error.tsx` porte déjà le point de
branchement (le `useEffect` qui journalise le digest). Recommandation :
`@sentry/nextjs` sur le back-office, avec `tracesSampleRate` bas — le budget
d'un projet à ce stade se dépense en volume de traces sans qu'on s'en
aperçoive.

---

# MESURÉ PUIS ÉCARTÉ

Cette section existe parce qu'un audit doit aussi dire ce qu'il **ne faut
pas** faire. Chaque ligne ci-dessous a été mesurée, et le changement n'a pas
été retenu.

## E-1 · Index sur `orders(restaurant_id, closed_at)` — écarté

**L'hypothèse** : tous les rapports filtrent sur `closed_at`, et le seul index
de date porte sur `opened_at`. Un index manquant, évident.

**La mesure**, sur un million de commandes réparties sur 5 000 restaurants :

```
sans index closed_at : 204 buffers, 0,497 ms
avec index closed_at : 204 buffers, 0,462 ms   (index : 38 Mo)
```

**Écarté.** `(restaurant_id, opened_at)` narrows déjà à quelques centaines de
lignes, et c'est la lecture du tas qui domine. 38 Mo d'index et un coût
d'écriture sur le chemin de l'encaissement, pour du bruit de mesure.

## E-2 · Fusion des politiques permissives multiples — écarté

L'analyseur Supabase la signale sur **18 tables**. Mesuré sur 50 000
produits :

```
deux politiques permissives : 3,569 ms
une seule politique         : 3,552 ms
```

**Écarté.** Réécrire dix-huit politiques de sécurité — le cœur du
cloisonnement entre clients — pour zéro gain mesurable est un mauvais échange.
On ne touche pas à la sécurité parce qu'un outil le suggère.

## E-3 · `(select auth.uid())` — appliqué, mais pas pour la performance

```
auth.uid() nu          : 3,628 ms  (40 000 lignes)
(select auth.uid())    : 3,492 ms
```

4 % — dans le bruit. `auth.uid()` est `stable`, donc PostgreSQL met déjà son
résultat en cache : le « une fois par ligne » de l'analyseur décrit le *plan*,
pas le coût réel.

**Appliqué quand même** (migration 0032), pour une autre raison : l'analyseur
doit rester **lisible**. Un avertissement permanent qu'on a décidé d'ignorer
enterre celui qui, un jour, comptera vraiment. Deux politiques, prédicat
identique, risque nul.

## E-4 · Les 86 clés étrangères non indexées — écarté

Une FK non indexée coûte à la **suppression du parent** et sur les jointures
dans ce sens. Kaissi ne supprime presque rien — `archived_at` partout — et les
jointures chaudes sont déjà couvertes. Ajouter 86 index ralentirait chaque
`INSERT`, c'est-à-dire **le chemin de l'encaissement**, pour un gain nul.

## E-5 · Les 4 vulnérabilités `postcss` — non exploitables

Sévérité *high*, mais : dépendance de **développement** uniquement
(`vite` → `vitest`), jamais livrée, et l'exploitation demande de faire traiter
à postcss du CSS fourni par un attaquant au moment du build — le nôtre est
dans le dépôt. Inscrites dans `auditConfig` avec cette raison et une date de
revue.

---

# CE QUI RESTE — par ordre de valeur

## R-1 · Agréger les rapports EN SQL ✅ FAIT

*Migration `0033`, commit du 9 septembre 2026 — appliquée en production.*

Le plafond de 50 000 commandes était un garde-fou, pas une architecture.
`kaissi.rapport_ventes()` fait désormais les sommes **là où sont les lignes**
et rend quelques kilo-octets de JSON. Sept écrans sur neuf ne chargent plus
aucune ligne ; le plafond et sa bannière ne concernent plus que les deux qui
affichent une **liste** de tickets — où une ligne écrite est bien une ligne
lue.

**La règle 7 tient**, parce que règle et somme ne sont pas la même chose. Une
règle est une décision (arrondir la TVA par taux puis sommer, répartir la
remise globale au prorata, rapporter la marge au CA, n'arrondir les coûts
qu'une fois au total) : aucune n'est en SQL. Une somme d'entiers déjà décidés
n'en est pas une. Trois précautions le rendent vérifiable : les coûts sortent
**non arrondis** (`numeric` exact — plus précis que l'ancien flottant), aucun
pourcentage n'est calculé en SQL, et un test compare les **deux chemins** au
millime sur un jeu de ventes hostile. Sabotage vérifié : retirer le filtre des
lignes annulées fait tomber 4 tests, supprimer la bascule de journée en fait
tomber 2.

**Ce que le banc a trouvé et que la relecture n'aurait jamais vu.** Écrite en
`language sql`, la fonction mettait **27 300 ms** sur 92 jours — la même
requête avec des dates littérales en mettait 175. PostgreSQL ne connaît pas
les bornes quand il planifie un corps de fonction : il estime une commande,
choisit des boucles imbriquées, et rebalaye un CTE de 18 000 lignes une fois
par commande.

`plan_cache_mode = 'force_custom_plan'` le corrige — mais ce réglage n'a
**aucun effet** sur une fonction `language sql`, d'où le `plpgsql`. Mesuré
après : **380 ms**, soit 70×. Le symptôme en production aurait été le pire qui
soit : correct en démonstration, et de plus en plus lent chez le client qui
vend le plus. Deux tests figent la déclaration.

L'index `(restaurant_id, closed_at)` **écarté** par E-1 est créé ici : la
mesure d'alors était juste, mais portait sur une requête qui rendait déjà
toutes les lignes. *Une décision de performance est datée par la requête
qu'elle sert.*

**Supprime C-2 et le plafond ; M-3 devient sans objet** sur les écrans agrégés.

Le raisonnement complet est dans
[`docs/system-design.md`](system-design.md) §17 bis et §17 ter.

## R-2 · Limiteur de débit distribué

Quand le service passera à deux instances. Table Postgres avec `insert … on
conflict` sur une fenêtre, ou Redis.

## R-3 · Sentry + Speed Insights

Voir M-6.

## R-4 · Purge de `sync_mutations` à 90 jours

Voir M-5.

## R-5 · Tests d'accessibilité

Aucun contrôle automatique aujourd'hui. La colonne de navigation porte déjà
`aria-current` et `aria-label` ; le calendrier a `role="dialog"` et des
libellés complets. Un passage `axe-core` dans le parcours Playwright existant
coûterait peu et figerait l'acquis.

---

# Réponses courtes aux points de la revue

| Domaine | État | Détail |
|---|---|---|
| Architecture | **solide** | Voir `system-design.md`. Contrainte dominante identifiée, patrons cohérents. |
| Multi-tenance | **solide** | `organization_id` + `restaurant_id` partout, RLS forcée sur 37 tables. |
| Autorisation | **solide** | RLS entre clients, garde applicative entre écrans — les deux, parce qu'ils protègent de choses différentes. |
| Authentification | **corrigé** | Trois identités distinctes, jetons en temps constant, limitation de débit ajoutée (C-1). |
| Sécurité HTTP | **corrigé** | H-1. |
| Injection SQL | **hors risque** | Requêtes paramétrées partout ; PostgREST côté back-office. Aucune concaténation trouvée. |
| XSS | **hors risque** | React échappe par défaut, aucun `dangerouslySetInnerHTML` dans le dépôt. CSP en seconde couche. |
| CSRF | **hors risque** | Server Actions de Next 15 (vérification d'origine intégrée) ; le service de sync est sans cookie, donc sans autorité ambiante. |
| Redirection ouverte | **déjà traité** | `destinationSure()` n'accepte qu'un chemin interne. |
| Téléversement | **sans objet** | Un seul import CSV, borné à 1 Mo, jamais écrit sur disque. Aucun bucket de stockage utilisé. |
| Poids du JS | **solide** | 102–112 ko. Rien à faire. |
| Rendu Next.js | **correct** | `force-dynamic` sur les écrans de données — juste : un rapport mis en cache serait faux. |
| SEO | **sans objet** | Application entièrement derrière authentification. |
| Base de données | **solide** | Index pertinents, contraintes présentes, `numeric` pour les quantités, entiers pour l'argent. |
| Tests | **solide** | 592 tests, dont 239 contre un vrai PostgreSQL et un parcours navigateur complet. Manque : accessibilité (R-5). |
| CI/CD | **corrigé** | 10 jobs. Manque : déploiements de prévisualisation. |
| Journalisation | **corrigé** | M-1. |
| Supervision | **manquant** | M-6. |
| Documentation | **solide** | 12 documents, à jour, avec les raisons. |

---

## Note de méthode

Quatre hypothèses de départ ont été **contredites par la mesure** : l'index
manquant sur `closed_at`, la fusion des politiques RLS, l'évaluation par ligne
d'`auth.uid()`, et les clés étrangères non indexées. Toutes paraissaient
évidentes ; aucune ne tenait au banc d'essai.

C'est la raison d'être de ce document. Un audit qui liste les bonnes pratiques
non appliquées produit du travail ; un audit qui mesure produit des décisions —
y compris celle de ne rien faire, qui est souvent la plus difficile à défendre
et la plus rentable.
