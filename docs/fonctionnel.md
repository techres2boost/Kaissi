# Kaissi — documentation fonctionnelle

À quoi sert chaque module, ce qu'il garantit, et **pourquoi il est construit
ainsi**. Le « pourquoi » compte autant que le « quoi » : la plupart des
décisions de ce projet paraissent excessives tant qu'on n'a pas vu la panne
qu'elles évitent.

> Public : toi dans six mois, un développeur qui rejoint, un intégrateur qui
> déploie chez un client.

---

## Table des matières

1. [L'idée en une page](#1-lidée-en-une-page)
2. [Le vocabulaire](#2-le-vocabulaire)
3. [`packages/domain` — le cœur](#3-packagesdomain--le-cœur)
4. [`packages/db-local` — la base de la tablette](#4-packagesdb-local--la-base-de-la-tablette)
5. [`packages/printing` — les tickets](#5-packagesprinting--les-tickets)
6. [`apps/pos` — le terminal](#6-appspos--le-terminal)
7. [`apps/sync` — la réconciliation](#7-appssync--la-réconciliation)
8. [`packages/sync-client` — le moteur embarqué](#8-packagessync-client--le-moteur-embarqué)
9. [Le schéma Postgres](#9-le-schéma-postgres)
10. [Les scénarios qui comptent](#10-les-scénarios-qui-comptent)
11. [Ce qui n'existe pas encore](#11-ce-qui-nexiste-pas-encore)

---

## 1. L'idée en une page

Kaissi est une caisse de restaurant qui **ne s'arrête jamais**.

Un restaurant qui ne peut pas encaisser désinstalle le logiciel le soir même
et le dit à tous ses confrères. Cette phrase gouverne toute l'architecture.

Trois conséquences, dont tout le reste découle :

**Le code de l'application vit sur l'appareil.** Pas sur un serveur qu'une
WebView irait chercher. C'est pour cela qu'il n'y a jamais de `server.url`
dans la configuration Capacitor, et que la CI le vérifie à chaque PR.

**Les données vivent sur l'appareil.** SQLite local, avec le catalogue,
les commandes et le journal des ventes. Le serveur sert à *se réconcilier*,
jamais à *fonctionner*.

**Les commandes sont un journal d'événements, pas des lignes modifiables.**
Deux serveurs qui ajoutent chacun un plat à la table 12, hors ligne, produisent
une commande à trois plats. Sans conflit, sans arbitrage, sans code de fusion.

```
        LA TABLETTE                          LE SERVEUR
   ┌────────────────────┐              ┌────────────────────┐
   │  écran de caisse   │              │   API de sync      │
   │         ↓          │   push       │         ↓          │
   │   SessionCaisse    │─────────────▶│   ServiceSync      │
   │         ↓          │   pull       │         ↓          │
   │  journal + outbox  │◀─────────────│   PostgreSQL       │
   │         ↓          │              │         ↓          │
   │   projections      │              │   projections      │
   └────────────────────┘              └────────────────────┘
              │                                   │
              └──── packages/domain ──────────────┘
                    LE MÊME CODE DES DEUX CÔTÉS
```

Cette dernière ligne est la décision la plus importante du projet. Un total
calculé hors ligne sur une tablette et le même total dans le rapport du
back-office **ne peuvent pas diverger**, parce que c'est littéralement la même
fonction qui les calcule.

---

## 2. Le vocabulaire

| Terme | Ce que c'est |
|---|---|
| **Millime** | 1/1000 de dinar. Le TND a **trois** décimales : 24,500 TND = 24500 millimes |
| **Point de base** | 1/100 de pourcent. 19 % de TVA = `1900`. Jamais `0.19` |
| **Événement** | Un fait immuable : « ligne ajoutée », « paiement enregistré ». Ne se modifie ni ne se supprime |
| **Projection** | Une vue lisible reconstruite depuis les événements : `orders`, `order_items` |
| **Outbox** | File locale des événements pas encore confirmés par le serveur |
| **Curseur** | Entier serveur qui dit « j'ai tout reçu jusqu'ici ». Jamais une date |
| **Shift** | Une session de caisse : ouverture avec fond, clôture avec comptage |
| **KOT** | *Kitchen Order Ticket* — le bon qui part en cuisine |
| **Appairage** | Association d'une tablette à un établissement, via un jeton révocable |

### Les trois identités, jamais confondues

C'est une source de confusion classique, alors autant l'expliciter :

| Identité | Mécanisme | Répond à | Change |
|---|---|---|---|
| **Utilisateur** | Supabase Auth, e-mail + mot de passe | « qui administre » | rarement |
| **Appareil** | Jeton long révocable | « quelle tablette parle » | à l'appairage |
| **Employé** | PIN validé hors ligne | « qui a fait cette action » | 5× par service |

Confondre appareil et employé mène soit à des reconnexions permanentes, soit
à une traçabilité inexistante. Un serveur en salle change cinq fois par
service ; la tablette, elle, reste authentifiée en continu.

---

## 3. `packages/domain` — le cœur

**Zéro entrée/sortie.** Ni réseau, ni disque, ni base, ni React. C'est ce qui
permet de l'exécuter à l'identique sur la tablette et sur le serveur.

### 3.1 `monnaie.ts` — l'argent

Le piège tunisien : **le dinar a trois décimales, pas deux**. Toute
bibliothèque qui suppose « centimes = ×100 » produit des erreurs d'arrondi
silencieuses qui n'apparaissent qu'après des mois de production.

```ts
millimes(24500)        // ✅ 24,500 TND
millimes(24.5)         // ❌ jette — un flottant n'est pas de l'argent
depuisDecimal('24,5')  // ✅ 24500 — la SEULE porte d'entrée décimale
formaterTND(24500)     // "24,500 TND"
```

L'arrondi est **half-away-from-zero**, pas `Math.round` : ce dernier est
asymétrique sur les négatifs (`Math.round(-2.5) === -2`), ce qui est
inacceptable pour un remboursement.

### 3.2 `totaux.ts` — l'ordre figé

Dix étapes, dans cet ordre exact, et non négociable :

```
1. ligne_brute    = (prix + Σ modificateurs) × quantité
2. sous_total     = Σ lignes
3. remise_ligne   AVANT la remise globale
4. remise_globale RÉPARTIE AU PRORATA          ⚑ sinon la TVA est fausse
5. bases groupées PAR TAUX
6. tva = arrondi(base × taux)  PAR TAUX puis somme  ⚑ jamais l'inverse
7. service sur la base après remises
8. total
9. rendu = versé − total
10. écart d'arrondi → dernière ligne, sans jamais rendre une base négative
```

**Pourquoi l'étape 4.** Une remise globale non répartie laisse les bases par
taux inchangées : la TVA à 19 % est alors calculée sur le prix plein alors
que le client a payé moins. L'écart est petit par ticket, énorme sur un mois.

**Pourquoi l'étape 6.** Arrondir la TVA par ligne puis sommer donne un
résultat différent d'arrondir la base groupée. Sur trois pizzas à 3,333 TND :
3 × 633 = 1899 contre 1900. Un millime par ticket, tous les jours.

**Pourquoi le garde-fou de l'étape 10.** Mettre tout l'écart d'arrondi sur la
dernière ligne rend sa base **négative** si cette ligne est un supplément à
0,001 TND — et casse la TVA du groupe entier. Le résidu remonte donc de la
dernière ligne vers la première, sans jamais dépasser le poids d'une ligne.

### 3.3 `evenements.ts` et `reduction.ts` — le journal

Quinze types d'événements. Trois propriétés à retenir :

**Idempotent.** Rejouer cinq fois le même journal donne le même état. C'est
ce qui rend une retentative réseau sans danger.

**Commutatif sur les ajouts.** L'ordre d'arrivée de deux `line.added` ne
change pas le contenu de la commande.

**Dernier-écrivain-gagne sur les scalaires.** Numéro de table, statut, nom du
client : arbitrés par `(server_seq, device_id)`. L'ancienne valeur reste
visible dans le journal.

L'ordre canonique n'est **pas chronologique** : les événements confirmés par
le serveur passent d'abord, triés par `server_seq`. Les horloges des tablettes
dérivent, sont réglées à la main et changent de fuseau.

> **Une annulation n'efface jamais rien.** Elle ajoute un événement
> d'annulation. L'état visible change ; l'historique ne perd rien.

### 3.4 `permissions.ts` — qui a le droit

Cinq rôles. La subtilité utile est la distinction entre deux refus :

| Refus | Ce que fait l'interface |
|---|---|
| `escaladePossible: false` | Message d'explication. Point. |
| `escaladePossible: true` | **Ouvre une saisie de PIN manager** |

Un caissier qui accorde 50 % de remise ne voit pas « interdit » : il voit
« un responsable doit valider ». Et le nom du responsable reste dans
l'événement.

Plafonds par défaut : serveur 5 %, caissier 10 %, gérant sans limite.

### 3.5 `pin.ts` — l'employé

Argon2id, validé **hors ligne**, jamais contre le serveur.

Le commentaire du fichier est honnête sur ce que ça vaut : un PIN à quatre
chiffres n'a que 10 000 combinaisons. Argon2 achète des minutes contre
quelqu'un qui a volé la tablette, pas des années. **Le PIN répond à « qui a
fait ça », pas à « qui a le droit d'entrer ».** Ce qui protège l'argent, c'est
le jeton d'appareil révocable, RLS, et le journal d'audit.

Blocage **temporaire** après cinq échecs : bloquer définitivement le seul
caissier présent un vendredi soir serait pire que le risque couvert.

### 3.6 `shift.ts` — la caisse

```
attendu = fond + espèces encaissées + entrées − sorties
écart   = compté − attendu          ⚑ PEUT être négatif
```

Seules les **espèces** comptent : la carte ne passe pas par le tiroir.

Au-delà de 1 dinar d'écart, une justification écrite est exigée. En dessous,
c'est de l'arrondi de monnaie.

### 3.7 `audit.ts` — le journal chaîné

Chaque ligne porte le hash de la précédente. Supprimer ou modifier une ligne
en base casse la chaîne et devient **détectable**, y compris par quelqu'un
qui a un accès SQL direct.

```sql
select * from kaissi.verifie_chaine_audit('<restaurant_id>');
-- { valide: true, probleme: 'Journal intègre.' }
```

Peu coûteux à implémenter, et très convaincant en démonstration commerciale :
le patron achète aussi le logiciel pour savoir ce qui se passe quand il n'est
pas là.

---

## 4. `packages/db-local` — la base de la tablette

Miroir SQLite du schéma Postgres, plus ce qui n'existe que localement.

### 4.1 Migrations

Le SQL est un **littéral TypeScript**, empaqueté dans l'APK. Jamais un
fichier téléchargé : une migration qui a besoin du réseau ne s'applique pas
en mode avion.

| Règle | Pourquoi |
|---|---|
| Une migration publiée ne se modifie jamais | Un appareil peut rester 3 semaines hors ligne |
| Versions contiguës, vérifiées au démarrage | Un trou = un parc incohérent |
| Une transaction par migration | Une migration à moitié appliquée à Sfax n'est pas réparable à distance |
| Toujours additive | L'ancienne version écrit encore dans les colonnes qu'elle connaît |

L'application **refuse de démarrer** sur une base plus récente qu'elle : mieux
vaut un message clair qu'écrire dans un schéma qu'on ne comprend pas.

### 4.2 Ce qui n'existe qu'en local

| Table | Rôle |
|---|---|
| `outbox` | Événements pas encore confirmés. Ne se vide **que** sur accusé de réception |
| `print_queue` | Tickets à imprimer. Survit au redémarrage, ne supprime **jamais** un travail |
| `kitchen_sends` | Ce qui est déjà parti en cuisine. Sans elle, la cuisine referait les plats |
| `sync_state` | Curseurs, identité de l'appareil, jeton |

### 4.3 Le projecteur

`projeterCommande()` : journal → `orders` / `order_items` / `payments`.

Pourquoi ne pas rejouer les événements à chaque affichage ? Parce qu'en fin
de service, la liste des commandes ouvertes rejouerait des milliers
d'événements à chaque rafraîchissement — précisément au moment où la caisse
doit être rapide.

Écriture de l'événement et mise à jour de la projection sont **une seule
transaction** : sinon un arrêt brutal laisserait une vente dans le journal
mais invisible à l'écran.

---

## 5. `packages/printing` — les tickets

Le modèle du ticket est **pur** (`domain/ticket.ts`), le rendu ESC/POS est
séparé. On peut donc tester ce qu'il y a sur un ticket sans imprimante.

| Ticket | Particularité |
|---|---|
| **Client** | Ventilation de TVA par taux, monnaie rendue, pied de page |
| **Cuisine (KOT)** | **Aucun prix.** Gros caractères, note en gras, « RAPPEL » si tournée suivante |
| **Shift** | Écart signé : `-0,200` ne se confond pas avec `0,200` |

Le KOT ne montre aucun prix parce que la cuisine n'a rien à en faire, et
qu'une ligne de moins est une ligne de plus lisible à trois mètres.

**Transport** : socket TCP brut vers le port 9100. L'imprimante est sur le
LAN : quand Internet tombe — le cas fréquent — le bon de cuisine part quand
même. C'est le seul endroit où l'on écrit du code natif Android
(`ImprimanteReseau.java`, ~200 lignes).

---

## 6. `apps/pos` — le terminal

### 6.1 Le parcours d'une journée

```
verrouillé → PIN → ouverture de caisse → salle
                                           ↓
                              commande ⇄ paiement → salle
                                           ↓
                                  clôture de caisse
```

### 6.2 `SessionCaisse` — le passage obligé

**Toute** action de caisse passe par là, dans cet ordre :

1. contrôle de permission **et** de transition d'état
2. écriture de l'événement dans le journal + outbox, en une transaction
3. reprojection de la commande
4. mise à jour de l'écran

L'ordre compte : afficher avant d'écrire ferait voir au caissier une vente
qui n'existe nulle part si l'application est tuée entre les deux.

### 6.3 Ce que fait l'écran de caisse

| Geste | Événement produit |
|---|---|
| Toucher un produit sans option | `line.added` (un seul clic) |
| Produit à options | Variante + modificateurs, puis `line.added` |
| Retirer une ligne | `line.voided` — la ligne **reste visible** |
| Remise | `discount.applied`, avec escalade si au-dessus du plafond |
| Cuisine | `order.sent` + un KOT **par station**, lignes non encore envoyées |
| Encaisser | `payment.recorded` (n fois) puis `order.closed` |

### 6.4 Ce qui ne bloque jamais une vente

- **Imprimante éteinte** → le ticket va en file, badge rouge, la vente est faite
- **Serveur injoignable** → l'outbox garde tout, la vente est faite
- **Stock épuisé** → on alerte, on **ne bloque pas**. Refuser de vendre une
  pizza sur une donnée périmée est le pire des deux mondes

---

## 7. `apps/sync` — la réconciliation

### 7.1 Le protocole

| Route | Rôle |
|---|---|
| `GET /sante` | Sonde de l'hébergeur, sans authentification |
| `POST /sync/push` | L'appareil envoie son outbox |
| `GET /sync/pull` | L'appareil rattrape les autres terminaux |

**Authentification** : `Authorization: Bearer kdev_…`. Le serveur stocke le
SHA-256, jamais le jeton. Un vol de la table `devices` ne donne accès à rien.

**Versionnement** : chaque requête porte `protocolVersion`. Le serveur
supporte N, N−1, N−2. Sans cela, une mise à jour du serveur casserait les
appareils restés hors ligne — exactement la population qu'on ne peut pas
joindre.

### 7.2 Le push, étape par étape

```
1. version de protocole supportée ?
2. ces event_id sont-ils DÉJÀ connus ?     ⚑ idempotence AVANT tout
3. pour les nouveaux : forme + transition d'état
4. insertion en UNE transaction
5. reprojection des commandes touchées, et d'elles seules
6. consignation des rejets
```

**L'étape 2 est l'étape la plus importante du fichier.** Un événement déjà
accepté est un doublon de retentative, pas une opération tardive. Le
revalider le ferait rejeter dès que la commande a changé d'état entre
l'envoi et la réémission : une caisse dont le réseau coupe pile après un
`order.closed` ne viderait **jamais** son outbox.

### 7.3 Rejets

Un rejet est une **règle métier**, pas une panne. Il ne se réessaie jamais
tout seul et remonte au gérant.

| Code | Signification |
|---|---|
| `commande_close` | Un autre terminal a déjà encaissé |
| `commande_annulee` | La commande a été annulée entre-temps |
| `appareil_etranger` | L'événement prétend venir d'un autre appareil |
| `charge_invalide` | Données incohérentes |
| `type_inconnu` | Le serveur est plus ancien que l'application |

### 7.4 Sécurité par RLS

Le service **emprunte le rôle `kaissi_device`** et pose le contexte
d'appareil en variables de session. Toutes les requêtes passent donc par RLS,
comme si l'appareil parlait directement à la base.

Conséquence : un défaut de filtrage applicatif ne peut pas provoquer de fuite
entre deux restaurants concurrents. La base refuserait.

---

## 8. `packages/sync-client` — le moteur embarqué

**Push d'abord, pull ensuite.** Si le réseau ne tient que trois secondes, ce
sont nos encaissements qui en profitent, pas ceux des voisins.

**L'outbox ne se vide que sur accusé de réception.** Jamais « au bout de N
essais », jamais sur un délai.

**Recul exponentiel avec gigue.** Quarante tablettes qui se reconnectent après
une coupure de quartier ne doivent pas taper toutes à la même seconde.

### États affichés

| État | Ce que voit le caissier |
|---|---|
| `a_jour` | Tout est enregistré sur le serveur |
| `hors_ligne` | Le serveur est injoignable. **La caisse fonctionne normalement** |
| `bloque` | L'appareil est révoqué. Une action humaine est requise |

La distinction `hors_ligne` / `bloque` est délibérée : le premier se résout
tout seul, le second non.

---

## 9. Le schéma Postgres

**32 tables**, toutes avec RLS activée *et* forcée. Zéro alerte de sécurité.

### Les tables qu'il faut connaître

| Table | Rôle |
|---|---|
| `order_events` | **Source de vérité.** Insertion seule |
| `orders`, `order_items` | Projections, reconstruites depuis les événements |
| `change_log` | Curseur du référentiel (`seq` bigserial) |
| `sync_mutations` | Registre d'idempotence. `event_id` en clé primaire |
| `audit_events` | Journal chaîné par hash. Insertion seule |
| `devices`, `device_pairings` | Parc de terminaux et appairages |
| `etat_appareils` (vue) | Supervision : retard, dernier contact, refus |

### Les quatre garanties, et comment les vérifier

```sql
-- 1. Aucune table sans RLS
select c.relname from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname='kaissi' and c.relkind='r' and not c.relrowsecurity;
-- → 0 ligne

-- 2. Immuabilité
update kaissi.order_events set type='order.cancelled' where event_id='…';
-- → insufficient_privilege

-- 3. Idempotence
insert into kaissi.order_events (event_id, …) values ('…', …)
on conflict (event_id) do nothing;
-- → une seule ligne, quel que soit le nombre d'envois

-- 4. Intégrité de l'audit
select * from kaissi.verifie_chaine_audit('<restaurant_id>');
```

### Ajouter une table

1. `organization_id` **et** `restaurant_id`, tous deux `not null`
2. Montants en `bigint`, colonne suffixée `_millimes`
3. Taux en `integer` de points de base — jamais de `real` ni `float`
4. Clé primaire `uuid` **sans default** si l'entité est créable hors ligne
5. RLS dans la **même** migration :
   ```sql
   select kaissi.protege_referentiel('ma_table');    -- catalogue
   select kaissi.protege_transactionnel('ma_table'); -- l'appareil insère
   ```

---

## 10. Les scénarios qui comptent

### 10.1 Deux tablettes, une table, pas de réseau

```
19h04  A ouvre la table 12, ajoute une pizza     (hors ligne)
19h05  B ajoute deux Coca sur la MÊME table      (hors ligne)
19h31  le réseau revient, les deux poussent
       → la commande contient les TROIS articles
```

Aucun conflit, aucun arbitrage. Les événements additifs commutent.
*Testé dans* `apps/sync/test/banc-trois-appareils.test.ts`.

### 10.2 Coupure en plein push

Le pire cas : le serveur enregistre, la réponse se perd.

```
1. l'appareil envoie 4 événements
2. le serveur les écrit           ✅
3. le réseau coupe                ❌ pas d'accusé de réception
4. l'outbox n'est PAS vidée
5. au retour, le même lot repart intégralement
6. le serveur reconnaît les event_id → doublons
   → UNE seule vente, UN seul paiement
```

C'est la garantie « jamais de double encaissement ».

### 10.3 Terminal resté longtemps hors ligne

60 ventes pendant qu'un terminal dort = 240 événements. Au retour, il
rattrape par pages de 500, sans intervention. Le serveur signale `encore:
true` tant qu'il reste des pages.

### 10.4 Écart de caisse

```
fond 50,000 + espèces 27,200 − dépense 3,000 = attendu 74,200
compté 74,000 → écart −0,200
```

En dessous de 1 dinar : arrondi de monnaie. Au-dessus : justification écrite
obligatoire, et remontée dans le tableau de bord anti-fraude.

---

## 11. Ce qui n'existe pas encore

Écrit noir sur blanc pour ne pas le découvrir en démonstration client :

| Manque | Phase | Contournement aujourd'hui |
|---|---|---|
| **Impression testée sur appareil** | — | Le plugin est écrit mais n'a jamais tourné sur une vraie imprimante |
| Back-office (catalogue, employés, rapports) | 1 bis | SQL direct dans Supabase |
| KDS (écran cuisine) | 3 | Impression papier |
| Transfert / fusion d'addition | 3 | — |
| Stock, recettes, food cost | 4 | — |
| Multi-établissement | 5 | Le schéma est prêt, l'interface non |
| CRM, fidélité | 6 | — |
| Conformité fiscale tunisienne | 7 | **À cadrer avec un expert-comptable** |
| Hub LAN | 8 | Régime dégradé assumé |

### Les points fiscaux `⚠`

Marqués ainsi dans le code et les migrations. **Ne jamais les affirmer depuis
la documentation** — ce sont des paramètres réglementaires qui évoluent, et
une erreur expose commercialement :

- les taux de TVA applicables à la restauration ;
- le traitement du droit de timbre ;
- les règles de numérotation séquentielle des factures ;
- l'existence d'une obligation de certification de caisse.

Le modèle de données est conçu pour les accueillir (`tax_rates` paramétrable,
`fiscal_number` attribué côté serveur). La règle exacte doit venir d'un
professionnel.
