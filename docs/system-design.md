# System design — les patrons de Kaissi, et pourquoi ceux-là

Ce document n'est pas un catalogue de patrons. Un catalogue se lit en une
heure et ne change rien : ce qui manque, ce n'est jamais le nom d'un patron,
c'est de savoir **quel problème il résout, ce qu'il coûte, et quand il est le
mauvais choix**.

Chaque section suit donc le même plan : le problème réel, le patron appliqué,
**où il se trouve dans ce dépôt**, ce qu'il a coûté, et l'alternative qu'on a
écartée. Les fichiers cités sont réels — ouvre-les en lisant.

> **Lis d'abord [`architecture.md`](architecture.md).** Il donne les décisions
> en version courte. Celui-ci explique le raisonnement derrière, et le
> vocabulaire pour le réutiliser ailleurs.

### Comment lire ce document

Chaque patron porte, juste sous son titre, un **renvoi vers l'endroit du code
où il vit** :

> ⟶ `packages/domain/src/totaux.ts:80` — `calculerTotaux()`

Le chemin et la ligne servent à ouvrir le fichier ; c'est le **nom du symbole**
qui est l'ancre durable — une ligne bouge, un nom se retrouve au `grep`. Quand
un patron vit à plusieurs endroits (c'est le cas des plus importants), le
renvoi les donne tous : c'est précisément ce qui rend le patron visible.

Un patron sans renvoi n'existe pas dans ce dépôt. S'il en manque un, c'est un
défaut de ce document, pas une abstraction.

### Les 42 patrons, en un coup d'œil

- [0. La contrainte qui décide de tout](#0-la-contrainte-qui-décide-de-tout)

**PARTIE I — L'applicatif**

- [1. Event sourcing — la commande est un journal, pas une ligne](#1-event-sourcing--la-commande-est-un-journal-pas-une-ligne)
- [2. CQRS — écrire dans le journal, lire dans une projection](#2-cqrs--écrire-dans-le-journal-lire-dans-une-projection)
- [3. Shared kernel — un seul endroit calcule l'argent](#3-shared-kernel--un-seul-endroit-calcule-largent)
- [4. Ports & adapters — la même base sur trois runtimes](#4-ports--adapters--la-même-base-sur-trois-runtimes)
- [5. Transactional outbox — ne jamais perdre une vente](#5-transactional-outbox--ne-jamais-perdre-une-vente)
- [5 bis. File persistante et trace d'effet — imprimer sans bloquer, ne jamais réimprimer](#5-bis-file-persistante-et-trace-deffet--imprimer-sans-bloquer-ne-jamais-réimprimer)
- [6. Clé d'idempotence — la garantie « jamais de double encaissement »](#6-clé-didempotence--la-garantie--jamais-de-double-encaissement-)
- [7. Machine à états — interdire au lieu de vérifier partout](#7-machine-à-états--interdire-au-lieu-de-vérifier-partout)
- [8. Types marqués — rendre l'état illégal impossible à écrire](#8-types-marqués--rendre-létat-illégal-impossible-à-écrire)
- [9. Anti-corruption layer — le schéma écrit à la main](#9-anti-corruption-layer--le-schéma-écrit-à-la-main)
- [10. Feature flag — écrit, testé, éteint](#10-feature-flag--écrit-testé-éteint)

**PARTIE II — La base de données**

- [11. Multi-tenance — la colonne discriminante, partout](#11-multi-tenance--la-colonne-discriminante-partout)
- [11 bis. Numéroter hors ligne — l'espace de noms vient du serveur](#11-bis-numéroter-hors-ligne--lespace-de-noms-vient-du-serveur)
- [12. Horloge logique — un curseur, jamais un timestamp](#12-horloge-logique--un-curseur-jamais-un-timestamp)
- [12 bis. Un seul canal de descente — et l'ensemble complet quand l'élément ne suffit pas](#12-bis-un-seul-canal-de-descente--et-lensemble-complet-quand-lélément-ne-suffit-pas)
- [13. Journal append-only + chaînage par hash](#13-journal-append-only--chaînage-par-hash)
- [13 bis. L'exception nommée — lever une invariance sans la perdre](#13-bis-lexception-nommée--comment-on-lève-une-invariance-sans-la-perdre)
- [13 ter. L'exception étroite — pourquoi CRÉER n'est pas MODIFIER](#13-ter-lexception-étroite--pourquoi-créer-nest-pas-modifier)
- [14. UUIDv7 — l'identifiant vient de celui qui crée](#14-uuidv7--lidentifiant-vient-de-celui-qui-crée)
- [15. Instantané ponctuel — copier plutôt que joindre](#15-instantané-ponctuel--copier-plutôt-que-joindre)
- [15 bis. État dérivé — le stock se calcule, il ne se décrémente pas](#15-bis-état-dérivé--le-stock-se-calcule-il-ne-se-décrémente-pas)
- [16. Index unique partiel — la contrainte qui sait faire une exception](#16-index-unique-partiel--la-contrainte-qui-sait-faire-une-exception)
- [16 bis. Le cycle de vie d'un agrégat racine — fermer, puis supprimer sous obstacles](#16-bis-le-cycle-de-vie-dun-agrégat-racine--fermer-puis-supprimer-sous-obstacles)
- [16 ter. La fiche facultative — structurer sans imposer la saisie](#16-ter-la-fiche-facultative--structurer-sans-imposer-la-saisie)
- [17. Migrations — en avant seulement, et additives](#17-migrations--en-avant-seulement-et-additives)
- [17 bis. Aggregation pushdown — additionner là où sont les lignes](#17-bis-aggregation-pushdown--additionner-là-où-sont-les-lignes)
- [17 ter. Le piège du plan générique — quand PostgreSQL devine mal](#17-ter-le-piège-du-plan-générique--quand-postgresql-devine-mal)

**PARTIE III — La sécurité**

- [18. Trois identités distinctes, jamais confondues](#18-trois-identités-distinctes-jamais-confondues)
- [19. RLS — l'autorisation au plus près de la donnée](#19-rls--lautorisation-au-plus-près-de-la-donnée)
- [20. Moindre privilège — trois rôles, trois portées](#20-moindre-privilège--trois-rôles-trois-portées)
- [20 bis. La frontière exprimée en privilèges — ce que la caisse ne peut même pas lire](#20-bis-la-frontière-exprimée-en-privilèges--ce-que-la-caisse-ne-peut-même-pas-lire)
- [21. Le député confus — pourquoi le service relit les droits](#21-le-député-confus--pourquoi-le-service-relit-les-droits)
- [22. Le privilège de colonne, et l'incident qu'il a causé](#22-le-privilège-de-colonne-et-lincident-quil-a-causé)
- [23. Le hachage des PIN — Argon2id, et pourquoi pas autre chose](#23-le-hachage-des-pin--argon2id-et-pourquoi-pas-autre-chose)
- [23 bis. Limitation de débit — protéger l'entrée, jamais la caisse](#23-bis-limitation-de-débit--protéger-lentrée-jamais-la-caisse)
- [23 ter. Défense en profondeur — la CSP ne remplace pas RLS, elle échoue ailleurs](#23-ter-défense-en-profondeur--la-csp-ne-remplace-pas-rls-elle-échoue-ailleurs)

**PARTIE IV — Fiabilité et exploitation**

- [24. Auto-réparation — le bug qui a justifié le patron](#24-auto-réparation--le-bug-qui-a-justifié-le-patron)
- [25. Les gardes de CI — les règles qu'une relecture ne tient pas](#25-les-gardes-de-ci--les-règles-quune-relecture-ne-tient-pas)
- [25 bis. La garde d'énumération — vérifier la RÈGLE, pas l'instance](#25-bis-la-garde-dénumération--vérifier-la-règle-pas-linstance)
- [26. Observabilité — l'écran qui répond à la vraie question](#26-observabilité--lécran-qui-répond-à-la-vraie-question)
- [26 bis. Journal structuré — pour qu'une panne se cherche, pas se devine](#26-bis-journal-structuré--pour-quune-panne-se-cherche-pas-se-devine)
- [26 ter. Frontière d'erreur — ce que voit le client quand ça casse](#26-ter-frontière-derreur--ce-que-voit-le-client-quand-ça-casse)

**PARTIE V — Ce qu'on n'a PAS fait**

- [Et ce qu'on a MESURÉ puis écarté](#et-ce-quon-a-mesuré-puis-écarté)


---

## 0. La contrainte qui décide de tout

Un système bien conçu n'est pas celui qui applique le plus de patrons : c'est
celui qui a **identifié sa contrainte dominante** et a tout plié autour.

Pour Kaissi, elle tient en une phrase :

> **L'encaissement ne doit jamais s'arrêter.**

Tout le reste — stock, recettes, CRM, rapports — est un logiciel de gestion
ordinaire. C'est l'offline qui rend ce projet difficile, et c'est lui qui
justifie chaque décision qui suit. Chaque fois qu'une décision te semblera
excessive, repose-toi la question : *que se passe-t-il si Internet tombe à
20 h un vendredi ?*

**L'exercice à retenir** : avant de choisir une architecture, écris la
contrainte dominante en une phrase. Si tu n'y arrives pas, tu ne la connais
pas encore, et tu vas choisir au hasard.

---

# PARTIE I — L'applicatif

## 1. Event sourcing — la commande est un journal, pas une ligne
> ⟶ `packages/domain/src/evenements.ts:19` — `TypeEvenement`, le vocabulaire
> ⟶ `packages/domain/src/reduction.ts:160` — `reduire()`, le repli du journal


**Le problème.** Deux tablettes hors ligne ajoutent chacune un article à la
table 12. À la reconnexion, laquelle a raison ?

C'est la question sur laquelle échouent la plupart des POS, et elle est mal
posée. Tant qu'une commande est **une ligne qu'on modifie**, il faut un
arbitre, et l'arbitre perd des données par construction.

**Le patron : Event Sourcing.** L'état n'est pas stocké ; il est **dérivé**
d'une suite de faits immuables.

```
Tablette A hors ligne ──► line.added { Pizza, 1 }
Tablette B hors ligne ──► line.added { Coca, 2 }

Reconnexion → les DEUX sont appliqués. Trois articles. Aucun conflit.
```

Ce qui rend cela possible n'est pas le patron lui-même, c'est une propriété
des événements choisis : **ils commutent**. `line.added` est additif, donc
l'ordre d'arrivée ne change pas le résultat. Ce n'est pas un hasard, c'est un
critère de conception : *chaque fois que tu définis un événement, demande-toi
s'il commute avec lui-même*.

Pour la minorité de champs qui ne commutent pas — numéro de table, statut, nom
du client — on applique **LWW** (*last-writer-wins*) arbitré par
`(server_seq, device_id)`, jamais par une horloge. L'ancienne valeur reste
lisible dans le journal : on ne perd pas l'information, on choisit laquelle
afficher.

**Où :** `packages/domain/src/evenements.ts` (le vocabulaire),
`packages/domain/src/reduction.ts` (le repli).

**Ce que ça coûte.**
- Lire l'état demande de rejouer le journal → d'où la partie 2.
- Un événement publié ne se corrige plus. On en ajoute un nouveau.
- Le vocabulaire d'événements est un **engagement de compatibilité** : trois
  semaines plus tard, une tablette enverra encore l'ancienne forme.

**L'alternative écartée :** les CRDT. Plus puissants, beaucoup plus difficiles
à raisonner, et inutiles ici — nos événements additifs commutent déjà.
PowerSync (qui les implémente) est resté la porte de sortie, jamais franchie
(voir le jalon dans `CLAUDE.md`).

---

## 2. CQRS — écrire dans le journal, lire dans une projection
> ⟶ `packages/db-local/src/projecteur.ts` — la projection sur la tablette
> ⟶ `apps/sync/src/depot-postgres.ts:910` — `reprojeter()`, côté serveur


**Le problème créé par la partie 1.** Rejouer trois mille événements pour
afficher une liste de commandes rendrait la caisse lente en fin de service,
exactement quand elle doit être rapide.

**Le patron : CQRS** (*Command Query Responsibility Segregation*) — le modèle
d'écriture et le modèle de lecture sont deux choses différentes.

- **Écriture** : `order_events`, en insertion seule.
- **Lecture** : `orders`, `order_items`, `payments` — des **projections**,
  reconstruites par le même code.

**Où :** `packages/db-local/src/projecteur.ts` (tablette),
`apps/sync/src/depot-postgres.ts` → `reprojeter()` (serveur).

**Le point non évident, et il est capital.** La projection est **réécrite
entièrement** à chaque nouvel événement : `DELETE` puis `INSERT` de toutes les
lignes de la commande. Jamais une mise à jour incrémentale.

Pourquoi : une projection incrémentale doit savoir **défaire** ce qu'elle a
fait quand un événement d'annulation arrive. Elle y arrive presque toujours —
et ce « presque » dérive en silence. Recalculer depuis zéro est *idempotent
par construction* : rejouer donne exactement le même résultat.

C'est la même raison qui fait que le **stock est calculé à la lecture**
(migration `0019`) et que les **visites clients** sont une vue (migration
`0031`). À chaque fois qu'on a été tenté par un compteur, on s'est demandé :
« qui le décrémente quand la commande passe annulée ? ». Le compteur perd.

**Ce que ça coûte :** de la cohérence **à terme** (*eventual consistency*).
La projection peut être en retard d'un instant sur le journal. Acceptable
ici ; inacceptable si l'écran servait à décider d'un débit bancaire.

---

## 3. Shared kernel — un seul endroit calcule l'argent
> ⟶ `packages/domain/src/totaux.ts:80` — `calculerTotaux()`, l'ordre figé
> ⟶ `packages/domain/src/marge.ts:74` — `calculerMarge()`, la base du CA


**Le problème.** La tablette calcule un total, le serveur le recalcule. S'ils
divergent d'un millime, l'écart apparaît dans une caisse, un mois plus tard,
et personne ne sait l'expliquer au client.

**Le patron : Shared Kernel** (DDD) — un noyau de domaine **partagé à
l'identique** par tous les contextes.

`packages/domain` est **100 % pur** : aucune entrée/sortie, aucun accès
réseau, aucune horloge cachée. Il est importé tel quel par le POS, par le
service de synchronisation et par le back-office.

L'ordre de calcul y est **figé** (`totaux.ts`) et documenté ligne à ligne. Les
deux étapes qui produisent le plus d'écarts en production sont la répartition
au prorata de la remise globale, et l'arrondi de TVA **par taux** avant de
sommer. Les inverser change le total de quelques millimes — assez pour ne
jamais réconcilier une caisse.

**Ce que ça coûte :** une discipline. La tentation de « juste ajouter un petit
calcul » dans l'interface est permanente, et c'est exactement ce qui casse.

**Le test qui protège :** la pureté. Un noyau sans I/O se teste de façon
exhaustive, sans base ni serveur — 168 tests en 6 secondes.

---

## 4. Ports & adapters — la même base sur trois runtimes
> ⟶ `packages/db-local/src/adaptateur.ts:15` — `AdaptateurSqlite`, le port, six méthodes
> ⟶ `packages/db-local/src/adaptateurs/capacitor.ts` — Android et iOS
> ⟶ `packages/db-local/src/adaptateurs/node.ts` — les tests, sur `node:sqlite`
> ⟶ `apps/pos/src/donnees/sqlite-web.ts` — le navigateur, `sql.js` + IndexedDB


**Le problème.** SQLite s'appelle différemment sur la tablette (plugin
Capacitor), dans un navigateur (`sql.js`, compilé en WebAssembly) et sous Node
(`node:sqlite`, pour les tests). Écrire trois fois la logique métier serait
garantir trois comportements.

**Le patron : Ports & Adapters** (*hexagonal architecture*). Le port est une
interface ; les adaptateurs l'implémentent.

**Où :** `packages/db-local/src/adaptateur.ts` (le port — six méthodes :
`executer`, `executerScript`, `lire`, `lireUne`, `transaction`, `fermer`), et
trois adaptateurs. Les deux premiers vivent dans `db-local/adaptateurs/` ; le
troisième, celui du navigateur, vit dans `apps/pos/src/donnees/sqlite-web.ts`,
parce qu'il dépend de Vite pour charger son fichier `.wasm`.

**Ce que l'adaptateur web a de particulier :** `sql.js` tient la base **en
mémoire**, sans fichier. La persistance consiste à exporter l'image entière
dans IndexedDB à la sortie de chaque transaction — et à **attendre** cette
écriture : la différer ferait perdre l'encaissement qui vient d'être validé si
l'onglet meurt dans l'intervalle. C'est aussi pourquoi l'écran Diagnostic dit
en clair que ce stockage est évinçable par le navigateur, et que l'APK reste la
cible nominale.

**Le bénéfice concret, et il est plus grand qu'il n'y paraît :** les
migrations, les dépôts et le projecteur sont testés **contre le vrai SQLite**,
sous Node, sans émulateur Android. C'est ce qui rend possible d'écrire un test
avant de brancher une tablette.

**La règle pour reconnaître un bon port :** il ne doit parler que le
vocabulaire du domaine, jamais celui d'une technologie. Le nôtre parle de
`executer`, `lire`, `transaction` — pas de `Capacitor`, ni de `WASM`.

---

## 5. Transactional outbox — ne jamais perdre une vente
> ⟶ `packages/db-local/src/depots/journal.ts:2` — l'écriture jumelée
> ⟶ `packages/sync-client/src/index.ts:36` — `delaiRetentative()`, la gigue
> ⟶ `packages/sync-client/src/index.ts:52` — `estReessayable()`, ce qui ne se réessaie JAMAIS


**Le problème.** La tablette encaisse hors ligne. Comment garantir que la
vente partira, un jour, exactement une fois ?

**Le patron : Transactional Outbox.** L'événement est écrit dans le journal
**et** dans une file de sortie, **dans la même transaction locale**. Un
processus de fond vide la file.

**Où :** table `outbox` (`packages/db-local`), moteur dans
`packages/sync-client/src/moteur.ts`.

Trois règles qui n'ont l'air de rien et qui sont tout :

| Règle | Ce qui casse sans elle |
|---|---|
| **L'outbox ne se vide que sur accusé de réception** — jamais sur un délai, jamais « au bout de N essais » | une vente disparaît, et personne ne le sait |
| **Push avant pull** | si le réseau ne tient que trois secondes, ce sont nos encaissements qui en profitent |
| **Un rejet ne se réessaie jamais tout seul** | on masque une règle métier au gérant en la répétant en boucle |

**Le patron compagnon : Retry with exponential backoff + jitter.**
`packages/sync-client/src/index.ts` → `delaiRetentative()`. La *gigue* (le
terme aléatoire) n'est pas de la coquetterie : sans elle, cinquante tablettes
qui perdent le réseau au même moment le retrouvent au même moment, et le
serveur reçoit cinquante lots simultanés — le *thundering herd*.

---

## 5 bis. File persistante et trace d'effet — imprimer sans bloquer, ne jamais réimprimer
> ⟶ `packages/db-local/src/migrations/001_schema_initial.ts:363` — `print_queue`
> ⟶ `packages/db-local/src/migrations/002_phase1_caisse.ts:49` — `kitchen_sends`
> ⟶ `apps/pos/src/donnees/impression.ts:27` — `ServiceImpression`

**Le problème.** Une imprimante s'éteint, manque de papier, perd le Wi-Fi.
Si l'encaissement attend l'imprimante, la caisse s'arrête avec elle.

**Le patron, en deux morceaux.**

1. **File persistante** (*persistent job queue*). Un ticket n'est pas envoyé à
   l'imprimante : il est **écrit dans `print_queue`**, déjà rendu en ESC/POS.
   Une boucle vide la file, réessaie seule, et survit au redémarrage. La
   caisse, elle, est déjà passée au client suivant. Un échec allume un badge ;
   il ne supprime **jamais** un travail.
2. **Trace d'effet** (*side-effect log*). `kitchen_sends` retient **quelle
   ligne** est déjà partie en cuisine, avec un index unique sur
   `order_item_id`. C'est ce qui empêche une deuxième tournée de réimprimer
   la première — la cuisine referait les plats déjà servis.

C'est le même raisonnement que l'idempotence (§6), appliqué à un effet
physique : on ne peut pas « annuler » un bon imprimé, donc on retient qu'il
l'a été.

**Aujourd'hui éteint** (§10), mais la table `kitchen_sends` sert déjà : elle
dit à l'écran quelles lignes ont été envoyées.

---

## 6. Clé d'idempotence — la garantie « jamais de double encaissement »
> ⟶ `supabase/migrations/0005_sync.sql:8` — `sync_mutations.event_id`, clé primaire
> ⟶ `apps/sync/src/service.ts:157` — `push()`, l'idempotence consultée AVANT le métier


**Le problème.** Le réseau coupe pendant le `POST`. La vente est-elle
enregistrée ? La tablette n'en sait rien, donc elle réessaie. Une distribution
*at-least-once* est la seule qu'on puisse garantir.

**Le patron : Idempotency Key.** Chaque événement porte un identifiant généré
par l'appareil (`event_id`, UUIDv7), et cet identifiant est **clé primaire**
côté serveur. Le même événement renvoyé cinq fois est inséré une fois.

**Où :** `sync_mutations.event_id` et `order_events.event_id`
(`supabase/migrations/0005_sync.sql`), vérifié par une garde de CI.

**Le détail qui a coûté une panne.** *L'idempotence est consultée AVANT la
validation métier.* Un `event_id` déjà connu est un doublon de retentative,
pas une opération tardive : le revalider le ferait rejeter dès que la commande
a changé d'état entre l'envoi et la réémission — et la tablette ne viderait
jamais son outbox.

**La leçon générale :** *at-least-once + idempotence = exactly-once*. C'est la
seule façon connue d'obtenir « exactement une fois » dans un système
distribué. « Exactly-once delivery » n'existe pas ; « exactly-once effect »,
si.

---

## 7. Machine à états — interdire au lieu de vérifier partout
> ⟶ `packages/domain/src/machine-etat.ts:18` — `TRANSITIONS`


**Le problème.** Peut-on ajouter une ligne à une commande déjà encaissée ? La
question se repose à chaque écran, et une seule réponse oubliée crée un trou.

**Le patron : State Machine.** Les transitions autorisées sont déclarées **une
fois**, en table.

**Où :** `packages/domain/src/machine-etat.ts` — `TRANSITIONS` associe à chaque
statut la liste des événements recevables.

La table dit aussi ce qui est **escaladable** : refusé pour un caissier,
autorisé par un responsable dont le nom entre dans l'événement. La permission
n'est donc pas un booléen, c'est un verdict avec un motif.

---

## 8. Types marqués — rendre l'état illégal impossible à écrire
> ⟶ `packages/domain/src/monnaie.ts:40` — `millimes()`, le constructeur qui refuse


**Le problème.** `montant: number` accepte `24.5`, `-3`, `NaN` et
`0.1 + 0.2`. Un flottant pour de l'argent est une erreur qui n'apparaît
qu'après des mois.

**Le patron : Branded / Opaque Types.**

```ts
type Millimes = number & { readonly __marque: 'Millimes' }
export function millimes(valeur: number): Millimes  // lève si non entier sûr
```

**Où :** `packages/domain/src/monnaie.ts`.

Un `number` ordinaire ne peut plus entrer là où un `Millimes` est attendu : il
faut passer par le constructeur, qui **lève** sur un non-entier. Le compilateur
attrape ce que la relecture manque.

Même chose pour `PointsDeBase` : 19 % s'écrit `1900`, jamais `0.19`.

**La règle générale :** *make illegal states unrepresentable*. Chaque fois
qu'un commentaire dit « attention, ici la valeur doit être… », c'est qu'un
type manque.

---

## 9. Anti-corruption layer — le schéma écrit à la main
> ⟶ `apps/backoffice/src/serveur/schema.ts:679` — `Database`, écrit à la main


**Le problème.** Le back-office lit Postgres via PostgREST. Un générateur de
types produirait un miroir automatique — et une colonne renommée casserait la
production sans prévenir.

**Le patron : Anti-Corruption Layer.** `apps/backoffice/src/serveur/schema.ts`
est **écrit à la main** et déclare exactement les colonnes dont le back-office
dépend.

**Le bénéfice :** une migration qui renomme une colonne casse la
**compilation**. Le fichier dit noir sur blanc ce qui est utilisé — un
générateur, lui, aurait tout déclaré, y compris ce que personne ne lit.

---

## 10. Feature flag — écrit, testé, éteint
> ⟶ `apps/pos/src/config.ts:13` — `IMPRESSION_ACTIVE`


`apps/pos/src/config.ts` porte `IMPRESSION_ACTIVE`, faux par défaut. Le module
d'impression reste **écrit, testé et importé** ; il ne tourne simplement pas.

**Pourquoi c'est un patron et pas un bricolage :** supprimer le code aurait
supprimé la connaissance. Le rallumer est un drapeau de build
(`pnpm pos:build:impression`), pas un chantier.

**Le piège à éviter :** un drapeau qui traîne des années devient une branche
morte. Un drapeau doit avoir une date ou une condition de sortie.

---

# PARTIE II — La base de données

## 11. Multi-tenance — la colonne discriminante, partout
> ⟶ `supabase/migrations/0002_tenance.sql:4` — la colonne, partout


**Trois modèles existent :**

| Modèle | Isolation | Coût |
|---|---|---|
| Une base par client | totale | ingérable au-delà de quelques dizaines |
| Un schéma par client | forte | migrations × N clients |
| **Base et schéma partagés, colonne discriminante** | **par RLS** | **une seule migration** |

Kaissi prend le troisième, avec une particularité : `organization_id` **ET**
`restaurant_id` sur presque chaque table, **même quand c'est redondant**.

**Pourquoi la redondance est délibérée :**
1. C'est la future **clé de sharding**. Le jour où une base ne suffit plus, on
   coupe par organisation sans réécrire les requêtes.
2. Elle rend les politiques RLS **vérifiables sans jointure** — donc rapides,
   et surtout relisibles par un humain.

**Ce que ça coûte :** vingt minutes aujourd'hui. Ajouter ces colonnes après
coup sur 40 tables et 500 millions de lignes est un chantier de plusieurs
mois.

**La leçon générale :** les décisions **irréversibles** se prennent tôt, même
quand elles paraissent prématurées. Les décisions réversibles se repoussent.

---

## 11 bis. Numéroter hors ligne — l'espace de noms vient du serveur
> ⟶ `supabase/migrations/0002_tenance.sql:120` — `ticket_prefix`, unique par établissement
> ⟶ `apps/sync/src/depot-postgres.ts:2108` — `numeroTicketLibre()`, la collision désambiguïsée

**Le problème.** Deux caisses hors ligne émettent chacune un ticket. Il leur
faut un numéro lisible (« 000042 »), et un UUID (§14) ne se lit pas au
comptoir. Si chacune compte de son côté, les deux émettent « 000042 ».

**Le patron : un espace de noms par émetteur.** Le **serveur** attribue à
chaque terminal un préfixe unique (`P1`, `P2`…) à l'appairage ; le terminal
compte ensuite librement **dans son espace** : `P1-000042`, `P2-000042`.
Aucune coordination n'est nécessaire hors ligne, parce que les deux espaces
ne se recouvrent pas. C'est ce que font les plaques d'immatriculation par
département, ou les blocs d'adresses IP.

**Le filet, quand l'hypothèse casse quand même** (un terminal qui aurait gardé
un préfixe local) : la projection **ne refuse pas** la vente. Elle
désambiguïse le numéro (`P1-000042~25f8`), garde l'original dans le journal, et
inscrit la collision dans `orders.exceptions`.

> **Perdre une vente coûte infiniment plus cher qu'un numéro suffixé.** Un
> refus ici ferait disparaître du back-office une vente dont les événements
> sont pourtant arrivés — vu en production, avant ce correctif.

Le suffixe vient de l'**appareil**, pas d'un compteur : deux reprojections de
la même vente doivent donner le même numéro, sinon chaque balayage renommerait
le ticket.

---

## 12. Horloge logique — un curseur, jamais un timestamp
> ⟶ `supabase/migrations/0005_sync.sql` — `change_log.seq`, un `bigint generated always as identity`
> ⟶ `supabase/migrations/0043_curseur_sans_trou.sql` — `numerote_changement_sous_verrou()`, le numéro tiré sous verrou
> ⟶ `apps/sync/test/curseur-sans-trou.test.ts` — la course reproduite avec le vrai code


**Le problème.** Sur quoi une tablette dit-elle « donne-moi ce qui a changé
depuis… » ?

**La mauvaise réponse : un timestamp.** Les horloges des tablettes dérivent,
sont réglées à la main, changent de fuseau. Deux événements insérés dans la
même milliseconde sont indiscernables. Une transaction longue peut valider un
`now()` antérieur à une transaction plus récente — et un curseur temporel
saute alors l'événement, **définitivement et sans trace**.

**Le patron : Logical Clock** — un compteur monotone attribué par un seul
acteur, le serveur. `change_log.seq`, `order_events.server_seq` : des colonnes
`bigint generated always as identity` — la forme moderne du `bigserial`, que
ce document et CLAUDE.md continuent d'appeler ainsi par commodité.

**Où :** `supabase/migrations/0005_sync.sql`.

**La leçon générale :** dans un système distribué, le temps n'est pas un
ordre. Chaque fois qu'un `order by created_at` sert à la **correction** d'un
algorithme (et non au confort d'affichage), c'est un bug qui attend.

> **Le compteur avait le même trou — corrigé par la migration 0043.**
>
> PostgreSQL attribue un numéro d'identité au moment de l'**insertion**, pas de
> la validation. Si la transaction A reçoit 100 et tarde à valider pendant que
> B reçoit 101 et valide, une tablette qui tire à ce moment voit 101, avance
> son curseur, et ne reçoit **jamais** le 100. Le reproche fait plus haut au
> timestamp valait donc aussi pour le compteur : c'est le problème que DDIA
> décrit au ch. 9, « Total Order Broadcast » — un journal doit être lu dans
> l'ordre **et sans trous**.
>
> Le correctif : un déclencheur `before insert` sur `order_events` et sur
> `change_log` prend un **verrou par établissement**, gardé jusqu'à la
> validation, et tire **alors seulement** le numéro. Deux transactions d'un
> même établissement ne peuvent plus détenir de numéro en même temps : l'ordre
> des numéros devient l'ordre des validations.
>
> Deux détails qui comptent :
>
> - **le numéro est retiré, pas seulement verrouillé.** La valeur par défaut
>   est calculée *avant* les déclencheurs ; un simple verrou arriverait trop
>   tard. Le numéro réservé d'abord est perdu : la séquence peut sauter
>   (100, 102…), ce qui n'est pas un trou de livraison ;
> - **le verrou est par établissement.** Deux restaurants ne s'attendent
>   jamais, et le test le mesure : un verrou global y échoue.
>
> Il est dans la **base** et non dans le service, parce que `change_log` a six
> écrivains : un déclencheur sur la table les couvre tous, y compris ceux qui
> n'existent pas encore.

---

## 12 bis. Un seul canal de descente — et l'ensemble complet quand l'élément ne suffit pas
> ⟶ `packages/db-local/src/miroir.ts:61` — `TABLES_MIROIR`, et son option `lot`
> ⟶ `supabase/migrations/0037_modificateurs_descendent.sql:56` — `journalise_modificateurs_produit()`

**Le problème.** Le catalogue descend par `change_log` (§12). Puis arrivent
d'autres réglages : l'en-tête du reçu (0035), le service et le timbre (0036),
les modificateurs (0037). La tentation est d'ouvrir une route par réglage.

**Le patron : un seul canal.** Chaque réglage devient une ligne de
`change_log`, exactement comme un changement de prix. La caisse n'apprend
rien de nouveau : elle applique ce qui descend, dans l'ordre du curseur. Un
réglage de plus, c'est une entrée dans `TABLES_MIROIR`, pas une voie de
synchronisation à maintenir.

**Le cas qui ne rentrait pas.** `product_modifiers` est une table de
**liaison** (quel groupe s'applique à quel produit). Journaliser ligne à
ligne un DÉTACHEMENT pose problème : la ligne n'existe plus, et la caisse ne
saurait pas quoi retirer. La 0037 journalise donc **l'ensemble complet** des
groupes d'un produit à chaque changement ; la caisse efface les liens de ce
produit puis réinsère la liste reçue (option `lot` du miroir).

**La règle générale :** quand un élément isolé ne suffit pas à reconstruire
l'état, envoie l'ensemble dont il fait partie. Une liste complète est
idempotente ; une suite de « ajoute / retire » ne l'est pas.

---

## 13. Journal append-only + chaînage par hash
> ⟶ `packages/domain/src/audit.ts:37` — le chaînage par hash


**Le problème.** Un journal d'audit qu'on peut modifier ne prouve rien.

**Deux mécanismes, et il en faut deux :**

1. `REVOKE UPDATE, DELETE` — mais le REVOKE seul ne protège pas du
   **propriétaire** de la table.
2. Un **déclencheur de blocage**, qui lève quoi qu'il arrive.

Et par-dessus, le **chaînage par hash** : chaque ligne porte le hash de la
précédente (`supabase/migrations/0006_audit.sql`). Supprimer ou modifier une
ligne casse la chaîne, et devient **détectable** — c'est le principe d'un
registre chaîné, sans rien emprunter aux chaînes de blocs.

> **Une annulation n'efface jamais rien.** Elle ajoute un événement
> d'annulation. L'état visible change ; l'historique ne perd jamais
> d'information.

---

## 13 bis. L'exception nommée — comment on lève une invariance sans la perdre
> ⟶ `packages/db-local/src/migrations/010_purge_etablissement.ts:49` — le déclencheur conditionnel
> ⟶ `packages/db-local/src/bascule-etablissement.ts:210` — le drapeau, posé et retiré

**Le problème.** Une invariance absolue finit toujours par croiser un cas
légitime. Ici : `order_events` est en insertion seule (§13) — et changer une
caisse d'établissement exige de vider sa base locale, journal compris.

Les deux réponses spontanées sont mauvaises :

- **contourner en silence** (un `DROP TRIGGER` le temps de l'opération) : un
  plantage entre le DROP et le CREATE laisse la table sans protection, et plus
  rien ne le dit ;
- **ne rien effacer** : les événements gardent le `restaurant_id` de l'ancien
  établissement, et la projection les fait réapparaître dans le chiffre du
  nouveau — un chiffre faux qui a l'air juste.

**Le patron.** Le déclencheur reste en place et consulte un **drapeau nommé**,
posé et retiré **dans la transaction** de purge :

```sql
CREATE TRIGGER order_events_pas_delete
BEFORE DELETE ON order_events
WHEN (SELECT valeur FROM sync_state WHERE cle = 'purge_etablissement') IS NULL
BEGIN
  SELECT RAISE(ABORT, 'order_events est en insertion seule : aucune suppression');
END;
```

Trois propriétés, et il faut les trois :

1. la suppression n'est jamais permise **par défaut** — seulement pendant les
   millisecondes où quelqu'un l'a demandée **par son nom** ;
2. un échec quelconque annule tout, **drapeau compris** : la table ne peut pas
   rester ouverte ;
3. l'exception est **lisible** : elle porte un nom qui dit pourquoi elle
   existe, au lieu d'être un contournement qu'on retrouve deux ans plus tard.

> **Ce qui l'a rendue nécessaire — et pourquoi les tests l'avaient ratée.**
> La bascule d'établissement échouait à tous les coups sur « order_events est
> en insertion seule ». Les tests unitaires passaient : ils vidaient des
> tables **vides**, et un déclencheur `BEFORE DELETE` ne se déclenche sur
> aucune ligne. Un test de purge qui ne pose rien à purger ne prouve rien.

---

## 13 ter. L'exception étroite — pourquoi CRÉER n'est pas MODIFIER
> ⟶ `supabase/migrations/0034_article_cree_sur_la_caisse.sql` — la politique `products_creation_caisse`
> ⟶ `apps/sync/test/rls-partout.test.ts` — `update` jamais accordé à `kaissi_device`

**Le problème.** Le référentiel descend dans un seul sens : serveur → caisse
(§12). C'est ce qui rend la synchronisation simple — aucun arbitrage, aucun
conflit. Puis arrive une demande légitime : un caissier veut vendre un article
qui n'est pas à la carte, maintenant, devant un client.

La réponse spontanée est « ouvrons l'écriture du catalogue à la caisse ». Elle
coûte cher : deux caisses hors ligne qui modifient le même produit exigent un
dernier-écrivain-gagne arbitré par `(server_seq, device_id)`, donc un champ de
version, donc une reprise de toute la descente. On ne l'ajoute pas « en
passant ».

**Le patron.** Distinguer la **création** de la **modification**, et n'ouvrir
que la première.

> **Créer n'est pas écrire sur un état partagé.**

Deux caisses hors ligne qui créent un article produisent **deux lignes
distinctes**, avec leurs identifiants propres (§14). Au pire deux fois le même
nom, que le back-office fusionne : un désagrément, pas une perte. Deux caisses
qui MODIFIENT la même ligne, elles, en écrasent une — et l'écrasée est perdue
sans que rien ne le dise.

La création commute ; la modification, non. C'est le même critère qui fait
qu'un journal d'événements additifs n'a pas de conflits (§1) : **on ouvre ce
qui commute, on refuse ce qui arbitre.**

**Ce que l'exception a coûté pour rester étroite** — et les trois points sont
indispensables :

1. la demande voyage dans **l'outbox existante** (`kind = 'catalogue'`), après
   les ventes : si le réseau ne tient que trois secondes, ce sont les
   encaissements qui en profitent. Aucune voie de synchronisation nouvelle ;
2. l'article **redescend par `change_log`**, comme un changement de prix. La
   caisse ne garde pas « sa » version : elle reçoit celle du serveur ;
3. le privilège `update` n'est **pas accordé** à `kaissi_device`. La politique
   RLS dit *quelles lignes* ; le privilège dit *quel verbe*. La seconde
   serrure tient même si la politique était réécrite un jour par mégarde.

**Et ce qui reste fermé, exprès :** `is_available`. Basculer un produit hors
carte reste la décision du serveur, parce qu'il calcule le stock à l'instant
alors qu'une tablette hors ligne travaille sur un souvenir de trois heures.
L'exception porte sur un verbe, pas sur une table.

**L'exercice à retenir** : avant d'ouvrir une écriture distribuée, demande-toi
si l'opération **commute**. Si deux exécutions concurrentes produisent le même
résultat dans n'importe quel ordre, elle est ouvrable sans machinerie. Sinon,
le coût réel n'est pas l'écriture — c'est l'arbitrage qu'elle traîne derrière.

---

## 14. UUIDv7 — l'identifiant vient de celui qui crée
> ⟶ `packages/domain/src/uuid.ts:48` — `uuidV7()`


**Le problème.** Une tablette doit pouvoir ouvrir une commande **sans
réseau**. Un `serial` exige un aller-retour serveur : disqualifié.

**Le patron.** Identifiant généré côté client, en **UUIDv7** — préfixé par un
horodatage, donc **triable par le temps**.

**Pourquoi pas UUIDv4 :** un identifiant aléatoire insère au hasard dans
l'index B-tree. Chaque insertion touche une page différente, l'index se
fragmente, et la table devient lente à mesure qu'elle grossit. Un UUIDv7
insère **en fin d'index**, comme un `serial`, en gardant l'unicité globale.

**La leçon générale :** un identifiant n'est pas qu'une clé. C'est aussi une
décision de **localité d'écriture**.

---

## 15. Instantané ponctuel — copier plutôt que joindre
> ⟶ `supabase/migrations/0030_referentiel_de_reductions.sql` — `discount_label` recopié
> ⟶ `supabase/migrations/0031_base_clients.sql` — `customer_name` recopié


**Le problème.** Un rapport affiche « Happy hour ». L'an prochain, le gérant
renomme la réduction en « Heure creuse ». Que doit afficher le rapport de
l'an dernier ?

**La réponse : « Happy hour ».** Un rapport qui change quand on renomme un
réglage n'est plus un historique.

**Le patron : Point-in-Time Snapshot** — dénormalisation **délibérée**. La
vente porte l'**identifiant** (pour regrouper) *et* le **libellé recopié**
(pour afficher) :

- `orders.discount_id` / `discount_label` (migration `0030`)
- `orders.customer_id` / `customer_name` (migration `0031`)
- **le taux de service de la commande** : quand le gérant change son taux,
  une commande déjà ouverte garde celui qu'elle portait
  (`configEffective()`, `packages/domain/src/commande.ts`). Le serveur
  l'ignorait jusqu'à la migration 0036, et reprojetait avec le taux du jour :
  la tablette imprimait un total, le back-office en affichait un autre.

**Comment reconnaître ce cas :** demande-toi si la donnée décrit **un fait
passé** ou **un état courant**. Un fait passé se copie ; un état courant se
joint. Une facture est un fait ; un solde est un état.

---

## 15 bis. État dérivé — le stock se calcule, il ne se décrémente pas
> ⟶ `supabase/migrations/0019_stock_simple.sql` — la vue `stock_actuel`
> ⟶ `supabase/migrations/0023_rupture_automatique.sql` — `is_available`, décidé par le serveur

**Le problème.** Le réflexe est un compteur `qty_on_hand` qu'un déclencheur
décrémente à chaque vente. Ici, il dériverait en silence : la reprojection
serveur réécrit **toutes** les lignes d'une commande (`DELETE` puis `INSERT`)
à chaque nouvel événement. Le compteur devrait défaire exactement ce qu'il a
fait — y compris quand la commande est passée « annulée » entre-temps.

**Le patron : état dérivé** (*derived state*). On ne stocke que des faits —
un comptage de référence, des mouvements manuels, des ventes — et le stock
se **calcule à la lecture** :

```
stock = comptage de référence + mouvements depuis − ventes depuis
```

C'est exact par construction, insensible aux reprojections, et **borné** : un
nouvel inventaire repose la référence, donc la somme ne balaie jamais tout
l'historique.

**Deux conséquences voulues :**

- un stock **négatif reste possible**, et il n'est pas borné à zéro. C'est le
  cas normal d'une vente encaissée hors ligne qui arrive après coup, et le
  seul signal qu'il manque une réception ;
- c'est le **serveur** qui retire un produit de la carte (`is_available`),
  parce qu'il calcule sur la donnée de l'instant. Une tablette hors ligne
  travaille sur un souvenir de trois heures : elle affiche, elle alerte, elle
  ne bloque **jamais** une vente.

**Quand préférer un compteur :** quand les faits sont trop nombreux pour être
relus à chaque lecture, et qu'aucune réécriture ne les touche. Ce n'est le cas
ni du volume d'un restaurant, ni de nos projections.

---

## 16. Index unique partiel — la contrainte qui sait faire une exception
> ⟶ `supabase/migrations/0021_appairage_stable.sql:60` — `devices_installation_idx`, partiel sur `revoked_at is null`


Trois exemples, trois raisons :

```sql
-- Un appareil réappairé ne crée pas un doublon…
create unique index … on kaissi.devices (restaurant_id, installation_id)
  where installation_id is not null and revoked_at is null;
  -- …mais une révocation reste définitive

-- Un client de passage sans numéro reste légitime…
create unique index … on kaissi.customers (restaurant_id, phone)
  where phone is not null and archived_at is null;   -- …et réinscriptible

-- Une alerte reste ouverte, une seule à la fois, par produit
create unique index … on kaissi.stock_alerts (product_id)
  where resolue_a is null;
```

**Le patron :** l'unicité ne porte pas sur toute la table, mais sur le
**sous-ensemble qui a un sens métier**. C'est presque toujours ce qu'on veut,
et presque jamais ce qu'on écrit du premier coup.

---

## 16 bis. Le cycle de vie d'un agrégat racine — fermer, puis supprimer sous obstacles
> ⟶ `supabase/migrations/0038_fermer_un_etablissement.sql` — `restaurants.closed_at`
> ⟶ `supabase/migrations/0039_journal_et_suppression.sql` — `kaissi.etablissement_vivant()`
> ⟶ `apps/sync/src/depot-postgres.ts` — `obstaclesSuppression()`

**Le problème.** Un client ferme son restaurant. Que fait le logiciel ?

Les deux réponses spontanées sont mauvaises. **Supprimer** efface des ventes,
donc des écritures comptables, que la loi et le client exigent de conserver.
**Ne rien faire** laisse un établissement mort dans toutes les listes,
appairable, facturable, et indistinguable d'un vivant.

**Le patron.** Deux gestes distincts, et une porte qui se referme entre les
deux.

| | **Fermer** | **Supprimer** |
|---|---|---|
| Ce que ça fait | pose `closed_at`, range l'établissement à part | efface la ligne et ses dépendances |
| Réversible | oui | non |
| Quand c'est permis | toujours | **seulement si aucun obstacle** |
| Sur les ventes | aucun effet | interdit s'il y en a une |

Un **obstacle** est une raison nommée de refuser, comptée en base : une vente,
un service de caisse, un événement d'audit. Le geste n'est pas « supprimer, on
verra » mais « voici les trois choses qui l'empêchent ». La différence se lit
à l'écran : un refus qui ÉNUMÈRE est actionnable, un refus opaque envoie
ouvrir une console SQL.

**Ce que fermer ne fait PAS, et c'est délibéré :** couper les terminaux déjà
appairés. Ils continuent d'envoyer. Refuser leurs envois le jour de la
fermeture perdrait les ventes de la dernière soirée — celles qui sont encore
dans les outbox — et **un rejet ne se réessaie jamais tout seul** (§5). La
fermeture coupe les NOUVEAUX appairages, rien d'autre.

> **Le piège qu'on n'a vu qu'en le heurtant.**
>
> Supprimer un établissement supprime ses produits, ses catégories, ses
> stations — en cascade. Or chacune de ces tables porte un déclencheur qui
> JOURNALISE le changement dans `change_log`, avec le `restaurant_id` de la
> ligne. La cascade insérait donc des lignes de journal **pointant vers un
> établissement en train de disparaître**, et la suppression échouait sur une
> violation de clé étrangère — un message qui ne nomme ni la cause, ni le
> remède.
>
> Trois correctifs ont été envisagés et **rejetés** : retirer la clé étrangère
> (elle protège du vrai défaut), la passer en `on delete cascade` (le problème
> n'est pas les anciennes lignes, ce sont les NOUVELLES), énumérer les tables
> à désactiver (ça casse à la prochaine table de référentiel ajoutée).
>
> Le correctif retenu tient en une fonction, `kaissi.etablissement_vivant()`,
> que **les cinq fonctions de journalisation** consultent en première ligne.
> Un déclencheur doit pouvoir savoir qu'il s'exécute à l'intérieur d'une
> suppression — sans quoi il travaille pour un monde qui n'existe plus.

**L'exercice à retenir** : pour tout agrégat racine, écris son cycle de vie
AVANT d'écrire sa table. « Créé → actif → fermé → supprimable sous conditions »
tient en une ligne, et décide de la moitié des colonnes.

---

## 16 ter. La fiche facultative — structurer sans imposer la saisie
> ⟶ `supabase/migrations/0026_historique_stock.sql` — le champ libre, et sa promesse
> ⟶ `supabase/migrations/0041_fournisseurs.sql` — la table, ajoutée À CÔTÉ

**Le problème.** Une donnée saisie en texte libre finit par mériter une table :
on veut compter, regrouper, rapprocher d'une facture. Mais la table apporte
avec elle une contrainte que le texte n'avait pas — **il faut créer la fiche
avant de pouvoir saisir**.

Pour un fournisseur, cela veut dire : remplir un formulaire au moment où
quelqu'un décharge des cageots. C'est le genre d'exigence qui ne se discute
pas en réunion et se contourne sur le terrain — on tape « divers », et la
donnée qu'on voulait structurer est perdue pour de bon.

**Le patron.** La table s'ajoute **à côté** du champ libre, jamais à sa place.

```
stock_movements.supplier      text      -- ce qui a été TAPÉ. Fait foi à l'affichage.
stock_movements.supplier_id   uuid null -- la fiche, QUAND le nom correspondait.
```

Quatre propriétés, et ce sont elles qui rendent l'ajout indolore :

1. `supplier_id` **nul est le cas normal**, pas une anomalie à corriger ;
2. l'interface propose (`datalist`) et ne contraint pas (`select`) : un nom
   inconnu passe exactement comme avant ;
3. l'historique déjà saisi **n'est pas migré**. Décider que « Sfax Primeurs »
   et « sfax primeur » sont le même fournisseur appartient au gérant, pas à
   une migration qui s'exécute une nuit ;
4. le rattachement **ne conditionne rien** — il ajoute un lien, il n'ouvre
   aucune porte. Si la lecture échoue, on écrit `null` et la réception passe :
   perdre un lien de confort coûte moins cher que perdre une saisie de stock.

**Ce que ça coûte :** deux colonnes pour une information, et la discipline de
se souvenir laquelle fait foi. C'est écrit dans le schéma, à l'endroit où on
le lira.

---

## 17. Migrations — en avant seulement, et additives
> ⟶ `packages/db-local/src/migrations/index.ts:30` — le registre vérifié
> ⟶ `packages/db-local/src/migrateur.ts` — une migration, une transaction


| Règle | Pourquoi |
|---|---|
| Une migration appliquée ne se modifie **jamais** | des appareils sont déjà passés dessus |
| Pas de *rollback* : on écrit la migration **inverse** | un rollback automatique suppose que la donnée écrite entre-temps n'existe pas |
| **Additive** tant que le protocole supporte N−2 | une tablette restée trois semaines hors ligne écrit encore l'ancienne forme |
| Une migration = **une** transaction | une migration à moitié appliquée sur une tablette à Sfax n'est pas réparable à distance |
| Le SQL local est un **littéral TypeScript** | une migration qui a besoin du réseau ne s'applique pas en mode avion |

**La leçon générale :** un schéma n'évolue pas comme du code. Le code se
remplace ; les données, elles, restent.

---

## 17 bis. Aggregation pushdown — additionner là où sont les lignes
> ⟶ `supabase/migrations/0033_rapports_agreges_en_sql.sql` — `kaissi.rapport_ventes()`
> ⟶ `apps/backoffice/src/serveur/agregats.ts:266` — `chargerAgregats()`
> ⟶ `apps/sync/test/rapports-agreges.test.ts` — les DEUX chemins, comparés au millime

**Le problème.** Un écran de rapport affiche une trentaine de nombres. Pour
les produire, le back-office lisait la **ligne à ligne** : sur un trimestre à
200 ventes par jour, 18 400 commandes et 55 200 lignes traversaient le réseau,
étaient désérialisées en objets JavaScript dans une fonction serverless, puis
additionnées. Mesuré au point de rupture : 73 000 commandes, un tri **sur
disque** dans PostgreSQL, et une erreur 500 sans explication — sur l'écran du
chiffre d'affaires.

**Le patron : *aggregation pushdown*.** On ne déplace pas les données vers le
calcul ; on déplace le calcul vers les données. La base rend quelques
kilo-octets de JSON au lieu de plusieurs dizaines de mégaoctets de lignes.

**La question qui rend ce patron intéressant ici**, et qui vaut pour tout
système où l'argent se calcule : *cela n'enfreint-il pas la RÈGLE 7 — « les
totaux se calculent à un seul endroit » ?*

Non, et la distinction est **tout le sujet** :

| | Ce que c'est | Où ça vit |
|---|---|---|
| **Une règle** | une **décision** — arrondir la TVA par taux puis sommer et non l'inverse ; répartir la remise globale au prorata ; rapporter la marge au CA ; n'arrondir les coûts qu'une fois, au total | `packages/domain`, et nulle part ailleurs |
| **Une somme** | `sum()` sur des entiers **déjà décidés** — associative, exacte, indifférente à l'ordre | là où sont les lignes |

La fonction SQL ne fait **que** la seconde. Elle ne recalcule aucune TVA, ne
répartit aucune remise, ne divise rien. Trois précautions rendent la frontière
**vérifiable** plutôt que déclarative :

1. **Les coûts sortent NON ARRONDIS**, en `numeric` exact. C'est
   `totaliserCouts()` du domaine qui arrondit, une seule fois. Arrondir en SQL
   aurait déplacé une décision — et le test le refuserait.
   *Effet de bord agréable* : le SQL est **plus exact** que l'ancien chemin,
   parce que `numeric` est de l'arithmétique décimale là où JavaScript
   accumulait en flottant.
2. **Aucun pourcentage** n'est calculé en SQL. La fonction rend un CA et un
   coût ; `calculerMarge()` en fait une marge. Une division est un arrondi,
   donc une décision.
3. **Un test compare les deux chemins** sur le même jeu de ventes et exige
   l'égalité au millime : deux taux de TVA, deux employés, une remise nommée,
   une sans motif, une remise globale répartie au prorata, une ligne annulée,
   un coût fractionnaire (1,234567 millime l'unité), et une vente encaissée à
   1 h du matin.

**Le test a été éprouvé en sabotant volontairement le SQL** : retirer le
filtre des lignes annulées fait tomber 4 tests, supprimer la bascule de
journée commerciale en fait tomber 2. Un test de non-régression qu'on n'a
jamais vu échouer ne prouve rien.

**Ce que ça coûte.** Une seconde implémentation à garder alignée. C'est réel,
et c'est la raison du test de comparaison : il ne documente pas l'alignement,
il le **vérifie**.

**Le corollaire d'architecture.** Le plafond de 50 000 commandes posé pendant
l'audit était un garde-fou, pas une architecture. Sept écrans sur neuf ne
chargent désormais plus **aucune** ligne, et n'ont donc plus rien à tronquer.
Il reste sur les deux qui affichent une **liste** de tickets — là, une ligne
écrite est une ligne lue, et l'agréger n'aurait aucun sens.

**La règle à retenir** : *avant de déplacer un calcul, sépare la décision de
l'addition.* La décision ne se duplique jamais ; l'addition se déplace
librement.

---

## 17 ter. Le piège du plan générique — quand PostgreSQL devine mal
> ⟶ `supabase/migrations/0033_rapports_agreges_en_sql.sql` — `set plan_cache_mode = 'force_custom_plan'`
> ⟶ `apps/sync/test/rapports-agreges.test.ts` — le test qui fige la déclaration

Ce patron n'était pas prévu. Il vient d'un banc de mesure, et c'est
exactement pour cela qu'il mérite une section.

**Le symptôme.** La fonction d'agrégation, écrite en `language sql`, était
juste — et mettait **27 300 ms** sur 92 jours de ventes. La *même requête*,
écrite à la main avec des dates littérales, en mettait **175 ms**. Cent
soixante fois.

**La cause.** PostgreSQL ne connaît pas les valeurs de `p_debut` et `p_fin` au
moment où il planifie le corps d'une fonction. Il applique une sélectivité par
défaut et estime que la période contiendra **UNE** commande. Sur cette
estimation, il choisit des boucles imbriquées — le bon plan pour une ligne — et
rebalaye alors un CTE de 18 000 lignes une fois par commande. Trois cent
trente millions de lignes visitées pour en agréger cinquante-cinq mille.

```
        estimation du planificateur :        1 commande
        réalité :                       18 400 commandes
        conséquence :          Nested Loop au lieu de Hash Join
```

**Le correctif, en une ligne** : `plan_cache_mode = 'force_custom_plan'`.
PostgreSQL replanifie alors à chaque appel, avec les vraies bornes.
Replanifier coûte une fraction de milliseconde ; se tromper de plan en coûte
vingt-sept mille.

**Et le détail qui a coûté le plus de temps à trouver** : ce réglage n'a
**aucun effet** sur une fonction `language sql` — son corps ne passe pas par le
cache de plans qui l'honore. D'où le `begin … return (…) ; end` en `plpgsql`
qui enveloppe la requête. Il ne fait rien d'autre que la confier à un moteur
qui écoute ce réglage. Mesuré ensuite : **380 ms**.

**Pourquoi c'est un patron et pas une anecdote.** Le symptôme aurait été le
pire qui soit en production : correct en démonstration, correct chez un client
qui démarre, et **de plus en plus lent chez celui qui vend le plus** — sans
qu'une ligne de code ait changé. Un redémarrage de serveur l'aurait même
« réparé » quelques requêtes durant.

Deux tests figent donc la **déclaration** de la fonction (`plpgsql` et
`force_custom_plan`), et non sa durée : un test de durée serait instable en
intégration continue, alors qu'un `begin … end` qui a l'air inutile finit
toujours par être « nettoyé ».

**La leçon générale, valable hors PostgreSQL :** *un plan de requête est une
hypothèse sur les données.* Dès qu'un paramètre décide de la taille du
résultat, il faut vérifier que le moteur peut le savoir — ou le lui imposer.

---

# PARTIE III — La sécurité

## 18. Trois identités distinctes, jamais confondues
> ⟶ `packages/domain/src/pin.ts:92` — le PIN, qui TRACE
> ⟶ `apps/sync/src/jeton.ts` — le jeton d'appareil, qui PROTÈGE


C'est la décision de sécurité la plus structurante du produit, et elle tient à
une observation de terrain : **un serveur en salle change cinq fois par
service, la tablette reste allumée toute la journée.**

| Identité | Mécanisme | Répond à | Portée |
|---|---|---|---|
| **Utilisateur** | Supabase Auth, e-mail + mot de passe | qui se connecte ? | back-office |
| **Appareil** | jeton long révocable, lié au `device_id` | quelle machine parle ? | `/sync` |
| **Employé** | code PIN vérifié **hors ligne** (Argon2id) | **qui agit** ? | terminal |

Confondre les deux premières mène à des reconnexions permanentes ; confondre
les deux dernières mène à une traçabilité inexistante.

**Le vocabulaire à retenir :** *authentification* (qui es-tu), *autorisation*
(as-tu le droit), **attribution** (qui a fait ça). Le PIN ne fait que la
troisième — et c'est écrit noir sur blanc dans le code :

> **Le PIN trace, il ne protège pas.** Quatre chiffres, dix mille
> combinaisons. Ce qui protège l'argent, c'est le jeton d'appareil révocable,
> RLS, et le journal d'audit.

Savoir **ce qu'un mécanisme ne protège pas** vaut mieux que de le croire fort.
C'est un modèle de menace, en une phrase.

---

## 19. RLS — l'autorisation au plus près de la donnée
> ⟶ `supabase/migrations/0003_taxes_et_catalogue.sql` — `protege_transactionnel()`
> ⟶ `apps/backoffice/src/serveur/supabase.ts` — la clé publique, et rien d'autre


**Le problème.** Le cloisonnement entre clients repose-t-il sur la vigilance
de chaque `where restaurant_id = …` écrit à la main ? Un seul oubli rend les
données d'un autre client.

**Le patron : Row-Level Security** — la règle est portée par la **table**, pas
par la requête. Une requête sans `where` ne rend **aucune** ligne. Le pire cas
devient une page vide, jamais une fuite.

Conséquence directe : le back-office n'utilise **que la clé publique** de
Supabase, avec la session de l'utilisateur. Un contrôle au démarrage refuse la
clé de service, et une garde de CI l'interdit dans tout ce qui est livré à un
navigateur.

**Le corollaire qu'on oublie toujours.** RLS protège **entre clients**. Elle
ne dit pas *quel écran* un membre légitime de CE restaurant peut ouvrir. Ce
cloisonnement-là est **applicatif par nature** :

- `ecranReserve()` refuse côté serveur les écrans de gestion à un rôle de
  préparation — parce que taper l'URL à la main rendait le chiffre d'affaires ;
- **les exports passent par le même garde**, sinon un export rend ce qu'on
  vient de retirer de l'écran ;
- `memberships_lecture` rend, **à dessein**, toutes les appartenances de mes
  établissements — l'écran « Employés » en dépend. Une requête sans
  `where user_id = moi` ne rend donc pas mon rôle, mais ceux de toute
  l'équipe.

**La leçon générale :** un mécanisme de sécurité a un **périmètre**. Le
connaître, c'est savoir où il faut un second mécanisme. C'est la *défense en
profondeur*, et ce n'est pas « en mettre deux » : c'est en mettre deux
**différents**, qui échouent différemment.

---

## 20. Moindre privilège — trois rôles, trois portées
> ⟶ `apps/sync/src/depot-postgres.ts:143` — `sousIdentite()`, l'emprunt de rôle


| Qui | Rôle Postgres | Peut |
|---|---|---|
| Le navigateur | `authenticated` (clé publique) | ce que RLS lui rend |
| Le service de sync | `kaissi_device` **emprunté** | ce que le contexte de session autorise |
| Le service de sync (admin) | `service_role` | tout — et il relit donc les droits en base |

Le point technique intéressant est l'**emprunt d'identité** :
`apps/sync/src/depot-postgres.ts` → `sousIdentite()`. Le service prend le rôle
`kaissi_device` et pose le contexte en variables de session
(`kaissi.device_id`, `kaissi.restaurant_id`), **dans la transaction** :

```sql
set local role kaissi_device;
select set_config('kaissi.device_id', $1, true);
```

Tout passe alors par RLS. Un défaut de filtrage applicatif **ne peut pas**
provoquer de fuite entre restaurants — la base refuserait.

**Le `local` compte** : le réglage meurt avec la transaction. Sans lui, une
connexion rendue au pool garderait le contexte du restaurant précédent, et
c'est exactement ainsi qu'on fabrique une fuite entre clients.

---

## 20 bis. La frontière exprimée en privilèges — ce que la caisse ne peut même pas lire
> ⟶ `supabase/migrations/0042_moindre_privilege_abonnements.sql` — le `revoke`
> ⟶ `apps/sync/test/rls-partout.test.ts` — la garde qui l'exige

**Le problème.** Kaissi vend des formules d'abonnement. La règle qui les
encadre est absolue :

> **Un abonnement ne ferme QUE des écrans de gestion. Jamais un geste de
> caisse.**

Elle est écrite en tête de `packages/domain/src/abonnement.ts`, répétée dans
la migration qui crée la table, et tenue par un test de conception qui refuse
tout nom de module contenant « caisse », « encaissement », « hors_ligne »,
« vente » ou « impression ».

Cela ne suffit pas. Un commentaire, même excellent, ne survit pas à une
demande pressante un mardi après-midi. Quelqu'un écrira, de bonne foi, un
`if (formule === 'gratuit')` sur un chemin de vente — et personne ne le verra
passer, parce que rien ne l'en empêchait.

**Le patron.** Retirer au rôle la capacité **physique** de poser la question.

```sql
revoke select on kaissi.subscriptions from kaissi_device;
```

La caisse n'a plus rien à lire. Aucun code du POS ne peut se mettre à dépendre
d'un abonnement, parce qu'il n'obtiendrait qu'une erreur de privilège — au
premier essai, sur le poste du développeur, et non six mois plus tard chez un
client.

**C'est une règle qu'on ne peut pas enfreindre, au lieu d'une règle qu'on
rappelle.** La différence est tout le sujet de cette section.

> **Le privilège avait été accordé, et sa justification paraissait raisonnable :**
> « l'écran Diagnostic de la caisse peut vouloir dire quelle formule est en
> cours ». *Peut vouloir* n'est pas un besoin. Un privilège accordé pour un
> usage qui n'existe pas est un usage qui finit par exister — et c'est
> exactement ce que le moindre privilège (§20) interdit, sans exception « au
> cas où ».

**Comment savoir qu'un privilège exprime une frontière** : demande-toi ce
qu'un développeur pressé pourrait construire avec. Si la réponse est « la
chose que ce document interdit », le privilège fait partie du problème.

---

## 21. Le député confus — pourquoi le service relit les droits
> ⟶ `apps/sync/src/serveur.ts` — les routes `/admin`, qui relisent les droits en base


**Le problème.** Le back-office appelle le service pour créer un compte, parce
que cela exige `service_role`. Le service a plus de pouvoirs que son appelant.
Comment éviter qu'un appelant lui fasse faire ce qu'il n'a pas le droit de
faire lui-même ?

C'est le **problème du député confus** (*confused deputy*) : un composant
privilégié agit pour le compte d'un composant qui ne l'est pas.

**La solution appliquée**, dans `apps/sync/src/serveur.ts` :

1. l'appelant transmet **le jeton de sa session**, pas une affirmation ;
2. le service **relit ses droits en base** — il ne croit pas le back-office ;
3. les paramètres sensibles sont **dérivés**, jamais acceptés. Sur
   `POST /admin/restaurants`, l'`organizationId` vient d'un établissement que
   l'appelant administre déjà. Le lire depuis la requête permettrait d'ouvrir
   un restaurant chez un autre client, et RLS ne l'arrêterait pas.

**La règle à retenir :** *un service privilégié ne doit jamais accepter d'un
appelant un paramètre qui décide de la portée de son action.* Il le dérive de
l'identité de l'appelant.

---

## 22. Le privilège de colonne, et l'incident qu'il a causé
> ⟶ `supabase/migrations/0024_admin_seul_donne_les_cles.sql` — le privilège de colonne


La migration `0014` accorde à un gérant l'écriture sur `users`, **colonne par
colonne** : `full_name`, `phone`, `pin_hash`, `status`, `archived_at`. Pas
`email` — le changer désynchroniserait la ligne de `auth.users` en silence.

**L'incident.** Le back-office écrivait `updated_at` « en passant », avec le
`pin_hash`. Postgres refuse alors **toute l'instruction**, avec :

```
permission denied for table users
```

Message exact, cause invisible : ni le nom de la colonne fautive, ni le mot
« colonne ». La réinitialisation du PIN **et** la suspension étaient cassées,
pour la même raison, et rien ne le disait.

**La correction n'a pas été d'élargir le privilège** — c'était l'invitation
évidente. La colonne est tenue par un déclencheur ; le back-office n'a aucune
raison de l'écrire. Cinq tests RLS l'ont figé
(`apps/sync/test/rls-gestion-employes.test.ts`).

**Deux leçons.**
1. Un privilège fin produit des messages d'erreur grossiers. Prévois-le.
2. Quand un contrôle de sécurité gêne, la première hypothèse à écarter est
   « le contrôle est trop strict ». Ici, le code était fautif.

---

## 23. Le hachage des PIN — Argon2id, et pourquoi pas autre chose
> ⟶ `packages/domain/src/pin.ts:92` — `hacherPin()`, Argon2id


| Choix | Verdict |
|---|---|
| SHA-256 | **non** — conçu pour être rapide, donc parfait pour attaquer |
| bcrypt | acceptable, mais coût mémoire fixe |
| **Argon2id** | **retenu** — coûteux en **mémoire**, donc résistant au GPU |

Les paramètres sont **encodés dans le hachage lui-même**
(`argon2id$m=8192,t=3,p=1$…`), ce qui permet de les durcir plus tard sans
invalider les PIN existants.

Le hachage est vérifié **hors ligne, sur la tablette** — c'est ce qui permet
une prise de poste en mode avion. Le serveur envoie le **hachage**, jamais le
PIN.

---

## 23 bis. Limitation de débit — protéger l'entrée, jamais la caisse
> ⟶ `apps/sync/src/limiteur.ts:89` — `Limiteur`, fenêtre glissante en mémoire
> ⟶ `apps/sync/src/serveur.ts:116` — les deux limiteurs, et le commentaire qui dit où ils NE s'appliquent pas

**Le problème.** `POST /appairage` accepte un e-mail et un mot de passe **sans
authentification préalable**. C'est le seul endroit du produit où l'on peut
*essayer* un secret, et il n'avait aucune limite.

**Ce qui rend ce défaut plus grave qu'il n'en a l'air.** Le bourrage
d'identifiants est le risque évident ; le vrai est ailleurs. Chaque tentative
appelle GoTrue, **dont le quota est par projet Supabase** — et c'est notre
serveur qu'il voit, pas l'attaquant. Il n'était donc pas nécessaire de trouver
un mot de passe : saturer suffisait pour que **les vrais gérants ne puissent
plus appairer**. L'endpoint était un amplificateur de déni de service.

**Le patron : compteur à fenêtre glissante, sur DEUX dimensions.**

| Dimension | Arrête |
|---|---|
| par **IP** | le balayage depuis une machine |
| par **adresse e-mail** | le bourrage où l'attaquant change d'IP mais garde sa cible |

L'une sans l'autre en laisse passer la moitié. C'est le point général : *une
limite se pose sur ce qui identifie l'attaque, et une attaque a souvent deux
identités.*

**Ce qui n'est délibérément PAS limité : `/sync/*`.** Une caisse qui rattrape
trois semaines hors ligne envoie légitimement des dizaines de lots à la
suite ; la freiner retarderait des encaissements **déjà faits**. Le jeton
d'appareil fait 32 octets aléatoires — il n'y a rien à protéger contre la
force brute. *L'encaissement ne doit jamais s'arrêter* vaut aussi contre nos
propres garde-fous, et c'est le test le plus important du fichier.

**Deux défauts trouvés dans le correctif lui-même**, avant qu'il ne parte —
et ils disent quelque chose sur la manière de relire un garde-fou :

- il devenait **O(n log n) par requête** une fois son plafond de clés atteint,
  c'est-à-dire précisément sous l'attaque qu'il devait absorber (8 s pour
  25 000 clés → 54 ms après correction, par éviction dans l'ordre d'insertion
  plutôt que par tri) ;
- il utilisait une **propriété de paramètre**, que le *type stripping* de Node
  refuse : **le service n'aurait pas démarré**. Une règle ESLint le refuse
  maintenant à la frappe (§25).

**Limite connue et assumée** : le compteur est en mémoire, donc **par
processus**. Avec plusieurs instances, un attaquant obtient N fois le quota.
Le jour du passage à l'échelle horizontale, il doit descendre dans Postgres ou
Redis. *Un limiteur qu'on croit distribué sans l'être est pire que pas de
limiteur*, parce qu'on cesse de regarder.

---

## 23 ter. Défense en profondeur — la CSP ne remplace pas RLS, elle échoue ailleurs
> ⟶ `apps/backoffice/src/middleware.ts:47` — `politiqueContenu()`, nonce par réponse
> ⟶ `apps/backoffice/next.config.mjs:49` — HSTS, nosniff, COOP, X-Frame-Options

**Le problème.** Le back-office n'envoyait **aucun** en-tête de sécurité. Il
était encadrable dans une iframe — donc détournable au clic — et le navigateur
n'avait aucune consigne sur ce qu'il avait le droit de charger.

**Le patron : *defence in depth*.** Le point important n'est pas d'empiler des
protections, c'est que **chacune échoue différemment** :

| Mécanisme | Empêche | N'empêche PAS |
|---|---|---|
| **RLS** | qu'un client LISE les données d'un autre | qu'un script injecté agisse dans la session d'un gérant légitime |
| **CSP** | qu'un script injecté s'exécute | qu'une requête légitime rende trop de lignes |
| **`ecranReserve()`** | qu'un rôle de préparation ouvre l'écran des ventes | quoi que ce soit entre CLIENTS — c'est le travail de RLS |

Un mécanisme dont on ne sait pas dire **ce qu'il ne protège pas** est un
mécanisme dont on surestime la portée. La question 5 de la checklist finale
existe pour cela.

**Le détail qui fait la différence entre une CSP et un décor :** le nonce est
**renouvelé à chaque réponse**. Une valeur écrite dans la configuration serait
constante, donc devinable, donc exactement aussi utile que `'unsafe-inline'`.

`'unsafe-inline'` reste d'ailleurs sur les **styles**, et jamais sur les
scripts : React pose des styles en ligne, et un style injecté **défigure** une
page là où un script la **détourne**. Le compromis est asymétrique, et il
penche du bon côté.

**Vérifié dans un vrai navigateur**, en mode développement *et* en mode
production : zéro violation, hydratation vivante. *Une CSP qu'on n'a pas
chargée dans un navigateur est une hypothèse, pas une protection.*

---

# PARTIE IV — Fiabilité et exploitation

## 24. Auto-réparation — le bug qui a justifié le patron
> ⟶ `apps/sync/src/reparation.ts:53` — la boucle qui reprend ce qui a échoué


**La panne, observée en production.** Deux ventes avaient *tous* leurs
événements dans `order_events`, `order.closed` compris, et **aucune ligne**
dans `orders`. La caisse affichait « À jour, 0 opération en attente ». Le
gérant ne les a jamais vues.

L'enchaînement :

1. les événements sont insérés et validés dans **leur** transaction ;
2. la reprojection, qui a **la sienne**, échoue → 500 ;
3. la caisse garde son outbox et réessaie, comme elle doit ;
4. au second passage, l'idempotence reconnaît **tout** le lot — donc plus
   aucun événement n'est « recevable », et la reprojection n'était rappelée
   que pour ceux-là ;
5. le serveur répond 200, la caisse vide son outbox.

La vente survit dans le journal. Elle n'entre jamais dans la projection.
**Définitivement.**

**Deux corrections, et il fallait les deux :**
- la reprojection est rappelée **même** quand tout le lot est un doublon ;
- un **balayage de réparation** cherche périodiquement les commandes dont le
  journal a des événements mais pas de projection.

**Le patron : Self-Healing / Reconciliation Loop.** Dans un système
distribué, ce n'est pas « si » un état incohérent apparaît, c'est « quand ».
Une boucle qui le détecte et le corrige vaut mieux qu'une preuve que cela ne
peut pas arriver.

**La leçon la plus utile de tout ce document :** deux transactions séparées ne
sont *pas* une transaction. Chaque fois que tu en écris deux à la suite,
demande-toi ce qui se passe si la seconde échoue — et écris la boucle qui le
rattrape.

---

## 25. Les gardes de CI — les règles qu'une relecture ne tient pas
> ⟶ `.github/workflows/ci.yml:257` — « Règles absolues »
> ⟶ `apps/pos/scripts/verifier-mode-avion.mjs:10` — la garde `server.url`


`.github/workflows/ci.yml` porte un job « Règles absolues » qui refuse :
un `server.url` dans la configuration Capacitor ; une colonne monétaire sans
suffixe `_millimes` ; un type flottant dans le schéma ; la disparition d'un
`REVOKE` ou d'un index d'idempotence ; une clé de service dans du code livré à
un navigateur ; un PIN en clair.

**Ce sont des tests, pas de la documentation.** Une règle écrite dans un
`README` est respectée six mois ; une règle vérifiée par la CI l'est toujours.

**Le contre-exemple, arrivé dans ce dépôt.** La garde sur la clé de service
interdisait le mot *partout*. Quand la clé est arrivée — légitimement — dans
le service de synchronisation, la CI a échoué sur du code **correct**.

Une garde qui échoue sur du code correct finit désactivée, et ce jour-là elle
ne protège plus rien. Elle a donc été rendue **directionnelle** : interdite
dans ce qui descend vers un navigateur, libre dans le service.

**La leçon :** le taux de faux positifs d'un contrôle automatique n'est pas un
détail de confort. C'est ce qui décide s'il survivra.

---

## 25 bis. La garde d'énumération — vérifier la RÈGLE, pas l'instance
> ⟶ `apps/sync/test/rls-partout.test.ts` — aucune table sans RLS
> ⟶ `apps/backoffice/src/serveur/ecrans-reserves.test.ts` — aucun écran sans garde de rôle
> ⟶ `apps/backoffice/src/serveur/use-server.test.ts` — aucun export non-async dans un `'use server'`

**Le problème.** Les deux incidents les plus graves de ce dépôt ont la même
forme, et ce n'est pas une coïncidence.

- Trois écrans — `ventes`, `tickets`, `tableau-bord` — ne vérifiaient aucun
  rôle. Une URL tapée à la main rendait le chiffre d'affaires à un cuisinier.
- Une table écrite à la main (`subscriptions`) portait sa politique de lecture
  **sans le `grant` correspondant** : la politique existait, la lecture
  échouait quand même.

Dans les deux cas, la règle était écrite, comprise, et appliquée **partout
sauf à un endroit**. On a corrigé l'endroit. Rien n'empêchait le suivant.

**Le patron.** Ne pas tester les instances — **énumérer l'univers et tester la
règle**.

```
pour chaque table du schéma kaissi     → RLS + force + au moins une politique
pour chaque page sous [restaurant]/    → appelle ecranReserve(), ou déclare son exemption
pour chaque export de fichier 'use server' → est une fonction async
```

Ce qui change : une garde d'instance protège ce qu'on a pensé à lui donner ;
une garde d'énumération protège **ce qui n'existe pas encore**. Le code neuf
naît couvert.

**Trois propriétés, et il faut les trois** :

1. **un plancher sur le compte.** Un test qui balaie un dossier peut passer en
   ne trouvant RIEN : un chemin faux, une arborescence déplacée, et la garde
   devient une décoration verte. `expect(tous.length).toBeGreaterThan(20)`
   coûte une ligne et transforme un faux ✓ en échec ;
2. **des exemptions déclarées, avec leur raison.** Trois écrans n'ont
   légitimement pas de garde — une racine qui redirige, l'écran de la cuisine,
   une ancienne adresse. Les nommer fait de chaque exemption une décision
   relue, et non un oubli qui ressemble à une décision. Un test supplémentaire
   exige que la raison fasse plus de trois mots ;
3. **l'exemption se périme.** Une quatrième assertion vérifie qu'aucune
   exemption n'est devenue fausse. Une exemption qui n'a plus lieu d'être
   n'ouvre rien aujourd'hui — mais elle rouvre la porte le jour où quelqu'un
   retire un garde en croyant que la liste dit vrai.

> **Comment on sait qu'une garde d'énumération fonctionne :** on la sabote.
> Retirer `force row level security` d'une table, retirer `security_invoker`
> d'une vue, accorder un `select` à `anon`, retirer l'appel d'un écran, ajouter
> un écran vide — chacun de ces cinq gestes doit faire échouer un test
> **qui nomme le coupable**. Une garde qui échoue sans dire quoi déplace la
> recherche du côté du dépôt.

**Et la limite, assumée :** la garde des écrans lit le TEXTE du module, elle ne
vérifie pas que l'appel est atteint. C'est grossier. Mais un écran qui ne
nomme pas son garde ne peut certainement pas le franchir — et c'est ce
défaut-là qui s'est produit trois fois.

---

## 26. Observabilité — l'écran qui répond à la vraie question
> ⟶ `apps/pos/src/ecrans/EcranDiagnostic.tsx:34` — l'écran du gérant


Pas de Prometheus, pas de Grafana : un **écran Diagnostic** sur la tablette,
lisible par le gérant.

Le détail qui vaut d'être noté : il affiche **deux** informations qui se
ressemblent et ne disent pas la même chose.

- *Dernière synchronisation* → « ai-je du réseau ? »
- *Dernier changement reçu* → « **ce** changement-là est-il arrivé ici ? »

Elles ont été confondues pendant longtemps, et cela a coûté un diagnostic
faux : un code PIN tout juste changé était refusé, la caisse affichait « à
jour », et elle l'était — pour tout sauf ça.

**La leçon générale :** une métrique utile répond à une **question qu'on se
pose vraiment**. « Le service est-il en vie » n'est presque jamais cette
question.

---

## 26 bis. Journal structuré — pour qu'une panne se cherche, pas se devine
> ⟶ `apps/sync/src/journal.ts:125` — `journal`, une ligne = un objet JSON

**Le problème.** Le service journalisait en `console.log`, en texte libre. Sur
le tableau de bord d'un hébergeur, ces lignes sont indistinguables du reste :
impossible de filtrer « montre-moi les erreurs », impossible de suivre UNE
requête à travers plusieurs lignes, impossible de compter. On lit donc tout, à
l'œil, en remontant — c'est-à-dire qu'on ne lit pas.

**Le patron : JSONL** — une ligne, un objet JSON. C'est ce que savent lire
Railway, Vercel, Datadog, Loki et `jq`, sans aucune dépendance : quarante
lignes remplacent un paquet de plus à suivre, à mettre à jour et à auditer.

**Mais le format n'est pas ce qui compte le plus.** Ce qui compte est **ce qui
ne doit pas y entrer**. Un journal finit chez un hébergeur, dans un
agrégateur, parfois collé dans un ticket de support : un jeton d'appareil qui
s'y glisse une seule fois est un jeton à révoquer, et personne ne saura lequel.

Le masquage porte donc sur le **NOM du champ**, en profondeur — jamais sur la
valeur. Une expression régulière sur la valeur laisserait toujours passer le
format qu'on n'avait pas prévu ; une liste de noms est explicite, relisible, et
son défaut est de masquer un champ anodin de trop.

**Deux garde-fous qui n'ont l'air de rien**, et qui sont les vrais pièges de
ce patron :

- **la profondeur est bornée** — une erreur `pg` porte sa connexion, qui se
  porte elle-même ; une trace qui tue le processus est pire que la panne
  qu'elle décrit ;
- **`Error` est traitée à part** — parce que `JSON.stringify(new Error('x'))`
  rend `{}`. Le message et la pile disparaîtraient exactement au moment où on
  en a besoin.

**Tout sur `stdout`, y compris les erreurs**, et non `stderr` : les hébergeurs
mélangent les deux flux dans un même journal, et les séparer fait perdre
l'ORDRE relatif des lignes. Une erreur apparaîtrait alors avant la requête qui
l'a causée.

---

## 26 ter. Frontière d'erreur — ce que voit le client quand ça casse
> ⟶ `apps/backoffice/src/app/error.tsx:32` — l'écran d'erreur
> ⟶ `apps/backoffice/src/app/global-error.tsx` — celui qui ne dépend d'aucun style

**Le problème, tel qu'il s'est produit.** Six écrans de rapport sont tombés en
production. Ce que le client a vu :

```
Application error: a server-side exception has occurred
(see the server logs). Digest: 857891440
```

En anglais, sans issue, et « voir les journaux » s'adresse à quelqu'un qui
n'est pas là.

**Le patron : *error boundary*** — mais le patron n'est pas le sujet. Le sujet
est **l'ordre dans lequel l'écran parle** :

1. **« vos données ne sont pas perdues »** — c'est la première inquiétude
   devant une caisse cassée, et personne ne lit la suite tant qu'elle n'est pas
   levée ;
2. **quoi faire maintenant** — un bouton « Réessayer », un lien de retour ;
3. **le code à donner au support** — le `digest`, en petit. C'est **lui** qui
   permet de retrouver la trace côté serveur, et c'est la seule raison de
   l'afficher.

**Le détail non évident :** `global-error.tsx` ne dépend d'**aucune** feuille
de style — tout est en styles en ligne. C'est précisément le CSS qui peut
manquer quand cet écran-là s'affiche.

**La leçon générale :** un message d'erreur s'écrit pour **celui qui le lira**.
« An unexpected error occurred » est écrit pour le développeur qui n'a pas
voulu choisir.

---

# PARTIE V — Ce qu'on n'a PAS fait

Savoir ce qu'on n'a pas construit est aussi instructif que l'inverse. Les
architectures échouent plus souvent par excès que par manque.

| Écarté | Pourquoi |
|---|---|
| **Microservices** | Trois processus, une base. Un POS de restaurant a un domaine *cohérent* : le découper multiplierait les transactions distribuées pour aucun bénéfice d'échelle. On découpe quand les **équipes** se marchent dessus, pas avant. |
| **ORM** | Le SQL est écrit à la main. Les requêtes qui comptent — reprojection, curseurs, RLS — sont celles qu'un ORM rend opaques. |
| **GraphQL** | Un client (le POS) qui parle un protocole figé et versionné : la flexibilité de GraphQL est ici un coût sans contrepartie. |
| **Kafka / file de messages** | La file est déjà là, et elle est locale : c'est l'outbox de la tablette. Un courtier ajouterait une pièce à faire tourner, et ne résoudrait rien de plus. |
| **Redis** | Rien à mettre en cache sur le chemin de la caisse — tout est déjà local. |
| **CRDT / PowerSync** | Le jalon avait été écrit à l'avance : *si la synchronisation n'est pas fiable à trois appareils avec coupures, on bascule sans débat*. Le banc passe. Le moteur maison est conservé, la porte de sortie reste ouverte. |
| **WebSocket sur le chemin de la caisse** | Elle doit fonctionner sans réseau. Une connexion permanente n'est pas une amélioration, c'est une dépendance. |

**Le patron implicite :** *YAGNI*, mais informé. On n'écarte pas par
paresse — on écarte en ayant écrit le **critère de bascule**. C'est ce qui
distingue « on verra » d'une décision.

---

## Et ce qu'on a MESURÉ puis écarté

La section précédente écarte des architectures. Celle-ci écarte des
**optimisations**, et c'est un exercice différent : on n'écarte pas sur un
raisonnement, on écarte sur un chiffre. Sans le chiffre écrit quelque part,
la même idée revient tous les six mois et on la re-discute.

| Piste | Mesure | Verdict |
|---|---|---|
| Index sur `orders(restaurant_id, closed_at)` | aucun gain : le chargement rendait déjà **toutes** les lignes de la période — l'index n'évitait rien | écarté… **puis créé** (§17 bis) |
| Fusionner les politiques permissives multiples sur 18 tables *(recommandé par l'analyseur Supabase)* | 3,569 ms contre 3,552 ms sur 50 000 produits | **écarté** — réécrire dix-huit politiques de **sécurité** pour zéro gain mesurable est un mauvais échange |
| `(select auth.uid())` au lieu de `auth.uid()` | 3,628 ms → 3,492 ms sur 40 000 lignes, soit 4 % — dans le bruit | **appliqué quand même**, mais pas pour la performance |
| Indexer les 86 clés étrangères non indexées | aucune requête du produit ne les emprunte | écarté |
| Les 4 alertes `postcss` | non exploitables — outil de build, jamais exécuté chez un client | écartées, **avec leur raison et leur date de revue** |

**Trois choses valent d'être retenues de ce tableau, et aucune n'est un
chiffre.**

**1. Une mesure vaut pour une requête, pas pour une table.** L'index sur
`(restaurant_id, closed_at)` a été écarté à juste titre : à l'époque, le
chargement rendait toutes les lignes et un index n'évite rien quand il faut
tout lire. Il a été créé six commits plus tard, sans que la table ait changé —
parce que **la requête**, elle, avait changé : une agrégation peut s'arrêter à
l'index. *Une décision de performance est datée par la requête qu'elle sert.*

**2. Un outil qui suggère n'est pas un outil qui mesure.** L'analyseur de
Supabase avait raison sur le diagnostic (`auth.uid()` apparaît par ligne dans
le PLAN) et tort sur la conséquence : la fonction est déclarée `stable`, donc
PostgreSQL met déjà son résultat en cache. Le gain réel est de 4 %.

On l'a appliqué **quand même**, et pour une raison qui n'est pas la
performance : *un avertissement permanent qu'on a décidé d'ignorer enterre
celui qui, un jour, comptera vraiment.* Garder un tableau de bord d'analyse
**lisible** est une raison suffisante — à condition de le dire, ce que fait la
migration `0032` en tête de fichier.

**3. Une exception documentée n'est pas une exception.** Les quatre alertes
`postcss` sont listées dans `pnpm.auditConfig.ignoreGhsas`, chacune avec **sa
raison** et **sa date de revue**. Ce n'est pas une liste de dérogations, c'est
la trace d'une décision — et tout avis **non listé** fait échouer la
construction. La différence entre les deux est exactement la différence entre
un garde-fou et un décor.

---

# Comment décider, la prochaine fois

Les questions qui ont produit toutes les décisions ci-dessus. Elles ne sont
plus six — chaque incident en a ajouté une, et c'est ainsi que la liste doit
grandir : une question qu'on n'a pas su se poser coûte toujours une panne
avant d'être écrite.

1. **Quelle est la contrainte dominante ?** Écris-la en une phrase. Tout ce
   qui ne s'y rapporte pas est du logiciel ordinaire.
2. **Qu'est-ce qui est irréversible ?** Le schéma, les identifiants, la
   tenance, le vocabulaire d'événements. Ceux-là se décident tôt. Le reste
   attend.
3. **Que se passe-t-il si cette étape échoue au milieu ?** Si la réponse n'est
   pas « rien de grave » ou « une boucle le rattrape », il manque quelque
   chose.
4. **Cette donnée décrit-elle un fait passé ou un état courant ?** Le fait se
   copie, l'état se joint.
5. **Ce mécanisme de sécurité protège de quoi, et de quoi PAS ?** La seconde
   moitié de la réponse dit où il faut un second mécanisme.
6. **Comment le saurai-je quand ça cassera ?** Si la réponse est « le client
   appellera », l'observabilité manque.
7. **Ce calcul est-il une DÉCISION ou une ADDITION ?** Une décision ne se
   duplique jamais ; une addition se déplace librement, y compris dans la base
   (§17 bis). Confondre les deux fait soit un noyau qu'on contourne, soit des
   écarts de caisse.
8. **Quelle hypothèse mon moteur fait-il sur mes données ?** Un plan de
   requête, un cache, un dimensionnement de pool sont des paris sur des
   volumes. Le jour où le pari est faux, rien ne casse — ça ralentit, chez le
   client qui s'en sert le plus (§17 ter).
9. **Ai-je mesuré, ou ai-je supposé ?** Et si j'ai mesuré : *où le chiffre
   est-il écrit ?* Une optimisation écartée sans trace revient tous les six
   mois.
10. **Cette opération COMMUTE-t-elle ?** Si deux exécutions concurrentes
    donnent le même résultat dans n'importe quel ordre, elle s'ouvre sans
    machinerie. Sinon, ce qui coûte n'est pas l'écriture — c'est l'arbitrage
    qu'elle traîne derrière (§13 ter).
11. **Ce privilège exprime-t-il une frontière ?** Demande-toi ce qu'un
    développeur pressé pourrait construire avec. Si la réponse est « la chose
    que la documentation interdit », le privilège fait partie du problème :
    une règle qu'on ne PEUT pas enfreindre vaut mieux qu'une règle qu'on
    rappelle (§20 bis).
12. **Est-ce que je teste une instance, ou la RÈGLE ?** Corriger l'endroit où
    la règle a été oubliée ne protège pas le suivant. Énumérer l'univers, si
    (§25 bis).

---

# Pour aller plus loin

Par ordre d'utilité pour ce qui précède :

- **Martin Kleppmann, *Designing Data-Intensive Applications*** — le livre à
  lire si tu n'en lis qu'un. Les chapitres 5 (réplication), 7 (transactions),
  8 (défauts des systèmes distribués) et 11 (traitement de flux) couvrent
  directement les parties I et II.
- **Vaughn Vernon, *Implementing Domain-Driven Design*** — pour le shared
  kernel, les contextes bornés, et le vocabulaire d'événements.
- **Documentation PostgreSQL, chapitre *Row Security Policies*** — courte, et
  elle contient tous les pièges de la partie III.
- **Pat Helland, *Life beyond Distributed Transactions*** — un article de dix
  pages qui explique pourquoi l'idempotence remplace les transactions
  distribuées. C'est le fondement des parties 5 et 6.
- **Marc Brooker, *Timeouts, retries and backoff with jitter*** (blog AWS
  Builders' Library) — pourquoi la gigue n'est pas une coquetterie.

Et dans ce dépôt :

- **[`docs/audit-production.md`](audit-production.md)** — l'audit complet dont
  sortent les sections 17 bis, 17 ter, 23 bis, 23 ter, 26 bis et 26 ter. Il
  donne pour chaque défaut la mesure qui l'a révélé, ce qui vaut mieux qu'un
  patron nommé.
- **[`docs/architecture.md`](architecture.md)** — les mêmes décisions, en
  version courte, sans le raisonnement.

Et le plus utile de tous : **relis les migrations de ce dépôt dans l'ordre**,
de `0001` à la dernière. Chacune porte en tête le problème qu'elle résout. On
y voit une architecture se construire par décisions successives — y compris
les corrections, qui sont ce qu'on apprend le mieux.
