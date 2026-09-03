# Gestion — ventes, coûts, marges et stock

Ce que le back-office sait faire depuis un navigateur, sans SQL : suivre le
chiffre, comprendre d'où il vient, et savoir ce qu'il reste en réserve.

> **L'impression reste éteinte.** Rien ici n'en dépend. Voir
> [`mvp.md` §2](mvp.md).

---

## 1. Les écrans

| Écran | Répond à |
|---|---|
| **Tableau de bord** | Combien j'ai fait, et combien j'ai gagné ? |
| **Ventes** | D'où vient mon chiffre — quel produit, qui, comment payé ? |
| **Tickets** | Que contenait exactement cette vente ? |
| **Journée** | Ma caisse tombe-t-elle juste ce soir ? |
| **Stock** | Qu'est-ce qui manque ? |
| **Catalogue** | Combien ça me coûte, combien je le vends ? |

Tous sont réservés aux rôles **gérant** et **admin**, sauf *Journée* et
*Cuisine*. Un cuisinier ne voit ni les coûts, ni les marges.

---

## 2. Le modèle de coût, volontairement simple

Un coût d'achat par produit, saisi à la main au **Catalogue**.

```
Burger — prix de vente 15,000 TND, coût d'achat 10,000 TND
      → marge  5,000 TND
      → marge  33,33 %
```

Trois précisions qui évitent des malentendus coûteux :

- **La marge est rapportée au CA**, pas au coût. `5 / 15 = 33,33 %`, et non
  `5 / 10 = 50 %`. C'est la convention des logiciels de caisse, celle qu'on
  compare d'un mois sur l'autre.
- **Le CA des rapports est hors taxe et après remises.** C'est la seule
  grandeur comparable à un coût d'achat, lui aussi hors taxe. Additionner un
  CA TTC et un coût HT gonflerait la marge d'un point de TVA — une erreur
  invisible, qui fait croire à une rentabilité qu'on n'a pas.
- **Un coût non saisi n'est pas un coût nul.** Les rapports comptent les
  lignes concernées et le disent : *« 3 lignes sans coût d'achat saisi »*.
  Sans cela, la marge s'afficherait à 100 % et paraîtrait juste.

Le coût est la **seule exception** au tout-entier du dépôt : `numeric(18,6)`
en base, parce que le coût d'un gramme de mozzarella vaut moins qu'un
millime. L'arrondi n'a lieu **qu'au total** — jamais ligne par ligne.

---

## 3. Le stock, et pourquoi il est calculé plutôt que compté

```
stock = quantité COMPTÉE (à une date)
      + réceptions / pertes saisies depuis
      − quantités vendues depuis
```

Il n'existe **aucun compteur** qu'on décrémenterait à chaque vente. C'est
délibéré : le serveur reprojette une commande entière (`DELETE` puis
`INSERT` de toutes ses lignes) à chaque nouvel événement la concernant. Un
compteur muté par déclencheur devrait défaire exactement ce qu'il a fait, y
compris quand la commande passe « annulée » entre les deux — ce qu'il ne peut
pas savoir. Il dériverait en silence, et **un stock faux est pire qu'un stock
absent**.

Conséquences pratiques :

- **Une vente diminue le stock**, dès qu'elle est synchronisée au serveur.
- **Une commande annulée le rend**, sans geste de votre part.
- **Une ligne annulée sur un ticket encaissé ne sort jamais du stock.**
- **Le stock ne bloque JAMAIS une vente.** La caisse encaisse hors ligne et
  ne consulte pas cet écran. Une quantité peut donc devenir négative : c'est
  une information utile — celle d'une réception oubliée.
- **Un produit à zéro sort de la carte tout seul** — mais c'est le SERVEUR qui
  le décide, sur le stock calculé à l'instant, jamais la tablette sur un
  souvenir. Le réglage descend par le catalogue ; côté caisse le produit reste
  visible, barré et marqué **RUPTURE**, et un clic explique pourquoi. La
  réception le remet en vente sans autre geste.
- **La colonne « En vente » reste, pour ce que le stock ne sait pas** : « la
  machine à café est en panne », « on ne fait plus de brik ce soir ». Un
  retrait manuel est marqué comme tel, et l'automatisme ne le défait jamais.
- **La case « auto » coupe l'automatisme produit par produit**, pour un article
  dont le comptage n'est qu'indicatif.
- **Un inventaire repart de zéro** : recompter repose la référence à la date
  du jour, et les ventes antérieures ne sont plus soustraites.

---

## 4. Protocole de test — de bout en bout

Compte 20 minutes. Chaque étape dit **ce que tu dois voir**, sinon l'étape
n'a rien prouvé.

### Prérequis

```bash
git pull
pnpm install
pnpm test:rapide      # 257 tests, dont les calculs de marge
```

Applique la migration `0019_stock_simple.sql` dans le SQL Editor de Supabase
(ou `supabase db push`). Vérifie :

```sql
select count(*) from kaissi.stock_items;   -- 0, la table existe
select * from kaissi.stock_actuel limit 1; -- la vue répond
```

Puis redéploie le back-office (Vercel se déclenche sur un push `main`).

---

### Étape 1 — Saisir un coût d'achat

**Catalogue** → modifier un produit → champ **Coût d'achat**.

Prends un produit à 13,500 TND et saisis `9` comme coût.

✅ **Attendu** : la ligne du tableau affiche `Coût 9,000 TND` et
`Marge 4,500 TND · 33,33 %`.

> Si la colonne Marge affiche « — », le coût n'a pas été enregistré : le
> champ attend des **dinars** (`9`), pas des millimes (`9000`).

---

### Étape 2 — Activer le suivi de stock

**Stock** → ligne du produit → **Suivre**.

Saisis `20` en quantité et `5` en seuil d'alerte.

✅ **Attendu** :
- la ligne passe à `Stock 20`, `Seuil 5`, état **OK** ;
- la carte « Produits suivis » passe à `1 / 17` ;
- la carte « Valeur du stock » affiche `180,000 TND` (20 × 9).

---

### Étape 3 — Vendre, et voir le stock bouger

Sur le **POS**, encaisse **3 unités** de ce produit. Attends que le badge de
synchronisation revienne à `⇅ 0`.

Recharge **Stock**.

✅ **Attendu** : `Stock 17`, et en dépliant la ligne : *« Depuis le comptage :
3 vendu(s) »*.

> **Rien ne bouge ?** Le stock se calcule **côté serveur**, à partir des
> ventes synchronisées. Une caisse non appairée, ou une vente restée dans
> l'outbox, ne décrémente rien. Vérifie l'écran *Synchronisation* du POS.

---

### Étape 4 — Le tableau de bord

**Tableau de bord**, période **Aujourd'hui**.

✅ **Attendu**, pour 3 unités vendues à 13,500 (TVA 19 % incluse) :

| Indicateur | Ordre de grandeur |
|---|---|
| Chiffre d'affaires | le net **hors taxe** — donc inférieur à 40,500 |
| Tickets | 1 |
| Panier moyen | = le CA (un seul ticket) |
| Coût total | `27,000` (3 × 9) |
| Marge brute | CA − 27,000 |
| Marge % | ≈ 20–25 % |

> Le CA est **hors taxe** : ne le compare pas au total du ticket, qui est
> TTC. C'est l'écran **Journée** qui montre les encaissements TTC.

---

### Étape 5 — Une remise réduit la marge

Sur le POS, ouvre une commande, ajoute le même produit, applique une **remise
de 20 %**, encaisse. Synchronise.

✅ **Attendu** sur le **Tableau de bord** :
- « Remises accordées » n'est plus à zéro ;
- « CA net » < « CA brut », de ce montant exactement ;
- la **marge %** a baissé — le coût, lui, n'a pas bougé.

C'est précisément ce qu'un gérant doit voir avant d'accorder des remises à la
chaîne.

---

### Étape 6 — Les quatre ventilations

**Ventes**, période **Aujourd'hui**.

✅ **Attendu** : quatre tableaux cohérents entre eux.

| Tableau | Contrôle |
|---|---|
| **Par produit** | ton produit en tête ; la colonne *Part* totalise 100 % |
| **Par catégorie** | même CA que la somme des produits de la catégorie |
| **Par employé** | la vente est au nom de **qui a encaissé** |
| **Par moyen de paiement** | montants **TTC** — ils ne s'additionnent pas au CA net |

Le bloc *Récapitulatif* en haut doit donner exactement les mêmes chiffres que
le tableau de bord : les deux écrans lisent les **mêmes** lignes.

---

### Étape 7 — Le détail d'un ticket

**Tickets** → **Détail** sur une vente.

✅ **Attendu** : chaque ligne avec brut, remise, net HT et TVA ; les
transactions (moyen, montant, rendu) ; la ventilation de TVA par taux.

Une ligne annulée en cours de commande apparaît **barrée**, marquée
« annulée ». Elle n'entre dans aucun chiffre — mais elle explique l'écart
entre ce que le client a commandé et ce qu'il a payé.

---

### Étape 8 — Réception et alertes

**Stock** → déplie ton produit → **Mouvement** : `10`, motif **Réception**.

✅ **Attendu** : `Stock 27`.

Maintenant **recompte** à `4` (bouton *Recompter le stock*).

✅ **Attendu** : état **Faible** (4 ≤ seuil 5), pastille orange, et le produit
apparaît dans « À réapprovisionner ».

Recompte à `0` → état **Rupture**, pastille rouge.

> Vends encore une unité : le stock passe à `−1` et reste en **Rupture**. La
> caisse n'a rien refusé — c'est voulu — et le négatif te dit qu'il manque
> une réception à saisir.

---

### Étape 9 — Une annulation rend le stock

Recompte à `10`. Sur le POS, encaisse 2 unités, synchronise → `8`.

Fais **annuler** cette commande par un manager sur le POS, puis synchronise.

✅ **Attendu** : `Stock 10`. La vente disparaît aussi du tableau de bord.

---

### Étape 10 — Le garde-fou des coûts manquants

Vends un produit dont le coût n'est **pas** saisi.

✅ **Attendu** : un bandeau orange sur le tableau de bord —
*« N ligne(s) vendue(s) sans coût d'achat saisi. Le coût total est donc
sous-estimé, et la marge d'autant surestimée. »* avec un lien vers le
catalogue.

C'est le contrôle qui distingue un rapport honnête d'un rapport flatteur.

---

## 5. Vérifications automatiques

```bash
pnpm test:rapide          # 257 tests — dont marge, coûts fractionnaires
pnpm --filter @kaissi/backoffice test   # 48 — agrégations, ventilations, seuils
pnpm typecheck

# Contre un vrai PostgreSQL : RLS du stock, isolation de la vue
pnpm db:test && pnpm --filter @kaissi/sync test && pnpm db:test:stop
```

Ce que ces tests figent, et qui casserait en silence sans eux :

- l'arrondi des coûts **au total**, jamais ligne par ligne ;
- la marge **négative** quand on vend à perte — jamais plancher à zéro ;
- `null` et non « 0 % » quand il n'y a aucune vente ;
- un produit **supprimé** du catalogue garde son chiffre dans les rapports ;
- la vue `stock_actuel` ne traverse **pas** la frontière d'un autre client.

---

## 6. Ce qui n'est pas fait, et pourquoi

- **Pas de recettes ni de nomenclatures.** Le coût est par produit fini, pas
  par ingrédient. Un burger a un coût, pas « 1 pain + 1 steak ». C'est le
  modèle simple demandé ; les recettes viendront quand le stock d'ingrédients
  sera nécessaire.
- **Pas de stock par variante** (taille, supplément). Le suivi porte sur le
  produit.
- **Pas de remboursement depuis le back-office.** Les remboursements existent
  en base et sont **comptés** dans les rapports, mais se saisissent en caisse.
- **Pas d'export CSV.** À ajouter quand un comptable le demandera — la
  structure des rapports s'y prête déjà.
