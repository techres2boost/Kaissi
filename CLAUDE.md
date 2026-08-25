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

### Le stock n'est jamais autoritaire hors ligne

L'appareil affiche le dernier stock connu, alerte, **mais ne bloque jamais une
vente**. Refuser de vendre une pizza sur une donnée périmée est le pire des deux
mondes.

### Trois identités distinctes, jamais confondues

| Identité | Mécanisme | Portée |
|---|---|---|
| **Utilisateur** | Supabase Auth, e-mail + mot de passe | Back-office |
| **Appareil** | Jeton long, révocable, lié au `device_id` | `/sync` |
| **Employé** | Code PIN validé **hors ligne** (Argon2id) | Qui agit sur le terminal |

Un serveur en salle change cinq fois par service ; la tablette reste
authentifiée en continu. Confondre les deux mène soit à des reconnexions
permanentes, soit à une traçabilité inexistante.

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
pnpm test                       # tous les tests
pnpm typecheck                  # types de tout le monorepo
pnpm --filter @kaissi/domain test --watch   # boucle rapide sur les calculs

pnpm pos:dev                    # POS dans le navigateur (base EN MÉMOIRE)
pnpm pos:build                  # build + vérification du mode avion
pnpm pos:android                # build + sync + lancement sur appareil

pnpm backoffice:dev             # back-office Next.js
```

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

## Jalon de décision — moteur de synchronisation

Écrit maintenant pour éviter de s'entêter plus tard :

> Si, à la fin de la **Phase 2**, la synchronisation n'est pas fiable en test
> avec **trois appareils** et des coupures réseau simulées, on bascule sur
> **PowerSync** sans débat.
