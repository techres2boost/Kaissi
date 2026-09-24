# System design × DDIA — nos patrons face au livre de Kleppmann

Ce document relie chaque patron de [`system-design.md`](system-design.md) à la
partie de **Designing Data-Intensive Applications** (Martin Kleppmann,
O'Reilly — abrégé **DDIA**) qui en donne la théorie.

Il sert à apprendre dans les deux sens : lire le chapitre du livre, puis ouvrir
le code de Kaissi où l'idée tourne vraiment ; ou partir d'un patron de Kaissi,
et aller chercher dans le livre pourquoi il marche.

---

## Comment lire ce document

### D'où viennent les numéros de page

**Uniquement du sommaire du livre** (celui de la 1re édition, pages vii à xii).
Aucune page n'a été devinée.

Deux conséquences à connaître :

- **Une page est celle du DÉBUT de la section**, telle que le sommaire la
  donne. L'idée précise peut se trouver quelques pages plus loin, dans un
  sous-titre que le sommaire ne liste pas. Quand c'est le cas, le sous-titre
  est cité **sans numéro de page** — pour qu'il se cherche, pas pour être cru
  sur parole.
- **Si ton exemplaire est la 2e édition**, les pages ne correspondent plus. Les
  titres de chapitres et de sections, eux, restent le meilleur moyen de
  retrouver le passage.

### Les trois niveaux de correspondance

| Niveau | Ce que ça veut dire |
|---|---|
| **Direct** | Le livre traite exactement cette idée, dans cette section. |
| **Partiel** | Le livre traite le **problème** ou un cas voisin ; notre patron en est une application particulière, ou n'en couvre qu'une partie. |
| **Non couvert directement** | Aucune section du sommaire ne correspond clairement. DDIA parle de **données** ; il ne traite presque pas de sécurité applicative ni de conception de code. Ce n'est pas un manque du patron : c'est un autre livre. |

---

## Partie A — Le sommaire de DDIA, chapitre par chapitre : est-il dans notre md ?

Pour chaque chapitre : ce que Kaissi en utilise, et **si la logique de notre
md est la même que celle du livre**.

### Partie I — Foundations of Data Systems

| Chapitre (page) | Dans notre md ? | Même logique ? |
|---|---|---|
| **1. Reliable, Scalable, and Maintainable Applications** (3) | Oui, en filigrane : §0 (la contrainte dominante), §24 (auto-réparation), §26 (observabilité). | **Oui.** Le livre distingue *faute* (un composant lâche) et *défaillance* (le système entier s'arrête), et demande de concevoir pour que la première ne produise pas la seconde. C'est exactement §0 : Internet tombe (faute), la caisse encaisse quand même (pas de défaillance). |
| **2. Data Models and Query Languages** (27) | Oui : §15 (instantané ponctuel), §16 ter (fiche facultative). | **Oui, avec une conclusion différente, et c'est voulu** — voir §15 dans la partie B. |
| **3. Storage and Retrieval** (69) | Oui : §14 (UUIDv7 et les B-trees), §17 bis (agrégation), « Ce qu'on a mesuré puis écarté » (index). | **Oui.** Même raisonnement sur le coût d'un index et sur la séparation transactionnel / analytique. |
| **4. Encoding and Evolution** (111) | Oui : §17 (migrations additives), §9 (schéma écrit à la main), vocabulaire d'événements (§1, « engagement de compatibilité »). | **Oui.** Le livre dit que **les données survivent au code** ; notre §17 dit « le code se remplace ; les données, elles, restent ». Même phrase, même conséquence. |

### Partie II — Distributed Data

| Chapitre (page) | Dans notre md ? | Même logique ? |
|---|---|---|
| **5. Replication** (151) | Oui, c'est **le cœur** : chaque tablette est un leader local (§0), les conflits (§1), le retard de réplication (§2). | **Oui.** Voir surtout « Use Cases for Multi-Leader Replication » (168) : le livre y décrit presque mot pour mot notre situation. |
| **6. Partitioning** (199) | Partiellement : §11 (la colonne de tenance comme future clé de partitionnement). | **Oui**, mais Kaissi n'est **pas** partitionné aujourd'hui : c'est une préparation, pas une mise en œuvre. |
| **7. Transactions** (221) | En filigrane : l'outbox (§5), les migrations (§17 : « une migration = une transaction »), le verrou consultatif sur le préfixe (§11 bis). | **Oui** pour l'atomicité. Le md ne parle **pas** des niveaux d'isolation — et c'est justement là que se cache la divergence décrite en partie C. |
| **8. The Trouble with Distributed Systems** (273) | Oui : §12 (jamais un timestamp), §5 (réseau non fiable, backoff). | **Oui.** « Unreliable Clocks » (287) est la justification complète de notre §12. |
| **9. Consistency and Consensus** (321) | Oui : §11 bis (numérotation), §12 (curseur). | **Oui sur le principe — mais pas sur un détail d'implémentation.** Voir la partie C : c'est la seule vraie divergence trouvée. |

### Partie III — Derived Data

| Chapitre (page) | Dans notre md ? | Même logique ? |
|---|---|---|
| **10. Batch Processing** (389) | Très peu. Le balayage de réparation (§24) et la reprojection complète (§2) en ont l'esprit. | Pas vraiment comparable : Kaissi n'a pas de traitement par lots au sens du livre. |
| **11. Stream Processing** (439) | Oui, massivement : §1 (event sourcing), §2 (CQRS), §5 (outbox), §12 (curseur = offset de consommateur), §12 bis (capture de changements). | **Oui.** C'est le chapitre le plus proche de Kaissi. « Event Sourcing » (457) et « State, Streams, and Immutability » (459) décrivent notre modèle de commande. |
| **12. The Future of Data Systems** (489) | Oui : §6 (idempotence), §13 (audit chaîné), §15 bis (stock dérivé et stock négatif). | **Oui, et c'est remarquable** : « Timeliness and Integrity » (524) défend la même position que notre règle « le stock ne bloque jamais une vente ». |

---

## Partie B — Nos patrons, un par un

Chaque fiche donne : la section de DDIA (et sa page), le niveau de
correspondance, ce que dit le livre, ce que fait Kaissi, et **si la logique est
la même**.

### 0. La contrainte qui décide de tout

- **DDIA** : ch. 5, « Use Cases for Multi-Leader Replication » — **p. 168** · ch. 1, « Reliability » — **p. 6**
- **Correspondance** : **Direct**

**Ce que dit le livre.** Parmi les cas d'usage de la réplication multi-leader,
il cite les **clients qui fonctionnent hors ligne** : chaque appareil a sa base
locale, qui joue le rôle de leader ; la synchronisation se fait quand le réseau
revient, avec un retard qui peut durer des heures ou des jours.

**Ce que fait Kaissi.** Exactement cela. Chaque tablette est un leader pour ses
propres ventes (SQLite local), et le serveur réconcilie. Le livre en tire la
même conséquence que nous : **les conflits sont inévitables**, il faut donc
choisir le modèle de données qui les rend rares — ce que fait §1.

**Même logique ?** Oui.

### 1. Event sourcing — la commande est un journal

- **DDIA** : ch. 11, « Event Sourcing » — **p. 457** · « State, Streams, and Immutability » — **p. 459**
- Pour le dernier-écrivain-gagne : ch. 5, « Handling Write Conflicts » — **p. 171** · « Detecting Concurrent Writes » — **p. 184**
- **Correspondance** : **Direct**

**Ce que dit le livre.** L'état courant est **dérivé** d'un journal de faits
immuables. Le livre distingue la **commande** (une demande, qui peut être
refusée) de l'**événement** (un fait accepté, qui ne se discute plus).

**Ce que fait Kaissi.** `line.added`, `payment.recorded`… dans `order_events`
(`packages/domain/src/evenements.ts`), repliés par `reduire()`
(`packages/domain/src/reduction.ts`). Deux tablettes qui ajoutent chacune un
article produisent trois articles, parce que ces événements **commutent**.

**Sur le dernier-écrivain-gagne.** Le livre (p. 171 et 184) montre que LWW
**jette** les écritures concurrentes, et que l'arbitrer par une horloge est
dangereux. Kaissi l'arbitre par `(server_seq, device_id)`, jamais par l'heure,
et l'ancienne valeur reste dans le journal. Même avertissement, même remède.

**Même logique ?** Oui. Notre remarque « des événements additifs commutent »
est ce que le livre appelle, dans la même section p. 171, la résolution
automatique des conflits — un ensemble de lignes qui ne fait que grandir est
un cas très simple de CRDT. Nous écartons les CRDT généraux (§1), le livre les
présente comme une piste de recherche : cohérent.

### 2. CQRS — écrire dans le journal, lire dans une projection

- **DDIA** : ch. 11, « State, Streams, and Immutability » — **p. 459** · ch. 12, « Observing Derived State » — **p. 509** · ch. 3, « Aggregation: Data Cubes and Materialized Views » — **p. 101**
- Pour le retard de la projection : ch. 5, « Problems with Replication Lag » — **p. 161**, et « Reading Your Own Writes » — **p. 162**
- **Correspondance** : **Direct**

**Ce que dit le livre.** Séparer la forme dans laquelle on **écrit** (le journal)
de la forme dans laquelle on **lit** (des vues dérivées). Le livre nomme CQRS
dans cette section, et en fait l'argument principal de l'immuabilité : on peut
dériver plusieurs vues du même journal, et en ajouter une sans toucher aux
autres.

**Ce que fait Kaissi.** `order_events` est écrit ; `orders`, `order_items`,
`payments` sont des projections (`packages/db-local/src/projecteur.ts`,
`reprojeter()` côté serveur).

**Le point qui mérite d'être lu dans le livre** : p. 162, « Reading Your Own
Writes ». La tablette relit toujours sa propre vente **immédiatement**, parce
qu'elle la projette elle-même, en local. Le retard de réplication n'existe que
pour les ventes **des autres** tablettes. C'est la garantie que le livre décrit,
obtenue ici gratuitement par l'architecture.

**Même logique ?** Oui.

### 3. Shared kernel — un seul endroit calcule l'argent

- **DDIA** : non couvert directement.

C'est un patron de **Domain-Driven Design** (Eric Evans). DDIA n'en parle pas.
Le plus proche serait le ch. 12, « Combining Specialized Tools by Deriving
Data » (p. 490) — mais il parle de dériver des **données**, pas de partager un
**calcul**. Ce n'est pas une correspondance claire.

### 4. Ports & adapters — la même base sur trois runtimes

- **DDIA** : non couvert directement.

Patron d'architecture logicielle (Alistair Cockburn). DDIA ne traite pas de
l'organisation du code.

### 5. Transactional outbox — ne jamais perdre une vente

- **DDIA** : ch. 11, « Keeping Systems in Sync » — **p. 452** · « Messaging Systems » — **p. 441**
- **Correspondance** : **Partiel**

**Ce que dit le livre.** P. 452 : le problème des **doubles écritures**. Écrire
dans deux systèmes l'un après l'autre finit toujours par laisser l'un des deux
en retard, ou en désaccord. Le remède du livre : n'avoir **qu'une** source de
vérité, et **dériver** le reste d'un journal. P. 441 : un courtier de messages
ne supprime un message que sur **accusé de réception**.

**Ce que fait Kaissi.** L'outbox est la réponse au problème de la p. 452 :
l'événement et son entrée dans la file sont écrits dans **la même transaction
locale**, donc jamais l'un sans l'autre. Et notre règle « l'outbox ne se vide
que sur accusé de réception » est la règle de la p. 441.

**Pourquoi « partiel ».** Le mot *outbox* n'est pas dans le sommaire, et le
livre ne décrit pas ce montage précis. Les autres règles de notre §5 — backoff
avec gigue, « un rejet ne se réessaie jamais tout seul » — ne sont pas couvertes
directement.

**Même logique ?** Oui pour le principe (une seule écriture atomique, le reste
en découle).

### 5 bis. File persistante et trace d'effet (impression)

- **DDIA** : ch. 11, « Messaging Systems » — **p. 441** · « Fault Tolerance » — **p. 476**
- **Correspondance** : **Partiel**

**Ce que dit le livre.** Une file durable survit aux pannes et redélivre ce qui
n'a pas été acquitté (p. 441). Mais **redélivrer** veut dire qu'un effet peut
se produire deux fois ; p. 476, le livre explique qu'on s'en protège par
l'**idempotence** (sous-titre « Idempotence », page non listée au sommaire).

**Ce que fait Kaissi.** `print_queue` est la file durable. `kitchen_sends`
applique l'idée de la p. 476 à un effet **physique** : on ne peut pas annuler un
bon imprimé, alors on retient qu'il l'a été (index unique sur la ligne).

**Même logique ?** Oui.

### 6. Clé d'idempotence — jamais de double encaissement

- **DDIA** : ch. 12, « The End-to-End Argument for Databases » — **p. 516** · ch. 11, « Fault Tolerance » — **p. 476**
- **Correspondance** : **Direct**

**Ce que dit le livre.** P. 516 : même avec des transactions, une requête peut
être rejouée par le client après une coupure réseau. La seule protection qui
tient **de bout en bout** est un identifiant d'opération généré par le client
et rendu **unique** en base (sous-titres « Duplicate suppression » et
« Operation identifiers », pages non listées au sommaire).

**Ce que fait Kaissi.** `event_id` (UUIDv7 généré par la tablette) est la clé
primaire de `sync_mutations` et de `order_events`. Le même événement envoyé
cinq fois est inséré une fois.

**Même logique ?** Oui, **exactement** — c'est probablement la correspondance la
plus directe du document. Notre formule « exactly-once delivery n'existe pas,
exactly-once effect si » est la conclusion du livre.

**Ce que notre md ajoute** et que le livre ne dit pas : l'idempotence doit être
consultée **avant** la validation métier (sinon un doublon arrivé après un
changement d'état est rejeté, et la tablette ne vide jamais son outbox). C'est
cohérent avec la distinction commande / événement de la p. 457 : un événement
déjà accepté ne se revalide pas.

### 7. Machine à états — interdire au lieu de vérifier partout

- **DDIA** : non couvert directement.

⚠ **Faux ami.** Le ch. 9, « Total Order Broadcast » (p. 348), parle de
*state machine replication* : des répliques qui appliquent les mêmes opérations
dans le même ordre. Ce n'est **pas** notre patron, qui est une machine à états
**métier** (quelles transitions sont permises à une commande). Même mot, idée
différente.

### 8. Types marqués

- **DDIA** : non couvert directement. (Conception de types, hors du sujet du livre.)

### 9. Anti-corruption layer — le schéma écrit à la main

- **DDIA** : ch. 4, « The Merits of Schemas » — **p. 127** · « Dataflow Through Databases » — **p. 129**
- **Correspondance** : **Partiel**

**Ce que dit le livre.** Un schéma explicite sert de documentation toujours à
jour, et permet de vérifier la compatibilité **à la compilation** plutôt qu'à
l'exécution (p. 127).

**Ce que fait Kaissi.** `apps/backoffice/src/serveur/schema.ts` déclare à la
main les colonnes dont le back-office dépend : une colonne renommée casse la
compilation au lieu de casser la production. C'est l'argument de la p. 127.

**Pourquoi « partiel ».** *Anti-corruption layer* est un terme de DDD ; le livre
parle de schémas d'encodage (Avro, Protocol Buffers), pas d'une couche de
traduction entre deux modèles.

### 10. Feature flag — écrit, testé, éteint

- **DDIA** : non couvert directement.

### 11. Multi-tenance — la colonne discriminante partout

- **DDIA** : ch. 6, « Partitioning of Key-Value Data » — **p. 201** · « Skewed Workloads and Relieving Hot Spots » — **p. 205**
- **Correspondance** : **Partiel**

**Ce que dit le livre.** Partitionner, c'est choisir une **clé** qui décide sur
quelle machine vit chaque ligne. Un mauvais choix concentre la charge sur une
partition (p. 205).

**Ce que fait Kaissi.** `organization_id` et `restaurant_id` sur presque chaque
table, présentés dans notre md comme la **future clé de partitionnement**.

**Pourquoi « partiel ».** Kaissi n'est pas partitionné aujourd'hui. Et la moitié
de notre §11 — l'isolation entre clients par RLS — est de la **sécurité**, que le
livre ne traite pas.

**À lire en pensant à Kaissi** : p. 205. Un très gros client (une chaîne de
cinquante restaurants dans une seule organisation) serait exactement le
« point chaud » que décrit le livre. Partitionner par `restaurant_id` plutôt que
par `organization_id` le répartirait.

### 11 bis. Numéroter hors ligne — l'espace de noms vient du serveur

- **DDIA** : ch. 9, « Sequence Number Ordering » — **p. 343**
- **Correspondance** : **Direct**

**Ce que dit le livre.** Sans leader unique, on peut générer des numéros sans
coordination en donnant à chaque nœud **son propre espace** : l'un les pairs,
l'autre les impairs, ou des **blocs** attribués d'avance. Le livre prévient :
ces numéros sont uniques, mais ils ne disent **rien de l'ordre réel** des
événements entre deux nœuds.

**Ce que fait Kaissi.** Le serveur attribue un préfixe par terminal (`P1`,
`P2`), et chacun numérote dans son espace : `P1-000042`, `P2-000042`. C'est
la technique des blocs.

**Même logique ?** Oui, **et Kaissi respecte l'avertissement** : le numéro de
ticket ne sert **jamais** à ordonner. L'ordre vient de `server_seq` (§12). Le
numéro est fait pour être lu au comptoir, pas pour trier.

### 12. Horloge logique — un curseur, jamais un timestamp

- **DDIA** : ch. 8, « Unreliable Clocks » — **p. 287** · « Relying on Synchronized Clocks » — **p. 291** · ch. 9, « Sequence Number Ordering » — **p. 343** · « Total Order Broadcast » — **p. 348** · ch. 11, « Partitioned Logs » — **p. 446**
- **Correspondance** : **Direct**

**Ce que dit le livre.** P. 287 à 291 : les horloges des machines dérivent, sont
recalées, et ne permettent pas d'ordonner des événements de façon fiable. P.
343 : un compteur attribué par un seul acteur donne un ordre total. P. 446 : un
consommateur de journal retient un **offset** — la position jusqu'où il a lu.

**Ce que fait Kaissi.** `change_log.seq` et `order_events.server_seq` sont
attribués par le serveur. Chaque tablette retient jusqu'où elle a lu
(`last_catalog_seq`) : c'est l'**offset de consommateur** de la p. 446, sous un
autre nom.

**Même logique ?** Oui pour le refus des timestamps. **Non pour une propriété que
le md affirme** : voir la **partie C**. Le livre, p. 348, exige qu'un journal
soit lu **sans trous**, et un compteur de base de données ne le garantit pas
tout seul.

### 12 bis. Un seul canal de descente — et l'ensemble complet quand l'élément ne suffit pas

- **DDIA** : ch. 11, « Change Data Capture » — **p. 454**
- **Correspondance** : **Direct** pour le canal, **Partiel** pour l'ensemble complet

**Ce que dit le livre.** Capter les changements d'une base (par exemple par des
**déclencheurs**) et les publier comme un flux que d'autres systèmes
rejouent. Dans la même section, la **compaction de journal** : pour chaque clé,
on ne garde que la dernière valeur **complète**.

**Ce que fait Kaissi.** `change_log`, rempli par des déclencheurs, est
exactement une capture de changements faite par déclencheurs. Et pour
`product_modifiers`, la 0037 envoie la **liste complète** des groupes d'un
produit à chaque changement : chaque message porte l'état entier de sa clé,
ce qui est l'idée de la compaction.

**Même logique ?** Oui.

### 13. Journal append-only + chaînage par hash

- **DDIA** : ch. 11, « State, Streams, and Immutability » — **p. 459** · ch. 12, « Trust, but Verify » — **p. 528**
- **Correspondance** : **Direct**

**Ce que dit le livre.** P. 459 : un journal immuable facilite l'audit — on ne
perd jamais ce qui s'est passé, on ajoute une correction. P. 528 : ne pas faire
confiance aveuglément à ses propres systèmes, et utiliser des outils
cryptographiques (arbres de Merkle, chaînes de hash) pour rendre une
altération **détectable**.

**Ce que fait Kaissi.** `audit_events` en insertion seule (REVOKE +
déclencheur), chaque ligne portant le hash de la précédente
(`kaissi.verifie_chaine_audit()`).

**Même logique ?** Oui. Notre md précise un point que le livre ne détaille pas :
le REVOKE seul ne protège pas du **propriétaire** de la table, d'où le
déclencheur en plus.

### 13 bis. L'exception nommée — lever une invariance sans la perdre

- **DDIA** : ch. 11, « State, Streams, and Immutability » — **p. 459**
- **Correspondance** : **Partiel**

**Ce que dit le livre.** Dans cette section, le livre reconnaît les **limites de
l'immuabilité** : il faut parfois vraiment effacer (pour des raisons légales, par
exemple), et c'est difficile dans un système conçu pour ne rien effacer.

**Ce que fait Kaissi.** La purge du journal local quand une caisse change
d'établissement, autorisée par un **drapeau nommé**, posé et retiré dans la
même transaction.

**Même logique ?** Même tension, mécanisme propre à Kaissi. Le livre pose le
problème ; il ne décrit pas cette solution.

### 13 ter. L'exception étroite — pourquoi CRÉER n'est pas MODIFIER

- **DDIA** : ch. 5, « Handling Write Conflicts » — **p. 171** · ch. 12, « Timeliness and Integrity » — **p. 524**
- **Correspondance** : **Partiel**

**Ce que dit le livre.** P. 171 : la meilleure façon de gérer les conflits est de
les **éviter** (sous-titre « Conflict avoidance ») — par exemple en faisant
passer toutes les écritures d'un même enregistrement par un même leader. P.
524 : un système peut éviter la coordination si ses opérations le permettent.

**Ce que fait Kaissi.** Une caisse peut **créer** un article, jamais le
**modifier**. Chaque article créé a un seul auteur, la caisse qui l'a créé : il
n'y a donc **jamais** deux écrivains sur la même ligne. C'est l'évitement de
conflit de la p. 171, obtenu par construction.

**Même logique ?** Oui. Notre critère « on ouvre ce qui commute, on refuse ce qui
arbitre » est une façon courte de dire la p. 524.

### 14. UUIDv7 — l'identifiant vient de celui qui crée

- **DDIA** : ch. 3, « B-Trees » — **p. 79** · ch. 9, « Sequence Number Ordering » — **p. 343**
- **Correspondance** : **Partiel**

**Ce que dit le livre.** P. 79 : comment un B-tree range les clés dans des pages,
et ce que coûte une insertion. P. 343 : générer des identifiants sans
coordination.

**Ce que fait Kaissi.** UUIDv7, généré par la tablette, préfixé par
l'horodatage : les nouvelles lignes s'insèrent **en fin d'index**.

**Pourquoi « partiel ».** Le livre ne parle pas des UUID, ni de v4 contre v7. Mais
la p. 79 donne tout ce qu'il faut pour comprendre **pourquoi** une clé aléatoire
fragmente un B-tree. Remarque : ici l'horodatage n'ordonne rien de façon fiable
(voir p. 287) — il ne sert qu'à la **localité** de l'index, ce qui est correct.

### 15. Instantané ponctuel — copier plutôt que joindre

- **DDIA** : ch. 2, « Many-to-One and Many-to-Many Relationships » — **p. 33**
- **Correspondance** : **Direct**

**Ce que dit le livre.** Stocker un **identifiant** ou **recopier le texte** ? Le
livre recommande en général l'identifiant : le texte recopié se désynchronise
quand la source change, alors qu'un identifiant se résout toujours vers la
valeur à jour.

**Ce que fait Kaissi.** Les deux à la fois : `discount_id` **et**
`discount_label` recopié, `customer_id` **et** `customer_name`.

**Même logique ?** **Même raisonnement, conclusion opposée — et c'est correct.**
Le livre parle d'**état courant** : on veut la valeur à jour, donc un
identifiant. Une vente est un **fait passé** : on veut la valeur **du jour de la
vente**, donc une copie. C'est exactement la question de notre md : « fait passé
ou état courant ? ». L'identifiant est gardé en plus, pour pouvoir regrouper.

### 15 bis. État dérivé — le stock se calcule, il ne se décrémente pas

- **DDIA** : ch. 11, « State, Streams, and Immutability » — **p. 459** · ch. 12, « Observing Derived State » — **p. 509** · « Timeliness and Integrity » — **p. 524**
- **Correspondance** : **Direct**

**Ce que dit le livre.** P. 459 : l'état est le résultat de l'accumulation des
événements (le livre parle de l'état comme de l'**intégrale** du flux). P. 524 :
certaines contraintes peuvent être **violées temporairement puis corrigées** —
vendre plus que le stock, par exemple, et s'en excuser ou compenser ensuite —
plutôt que de tout bloquer par de la coordination.

**Ce que fait Kaissi.** `stock_actuel` = comptage de référence + mouvements −
ventes, calculé à la lecture. Un stock **négatif** est accepté : c'est le cas
normal d'une vente encaissée hors ligne. La caisse ne bloque jamais une vente.

**Même logique ?** Oui, **et c'est la correspondance la plus instructive du
document.** Notre règle « le stock n'est jamais autoritaire hors ligne » est un
exemple de ce que la p. 524 appelle une contrainte appliquée de façon lâche : on
préfère corriger après coup que coordonner avant.

### 16. Index unique partiel

- **DDIA** : ch. 12, « Enforcing Constraints » — **p. 521**
- **Correspondance** : **Partiel**

La p. 521 traite des contraintes d'**unicité** et de ce qu'elles coûtent dans
un système distribué. L'index **partiel** lui-même (une unicité qui ne
s'applique qu'à une partie des lignes) est une fonctionnalité de PostgreSQL que
le livre ne décrit pas.

### 16 bis. Le cycle de vie d'un agrégat racine

- **DDIA** : non couvert directement.

Le plus proche est la discussion sur l'effacement de données dans « State,
Streams, and Immutability » (p. 459), déjà citée en §13 bis ; mais le cycle
« fermer, puis supprimer sous obstacles » n'y figure pas.

### 16 ter. La fiche facultative

- **DDIA** : ch. 2, « Many-to-One and Many-to-Many Relationships » — **p. 33**
- **Correspondance** : **Partiel**

Même question qu'au §15 (texte libre ou référence ?), prise sous un autre
angle : Kaissi garde **les deux**, et le texte fait foi. Le livre pose
l'alternative, il ne propose pas cette coexistence.

### 17. Migrations — en avant seulement, et additives

- **DDIA** : ch. 4, « Encoding and Evolution » — **p. 111** · « Dataflow Through Databases » — **p. 129** · ch. 1, « Evolvability: Making Change Easy » — **p. 21**
- **Correspondance** : **Direct**

**Ce que dit le livre.** Pendant une mise à jour, l'ancien et le nouveau code
tournent en même temps : il faut la compatibilité **ascendante** (le nouveau
code lit les vieilles données) **et descendante** (le vieux code lit les
nouvelles). P. 129 : les données écrites il y a longtemps restent en base, et
**survivent au code** qui les a écrites.

**Ce que fait Kaissi.** Migrations additives tant que le protocole supporte N−2 :
une tablette restée trois semaines hors ligne écrit encore l'ancienne forme. Le
miroir local ignore les colonnes qu'il ne connaît pas encore.

**Même logique ?** Oui, point pour point.

### 17 bis. Aggregation pushdown

- **DDIA** : ch. 3, « Transaction Processing or Analytics? » — **p. 90** · « Aggregation: Data Cubes and Materialized Views » — **p. 101**
- **Correspondance** : **Partiel**

La p. 90 distingue les requêtes **transactionnelles** (quelques lignes) des
requêtes **analytiques** (beaucoup de lignes, peu de colonnes, des sommes). La
p. 101 présente les agrégats précalculés. Kaissi fait des agrégats **à la
demande**, dans la base, sans les précalculer : même famille d'idées, pas la même
technique. La distinction « une règle n'est pas une somme » est propre à Kaissi.

### 17 ter. Le piège du plan générique

- **DDIA** : non couvert directement. (Comportement de l'optimiseur de PostgreSQL.)

### 18 à 23 ter. Toute la partie sécurité

| Patron | DDIA |
|---|---|
| 18. Trois identités distinctes | non couvert directement |
| 19. RLS | non couvert directement |
| 20. Moindre privilège | non couvert directement |
| 20 bis. La frontière exprimée en privilèges | non couvert directement |
| 21. Le député confus | non couvert directement |
| 22. Le privilège de colonne | non couvert directement |
| 23. Hachage des PIN (Argon2id) | non couvert directement |
| 23 bis. Limitation de débit | non couvert directement |
| 23 ter. Défense en profondeur (CSP) | non couvert directement |

DDIA ne traite pas de sécurité applicative. Le seul passage voisin est « Privacy
and Tracking » (ch. 12, p. 536), qui parle d'**éthique** des données
personnelles, pas de contrôle d'accès. Pour cette partie, il faut un autre
livre.

### 24. Auto-réparation — la boucle de réconciliation

- **DDIA** : ch. 12, « Trust, but Verify » — **p. 528** · ch. 1, « Software Errors » — **p. 8**
- **Correspondance** : **Partiel**

**Ce que dit le livre.** P. 528 : les bugs arrivent, même dans des systèmes bien
testés ; un système sain **vérifie** périodiquement l'intégrité de ses propres
données au lieu de supposer qu'elle tient. P. 8 : les erreurs logicielles sont
corrélées et plus dangereuses que les pannes matérielles.

**Ce que fait Kaissi.** Un balayage cherche les commandes qui ont des
événements mais pas de projection, et les reprojette
(`apps/sync/src/reparation.ts`).

**Même logique ?** Oui. ⚠ Mais ce balayage ne répare que les projections **du
serveur**. Il ne voit pas le problème décrit en partie C, qui touche les
**tablettes**.

### 25 et 25 bis. Les gardes de CI, et la garde d'énumération

- **DDIA** : ch. 12, « Trust, but Verify » — **p. 528**
- **Correspondance** : **Partiel**

Même esprit — ne pas croire, vérifier —, mais pas le même objet : le livre
vérifie des **données**, nos gardes vérifient du **code et un schéma**.

### 26. Observabilité — l'écran Diagnostic

- **DDIA** : ch. 1, « Operability: Making Life Easy for Operations » — **p. 19**
- **Correspondance** : **Partiel**

Le livre demande de rendre le système facile à surveiller et à comprendre
pour ceux qui l'exploitent. Notre écran Diagnostic est écrit pour un **gérant**,
pas pour un opérateur technique : même intention, public différent.

### 26 bis et 26 ter. Journal structuré, frontière d'erreur

- **DDIA** : non couvert directement.

### « Ce qu'on n'a pas fait » et « Ce qu'on a mesuré puis écarté »

- **Microservices** — ch. 4, « Dataflow Through Services: REST and RPC » (**p. 131**) : **partiel**. Le livre explique ce que coûte un appel réseau par rapport à un appel local ; c'est l'argument de notre refus.
- **Kafka / file de messages** — ch. 11, « Partitioned Logs » (**p. 446**) : **direct** pour comprendre ce qu'on n'a pas pris, et pourquoi l'outbox locale suffit à notre échelle.
- **CRDT / PowerSync** — ch. 5, « Handling Write Conflicts » (**p. 171**) : **partiel**.
- **Mesurer avant d'optimiser** — ch. 1, « Describing Performance » (**p. 13**) : **partiel**. Le livre insiste sur la mesure (percentiles plutôt que moyennes) ; notre tableau de mesures en est l'application.
- **Index créés ou écartés** — ch. 3, « Data Structures That Power Your Database » (**p. 70**) : **direct**. Un index accélère les lectures et ralentit les écritures ; c'est le compromis de chaque ligne de notre tableau.

---

## Partie C — Là où le livre et notre md ne disent pas la même chose

### ⚠ Le curseur de synchronisation peut sauter un événement

**Ce que dit notre md (§12).** Un timestamp est un mauvais curseur, entre autres
parce que « une transaction longue peut valider un `now()` antérieur à une
transaction plus récente — et un curseur temporel saute alors l'événement,
définitivement et sans trace ». Le md présente le compteur serveur comme la
solution.

**Ce que dit le livre.** Ch. 9, « Total Order Broadcast » (**p. 348**) : un journal
qui sert à répliquer doit être délivré **dans l'ordre et sans trous**. Un
compteur donne un ordre ; il ne garantit pas, à lui seul, qu'un lecteur ne verra
pas le numéro 101 **avant** le numéro 100.

**Le problème.** Une séquence PostgreSQL attribue son numéro **au moment de
l'insertion**, pas au moment de la validation. Le trou que le md reproche aux
timestamps existe donc aussi avec le compteur :

1. la transaction A insère un événement et reçoit `seq = 100`, sans valider tout
   de suite ;
2. la transaction B insère, reçoit `seq = 101` et valide immédiatement ;
3. une tablette tire `seq > 99` : elle ne voit que 101 (A n'est pas encore
   validée) et avance son curseur à 101 ;
4. A valide. La tablette tire ensuite `seq > 101`, et **ne reçoit jamais le 100**.

**Vérifié, pas supposé.** Reproduit sur un vrai PostgreSQL 16 avec deux sessions :
la ligne validée en retard n'est jamais relue par un lecteur dont le curseur
est passé devant.

**Dans le code.** Les deux tirages font `where … seq > $2 order by seq`, sans
protection contre les transactions encore en cours :

- `catalogueDepuis()` sur `change_log` (`apps/sync/src/depot-postgres.ts`) ;
- le tirage des événements sur `order_events.server_seq` (même fichier).

Et `insererEvenements()` ne sérialise pas les insertions par établissement :
deux caisses qui envoient en même temps peuvent se croiser exactement comme A et
B.

**Ce que ça coûte, concrètement.**

| Journal | Ce qui peut arriver | Ce qui reste juste |
|---|---|---|
| `order_events` | une tablette ne reçoit jamais un événement d'une **autre** tablette : une commande partagée (la table 12) lui manque un article | le **serveur** a tout — les totaux du back-office sont justes ; la tablette qui a créé l'événement l'a aussi |
| `change_log` | une tablette ne reçoit jamais un changement de catalogue : un prix, une rupture, un réglage de reçu | le back-office et les autres tablettes |

Rien ne le rattrape ensuite : le balayage d'auto-réparation (§24) ne répare que
les projections du serveur, et la tablette ne redemande jamais un numéro
qu'elle croit avoir dépassé.

**La fenêtre est étroite** — elle suppose deux transactions qui se croisent au
moment exact d'un tirage — mais elle grandit avec le nombre de caisses, et elle
est invisible quand elle se produit. C'est le genre de défaut que le livre
décrit : rare, silencieux, définitif.

**Ce document ne corrige rien** (la consigne était de ne pas toucher au code ni à
`system-design.md`). Les remèdes connus, pour décider ensuite :

1. **Sérialiser les insertions par établissement** (verrou consultatif pris à
   l'insertion, comme on le fait déjà pour le préfixe de tickets). Simple ;
   l'ordre des numéros devient l'ordre de validation, mais les envois d'un même
   établissement s'attendent les uns les autres.
2. **Ne délivrer que ce qui ne peut plus être dépassé** : noter l'identifiant de
   transaction à l'insertion, et ne rendre au tirage que les lignes plus
   anciennes que la plus vieille transaction encore en cours
   (`pg_snapshot_xmin(pg_current_snapshot())`). C'est la solution classique des
   systèmes de capture de changements (ch. 11, p. 454).
3. **Relire un peu en arrière** : tirer depuis `curseur − N`, ou depuis les
   dernières secondes, et laisser l'idempotence dédupliquer. Moins propre, mais
   la tablette dédoublonne déjà (§6).

### Les autres différences, qui n'en sont pas vraiment

- **§15 — copier plutôt que joindre.** Le livre recommande l'identifiant, Kaissi
  copie le libellé. Ce n'est pas une contradiction : le livre parle d'**état
  courant**, Kaissi d'un **fait passé**. Voir la fiche §15.
- **§12 — « un `bigserial` ».** Le code utilise `bigint generated always as
  identity`. Même comportement pour ce qui nous occupe, et même trou (ci-dessus).
- **§7 — machine à états.** À ne pas confondre avec la *state machine
  replication* du ch. 9 (p. 348). Même mot, autre sujet.

---

## Pour apprendre — un ordre de lecture

Si tu lis le livre pour comprendre Kaissi, cet ordre suit l'architecture plutôt
que la numérotation :

| Étape | Lire dans DDIA | Puis ouvrir dans Kaissi |
|---|---|---|
| 1 | ch. 5, p. 168 — les clients hors ligne | `system-design.md` §0 |
| 2 | ch. 11, p. 457 et 459 — Event Sourcing, immuabilité | `packages/domain/src/evenements.ts`, `reduction.ts` |
| 3 | ch. 5, p. 171 et 184 — conflits, dernier-écrivain-gagne | §1, puis §13 ter |
| 4 | ch. 11, p. 452 et 454 — rester synchronisé, capture de changements | l'outbox (§5), `change_log` (§12 bis) |
| 5 | ch. 12, p. 516 — l'argument de bout en bout, les identifiants d'opération | §6, `sync_mutations.event_id` |
| 6 | ch. 8, p. 287 à 291 — les horloges | §12 |
| 7 | ch. 9, p. 343 et 348 — numéros de séquence, diffusion totalement ordonnée | §11 bis, §12, **puis la partie C de ce document** |
| 8 | ch. 12, p. 524 — contraintes appliquées de façon lâche | §15 bis, le stock négatif |
| 9 | ch. 4, p. 111 à 129 — faire évoluer un schéma | §17 |
| 10 | ch. 12, p. 528 — ne pas croire, vérifier | §13 (audit chaîné), §24, §25 bis |

Pour ce que DDIA ne couvre pas :

- **Shared kernel, anti-corruption layer, agrégat racine** : *Domain-Driven Design*, Eric Evans ;
- **Ports & adapters** : l'article d'Alistair Cockburn sur l'architecture hexagonale ;
- **La partie sécurité** : les recommandations OWASP ; la documentation PostgreSQL sur RLS et les privilèges.
