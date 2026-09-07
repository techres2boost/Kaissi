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

**Le problème.** SQLite s'appelle différemment sur Android (plugin Capacitor),
dans un navigateur (wa-sqlite/OPFS) et sous Node (better-sqlite3). Écrire trois
fois la logique métier serait garantir trois comportements.

**Le patron : Ports & Adapters** (*hexagonal architecture*). Le port est une
interface ; les adaptateurs l'implémentent.

**Où :** `packages/db-local/src/adaptateur.ts` (le port — six méthodes),
`adaptateurs/capacitor.ts` et `adaptateurs/node.ts` (les adaptateurs).

**Le bénéfice concret, et il est plus grand qu'il n'y paraît :** les
migrations, les dépôts et le projecteur sont testés **contre le vrai SQLite**,
sous Node, sans émulateur Android. C'est ce qui rend possible d'écrire un test
avant de brancher une tablette.

**La règle pour reconnaître un bon port :** il ne doit parler que le
vocabulaire du domaine, jamais celui d'une technologie. Le nôtre parle de
`executer`, `lire`, `transaction` — pas de `Capacitor`, ni de `WASM`.

---

## 5. Transactional outbox — ne jamais perdre une vente

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

## 6. Clé d'idempotence — la garantie « jamais de double encaissement »

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

## 12. Horloge logique — un curseur, jamais un timestamp

**Le problème.** Sur quoi une tablette dit-elle « donne-moi ce qui a changé
depuis… » ?

**La mauvaise réponse : un timestamp.** Les horloges des tablettes dérivent,
sont réglées à la main, changent de fuseau. Deux événements insérés dans la
même milliseconde sont indiscernables. Une transaction longue peut valider un
`now()` antérieur à une transaction plus récente — et un curseur temporel
saute alors l'événement, **définitivement et sans trace**.

**Le patron : Logical Clock** — un compteur monotone attribué par un seul
acteur, le serveur. `change_log.seq`, `order_events.server_seq`, des
`bigserial`.

**Où :** `supabase/migrations/0005_sync.sql`.

**La leçon générale :** dans un système distribué, le temps n'est pas un
ordre. Chaque fois qu'un `order by created_at` sert à la **correction** d'un
algorithme (et non au confort d'affichage), c'est un bug qui attend.

---

## 13. Journal append-only + chaînage par hash

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

## 14. UUIDv7 — l'identifiant vient de celui qui crée

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

**Comment reconnaître ce cas :** demande-toi si la donnée décrit **un fait
passé** ou **un état courant**. Un fait passé se copie ; un état courant se
joint. Une facture est un fait ; un solde est un état.

---

## 16. Index unique partiel — la contrainte qui sait faire une exception

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

## 17. Migrations — en avant seulement, et additives

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

# PARTIE III — La sécurité

## 18. Trois identités distinctes, jamais confondues

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

## 21. Le député confus — pourquoi le service relit les droits

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

# PARTIE IV — Fiabilité et exploitation

## 24. Auto-réparation — le bug qui a justifié le patron

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

## 26. Observabilité — l'écran qui répond à la vraie question

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

# Comment décider, la prochaine fois

Les six questions qui ont produit toutes les décisions ci-dessus :

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

Et le plus utile de tous : **relis les migrations de ce dépôt dans l'ordre**,
de `0001` à la dernière. Chacune porte en tête le problème qu'elle résout. On
y voit une architecture se construire par décisions successives — y compris
les corrections, qui sont ce qu'on apprend le mieux.
