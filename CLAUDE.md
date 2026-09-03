# Kaissi — conventions du dépôt

POS et gestion de restaurant **offline-first** pour le marché tunisien, sous la
marque **Res2Boost** (même famille que Stampi et Box).

La caractéristique qui définit techniquement ce produit n'est pas la richesse
fonctionnelle : c'est que **l'encaissement ne doit jamais s'arrêter**. Tout le
reste — stock, recettes, CRM, reporting — est un logiciel de gestion classique.
C'est l'offline qui rend ce projet difficile, et c'est lui qui doit piloter
chaque décision technique.

---

## Les huit règles absolues

Elles ne se contournent pas silencieusement. Si l'une d'elles paraît fausse dans
un contexte donné, **dis-le avant de coder**.

### 1. Argent : entiers de millimes, jamais de flottant

Le dinar tunisien a **trois** décimales, pas deux. `24,500 TND = 24500 millimes`.

- Colonnes suffixées `_millimes`, type `bigint` en Postgres, `INTEGER` en SQLite.
- Taux en **points de base entiers** : 19 % = `1900`. Jamais `0.19`.
- Seule exception : les **coûts unitaires**, en `numeric(18,6)`. Le coût d'un
  gramme de mozzarella est inférieur au millime ; l'arrondi ne se fait qu'au total.
- Quantités de stock : `numeric`, jamais entier (0,25 kg existe).
- Toute conversion depuis ou vers une écriture décimale passe **exclusivement**
  par `depuisDecimal` / `formaterTND` de `@kaissi/domain`.

Le piège classique : une bibliothèque qui suppose « centimes = ×100 » produit des
erreurs d'arrondi silencieuses qui n'apparaissent qu'après des mois de production.

### 2. Identifiants : UUIDv7 générés côté client

Toute entité créable hors ligne reçoit son identifiant de **l'appareil**, jamais
du serveur. Une tablette doit pouvoir ouvrir une commande sans réseau.
UUIDv7 est triable par le temps : pas de fragmentation d'index.
**Jamais de `serial`** sur ces entités.

### 3. Tenance : `organization_id` ET `restaurant_id` partout

Sur presque chaque table, **même quand c'est redondant**. C'est la future clé de
sharding, et cela rend les politiques RLS simples et vérifiables sans jointure.
L'ajouter après coup sur 40 tables et 500 millions de lignes est un chantier de
plusieurs mois ; l'ajouter maintenant coûte vingt minutes.

### 4. Curseur de synchronisation : un bigserial serveur

`change_log.seq` et `order_events.server_seq`. **Jamais un timestamp.** Les
horloges des tablettes dérivent, sont réglées à la main et changent de fuseau ;
un curseur temporel perdrait des événements sans qu'on sache jamais lesquels.

### 5. Idempotence : index unique sur l'identifiant d'événement

`sync_mutations.event_id` et `order_events.event_id` sont des clés primaires.
Le même événement renvoyé cinq fois n'est inséré qu'une fois. C'est **la** garantie
« jamais de double encaissement ». Sans elle, tout l'édifice tombe.

### 6. Immuabilité : `order_events` et `audit_events` en insertion seule

`REVOKE UPDATE, DELETE` **et** un déclencheur de blocage — le REVOKE seul ne
protège pas du propriétaire de la table. Le journal d'audit est chaîné par hash :
supprimer ou modifier une ligne casse la chaîne et devient détectable.

> **Une annulation n'efface jamais rien.** Elle ajoute un événement d'annulation.
> L'état visible change ; l'historique ne perd jamais d'information.

### 7. Les totaux se calculent à UN SEUL endroit

`packages/domain`, importé à l'identique par le POS et par le serveur. Dupliquer
cette logique produit des écarts de caisse impossibles à expliquer au client.

L'ordre de calcul est **figé** (`packages/domain/src/totaux.ts`) :

```
1. ligne_brute    = (prix_base + Σ modificateurs) × quantité
2. sous_total     = Σ ligne_brute
3. remise_ligne   AVANT la remise globale
4. remise_globale répartie AU PRORATA sur les lignes
                  ⚑ sans répartition, la TVA par taux est fausse
5. base_taxable   regroupée PAR TAUX
6. tva            = arrondi(base × tauxBp / 10000) — ARRONDI PAR TAUX,
                    puis somme. Jamais l'inverse.
7. service        sur la base après remises
8. total          = base + tva exclusive + service + timbre
9. rendu          = versé − total
10. écart d'arrondi de répartition → dernière ligne, sans jamais rendre
    une base négative
```

Les étapes **4** et **6** sont les deux sources d'écart les plus fréquentes en
production. Elles sont couvertes par des tests exhaustifs ; ne les modifie pas
sans en ajouter.

### 8. Français

Commentaires de code, messages d'erreur, libellés d'interface, messages de
commit, titres de PR : **en français**. Les identifiants de code (noms de
fonctions, de variables) le sont aussi, sauf les noms de colonnes SQL qui
restent en anglais par convention SQL et pour rester lisibles par les outils.

---

## Architecture — ce qui n'est pas négociable

### Le POS est EMPAQUETÉ dans l'APK

**Jamais** de `server.url` dans `capacitor.config.ts`. **Jamais** de TWA
Bubblewrap.

Le pattern Stampi / Box (coque Capacitor qui charge un site distant) est
*disqualifiant* ici : quand Internet tombe, la WebView n'a plus rien à charger
et l'application ne s'ouvre même pas. Ce n'est pas un problème de données —
c'est que le code de l'application lui-même viendrait du réseau.

La CI vérifie ce point à chaque PR (`apps/pos/scripts/verifier-mode-avion.mjs`).

### Aucun Server Component ni Server Action sur le chemin de la caisse

Ajouter un article doit rester sous les 50 ms. Chaque aller-retour serveur rend
la caisse inutilisable en service, et impossible hors ligne. Next.js est réservé
au **back-office**, où il est le bon outil.

### Les commandes sont un journal d'événements, pas des lignes mutables

`order_events` est la source de vérité. `orders` et `order_items` en sont des
**projections**, reconstruites par `packages/domain`.

Les événements additifs **commutent** : deux tablettes hors ligne qui ajoutent
chacune un article à la table 12 produisent une commande à trois articles, sans
le moindre conflit. C'est ce qui fait disparaître 90 % des conflits au lieu de
les arbitrer.

Pour la minorité de champs réellement conflictuels — numéro de table, statut,
nom du client — dernier-écrivain-gagne arbitré par `(server_seq, device_id)`,
et l'ancienne valeur reste visible dans le journal.

### Périmètre MVP : l'impression est éteinte, pas supprimée

`apps/pos/src/config.ts` porte `IMPRESSION_ACTIVE`, faux par défaut. Tant
qu'il l'est : rien n'entre en file, la boucle de drainage ne tourne pas, le
ticket client et le bon de cuisine s'affichent À L'ÉCRAN, et la cuisine lit
ses commandes au back-office (`/‹resto›/cuisine`).

Le module d'impression reste **écrit, testé et importé** —
`pnpm pos:build:impression` le rallume (ou `pos:build:web:impression`).
N'en supprime aucune partie « puisqu'elle ne sert pas » :
les règles ci-dessous restent celles qui s'appliqueront le jour où on la
rallume, et `kitchen_sends` est déjà utilisé aujourd'hui.

Le POS a par ailleurs deux cibles de build. `android` (défaut) reste la cible
nominale ; `web` sert le même bundle comme site statique, avec SQLite persisté
dans IndexedDB — plus rapide à déployer, mais son stockage est évinçable par
le navigateur, ce que l'écran Diagnostic dit explicitement. Aucune des deux ne
charge son code depuis le réseau : la règle `server.url` reste entière.

### L'impression ne bloque jamais la caisse

Un ticket part en **file persistante**, pas directement à l'imprimante. Une
imprimante éteinte n'empêche pas d'encaisser le client suivant : elle allume
un badge rouge que le serveur voit. La file survit au redémarrage, réessaie
seule, et ne supprime **jamais** un travail — un ticket qui disparaît en
silence est exactement ce qu'il ne faut pas.

Un bon de cuisine n'est jamais réimprimé : `kitchen_sends` retient ce qui est
déjà parti, sinon la cuisine referait les plats déjà servis.

### Le PIN trace, il ne protège pas

Un PIN à quatre chiffres n'a que 10 000 combinaisons. Il répond à « QUI a
fait cette action », pas à « qui a le droit d'entrer ». Ce qui protège
l'argent, c'est le jeton d'appareil révocable, RLS, et le journal d'audit.

### Le stock n'est jamais autoritaire hors ligne

L'appareil affiche le dernier stock connu, alerte, **mais ne bloque jamais une
vente**. Refuser de vendre une pizza sur une donnée périmée est le pire des deux
mondes.

Corollaire de conception (migration 0019) : le stock est **calculé à la
lecture** — comptage de référence + mouvements manuels − ventes depuis ce
comptage — et jamais maintenu par un compteur qu'un déclencheur décrémenterait.
La reprojection serveur réécrit toutes les lignes d'une commande (`DELETE`
puis `INSERT`) à chaque nouvel événement : un compteur devrait défaire
exactement ce qu'il a fait, y compris quand la commande passe « annulée »
entre les deux. Il dériverait en silence.

### Les marges se calculent dans `packages/domain`, sur le CA hors taxe

`marge.ts` porte les coûts et les marges, comme `totaux.ts` porte la TVA. Deux
règles à ne pas contourner : la marge se rapporte au **CA** (5/15 = 33,33 %,
jamais 5/10), et le CA retenu est **hors taxe et après remises** — la seule
grandeur comparable à un coût d'achat, lui aussi hors taxe.

Un coût **non saisi** n'est pas un coût nul : les rapports comptent ces lignes
et le disent. Sans ce garde-fou, la marge s'afficherait à 100 % et paraîtrait
juste.

### Un compte de back-office se relie hors de l'application

Créer un compte Supabase exige la clé `service_role`, qui contourne RLS : elle
n'entre donc jamais dans le back-office. Le premier administrateur, et toute
personne qui doit ouvrir le back-office ensuite (cuisine, comptable), passent
par `pnpm sync:acces`, qui tourne sur le poste de l'exploitant avec la
connexion PostgreSQL.

Corollaire à ne pas oublier : **RLS ne dit pas qui je suis dans mon propre
restaurant.** `memberships_lecture` rend, à dessein, toutes les appartenances
de mes établissements — l'écran « Employés » en dépend. Une requête sur
`memberships` sans `where user_id = moi` ne rend donc pas mon rôle, mais ceux
de toute l'équipe. Ce filtre-là est applicatif, par nature.

### Trois identités distinctes, jamais confondues

| Identité | Mécanisme | Portée |
|---|---|---|
| **Utilisateur** | Supabase Auth, e-mail + mot de passe | Back-office |
| **Appareil** | Jeton long, révocable, lié au `device_id` | `/sync` |
| **Employé** | Code PIN validé **hors ligne** (Argon2id) | Qui agit sur le terminal |

Un serveur en salle change cinq fois par service ; la tablette reste
authentifiée en continu. Confondre les deux mène soit à des reconnexions
permanentes, soit à une traçabilité inexistante.

**La remise en service d'un terminal ne crée jamais un terminal de plus.**
Le POS conserve un `installation_id` dans sa base locale et l'envoie à
l'appairage ; le serveur reconnaît l'installation et rend le MÊME appareil —
même préfixe de tickets, jeton simplement renouvelé (migration 0021). Sans
cela, les événements déjà en attente dans l'outbox portent l'ancien
`device_id` et sont refusés « appareil_etranger » : un rejet ne se réessaie
jamais tout seul, donc ces ventes n'arrivent JAMAIS. Une révocation, elle,
reste définitive : l'index unique est partiel sur `revoked_at is null`.

L'adresse du serveur de synchronisation vit dans `apps/pos/deploiement.json`,
versionnée, lue à la fois par `vite.config.ts` et par la garde du mode avion.
Le gérant n'a donc rien d'autre à saisir que son e-mail et son mot de passe.
Ce n'est pas un `server.url` : aucun code ne vient de cette adresse.

---

## Arborescence

```
kaissi/
├─ apps/
│  ├─ pos/          Vite + React + TS → Capacitor Android. EMPAQUETÉ.
│  ├─ backoffice/   Next.js App Router → Vercel
│  └─ sync/         API de synchronisation (Hono sur Node) — Phase 2
├─ packages/
│  ├─ domain/       ⚑ LE CŒUR : monnaie, TVA, remises, réduction
│  │                d'événements. 100 % pur, zéro I/O, testé.
│  ├─ db-local/     Schéma SQLite miroir + migrations locales versionnées
│  ├─ sync-client/  Outbox, curseurs, retentatives — Phase 2
│  ├─ printing/     Rendu ESC/POS + file d'impression
│  └─ ui/           Jetons de style partagés
└─ supabase/
   └─ migrations/   Schéma Postgres, RLS, fonctions
```

Les paquets sont consommés **en source TypeScript** (`main: src/index.ts`), pas
en `.d.ts` compilés : leur script `build` n'est donc qu'une vérification de types.

---

## Commandes

```bash
pnpm install                    # installer le monorepo
pnpm test:rapide                # domaine + schéma local + ESC/POS (aucun prérequis)
pnpm test                       # tout, synchronisation comprise (exige pnpm db:test)
pnpm typecheck                  # types de tout le monorepo
pnpm --filter @kaissi/domain test --watch   # boucle rapide sur les calculs

pnpm pos:dev                    # POS dans le navigateur (base EN MÉMOIRE)
pnpm pos:build                  # build + vérification du mode avion
pnpm pos:android                # build + sync + lancement sur appareil

pnpm backoffice:dev             # back-office Next.js (exige .env.local)

# Rejoue une journée de service dans un navigateur : prise de poste, shift,
# commande, envoi cuisine, remise escaladée, encaissement, clôture.
pnpm --filter @kaissi/pos test:parcours

# Tests de synchronisation — exigent un vrai PostgreSQL.
# pnpm db:test le prépare : base jetable + migrations de production telles quelles.
pnpm db:test && pnpm --filter @kaissi/sync test && pnpm db:test:stop

# Le plugin Java d'impression compile — un JDK suffit, aucun SDK Android
pnpm verifier:natif

# Appairer un terminal en ligne de commande — DÉPANNAGE seulement.
# En clientèle, le gérant saisit ses identifiants sur la tablette : le jeton
# ne se recopie plus à la main (POST /appairage).
node apps/sync/scripts/appairer.mjs --restaurant <uuid> --prefixe P1
```

---

## Back-office — la clé publique, et rien d'autre

`apps/backoffice` n'utilise **que** la clé publique de Supabase, avec la session
de l'utilisateur connecté. Toutes ses requêtes passent donc par RLS.

Ce n'est pas une commodité. Avec `service_role`, le cloisonnement entre
restaurants reposerait sur la vigilance de chaque `where restaurant_id = …`
écrit à la main, et un seul oubli rendrait les données d'un autre client. Avec
la clé publique, un `where` oublié ne rend **aucune** ligne : le pire cas est
une page vide, pas une fuite. Un contrôle au démarrage refuse la clé de
service, et une garde de CI l'interdit dans tout le dépôt.

Deux conséquences pratiques :

- Le schéma `kaissi` est exposé à PostgREST (migration 0012). C'est la
  « décision explicite » que le socle appelait ; `public` reste vide, et
  `anon` n'a **aucun privilège**.
- Une migration qui renomme une colonne utilisée par le back-office doit
  passer par `apps/backoffice/src/serveur/schema.ts`, écrit à la main. Le
  générateur de types de Supabase ne sort que `public`, qui est vide ici. Ce
  fichier dit noir sur blanc de quelles colonnes le back-office dépend — et
  une colonne renommée casse la compilation au lieu de casser la production.

Server Components et Server Actions y sont les bienvenus : personne n'encaisse
dans un back-office. Sur le chemin de la caisse, ils restent interdits.

---

## Migrations

### Postgres (`supabase/migrations/`)

Numérotées, jamais modifiées après application. Chaque migration qui crée une
table **doit** activer RLS dans le même fichier — utilise
`kaissi.protege_referentiel()` ou `kaissi.protege_transactionnel()`, qui posent
le jeu complet de politiques et garantissent qu'aucune table n'existe sans RLS.

### SQLite (`packages/db-local/src/migrations/`)

Le SQL est un **littéral TypeScript**, empaqueté dans l'APK. Jamais un fichier
téléchargé : une migration qui a besoin du réseau ne s'applique pas en mode avion.

- Une migration publiée ne se modifie **jamais** — on en ajoute une nouvelle.
- Versions contiguës et croissantes, vérifiées par `verifierRegistre()`.
- Chaque migration s'applique dans **une** transaction : une migration à moitié
  appliquée sur la tablette d'un restaurant à Sfax n'est pas réparable à distance.
- Reste **additive** tant que le protocole de sync supporte N−2 : ajouter une
  colonne, jamais en supprimer une que l'ancienne version écrit encore.

---

## Ce qu'il ne faut surtout pas faire

- Reproduire le pattern Stampi (`server.url`) ou une TWA Bubblewrap.
- Mettre une Server Action sur le chemin de la caisse.
- Synchroniser des lignes mutables plutôt que des événements.
- Utiliser un flottant pour de l'argent, ou supposer deux décimales.
- Utiliser un timestamp comme curseur de synchronisation.
- Bloquer une vente sur une donnée de stock périmée.
- Exposer la clé `service_role` de Supabase côté client. Le POS n'a que son
  jeton d'appareil.
- Faire tourner un rapport lourd sur la base transactionnelle en heure de pointe.
- Repousser RLS ou l'audit : ce sont des fondations, pas des fonctionnalités.

---

## Points à valider avec un expert-comptable tunisien

Ils sont marqués `⚠` dans le code et les migrations. **Ne les affirme jamais
depuis la documentation** — ce sont des paramètres réglementaires qui évoluent,
et une erreur expose commercialement :

- les taux de TVA applicables à la restauration ;
- le traitement du droit de timbre sur les factures ;
- les règles de numérotation séquentielle des factures ;
- l'existence éventuelle d'une obligation de certification de caisse.

Le modèle de données est conçu pour les accueillir (`tax_rates` paramétrable,
`fiscal_number` attribué côté serveur) — mais la règle exacte doit venir d'un
professionnel.

---

## Jalon de décision — moteur de synchronisation : TENU

La règle avait été écrite à l'avance :

> Si, à la fin de la **Phase 2**, la synchronisation n'est pas fiable en test
> avec **trois appareils** et des coupures réseau simulées, on bascule sur
> **PowerSync** sans débat.

Le banc (`apps/sync/test/banc-trois-appareils.test.ts`) passe contre un vrai
PostgreSQL, avec coupures franches et aléatoires : aucune vente perdue,
aucune dupliquée, totaux identiques au millime. **Le moteur maison est
conservé.** PowerSync reste la porte de sortie si le passage à l'échelle
révélait autre chose.

---

## Synchronisation — ce qui ne se contourne pas

- **L'idempotence est consultée AVANT la validation métier.** Un `event_id`
  déjà connu est un doublon de retentative, pas une opération tardive. Le
  revalider le ferait rejeter dès que la commande a changé d'état entre
  l'envoi et la réémission — et l'appareil ne viderait jamais son outbox.
- **L'outbox ne se vide que sur accusé de réception.** Jamais sur un délai,
  jamais « au bout de N essais ».
- **Un rejet ne se réessaie jamais tout seul.** C'est une règle métier, elle
  remonte au gérant.
- **Push avant pull.** Si le réseau ne tient que trois secondes, ce sont nos
  encaissements qui en profitent.
- **Le service emprunte le rôle `kaissi_device`** et pose son contexte en
  variables de session : tout passe par RLS. Un défaut de filtrage applicatif
  ne peut pas provoquer de fuite entre restaurants.
