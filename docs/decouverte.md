# Découvrir Kaissi en cinq étapes

Ce document est **le point d'entrée**. Il n'explique pas l'architecture : il te
fait *voir* le produit fonctionner, dans un ordre où chaque étape ne demande
que ce que la précédente a déjà installé.

Chaque étape dit trois choses : **la commande**, **ce que tu dois voir**, et
**ce que ça prouve**. Si une étape échoue, ne passe pas à la suivante — elle
échouerait aussi, pour une raison qui n'aurait plus rien à voir.

| # | Étape | Durée | Prérequis |
|---|---|---|---|
| 1 | Les calculs et le schéma local | 2 min | Node 22 + pnpm |
| 2 | Le POS dans ton navigateur | 15 min | rien de plus |
| 3 | Une journée rejouée toute seule | 2 min | Chromium |
| 4 | La synchronisation multi-appareils | 10 min | Docker **ou** PostgreSQL |
| 5 | La tablette réelle, en mode avion | 1 h | Android Studio + tablette |

Les étapes 1 à 4 se font **entièrement sur ton poste**, sans Android, sans
Supabase, sans imprimante.

---

## 0. Installer

```bash
git clone https://github.com/techres2boost/Kaissi.git
cd Kaissi
pnpm install
```

Node 22 ou plus (`node --version`). Si `pnpm` manque : `npm i -g pnpm`.

---

## Étape 1 — Les calculs et le schéma local · 2 min

```bash
pnpm test:rapide
```

**Ce que tu dois voir**

```
@kaissi/domain:test:      Tests  154 passed (154)
@kaissi/db-local:test:    Tests   45 passed (45)
@kaissi/printing:test:    Tests   26 passed (26)
```

**Ce que ça prouve** — les trois briques qui n'ont besoin de rien pour
tourner, et dont tout le reste dépend :

| Paquet | Ce qu'il garantit | Pourquoi c'est là |
|---|---|---|
| `packages/domain` | L'argent en **entiers de millimes**, la TVA arrondie **par taux**, la remise globale répartie **au prorata**, les permissions, le shift, le PIN | Le dinar a **trois** décimales. Une bibliothèque qui suppose « centimes = ×100 » produit des écarts de caisse qu'on ne découvre qu'après des mois |
| `packages/db-local` | Le schéma SQLite, les migrations locales, les projections, l'outbox | Les migrations sont des **littéraux TypeScript** empaquetés dans l'APK : une migration qui a besoin du réseau ne s'applique pas en mode avion |
| `packages/printing` | Le rendu ESC/POS : ticket client, bon de cuisine, rapport de caisse | Le bon de cuisine ne porte **aucun prix**, et n'est jamais réimprimé |

> **Pourquoi `test:rapide` et pas `pnpm test` ?** `pnpm test` inclut la
> synchronisation, qui exige un vrai PostgreSQL — c'est l'étape 4. Lancée sans
> base, elle échoue, et l'échec n'apprend rien.

Pour regarder de plus près un calcul précis :

```bash
pnpm --filter @kaissi/domain test totaux --reporter=verbose
```

Le fichier `packages/domain/src/totaux.ts` fixe l'ordre de calcul, et cet ordre
**ne bouge pas**. Les étapes 4 (répartition au prorata) et 6 (arrondi par taux)
sont les deux sources d'écart les plus fréquentes en production.

---

## Étape 2 — Le POS dans ton navigateur · 15 min

```bash
pnpm pos:dev          # → http://localhost:5173
```

> La base est **en mémoire** : tout disparaît au rechargement. C'est voulu, et
> c'est le seul mode où le POS tourne hors d'un APK.

Suis exactement cette séquence. Les montants indiqués sont ceux que tu dois
voir — ils viennent du parcours automatisé de l'étape 3.

| # | Ce que tu fais | Ce que tu dois voir | Ce que ça montre |
|---|---|---|---|
| 1 | L'application s'ouvre | **Prise de poste** | Aucun appel réseau n'a eu lieu : SQLite, migrations et catalogue sont locaux |
| 2 | **Salma Trabelsi** → PIN `2468` | La caisse se déverrouille | PIN vérifié **hors ligne** (Argon2id). Il dit *qui agit*, il ne protège pas l'argent |
| 3 | Fond de caisse `50` → valider | Le plan de salle | Ouverture de shift. Le fond sert de référence à l'écart de clôture |
| 4 | Table **3** | La grille des produits | Une commande est ouverte — un événement, pas une ligne modifiable |
| 5 | Boissons → **Coca-Cola 33cl** | La ligne apparaît en **un clic** | Un produit sans option ne pose pas de question |
| 6 | Plats → **Pizza Margherita** → supplément **Fromage** → valider | Total **20,200 TND** | Le modificateur entre dans le prix de la ligne, pas en supplément séparé |
| 7 | **Cuisine** | « 2 article(s) envoyé(s) — 2 bon(s). » | Un bon par station |
| 8 | **Cuisine** une seconde fois | « Tout est déjà parti en cuisine. » | `kitchen_sends` retient ce qui est parti. Sinon la cuisine referait les plats déjà servis |
| 9 | **Remise** → **10 %** | « − 2,020 TND » | 10 % est le plafond de Salma, caissière : accordé sans rien demander |
| 10 | **Remise** → **50 %** | **Autorisation requise** — « Remise de 50 % supérieure au plafond de 10 % accordé à Salma Trabelsi. » | Ce n'est pas *interdit*, c'est *interdit sans manager*. La nuance décide d'ouvrir une saisie de PIN plutôt qu'un message d'échec |
| 11 | **Ahmed** → PIN `1357` | Total **10,100 TND** | L'autorisation est tracée : qui, quoi, pourquoi |
| 12 | Encaisser → **Espèces** | Suggestions : `10,100 · 11,000 · 15,000 · 20,000` | Des **coupures réelles** : le billet de 40 dinars n'existe pas |
| 13 | Toucher **11,000** | Monnaie à rendre **0,900 TND** | Calculée sur la somme des paiements, pas sur `total − versé` |
| 14 | Clôturer | Retour au plan de salle, table 3 **libre** | |
| 15 | Badge **🖨 3** en haut | Trois tickets en attente | Aucune imprimante en navigateur. Les travaux **restent en file** — un ticket qui disparaît en silence est exactement ce qu'il ne faut pas |

### Les deux écrans à ne pas manquer

**Diagnostic** — étapes de démarrage chronométrées, migrations appliquées,
état de l'outbox, test du mode avion. Un support à distance sans diagnostic
sur l'appareil n'est pas un support.

**Synchronisation** — curseurs, opérations en attente, opérations *rejetées*.
Un rejet ne se réessaie **jamais** tout seul : c'est une règle métier, elle
remonte au gérant.

### Choses à essayer pour comprendre les garanties

| Essai | Ce que tu observes | La règle derrière |
|---|---|---|
| Annuler une ligne déjà envoyée en cuisine | La ligne disparaît de l'écran | L'événement d'annulation **s'ajoute**, il n'efface rien |
| Payer 5 dinars sur un total de 10 | Reste à payer 5, la commande reste ouverte | Paiement partiel et mixte |
| Se tromper 5 fois de PIN | Blocage **temporaire** | Bloquer définitivement le seul caissier présent un vendredi soir serait pire que le risque couvert |
| Clôturer la caisse avec un comptage faux | L'écart s'affiche **signé** | L'écart n'est jamais borné à zéro : un excédent est aussi anormal qu'un manque |

---

## Étape 3 — Une journée rejouée toute seule · 2 min

Laisse `pnpm pos:dev` tourner, puis dans un second terminal :

```bash
pnpm parcours
```

**Ce que tu dois voir** — les quinze étapes de l'étape 2, jouées dans un vrai
Chromium, avec les montants affichés au passage, et pour finir :

```
✓ Parcours complet — aucune erreur console.
```

**Ce que ça prouve** — ce qu'aucun test unitaire ne peut prouver : que la
journée tient debout du déverrouillage à la clôture. C'est ce parcours qui
tourne en CI à chaque commit.

---

## Étape 4 — La synchronisation multi-appareils · 10 min

C'est la partie difficile du produit, et celle qui décide s'il est vendable.

```bash
pnpm db:test                        # PostgreSQL jetable + schéma de production
pnpm --filter @kaissi/sync test
```

`pnpm db:test` utilise Docker s'il tourne, sinon un cluster PostgreSQL local.
Il applique **les migrations de production telles quelles** : `amorce-supabase.sql`
n'ajoute que les rôles et le schéma `auth` qu'un PostgreSQL nu n'a pas.

**Ce que tu dois voir**

```
✓ PostgreSQL prêt sur 127.0.0.1:5433 — 30 tables, toutes sous RLS
...
Test Files  2 passed (2)
     Tests  35 passed (35)
```

**Ce que ça prouve**

| Garantie | Comment elle est vérifiée |
|---|---|
| **Jamais de double encaissement** | Le même `event_id` renvoyé cinq fois n'insère qu'une ligne |
| **L'idempotence passe AVANT la validation métier** | Une caisse dont le réseau tombe juste après `order.closed` doit pouvoir vider son outbox. Revalider l'état la bloquerait pour toujours |
| **Curseur = `bigserial` serveur, jamais un horodatage** | Les horloges des tablettes dérivent et changent de fuseau |
| **Aucune fuite entre restaurants** | Le service emprunte le rôle `kaissi_device` : tout passe par RLS, un défaut de filtrage applicatif ne suffit pas à faire fuir des données |
| **Les journaux sont en insertion seule** | `UPDATE`/`DELETE` sur `order_events` lèvent `insufficient_privilege` |

Le fichier `apps/sync/test/banc-trois-appareils.test.ts` est **le jalon de la
Phase 2** : trois terminaux, des coupures franches et aléatoires — dont la
pire, celle où le serveur écrit et où la réponse se perd. Aucune vente perdue,
aucune dupliquée, totaux identiques au millime.

Quand tu as fini :

```bash
pnpm db:test:stop
```

---

## Étape 5 — La tablette réelle · 1 h

C'est **le seul test qui compte vraiment**, et le seul que rien ne remplace.

Avant d'y aller, une vérification qui ne demande qu'un JDK :

```bash
pnpm verifier:natif    # le plugin d'impression compile, sans SDK Android
pnpm verifier:avion    # le bundle ne dépend d'aucune ressource distante
```

Puis suis [`tester-mode-avion.md`](tester-mode-avion.md) — la procédure
complète, y compris ce qu'il faut voir et ce que chaque symptôme signifie.
En résumé : construire l'APK, l'installer, **activer le mode avion**, tuer
l'application, la rouvrir. Elle doit démarrer et afficher le menu.

Si elle démarre avec l'avion activé, la promesse du produit tient.

---

## Où lire ensuite

| Tu veux | Va voir |
|---|---|
| Comprendre **pourquoi** chaque module est ainsi | [`fonctionnel.md`](fonctionnel.md) |
| Les décisions structurantes en version courte | [`architecture.md`](architecture.md) |
| Toutes les procédures de test, en détail | [`tester.md`](tester.md) |
| Mettre en production | [`deploiement.md`](deploiement.md) |
| Les règles qui ne se contournent pas | [`../CLAUDE.md`](../CLAUDE.md) |

---

## Ce qui n'existe pas encore

Autant le savoir avant une démonstration client :

| Manque | Conséquence aujourd'hui |
|---|---|
| Back-office (catalogue, employés, rapports) | Modifier un produit ou un employé passe par du SQL direct dans Supabase |
| Impression testée sur imprimante réelle | Le code compile et le rendu est testé ; **le papier qui sort ne l'est pas** |
| KDS, stock, recettes, CRM | Phases 3 à 6 |
