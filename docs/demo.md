# Démonstration de bout en bout

Un service complet joué en 30 minutes, qui remplit **tous** les écrans :
tableau de bord, ventes, tickets, journée, stock, cuisine.

À la fin, tu sauras lire chaque chiffre et dire d'où il vient.

> **Rien à installer, rien à `git pull`.** Tout tourne déjà sur Vercel et
> Railway, qui se redéploient à chaque `push` sur `main`. Le dépôt local ne
> sert que pour deux commandes d'exploitation : `pnpm sync:acces` (donner un
> accès au back-office) et `pnpm sync:appairer` (appairer une caisse).

---

## 0. Les trois adresses

| Rôle | Adresse |
|---|---|
| **Caisse** | `https://kaissi-pos.vercel.app` |
| **Back-office** | `https://kaissi-backoffice.vercel.app` |
| **API de sync** | `https://kaissi-production.up.railway.app` |

PIN de démonstration : `2468` (caissier Salma) · `1357` (gérant Ahmed) ·
`9753` (serveur Karim).

---

## 1. Vérifier que la chaîne est vivante

Trois contrôles, 30 secondes. **Ne commence pas la démo si l'un échoue.**

**1.1 — L'API répond**

```bash
curl https://kaissi-production.up.railway.app/sante
# {"etat":"ok","protocole":1,"base":"joignable",…}
```

**1.2 — La caisse est appairée**

Ouvre la caisse → bandeau du haut. Tu dois voir `⇅ 0` ou rien du tout.
Si tu vois **`⇅ local`**, elle n'est pas appairée : voir §7.

**1.3 — Aucune opération refusée**

Bandeau → **⇅** → *État de la synchronisation*. « Opérations refusées » doit
être à **0**.

> **S'il y a des refus « Événement signé par un autre appareil »** — le
> terminal signait avec l'identité de la graine de démonstration au lieu de
> celle que son jeton désigne. Il se répare désormais **tout seul au
> démarrage** : recharge complètement la page de la caisse (Ctrl+Maj+R),
> puis clique **« Abandonner ces opérations d'un ancien appairage »** au bas
> de l'écran Synchronisation. Ces ventes-là ne remonteront jamais — elles
> portent l'ancien identifiant — mais elles restent enregistrées localement,
> et **toutes les suivantes** partiront normalement.

---

## 2. Ce qui est déjà préparé

Le jeu de démonstration « Snack Lac 1 » est prêt à l'emploi :

- **17 produits** avec leur **coût d'achat** renseigné (marges 60 à 76 %) ;
- **5 produits suivis en stock**, choisis pour montrer les trois états :

| Produit | Stock | Seuil | État |
|---|---|---|---|
| Coca-Cola 33cl | 48 | 12 | **OK** |
| Frites | 30 | 10 | **OK** |
| Eau minérale 50cl | 24 | 6 | **OK** |
| Ojja merguez | 6 | 8 | **Faible** |
| Pizza Margherita | 0 | 5 | **Rupture** |

Tu peux donc ouvrir **Stock** dès maintenant et voir les pastilles.

---

## 3. Le scénario — un service de 4 tickets

Joue-le à la caisse. Chaque ticket sert un écran précis.

### Prise de poste

Caisse → **Salma Trabelsi** → PIN `2468` → ouverture de caisse, fond `50`.

> Le fond de caisse alimente l'écran **Journée** : c'est lui qui rend l'écart
> de caisse calculable ce soir.

### Ticket 1 — la vente simple *(sert le tableau de bord)*

Table 3 → **Coca-Cola 33cl** ×2 → **Frites** ×1 → **Encaisser** → Espèces →
montant exact.

```
2 × Coca (4,200)  +  1 × Frites (4,500)  =  12,900 TND TTC
coût :  2 × 1,400  +  1 × 1,300          =   4,100 TND
```

### Ticket 2 — la remise *(sert les rapports Remises)*

Table 5 → **Couscous poulet** ×1 → bouton **Remise** → **10 %** → Encaisser.

> Observe : le coût ne bouge pas, la marge baisse. C'est exactement ce qu'un
> gérant doit voir avant d'accorder des remises à la chaîne.

### Ticket 3 — l'envoi en cuisine *(sert l'écran Cuisine)*

Table 8 → **Pizza Quatre Fromages** ×1 → **Escalope panée frites** ×1 →
bouton **Cuisine**.

**Ne l'encaisse pas tout de suite.** Va voir l'écran Cuisine (§4.6), puis
reviens l'encaisser par **Carte bancaire**.

> Encaisser par carte fait apparaître un second moyen de paiement dans la
> ventilation — sinon le tableau « Par moyen de paiement » n'a qu'une ligne.

### Ticket 4 — l'autre employé *(sert « Ventes par employé »)*

Bandeau → **verrouiller** → **Karim Jelassi**, PIN `9753`.
Table 2 → **Sandwich thon** ×2 → Encaisser en espèces.

> La vente est attribuée à **celui qui encaisse**, donc à Karim.

### Ticket 5 — la ligne annulée *(sert le détail de ticket)*

Reprends avec Salma (`2468`). Table 1 → **Tiramisu** ×1 → **Express** ×1 →
annule la ligne **Express** (motif : « erreur de saisie ») → Encaisser.

### Synchroniser

Bandeau → **⇅** → **Synchroniser maintenant**. Attends `⇅ 0`.

> **Rien ne remonte tant que ce compteur n'est pas à zéro.** Tous les écrans
> du back-office lisent le **serveur**, jamais la caisse.

---

## 4. Lire les écrans

Ouvre le back-office et connecte-toi avec ton compte admin.

### 4.1 — Tableau de bord

Période **Aujourd'hui**. Six chiffres :

| Indicateur | Ce qu'il dit | Piège |
|---|---|---|
| **Chiffre d'affaires** | Ventes **hors taxe**, après remises | Il est **inférieur** au total des tickets, qui est TTC. Normal. |
| **Tickets** | Commandes encaissées | Une commande ouverte n'en est pas une. |
| **Panier moyen** | CA ÷ tickets | — |
| **Coût total** | Somme des coûts d'achat vendus | Vaut 0 si aucun coût n'est saisi. |
| **Marge brute** | CA − coût | Peut être négative, et le reste. |
| **Marge %** | Marge ÷ **CA** | `5/15 = 33 %`, **pas** `5/10 = 50 %`. |

En dessous :

- **Remises et remboursements** — la chaîne complète : CA brut → remises →
  CA net → remboursements. Le ticket 2 fait apparaître la remise.
- **Volume** — articles vendus, références, catégories actives.
- **Meilleures ventes** — le top 10 par CA, avec marge par produit.

> **Bandeau orange « N lignes sans coût d'achat saisi »** : le coût total est
> sous-estimé et la marge surestimée d'autant. Il ne devrait pas apparaître
> ici — les 17 produits ont un coût. S'il apparaît, c'est qu'un produit a été
> créé depuis.

### 4.2 — Ventes

Le même chiffre, décomposé de quatre façons. Le **Récapitulatif** en tête doit
donner exactement les mêmes montants que le tableau de bord : les deux écrans
lisent les mêmes lignes.

| Tableau | Ce que tu dois voir après le scénario |
|---|---|
| **Par produit** | Coca et Frites en tête ; la colonne *Part* totalise 100 % |
| **Par catégorie** | Plats, Boissons, Snacks, Desserts |
| **Par employé** | **Salma** (tickets 1, 2, 3, 5) et **Karim** (ticket 4) |
| **Par moyen de paiement** | **Espèces** et **Carte** |

> Les montants « Par moyen de paiement » sont **TTC** et ne s'additionnent pas
> au CA net, qui est HT. C'est écrit sur l'écran, et c'est la confusion n° 1.

### 4.3 — Tickets

La liste des 5 ventes. Clique **Détail** sur le **ticket 5** (Tiramisu).

Tu y verras :
- chaque ligne avec **brut, remise, net HT, TVA** ;
- la ligne **Express barrée**, marquée « annulée » — elle n'entre dans aucun
  chiffre, mais elle explique l'écart entre ce qui a été commandé et ce qui a
  été payé ;
- les **transactions** (moyen, montant, rendu) ;
- la **ventilation de TVA** par taux.

C'est la page à ouvrir quand un client conteste un montant.

### 4.4 — Journée

**Différent des autres écrans, et c'est voulu.**

| | Tableau de bord / Ventes | Journée |
|---|---|---|
| Question | Est-ce que je gagne de l'argent ? | Ma caisse tombe-t-elle juste ? |
| Montants | **Hors taxe**, après remises | **TTC**, tels qu'encaissés |
| Coûts et marges | Oui | Non |
| Période | Libre (jour, semaine, mois) | **Un** jour commercial |
| Contient | Ventilations, marges | Encaissements, **caisses et écarts** |

La journée commerciale va de **04:00 à 04:00 le lendemain** : une vente
encaissée à 1 h du matin appartient à la soirée de la veille. Sans cela, une
fin de service à cheval sur minuit se retrouverait coupée en deux.

Le bloc **Caisses** montre le fond de caisse, l'attendu, le compté et
l'**écart** — c'est le seul écran qui répond à « il manque 3 dinars ce soir ».

### 4.5 — Stock

Quatre cartes en tête : produits suivis, ruptures, stock faible, **valeur du
stock** (quantités × coût d'achat).

Puis « À réapprovisionner », et le tableau complet avec prix, coût, **marge
par produit**, stock, seuil et état.

**Vérifie que la vente a bien décrémenté** : Coca-Cola devait être à 48, tu en
as vendu 2 au ticket 1 → il doit afficher **46**. Déplie la ligne : *« Depuis
le comptage : 2 vendu(s) »*.

> **Rien n'a bougé ?** Le stock se calcule **côté serveur** à partir des
> ventes synchronisées. Vérifie que le badge de la caisse est bien à `⇅ 0`.

### 4.6 — Cuisine

À faire **entre l'envoi et l'encaissement du ticket 3**.

L'écran affiche les commandes **envoyées et pas encore encaissées**, les plus
anciennes d'abord, avec l'attente en minutes qui passe à l'orange à 10 min et
au rouge à 20. Aucun montant : la cuisine prépare, elle n'encaisse pas.

Clique **Prêt** → le bon grisonne. Encaisse le ticket à la caisse → il
disparaît de l'écran.

> Cet écran a besoin du **réseau** (il lit le serveur). La caisse, elle,
> encaisse hors ligne. Si la cuisine perd Internet elle perd l'affichage, pas
> les commandes : elles réapparaissent au retour du réseau.

---

## 5. Les trois manipulations qui prouvent que ça marche

### 5.1 — Le stock revient quand on annule

Note le stock de **Frites** (30). Encaisse un ticket avec 3 Frites →
synchronise → Stock affiche **27**.

Fais **annuler** cette commande par un manager (PIN `1357`) → synchronise →
Stock revient à **30**, et la vente disparaît du tableau de bord.

> Aucun compteur n'est décrémenté nulle part : le stock est **recalculé** à
> chaque lecture. C'est ce qui le rend insensible aux annulations et aux
> reprojections.

### 5.2 — La caisse encaisse hors ligne

Coupe le Wi-Fi de la caisse. Le bandeau passe **Hors ligne**.

Encaisse une vente normalement — **rien ne bloque**. Le compteur `⇅ n` monte.

Rends le réseau : le compteur redescend à `0` tout seul, et la vente apparaît
au back-office.

> C'est la promesse du produit. Le stock, lui, ne bougera qu'après la
> synchronisation — il est calculé côté serveur.

### 5.3 — Le stock ne bloque jamais une vente

Pizza Margherita est à **0**. Vends-en une.

**La caisse ne refuse rien.** Après synchronisation, le stock affiche **−1**,
en rupture. Ce négatif est une information : il manque une réception à saisir.

> Refuser une vente sur une donnée de stock périmée est le pire des deux
> mondes — on perd le client *et* la donnée reste fausse.

---

## 6. Gérer le catalogue et le stock

### Changer un prix ou un coût

Back-office → **Catalogue** → modifier un produit.

- **Prix de vente** et **Coût d'achat** se saisissent en **dinars** (`15` et
  `9`), jamais en millimes.
- La colonne **Marge** se met à jour immédiatement : `6,000 TND · 40 %`.
- Les tablettes reçoivent le nouveau prix à leur prochaine synchronisation,
  sans rien réinstaller.

> Un coût laissé **vide** n'est pas un coût nul : les rapports comptent ces
> lignes et préviennent que la marge est surestimée.

### Compter, réceptionner, alerter

Back-office → **Stock** → bouton **Suivre** ou **Ajuster**.

| Geste | Quand | Effet |
|---|---|---|
| **Recompter le stock** | Après un inventaire | Repose la référence à maintenant. Les ventes antérieures ne sont plus soustraites. |
| **Réception** | Livraison | Ajoute la quantité |
| **Perte / casse** | Casse, péremption | Retranche (saisir un nombre **positif**) |
| **Correction** | Erreur de saisie | Ajoute ou retranche |
| **Seuil d'alerte** | — | Déclenche l'état « Faible » |
| **Arrêter le suivi** | Produit non stocké | Retire le produit des alertes |

---

## 7. Si quelque chose ne va pas

| Symptôme | Cause · geste |
|---|---|
| `Could not find the table 'kaissi.stock_items'` | Cache de schéma PostgREST périmé. Supabase → SQL Editor → `notify pgrst, 'reload schema';` |
| Opérations refusées « signé par un autre appareil » | Recharge la caisse (Ctrl+Maj+R) : elle adopte son identité au démarrage. Puis « Abandonner ces opérations d'un ancien appairage ». |
| Badge **⇅ local** | Terminal non appairé. `pnpm sync:appairer --restaurant 01930000-0000-7000-8000-000000000002 --prefixe P3`, puis saisir l'URL et le jeton dans la caisse. |
| « Failed to fetch » à l'appairage | `SYNC_ORIGINES` sur Railway doit contenir l'URL **exacte** du POS. |
| Stock inchangé après une vente | La vente n'est pas synchronisée : badge `⇅ 0` ? |
| Tableau de bord vide | Mauvaise période, ou vente non synchronisée. Vérifie d'abord **Tickets**. |
| CA inférieur au total des tickets | **Normal** : le CA est HT, les tickets TTC. |
| « Votre compte n'est rattaché à aucun établissement » | `pnpm sync:acces --restaurant <uuid> --email … --role admin` |

---

## 8. Remettre la démo à zéro

Dans le **SQL Editor** de Supabase.

**Effacer les ventes** (garde catalogue, employés, stock) :

```sql
-- order_events est en insertion seule : le déclencheur bloque même le
-- propriétaire. On le désactive le temps du ménage — un privilège réservé à
-- une base de démonstration, JAMAIS à une base de production réelle.
alter table kaissi.order_events disable trigger order_events_immuable;
delete from kaissi.payments  where restaurant_id = '01930000-0000-7000-8000-000000000002';
delete from kaissi.order_items where restaurant_id = '01930000-0000-7000-8000-000000000002';
delete from kaissi.order_events where restaurant_id = '01930000-0000-7000-8000-000000000002';
delete from kaissi.orders     where restaurant_id = '01930000-0000-7000-8000-000000000002';
alter table kaissi.order_events enable trigger order_events_immuable;
```

**Reposer les stocks de démonstration** :

```sql
update kaissi.stock_items set qty_reference = v.qte, counted_at = now(), min_qty = v.seuil
from (values ('Coca-Cola 33cl',48,12),('Eau minérale 50cl',24,6),('Frites',30,10),
             ('Ojja merguez',6,8),('Pizza Margherita',0,5)) as v(nom,qte,seuil)
join kaissi.products p on p.name = v.nom
where kaissi.stock_items.product_id = p.id;
```

> La caisse garde ses ventes **en local** : ce ménage ne vide que le serveur.
> Pour repartir d'une caisse vierge, efface les données du site dans le
> navigateur (Paramètres → Données de site).
