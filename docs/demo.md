# Kaissi — démonstration de bout en bout

Kaissi, c'est deux applications qui travaillent ensemble :

- **la caisse (POS)** : prend les commandes et encaisse, **même sans Internet** ;
- **le back-office** : rapports, carte, stock, équipe, paramètres.

Ce document fait tester **toutes les fonctionnalités**, de la mise en service
d'une caisse jusqu'aux rapports, dans l'ordre où un restaurant les utilise.
Chaque étape donne le geste, puis **Attendu** : ce que tu dois voir. Si tu ne
le vois pas, c'est un défaut à signaler.

Durée : environ 2 heures pour tout.

## Sommaire

1. [Avant de commencer](#1-avant-de-commencer)
2. [Mettre la caisse en service](#2-mettre-la-caisse-en-service)
3. [Un service complet à la caisse](#3-un-service-complet-à-la-caisse)
4. [Lire le service au back-office](#4-lire-le-service-au-back-office)
5. [Cuisine et bar](#5-cuisine-et-bar)
6. [Le stock](#6-le-stock)
7. [La carte : articles, catégories, modificateurs, réductions](#7-la-carte--articles-catégories-modificateurs-réductions)
8. [Les paramètres](#8-les-paramètres)
9. [Abonnement et inventaire avancé](#9-abonnement-et-inventaire-avancé)
10. [Administration : établissements et caisses](#10-administration--établissements-et-caisses)
11. [Qui peut faire quoi](#11-qui-peut-faire-quoi)
12. [Les vérifications automatiques](#12-les-vérifications-automatiques)
13. [Si quelque chose ne marche pas](#13-si-quelque-chose-ne-marche-pas)
14. [Remettre la démo à zéro](#14-remettre-la-démo-à-zéro)
15. [Ce qui n'existe pas encore](#15-ce-qui-nexiste-pas-encore)
16. [La caisse et le back-office en arabe](#16-la-caisse-et-le-back-office-en-arabe)
17. [Mettre à jour les téléphones de test](#17-mettre-à-jour-les-téléphones-de-test)

---

## 1. Avant de commencer

### Les adresses

| Quoi | Adresse |
|---|---|
| **Caisse** | `https://kaissi-pos.vercel.app` |
| **Back-office** | `https://kaissi-backoffice.vercel.app` |
| **Serveur de synchronisation** | `https://kaissi-production.up.railway.app` |

### Les accès

- **Back-office** : le compte **administrateur** (e-mail + mot de passe) qu'on
  t'a fourni. Le même compte sert à mettre une caisse en service.
- **Caisse** : les employés de démonstration, par code PIN.

| Employé | Rôle | PIN |
|---|---|---|
| Salma Trabelsi | caissier | `2468` |
| Ahmed | gérant | `1357` |
| Karim Jelassi | serveur | `9753` |

### Vérifier que le serveur tourne

Ouvre `https://kaissi-production.up.railway.app/sante` dans le navigateur.

**Attendu** : `{"etat":"ok", … "base":"joignable" …}`.
Si tu vois autre chose, arrête-toi et va au §13 : sans serveur, la caisse
encaisse mais rien n'arrive au back-office.

### Ce qui est déjà préparé

L'établissement de démonstration **Snack Lac 1** contient :

- **17 produits**, avec leur coût d'achat ;
- **5 produits suivis en stock** :

| Produit | Stock | Seuil d'alerte | État |
|---|---|---|---|
| Coca-Cola 33cl | 48 | 12 | OK |
| Frites | 30 | 10 | OK |
| Eau minérale 50cl | 24 | 6 | OK |
| Ojja merguez | 6 | 8 | Faible |
| Pizza Margherita | 0 | 5 | Rupture |

- **3 réductions** : *Happy hour* (10 %), *Personnel* (20 %), *Geste
  commercial* (−2,000 TND) ;
- **les clients se créent au back-office**. Avant de commencer :
  **Clients → + Ajouter un client** → **Salem Haddad**, téléphone
  `20 123 456`. Il redescend sur la caisse à la synchronisation suivante.

### Conseil pratique

Garde **deux fenêtres** côte à côte : la caisse et le back-office. Pour tester
un autre rôle (bar, caissier), utilise une **fenêtre privée**, pour ne pas
perdre ta session d'administrateur.

---

## 2. Mettre la caisse en service

1. Ouvre la caisse. Menu ☰ → **Synchronisation**.
2. Saisis l'e-mail et le mot de passe du compte administrateur →
   **Mettre en service**. Si le compte a plusieurs établissements, choisis
   **Snack Lac 1**.

**Attendu** : l'écran annonce **À jour**, et « Opérations refusées » vaut **0**.
Aucun code ni jeton à recopier : la caisse reçoit son identité toute seule.

3. Un terminal jamais mis en service affiche un badge rouge **« À appairer »**
   en haut. Le toucher ouvre ce même écran.

> Une caisse **déjà utilisée pour une démonstration** avant sa mise en service
> le signale : elle indique combien d'opérations de test elle contient, puis
> demande **« Effacer et mettre en service »**.

---

## 3. Un service complet à la caisse

Joue les étapes dans l'ordre : chaque ticket alimente un rapport précis du §4.

### 3.1 Prise de poste

> **Qui apparaît ici ?** Les employés **de l'établissement** qui ont un PIN —
> pas le compte e-mail qui a mis la caisse en service. L'e-mail rattache la
> **tablette** au restaurant, une fois ; ensuite chacun prend son poste avec
> **son PIN**. Sur Snack Lac 1, Ahmed, Karim et Salma sont de vrais employés
> de l'établissement (créés pour la démonstration). Un employé s'ajoute au
> back-office : **Paramètres → Employés → Embaucher**, avec son PIN.

Choisis **Salma**, PIN `2468`, ouvre la caisse avec un fond de **50**.

**Attendu** : l'écran de la salle (menu ☰ → **Ventes**) avec les tables.

### 3.2 Ticket 1 — vente simple

Table 3 → **Coca-Cola 33cl** ×2 → **Frites** ×1 → **Encaisser** → Espèces.

**Attendu** : un ticket de **12,900 TND**, affiché à l'écran.

### 3.3 Ticket 2 — remise avec motif

Table 5 → **Couscous poulet** → **Remise** → choisis **Happy hour** →
Encaisser.

**Attendu** : les réductions de la maison sont proposées **en premier**,
chacune **une seule fois**.
« Autre remise… » ouvre une grille libre (0 à 50 %).

Essaie aussi une remise de **20 %** avec Salma.
**Attendu** : refusée — un caissier est plafonné à **10 %**.

### 3.4 Ticket 3 — envoi en cuisine

Table 8 → **Pizza Quatre Fromages** + **Escalope panée frites** → bouton
**Cuisine**. **N'encaisse pas encore** : ce ticket sert au §5.

### 3.5 Ticket 4 — un serveur, puis un gérant

1. Menu → verrouille → **Karim**, PIN `9753`.
2. Table 2 → **Sandwich thon** ×2 → **Cuisine**.
3. Essaie d'encaisser.

**Attendu** : refusé — un serveur prend les commandes, il n'encaisse pas.

4. Verrouille → **Ahmed**, PIN `1357` → encaisse la table 2 par **Carte
   bancaire**.

**Attendu** : la vente est attribuée à **Ahmed**, qui l'a encaissée.

### 3.6 Ticket 5 — ligne annulée et client

Reprends avec **Salma**. Table 1 → **Tiramisu** + **Express** → sur la ligne
**Express**, touche **−** (ou **Retirer**) → bouton **Client** → cherche
« Salem » → rattache **Salem Haddad** → Encaisser.

**Attendu** : la ligne Express reste affichée, **barrée**, marquée
« retiré », et sort du total. Sur une ligne à 2 ou plus, **−** retire une
unité ; à 1, il retire la ligne.

### 3.7 Créer un article depuis la caisse (gérant)

Avec **Ahmed** : ouvre une commande → tuile **« + Nouvel article »** en fin de
grille → nom, prix, catégorie, taux de TVA → **Ajouter à la carte**.

**Attendu** : l'article apparaît tout de suite, avec un badge **« en
attente »**, et se vend immédiatement. Après synchronisation, le badge
disparaît et l'article existe au back-office (Articles → Liste d'articles).

Avec **Salma** (caissier) : **la tuile n'apparaît pas**.

### 3.7 bis Tenir sa carte depuis la caisse (gérant)

Menu ☰ → **Carte**. Quatre créations, sans ouvrir le back-office.

> On **crée** ici ; on ne **modifie** pas. Renommer, changer un prix,
> archiver : back-office. La raison : deux caisses hors ligne qui créent font
> deux lignes distinctes (au pire deux fois le même nom, que le bureau
> fusionne) ; deux caisses qui modifient la même ligne, il faudrait arbitrer.

1. **Nouvelle catégorie** → « Entrées », choisis un **poste de préparation**.
   **Attendu** : créée. Sans poste, ses articles ne partent sur **aucun**
   écran de préparation — l'écran le dit au moment du choix.
2. **Nouvelle réduction** → « Midi », pourcentage `12,5`.
   **Attendu** : créée, et proposée aussitôt au bouton **Remise** d'une
   commande.
3. **Nouveau groupe d'options** → « Cuisson », min **1**, max **1**, deux
   choix (« Saignant », « Bien cuit »), et **rattache-le à un article**.
   **Attendu** : créé. Ouvre une commande, touche cet article : la caisse
   **demande la cuisson**. Un groupe rattaché à aucun article n'apparaît
   nulle part — l'écran le dit aussi.
4. **Nouvel article** → dans la catégorie « Entrées ».
   **Attendu** : vendable tout de suite.

5. Fais tout cela **hors ligne** (coupe le réseau).
   **Attendu** : tout fonctionne, et les opérations attendent dans
   **Synchronisation**. Au retour du réseau, tout remonte et apparaît au
   back-office (Articles → Catégories, Réductions, Modificateurs).

6. Avec **Salma** (caissier) ou **Karim** (serveur) : **l'entrée « Carte »
   n'apparaît pas** dans le menu.

### 3.8 Encaisser sans Internet

1. Coupe le Wi-Fi (la page doit avoir été chargée une première fois).

**Attendu** : la caisse passe **Hors ligne**.

2. Encaisse une vente. Recharge même la page.

**Attendu** : rien ne bloque ; la page se rouvre, la caisse reste ouverte, le
poste est repris sans PIN. Un compteur **⇅ n** indique les ventes en attente.

3. Rétablis le réseau.

**Attendu** : le compteur redescend à **0** tout seul, la vente arrive au
back-office.

### 3.9 Les écrans de la caisse

| Menu ☰ | Ce que tu dois voir |
|---|---|
| **Reçus** | les ventes — numéro, heure, table, employé, paiement, montant. Badge **« en attente »** tant qu'une vente n'est pas remontée ; il **disparaît** au cycle de synchronisation suivant. Les ventes des **autres** caisses y figurent aussi |
| **Périodes de travail** | le service en cours et les services clos, **de cette caisse seulement** (l'écran le dit) |
| **Synchronisation** | « À jour », et les opérations refusées s'il y en a |
| **Diagnostic** | quatre phrases : la carte, les ventes, Internet, l'envoi au bureau |
| **Back-office** | ouvre le back-office dans le navigateur. **Hors ligne**, il explique qu'il faut du réseau, et rappelle que la caisse continue |

### 3.9 bis Rembourser un ticket payé

Le **ticket 1** est payé. Le client revient : son plat était froid.

1. Menu ☰ → **Reçus** → touche le ticket 1 → **Rembourser…**
2. Coche la ligne à rendre (ou **Tout le ticket**), choisis le mode
   (**Espèces**), le motif (« Plat froid » ou un motif écrit).
3. **Rembourser** : la caisse demande le **PIN d'un gérant** — Salma est
   caissière, elle ne peut pas l'autoriser seule. Ahmed pose `1357`.

**Attendu** :

- le reçu réédité porte une ligne **« Remboursé »** avec le montant, le
  motif, et le nom de qui l'a **autorisé** ;
- la ligne rendue ne peut plus l'être une seconde fois (« déjà remboursé ») ;
- rien n'est effacé : la vente reste dans le chiffre d'affaires, le
  remboursement s'ajoute **à part**, à la date où l'argent a été rendu ;
- hors ligne, c'est pareil : le remboursement part avec la synchronisation
  suivante.

Au back-office (§4) : **Reçus** → ticket 1 montre le remboursement et le
« Net encaissé » ; le **Récapitulatif des ventes** a une ligne
« Remboursements » non nulle.

> Un remboursement **par carte** se fait sur le terminal de la banque : Kaissi
> l'enregistre, le tiroir n'est pas concerné. En **espèces**, il sort du tiroir
> — c'est ce que la clôture va vérifier.

### 3.10 Clôturer la caisse

Encaisse d'abord le **ticket 3** (table 8) par carte. Puis menu ☰ →
**Clôturer la caisse** avec **Salma** : saisis le compte des billets et pièces,
coupure par coupure.

**Attendu** : la caisse calcule l'**attendu**, affiche l'**écart** (compté −
attendu), qui peut être négatif. Fais volontairement une erreur de 2 dinars
pour le voir. Le remboursement en espèces du §3.9 bis est **déduit** de
l'attendu : l'argent rendu est sorti du tiroir.

### 3.11 Synchroniser

Menu ☰ → **Synchronisation** → **Synchroniser maintenant**.

**Attendu** : **À jour**. Le back-office ne montre que ce qui est remonté.

---

## 4. Lire le service au back-office

Connecte-toi au back-office avec le compte administrateur, établissement
**Snack Lac 1**. Période : **Aujourd'hui**.

### 4.1 Tableau de bord

**Attendu** : chiffre d'affaires, tickets, panier moyen, coût, marge, marge %.

- Le CA est **hors taxe, après remises** : il est donc **inférieur** au total
  des tickets (TTC). C'est normal.
- La marge % se rapporte au CA : 5 de marge sur 15 de CA = **33 %**.

### 4.2 Rapports

| Écran (menu Rapports) | Ce que tu dois voir |
|---|---|
| **Récapitulatif des ventes** | brut → remboursements → réductions → net → marge, avec l'écart par rapport à la période précédente et un graphique par jour |
| **Ventes par article** | classement par CA ; bascule **« Par quantité »** : l'ordre change |
| **Ventes par catégorie** | Plats, Boissons, Snacks, Desserts |
| **Ventes par employé** | **Salma** et **Ahmed** |
| **Ventes par mode de paiement** | **Espèces** et **Carte** (montants TTC) |
| **Reçus** | la liste des ventes. Ouvre le ticket 5 : le ticket **tel qu'il s'imprime**, la ligne Express barrée, la TVA par taux, et **Exporter ce ticket** (`.txt`) |
| **Réductions** | le total accordé, **par motif** (« Happy hour », « Sans motif ») et par employé |
| **Périodes de travail** | chaque service de **toutes** les caisses : ouvert par, fermé par, attendu, compté, **écart** en rouge s'il manque |

Sur chaque rapport, teste les filtres en tête :

1. Le **calendrier** : premier clic = début, second clic = fin.
2. La **tranche horaire** `12 h → 15 h` : les chiffres ne portent plus que sur
   le midi.
3. Le **filtre employé**.
4. Copie l'adresse de la page et ouvre-la ailleurs : même rapport, mêmes
   filtres.
5. **Exporter** : un CSV qui couvre **toute la période**, pas seulement la page
   affichée, lisible dans Excel avec les accents.

### 4.3 Journée

Menu → **Journée**.

**Attendu** : les encaissements **TTC** du jour commercial (de 4 h à 4 h le
lendemain), la TVA **par taux**, et le bloc **Caisses** : fond, attendu,
compté, écart, **ouverte par** et **fermée par**.

---

## 5. Cuisine et bar

### 5.1 L'écran de préparation

Menu → **Préparation**.

**Attendu** : les commandes envoyées et pas encore encaissées, les plus
anciennes d'abord, avec le temps d'attente (orange à 10 min, rouge à 20).
**Aucun montant.**

Sur la caisse, envoie une nouvelle commande **mixte** en cuisine : une pizza +
un Coca.

**Attendu** : onglets **Cuisine** / **Bar** — la pizza d'un côté, le Coca de
l'autre. Le poste vient de la **catégorie** (Boissons → Bar).

### 5.2 « Prêt » remonte jusqu'à la salle

1. Au back-office, **Préparation** → **Prêt** sur la commande.
2. Sur la caisse : synchronise, puis écran de la salle.

**Attendu** : un bandeau **« Prêt à servir · Table N »**, la table cerclée de
vert, badge **« Prêt »**. Toucher le bandeau ouvre la commande.

3. Au back-office, **Annuler** le « prêt », resynchronise la caisse.

**Attendu** : le bandeau disparaît.

### 5.3 Un compte pour le bar

Le bar a **son propre compte** : un e-mail et un mot de passe à lui. Il n'a
jamais besoin de ceux du gérant. Un seul compte suffit pour le poste bar,
quelle que soit la personne qui y travaille ce soir-là.

1. **Paramètres → Employés** → **Gérer** sur un employé (ou **Embaucher**
   « Bar ») → rôle **Bar** → champ **Poste tenu** = **Bar** → enregistre.
2. Bloc **Accès au back-office** → **e-mail** + **mot de passe** (8
   caractères minimum) → **Ouvrir l'accès**.
   L'e-mail sert d'**identifiant** : aucun message n'y est envoyé, il n'a
   pas besoin d'exister. Un nom lisible suffit, par ex.
   `bar@snack-lac1.tn`.

**Attendu** : « Compte créé ». La personne peut se connecter tout de suite.

3. Dans une **fenêtre privée** (en vrai : sur la tablette du bar), ouvre le
   back-office et connecte-toi avec **cet e-mail et ce mot de passe**. La
   connexion reste ouverte : on ne la ressaisit pas à chaque service.

**Attendu** : tu arrives directement sur **Préparation**, titrée **« Bar »**,
avec une seule entrée dans le menu. Seuls les articles du bar s'affichent.

4. Tape à la main l'adresse `…/‹resto›/ventes`, puis `…/‹resto›/export/ventes`.

**Attendu** : **refusé** dans les deux cas, renvoyé vers Préparation. Aucun
montant, aucun fichier.

---

## 6. Le stock

Menu **Articles → Stock**.

### 6.1 Les ventes décrémentent

**Attendu** : Coca-Cola à **46** (48 − 2 du ticket 1), Frites à **29**.
Déplie la ligne : « Depuis le comptage : 2 vendu(s) ».

### 6.2 Une annulation remet le stock

1. Sur la caisse : vends **3 Frites**, synchronise → Frites **−3**.
2. Fais **annuler la commande** par Ahmed (PIN `1357`), synchronise.

**Attendu** : le stock revient, et la vente disparaît des rapports.

### 6.3 Réception et perte

Déplie un produit → **Ajuster** → **Mouvement** :

1. **Réception**, quantité `12`, fournisseur `Sfax Primeurs`, note
   `Facture 128`.
2. **Perte / casse**, quantité `3` (tu saisis toujours un nombre positif).

**Attendu** : dans **Historique des mouvements**, `+12` et `−3` (en rouge),
avec le fournisseur, la note et ton nom. L'historique s'exporte en CSV.

### 6.4 La rupture automatique

1. **Ajuster** → **Recompter le stock** à `0` sur un produit dont la case
   « Retirer ce produit de la carte dès qu'il atteint zéro » est cochée.
2. Synchronise la caisse.

**Attendu** : sur la caisse, la tuile est **grisée, « RUPTURE »**, mais reste
**cliquable** — le clic explique pourquoi le produit n'est pas disponible.

3. Saisis une **réception** de ce produit, resynchronise.

**Attendu** : le produit revient en carte tout seul.

4. Retire un autre produit **à la main** (bouton **Rupture (manuel)**), puis
   fais une réception.

**Attendu** : il **reste** hors carte. Une décision manuelle n'est jamais
défaite par l'automatisme.

5. Décoche la case automatique d'un produit à zéro.

**Attendu** : il reste en vente, avec l'étiquette **« Épuisé, toujours en
vente »** et un bouton pour rétablir le retrait automatique.

### 6.5 Le stock négatif

1. Recompte un produit à `1`.
2. Coupe le Wi-Fi de la caisse, vends-en **2**, rétablis le réseau.

**Attendu** : la vente n'est **jamais bloquée**. Le stock affiche **−1** et le
produit sort de la carte. Le négatif signale une réception oubliée ou un
comptage faux ; **Recompter le stock** avec la vraie quantité le remet à plat.

### 6.6 Les alertes de rupture (facultatif)

Prérequis, une fois pour toutes, par l'exploitant : lancer `pnpm sync:cles`
à la racine du dépôt, et copier les clés dans Railway (`VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) et dans Vercel (`VAPID_PUBLIC_KEY`).
Pour l'e-mail : `RESEND_API_KEY` et `URL_BACKOFFICE` dans Railway.

Vérifie d'abord `…railway.app/sante` : il doit afficher
`"notifications":"configurees"`.

1. **Stock** → **« M'alerter des ruptures sur ce navigateur »** → accepter.
   **Attendu** : le bouton devient **« Alertes actives sur ce navigateur —
   désactiver »**. Tant que tu vois encore « M'alerter… », **ce navigateur
   n'est pas abonné** et rien n'y arrivera.
2. **« Envoyer une notification de test »**.
   **Attendu** : une notification « Kaissi — notification de test » dans les
   secondes qui suivent. Sinon, le message affiché dit **quoi corriger** :
   clés absentes de Railway, clés différentes entre Vercel et Railway,
   navigateur à réactiver, ou notifications coupées par Windows (Paramètres →
   Notifications, mode « Ne pas déranger »).
3. Mets un produit à zéro (ou vends-en jusqu'à zéro).

**Attendu** : dans les secondes qui suivent la synchronisation, une
notification **« Rupture — ‹produit› »** (et un e-mail aux gérants). Une seule
fois par rupture : un produit **déjà en rupture** avant l'abonnement ne
sonnera qu'à sa prochaine rupture, après une réception. Trois ruptures d'un
coup donnent **une** notification groupée. Un caissier ne reçoit rien.

---

## 7. La carte : articles, catégories, modificateurs, réductions

### 7.1 Articles et catégories

Menu **Articles → Liste d'articles** et **Catégories**.

1. Change le prix d'un article, synchronise la caisse.
   **Attendu** : le nouveau prix apparaît sur la caisse, sans rien réinstaller.
2. Flèches **↑ ↓** sur une catégorie et sur un article.
   **Attendu** : l'ordre change, sur le back-office puis sur la caisse.
3. **Archiver** un article, puis **Remettre** depuis la section *Archive*.
   **Attendu** : il revient **hors vente** ; le remettre en carte est un
   second geste.
4. Crée un **poste de préparation** (ex. « Pizzeria »), rattache-lui une
   catégorie. Essaie d'archiver un poste qui a encore une catégorie.
   **Attendu** : refusé, avec le nom de ce qui bloque.

### 7.2 Modificateurs

Menu **Articles → Modificateurs**.

> **min** = combien de choix le caissier **doit** faire (0 = facultatif).
> **max** = combien il **peut** en faire au plus (0 = autant qu'il veut).
> Cuisson : min 1, max 1 → exactement un choix. Suppléments : min 0, max 0 →
> facultatifs, sans limite.

1. **Nouveau groupe** « Cuisson », min **1**, max **1**. Ajoute
   trois choix à `0,000` : Saignant, À point, Bien cuit.
2. Rattache le groupe à un plat (le panneau de rattachement est ouvert tant
   qu'aucun article n'y est lié).
3. Crée un groupe « Suppléments » avec « + Fromage » à `1,500`, rattache-le à
   une pizza.
4. Synchronise la caisse, ajoute le plat puis la pizza à une commande.

**Attendu** : la caisse **demande la cuisson** (obligatoire) ; le fromage
s'ajoute au **prix de la ligne**. Détacher un groupe au back-office le retire
aussi de la caisse après synchronisation.

### 7.3 Réductions

Menu **Articles → Réductions**.

1. Crée une réduction (pourcentage **ou** montant fixe).
2. Sur « Happy hour » : change le nom **et** la valeur (ex. `15`) →
   **Enregistrer**.
   **Attendu** : la caisse propose la nouvelle valeur après synchronisation ;
   les ventes déjà faites gardent **l'ancien nom et l'ancien montant**. Le
   type (pourcentage ou montant) ne change pas : pour ça, archive et recrée.
   Ce qu'une réduction a coûté se lit dans **Rapports → Réductions**.
3. Archive une réduction.
   **Attendu** : elle disparaît de la caisse après synchronisation, et reste
   dans les rapports passés.

---

## 8. Les paramètres

Menu **Paramètres**. Tous ces écrans sont réservés au gérant et à
l'administrateur.

| Écran | À faire | Attendu |
|---|---|---|
| **Employés** | Gérer → **Réinitialiser le PIN** ; sur la caisse, Diagnostic → « envoyer maintenant », puis verrouiller | le **nouveau** PIN ouvre, l'ancien est refusé |
| | **Suspendre**, puis **Réactiver** | l'employé passe dans « Ne prennent plus de poste », puis revient |
| | En **gérant** (pas admin), essaie de donner le rôle **gérant** à quelqu'un | refusé : seul un administrateur nomme un gérant |
| **Clients** | cherche « 20 123 » | la recherche porte sur nom, téléphone et e-mail ; Salem sort. Visites et total dépensé sont calculés |
| **Taxes** | ajoute un taux, change le taux par défaut | ⚠ un restaurant ouvert depuis la caisse démarre à **0 %** : c'est le premier réglage à faire, avec un expert-comptable |
| **Modes de paiement** | ajoute « Flouci », type *En ligne* | proposé à la caisse ; le dernier mode actif refuse d'être archivé |
| **Reçu** | saisis adresse, téléphone, identifiant fiscal, pied de page | l'aperçu fait 42 caractères de large, comme un ticket de 80 mm ; les tickets suivants portent ces lignes |
| **Imprimantes cuisine** | saisis une adresse IP pour un poste | l'écran rappelle que **rien ne s'imprime** dans cette version ; il refuse `http://…` et `ip:port` |
| **Options de restauration** | voir ci-dessous | |
| **Fonctionnalités** | lis la page | ce qui marche, ce qui est éteint, ce qui n'existe pas, avec **tes** chiffres ; aucun interrupteur |
| **Abonnement** | voir §9 | |
| **Aide** | ouvre le lien d'assistance | la page `/support`, publique |

### Options de restauration : service et timbre

C'est le seul réglage qui change le **total** payé par le client.

1. Encaisse une vente témoin (un Coca + une Ojja). **Note le total.**
2. **Options de restauration** : service **10 %**, coche « soumis à la taxe »,
   choisis **TVA 19 %**, timbre **0,600**.
   **Attendu** : l'aperçu se recalcule à chaque frappe ; articles + service +
   timbre = total.
3. Coche « soumis à la taxe » **sans** choisir de taux et enregistre.
   **Attendu** : refusé, avec la raison.
4. Enregistre avec le taux. Sur la caisse : **synchronise, puis recharge
   l'application**.
5. Refais exactement la même vente.
   **Attendu** : le ticket porte une ligne **Service** et une ligne **Timbre
   fiscal** ; le total a augmenté du service + 0,600.
6. **Rapports → Reçus**, ouvre les deux ventes.
   **Attendu** : les totaux du back-office sont **identiques au millime** à
   ceux des tickets.
7. Remets les deux champs à vide et enregistre.
   **Attendu** : plus de ligne « Service » sur les tickets suivants. Les ventes
   passées ne changent pas.

---

## 9. Abonnement et inventaire avancé

> Une formule ne touche **jamais** à la caisse. Quelle que soit la formule, et
> même expirée, la caisse encaisse. Une formule ne ferme que deux choses : la
> profondeur d'historique des rapports et l'inventaire avancé.

| Formule | Historique des rapports | Inventaire avancé |
|---|---|---|
| **Gratuit** | 62 jours | fermé |
| **Payant** | sans limite | ouvert |

Un restaurant qui s'inscrit démarre en **Gratuit**. Il n'y a plus d'essai.

### 9.1 Lire sa formule

**Paramètres → Abonnement**.

**Attendu** : la formule en cours et un tableau Gratuit / Payant. Un client
(même administrateur de son restaurant) ne voit **aucun bouton** pour en
changer.

### 9.2 Changer de formule (éditeur)

L'**éditeur**, c'est Res2Boost : la personne qui vend Kaissi, pas un
restaurant. Il n'existe pas de « compte administrateur du POS » à part : on
déclare quels comptes du back-office sont éditeurs.

Une fois : dans **Railway** → service de synchronisation → **Variables** →
`KAISSI_EDITEURS` = l'**e-mail avec lequel tu te connectes au back-office**
(plusieurs : séparés par des virgules), puis redéploie. Pour la
démonstration, c'est ton propre e-mail : tu es à la fois l'éditeur et
l'administrateur de Snack Lac 1.

1. Accueil du back-office → **« 🧾 Éditeur — clients et formules »** (ou
   `…/editeur`).
   **Attendu** : **tous** les clients, leurs établissements, leur formule, et
   deux boutons **Gratuit / Payant** par client — y compris des restaurants
   dont tu n'es pas membre.
2. Change la formule d'un client.
   **Attendu** : effet immédiat sur toute son organisation.
3. Le même bloc existe dans **Paramètres → Abonnement** d'un établissement
   dont tu es membre.
4. Dans une fenêtre privée avec le compte du bar ou d'un gérant : ni le
   lien, ni le bloc ; `…/editeur` répond **introuvable**.

En ligne de commande (même effet) : `pnpm sync:abonnement --organisation
<uuid> --formule gratuit|pro`, à la racine du dépôt.

### 9.3 Ce que « gratuit » ferme

Passe l'organisation en **gratuit**, puis :

1. Un rapport sur les **4 derniers mois**.
   **Attendu** : un bandeau « Votre formule limite l'historique » ; le rapport
   s'affiche **raboté** à 62 jours, il ne refuse pas.
2. **Articles → Inventaire avancé**.
   **Attendu** : une page qui explique ce que le module ajoute, sans aucune
   donnée.
3. Tape l'adresse `…/‹resto›/export/valorisation`.
   **Attendu** : **introuvable (404)**.
4. Encaisse une vente, hors ligne puis en ligne.
   **Attendu** : **rien ne change** à la caisse.

Repasse en **Payant** à la fin.

### 9.4 Inventaire avancé (formule Payant)

**Articles → Inventaire avancé**.

1. **Valeur d'achat du stock** : le total, puis le détail par article.
2. Vide le coût d'achat d'un article suivi.
   **Attendu** : bandeau « article(s) sans coût d'achat saisi — le total est
   incomplet ».
3. Crée un fournisseur **Sfax Primeurs** (contact, téléphone).
4. **Stock** → Mouvement → Réception → tape « Sfax » dans Fournisseur, et
   **choisis** « Sfax Primeurs » dans la liste.
   **Attendu** : le nom est **proposé**. Après enregistrement, retourne dans
   **Articles → Inventaire avancé**, bloc **Fournisseurs** : sous « Sfax
   Primeurs », **« 1 réception(s) rattachée(s) »**. Seul un nom **identique**
   à une fiche est rattaché — « Aziza » tapé sans fiche reste un nom libre
   dans l'historique, rattaché à rien.
5. Saisis une réception avec un fournisseur **sans fiche**.
   **Attendu** : elle passe quand même. La fiche est une aide, jamais une
   obligation.
6. Archive la fiche.
   **Attendu** : elle n'est plus proposée ; l'historique ne change pas.
7. **Exporter → Valorisation (CSV)**.

### 9.5 Un nouveau restaurant démarre en Gratuit

Ouvre un nouveau restaurant **depuis la caisse** (§10.3), puis Paramètres →
Abonnement sur ce nouveau compte.

**Attendu** : formule **Gratuit**, sans échéance, aucun bouton pour en
changer.

---

## 10. Administration : établissements et caisses

Menu **Administration → Établissements** (visible par l'administrateur
seulement).

### 10.1 Ouvrir un deuxième établissement

1. Ouvre **Snack Lac 2**, en copiant les réglages de Snack Lac 1.
2. Ajoute-lui un article et un employé.
3. Sur la caisse : menu ☰ → **Synchronisation** → **« Ré-appairer — ou
   changer d'établissement »** → reconnecte-toi → choisis **Snack Lac 2**.

**Attendu** : la caisse repart sur la carte, les employés et le stock de Snack
Lac 2, sans rien du premier.

4. Refais-le **avec une vente non synchronisée** (encaissée hors ligne).
   **Attendu** : le changement est **refusé**, et le message dit combien
   d'opérations attendent.

### 10.2 Fermer puis supprimer un établissement

1. **Fermer l'établissement** sur Snack Lac 2.
   **Attendu** : il est rangé à part, avec sa date de fermeture — dans
   l'Administration **et** sur l'écran d'accueil « Vos établissements »
   (section « Établissements fermés », étiquette **fermé**). Une
   **nouvelle** caisse ne peut plus s'y appairer ; une caisse **déjà
   appairée** continue d'envoyer ses ventes.
2. **Rouvrir** : tout revient.
3. **Supprimer** un établissement qui a des ventes.
   **Attendu** : refusé, avec la liste des obstacles (« N ventes », « N
   services de caisse »…).
4. Ouvre un établissement neuf, sans vente, et supprime-le.
   **Attendu** : il faut **retaper son nom exact**. Supprimer le **dernier**
   établissement qu'on administre est refusé.

### 10.3 Un nouveau client

- **Depuis la caisse** (APK ou web) : accueil → **Créer un compte** → nom du
  restaurant, votre nom, e-mail, mot de passe, et **votre code PIN de
  caisse** (deux fois). Le restaurant, le compte administrateur et
  l'appairage sont créés d'un coup, en formule **Gratuit**.
  **Attendu** : l'écran **« C'est ouvert »** avec l'avertissement sur le
  taux de TVA (posé à **0 %** : le régler en premier) → **Commencer** → la
  prise de poste ne propose **que vous**, avec votre PIN. **Aucun** employé
  de démonstration (Ahmed, Karim, Salma), ni la carte de Snack Lac 1.
- **Depuis le poste de l'exploitant** :

```bash
pnpm sync:nouveau-client \
  --organisation "Chez Fatma SARL" \
  --restaurant "Chez Fatma — Menzah 6" \
  --email fatma@chezfatma.tn \
  --tva "TVA 19 %:1900,TVA 7 %:700"
```

---

## 11. Qui peut faire quoi

| | admin | gérant | caissier | serveur | cuisine / bar |
|---|:---:|:---:|:---:|:---:|:---:|
| Ouvrir une commande, envoyer en préparation | ✓ | ✓ | ✓ | ✓ | — |
| Encaisser, ouvrir et clôturer la caisse | ✓ | ✓ | ✓ | — | — |
| Remise | illimitée | illimitée | 10 % | 5 % | — |
| Annuler une commande, forcer un prix | ✓ | ✓ | — | — | — |
| Créer un article depuis la caisse | ✓ | ✓ | — | — | — |
| Rapports, marges, carte, stock, paramètres | ✓ | ✓ | — | — | — |
| Embaucher caissier, serveur, cuisine, bar | ✓ | ✓ | — | — | — |
| **Nommer un gérant ou un administrateur** | ✓ | — | — | — | — |
| Écran de préparation | ✓ | ✓ | — | — | ✓ (son poste) |
| Établissements (ouvrir, fermer, supprimer) | ✓ | — | — | — | — |

Sur la caisse, admin et gérant ont exactement les mêmes droits. Les refus du
back-office sont appliqués **par le serveur** : taper une adresse à la main ne
contourne rien.

---

## 12. Les vérifications automatiques

À lancer à la racine du dépôt.

```bash
pnpm install
pnpm test:rapide            # calculs, base locale de la caisse, tickets
pnpm typecheck              # types de tout le projet
pnpm lint

pnpm --filter @kaissi/backoffice test           # back-office, dont : aucun écran sans contrôle de rôle
pnpm --filter @kaissi/backoffice test:largeur   # aucun écran ne déborde sur téléphone, en français PUIS en arabe
pnpm --filter @kaissi/i18n test                 # toute phrase affichée a sa traduction arabe

pnpm db:test                                    # base PostgreSQL jetable + migrations
pnpm --filter @kaissi/sync test                 # synchronisation, dont :
                                                #   rls-partout       aucune table sans cloisonnement
                                                #   curseur-sans-trou aucune vente ni prix sauté entre caisses
pnpm db:test:stop

pnpm pos:build                                  # vérifie que la caisse ne dépend d'aucun réseau
pnpm --filter @kaissi/pos test:parcours         # une journée de service jouée dans un navigateur
pnpm --filter @kaissi/pos test:carte            # la carte tenue depuis la caisse, hors ligne
pnpm --filter @kaissi/pos test:remboursement    # rembourser : PIN du gérant, ticket réédité, tiroir
pnpm --filter @kaissi/pos test:largeur          # 390 et 320 px, en français PUIS en arabe
pnpm verifier:docs                              # aucun lien cassé dans docs/
```

**Attendu** : tout au vert.

---

## 13. Si quelque chose ne marche pas

| Symptôme | Cause et geste |
|---|---|
| `/sante` affiche **« Not Found — The train has not arrived at the station »** | Le serveur ne tourne pas. Railway → Deployments : le dernier déploiement a-t-il échoué ? Vérifie dans Settings que **Root Directory** est la **racine** du dépôt (pas `apps/sync`), puis redéploie |
| « Railpack failed to prepare the build » dans Railway | Même cause : Root Directory n'est pas la racine, Railway n'a pas trouvé `railway.json` |
| Back-office lent : 1 à 2 s à chaque onglet ou filtre | Vercel → projet **kaissi-backoffice** → Settings → **Functions** → coche **Frankfurt (fra1)** seul, décoche Washington, puis redéploie. La base est à Francfort. Le projet **kaissi-pos** n'a pas de fonctions : sa région n'a aucun effet |
| Publication Android refusée : « minimum SDK version of 24 » | Corrigé (minSdk 24). Pousser sur `main` relance la publication |
| Alerte de rupture non reçue | §6.6 : vérifie que le bouton dit « Alertes actives », puis **notification de test** — son message dit quoi corriger |
| « Failed to fetch » à la mise en service | Ouvre d'abord `/sante`. S'il répond `ok`, la variable `SYNC_ORIGINES` (Railway) doit contenir l'adresse **exacte** de la caisse, sans `/` final, puis redéployer |
| Synchronisation : **« Erreur »** et « Erreur interne du serveur », opérations en attente qui ne baissent pas | Le serveur répond mais n'enregistre pas. Rien n'est perdu : les ventes restent dans la caisse. Signale-le avec le message affiché ; une fois le serveur corrigé, elles partent seules |
| Synchronisation : **« Hors ligne »** | Aucune réponse du serveur : réseau coupé, ou serveur arrêté (`/sante`) |
| Chaque réduction apparaît **deux fois** sur la caisse | Caisse mise en service avec une version antérieure : mets l'application à jour, les réductions de démonstration disparaissent au démarrage |
| La caisse affiche « Non appairé » | §2 |
| iPhone : **« Démarrage impossible — Échec de la migration locale 14 … near "id": syntax error »** | Corrigé. Installe le build TestFlight suivant (§17). Rien n'est perdu : la base est restée en version 13 |
| Le téléphone montre toujours **Snack Lac 1, Ahmed, Karim, Salma** au lieu de ton restaurant | C'est la **démonstration**, gardée par la mise à jour. Badge **« À appairer »** → e-mail et mot de passe → **Effacer et mettre en service** (§17) |
| Codemagic a construit, mais le téléphone a toujours l'ancienne version | §17 : le téléphone suit-il la bonne **piste** (Android) ? le build est-il sorti de *Processing* (iPhone) ? |
| Une phrase reste en français dans l'interface arabe | Le nom d'un plat, d'un employé, d'une catégorie : normal, c'est une donnée. Un libellé de l'application : signale-le avec une capture |
| Opérations refusées « signé par un autre appareil » | Synchronisation → bas de page → « Abandonner ces opérations d'un ancien appairage », puis recharger (Ctrl+Maj+R) |
| Le back-office est vide ou le stock ne bouge pas | La caisse n'est pas « À jour » : synchronise |
| Le CA est inférieur au total des tickets | Normal : le CA est hors taxe, les tickets sont TTC |
| « Votre compte n'est rattaché à aucun établissement » | `pnpm sync:acces --restaurant <uuid> --email … --role admin` |
| `Could not find the table …` au back-office | Supabase → SQL Editor → `notify pgrst, 'reload schema';` |

---

## 14. Remettre la démo à zéro

Dans le **SQL Editor** de Supabase. ⚠ Uniquement sur une base de
démonstration.

**Effacer les ventes** (garde carte, employés et stock) :

```sql
alter table kaissi.order_events disable trigger order_events_immuable;
delete from kaissi.kitchen_ready   where restaurant_id = '01930000-0000-7000-8000-000000000002';
delete from kaissi.refunds         where restaurant_id = '01930000-0000-7000-8000-000000000002';
delete from kaissi.payments        where restaurant_id = '01930000-0000-7000-8000-000000000002';
delete from kaissi.order_items     where restaurant_id = '01930000-0000-7000-8000-000000000002';
delete from kaissi.order_events    where restaurant_id = '01930000-0000-7000-8000-000000000002';
delete from kaissi.orders          where restaurant_id = '01930000-0000-7000-8000-000000000002';
delete from kaissi.cash_movements  where restaurant_id = '01930000-0000-7000-8000-000000000002';
delete from kaissi.shifts          where restaurant_id = '01930000-0000-7000-8000-000000000002';
delete from kaissi.sync_mutations  where restaurant_id = '01930000-0000-7000-8000-000000000002';
delete from kaissi.sync_cursors    where restaurant_id = '01930000-0000-7000-8000-000000000002';
delete from kaissi.stock_movements where restaurant_id = '01930000-0000-7000-8000-000000000002';
alter table kaissi.order_events enable trigger order_events_immuable;
```

**Reposer les stocks** :

```sql
update kaissi.stock_items set qty_reference = v.qte, counted_at = now(), min_qty = v.seuil
from (values ('Coca-Cola 33cl',48,12),('Eau minérale 50cl',24,6),('Frites',30,10),
             ('Ojja merguez',6,8),('Pizza Margherita',0,5)) as v(nom,qte,seuil)
join kaissi.products p on p.name = v.nom
where kaissi.stock_items.product_id = p.id;
```

**Remettre tous les produits en vente** :

```sql
update kaissi.products set is_available = true
 where restaurant_id = '01930000-0000-7000-8000-000000000002';
```

Côté caisse : pour repartir d'une caisse vierge, efface les données du site
dans le navigateur, puis refais le §2.

---

## 15. Ce qui n'existe pas encore

| Quoi | Où en est-on |
|---|---|
| Rembourser **une partie** de la quantité d'une ligne (1 pizza sur 3) | Une ligne se rembourse entière. Pour une partie, annuler la ligne avant l'encaissement |
| **Ticket imprimé en arabe** | Le ticket reste en français : l'imprimante thermique (CP858) n'a pas de caractères arabes, et ses mentions fiscales ⚠ sont à valider par un expert-comptable |
| **Exports CSV en arabe** | Les en-têtes de colonnes restent en français : ils sont lus par un tableur ou un comptable, et l'import de clients attend `nom`, `telephone`… |
| **Impression** des tickets et bons | Écrite et testée, mais éteinte dans cette version : tout s'affiche à l'écran, la cuisine lit **Préparation**. Achat, branchement, mise en route et test sans imprimante : [`imprimante.md`](imprimante.md) |
| **Programme de fidélité** | Pas construit |
| **Facturation de l'abonnement** (échéances, prélèvement) | Pas construite : la formule se lit, elle se change par `pnpm sync:abonnement` |
| **Chat d'assistance** | Pas construit : le contact se fait par e-mail |

---

## 16. La caisse et le back-office en arabe

Deux réglages indépendants : la langue d'une **tablette** n'est pas celle du
back-office du gérant. Une caissière qui lit l'arabe et un gérant qui
travaille en français partagent le même restaurant sans se gêner.

### 16.1 Sur la caisse

1. Écran d'accueil ou de prise de poste : bouton **العربية** en haut à droite.
   Ou, une fois en poste : menu ☰ → **Langue** → **العربية**.
2. La caisse se recharge (une seconde, sans réseau).

**Attendu** :

- tout s'écrit de **droite à gauche** : le menu s'ouvre à droite, les
  boutons « Retour » sont à droite, les montants restent lisibles
  (« 24,500 TND » ne se retourne jamais) ;
- les rôles sont traduits (مدير، أمين الصندوق، نادل), les heures restent sur
  24 h, les mois sont les mois tunisiens (جانفي، فيفري، أوت…) ;
- les **noms** que tu as saisis (plats, catégories, employés) restent tels
  quels : ce sont tes données ;
- le **ticket** reste en français (§15) ;
- le bouton **Français** ramène la caisse en français. Le choix est retenu
  au redémarrage, sur cette tablette seulement.

Joue le ticket 1 du §3.2 en arabe : mêmes montants, même TVA, mêmes rapports.

### 16.2 Au back-office

1. Page de connexion : bouton **العربية** sous le formulaire. Une fois
   connecté : en bas de la colonne de gauche, au-dessus de « Se déconnecter »
   (sur téléphone : menu ☰ en haut).
2. La page se recharge en arabe.

**Attendu** : la colonne de navigation passe **à droite**, les tableaux se
lisent de droite à gauche, les montants et pourcentages restent alignés et
lisibles. Les rapports, l'écran Journée, les paramètres, les messages
(« تمّ الحفظ. », erreurs de saisie) sont en arabe. Les graphiques gardent
leur axe du temps de gauche à droite, comme dans les tableaux de bord arabes.

Le choix est retenu par ce **navigateur** (un cookie), pour un an.

> **Les traductions** suivent la terminologie fiscale tunisienne en arabe —
> الأداء على القيمة المضافة (TVA), المعرف الجبائي (matricule fiscal), معلوم
> الطابع الجبائي (droit de timbre), رقم المعاملات (chiffre d'affaires),
> الحريف (le client). Le glossaire complet est en tête de
> `packages/i18n/src/ar.ts`. ⚠ Comme en français, les libellés fiscaux
> présentés à un client restent à valider par un expert-comptable.

---

## 17. Mettre à jour les téléphones de test

Le guide complet, clic par clic, est
dans [`stores.md` §4 duodecies](stores.md#4-duodecies-mettre-à-jour-son-téléphone-de-test--pas-à-pas).
L'essentiel :

1. **Quelle version tourne ?** Caisse → ☰ → **Diagnostic** → ligne
   **Commit**, à comparer au commit du build Codemagic.
2. **Android** : le compte Gmail du téléphone doit être testeur de la piste
   **Internal testing** (celle que Codemagic publie, 121 et suivantes) — pas
   seulement de *Closed testing — Alpha*, figée à 103. Ouvrir le lien
   d'inscription sur le téléphone, puis Play Store → Gérer les applis →
   Mettre à jour.
3. **iPhone** : attendre que le build quitte *Processing* dans App Store
   Connect, puis TestFlight → Kaissi → **Mettre à jour**.
4. **Encore « Snack Lac 1 »** : c'est la démonstration, gardée par la mise à
   jour. Badge **« À appairer »** → e-mail et mot de passe → **Effacer et
   mettre en service**.
