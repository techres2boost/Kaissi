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

> L'adresse de l'API est **versionnée** dans `apps/pos/deploiement.json` : la
> caisse la connaît déjà, le gérant n'a plus qu'à saisir son e-mail et son
> mot de passe pour mettre un terminal en service. Ce n'est pas un
> `server.url` — aucun code ne vient de cette adresse, et la garde du mode
> avion le vérifie à chaque build.

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

Ouvre la caisse → bandeau du haut → bouton **Sync**.

> **Le bandeau porte maintenant trois liens permanents : Salle · Sync ·
> Diagnostic.** Le badge coloré `⇅ n`, lui, n'apparaît *que* s'il a quelque
> chose à dire — il disparaît donc quand tout va bien, ce qui est
> précisément le moment où l'on cherche à vérifier que tout va bien. D'où le
> lien **Sync**, toujours là.
>
> **Salle** ramène à l'écran des tables depuis n'importe où.

L'écran doit annoncer **À jour**. S'il affiche **Non appairé**, voir §7.

**1.3 — Aucune opération refusée**

Sur ce même écran, « Opérations refusées » doit être à **0**.

> **S'il y a des refus « Événement signé par un autre appareil »** — le
> terminal signe ses ventes avec un identifiant d'appareil que son jeton ne
> désigne pas. Deux gestes, dans cet ordre :
>
> 1. **Fais défiler la page jusqu'en bas**, sous le tableau des refus : le
>    bouton **« Abandonner ces opérations d'un ancien appairage »** s'y
>    trouve. Ces ventes ne remonteront jamais — elles portent l'ancien
>    identifiant — mais elles restent enregistrées localement.
> 2. Recharge la caisse en **Ctrl+Maj+R**. Au démarrage, le terminal demande
>    au serveur quelle est son identité et l'adopte.
>
> Si le bouton n'apparaît pas, c'est que la caisse tourne encore sur un build
> antérieur : vide les données du site dans le navigateur (Paramètres →
> Données de site), puis ré-appaire.

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

Le tableau porte aussi une colonne **En vente**, à ne pas confondre avec
l'état de stock — §5.3 explique pourquoi ce sont deux choses différentes.

---

## 3. Le scénario — un service de 5 tickets

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

> **« Prêt » ne prévient personne aujourd'hui, et c'est une limite assumée
> du MVP.** Le clic grise le bon sur l'écran de cuisine et l'y laisse jusqu'à
> l'encaissement : il sert au poste de cuisine à ne pas refaire un plat déjà
> passé, pas à appeler le serveur en salle.
>
> Faire remonter « prêt » jusqu'à la tablette demande un canal de descente
> que le protocole n'a pas encore : `kitchen_ready` n'est ni un événement de
> commande, ni une table de référentiel, et la règle 4 interdit un curseur
> horodaté — il lui faut donc son propre `bigserial`. C'est la prochaine
> chose à construire (§9), pas un réglage oublié. En attendant, la cuisine
> annonce de vive voix, comme avec un bon papier.

### Ticket 4 — l'autre employé *(sert « Ventes par employé »)*

Bandeau → **verrouiller** → **Karim Jelassi**, PIN `9753`.
Table 2 → **Sandwich thon** ×2 → Encaisser en espèces.

> La vente est attribuée à **celui qui encaisse**, donc à Karim.

### Ticket 5 — la ligne annulée *(sert le détail de ticket)*

Reprends avec Salma (`2468`). Table 1 → **Tiramisu** ×1 → **Express** ×1 →
annule la ligne **Express** (motif : « erreur de saisie ») → Encaisser.

### Synchroniser

Bandeau → **Sync** → **Synchroniser maintenant**. Attends **À jour**.

> **Rien ne remonte tant que ce compteur n'est pas à zéro.** Tous les écrans
> du back-office lisent le **serveur**, jamais la caisse.

---

## 4. Lire les écrans

Ouvre le back-office et connecte-toi avec ton compte admin.

Les questions qui reviennent le plus ont chacune leur réponse ici :
**Part %** en §4.2 · **Remboursements** en §4.1 · **le bloc TVA** et **la
clôture de caisse** en §4.4 · **les postes Cuisine / Bar** en §4.6.

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

  Un **remboursement** est de l'argent **rendu au client après un
  encaissement** : le repas est reparti en cuisine, le client n'a pas été
  servi, un article était en double sur l'addition. Il porte sur un
  encaissement, il est donc **TTC**, et il n'est jamais soustrait du CA net —
  qui est HT : mélanger les deux fausserait la TVA. C'est pourquoi ils
  s'affichent sur une ligne à part.

  > **Cette ligne sera à 0,000 pendant toute la démo, et c'est normal :
  > aucun écran ne crée encore de remboursement.** La lecture est câblée de
  > bout en bout (table `refunds`, rapports, tableau de bord), l'écriture
  > non. Aujourd'hui, une erreur se répare **avant** l'encaissement — on
  > annule la ligne (ticket 5) ou la commande entière. Le geste
  > « rembourser un ticket déjà payé » viendra avec le module correspondant
  > (§9).
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

**La colonne « Part »**, présente dans les quatre tableaux, est la fraction du
**CA net hors taxe** de la période que représente cette ligne. `21,86 %` sur
Coca-Cola veut dire : *sur 100 dinars de chiffre d'affaires, Coca-Cola en a
apporté 21,86*. Ce n'est ni une marge, ni un nombre d'articles — c'est « qui
fait mon chiffre ». La somme des parts d'un tableau vaut 100 %.

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

> **Cette page tombait** sur un « Application error: a server-side exception
> has occurred ». La cause : la ventilation de TVA stockée dans les commandes
> nomme sa base `baseHtMillimes`, et la page lisait `baseMillimes` — un nom
> qui n'existe que dans la vue d'impression du ticket. Un seul champ absent
> faisait tomber la page **entière**. Corrigé, et rendu impossible à
> reproduire : tous les montants des écrans de reporting passent désormais
> par une lecture défensive, où une valeur illisible s'affiche à zéro au lieu
> d'emporter la page.

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

> **Il restait vide, même après « Caisse ouverte avec Salma ».** Les services
> de caisse ne quittaient jamais la tablette : ni le fond, ni le compté, ni
> l'écart n'existaient hors du terminal. Le POS les remonte maintenant par
> `POST /sync/shifts` — à l'**ouverture** (la caisse ouverte se voit pendant
> le service, pas seulement le soir), puis à la **clôture**, enrichis de leur
> écart. Comme tout le reste, ils n'apparaissent qu'une fois le badge à
> **À jour**.

#### Le bloc « TVA » de cet écran

Trois colonnes, une ligne **par taux** :

| Colonne | Ce que c'est |
|---|---|
| **Taux** | le taux appliqué — 19 %, 13 %, 7 % |
| **Base HT** | le chiffre d'affaires **hors taxe** taxé à ce taux |
| **TVA** | la taxe due sur cette base |

Les taux **diffèrent selon le produit**, pas selon le client : en Tunisie, la
restauration, les boissons et certains produits n'ont pas le même taux. Un
ticket avec une pizza et un Coca produit donc **deux lignes**, une par taux.
Le catalogue porte le taux de chaque produit (**Catalogue** → colonne TVA).

Le **total** de la colonne *Base HT* — les `22,158 TND` de ton écran — est
donc **le CA hors taxe de la journée, toutes lignes confondues**. À ne pas
confondre avec le *Total encaissé* juste au-dessus, qui est **TTC** : la
différence entre les deux, c'est exactement la TVA, le service et le timbre.

> **La TVA est arrondie PAR TAUX, puis additionnée** — jamais l'inverse.
> Sommer d'abord et arrondir ensuite produit un écart d'un ou deux millimes
> qu'aucun comptable n'accepte, et qui grossit avec le nombre de tickets.

> ⚠ **Les taux applicables à la restauration en Tunisie doivent être validés
> par un expert-comptable.** Le logiciel les rend paramétrables et les
> applique correctement ; il n'affirme pas lesquels sont les bons. Même
> réserve pour le droit de timbre.

#### Et la clôture de caisse : qui saisit quoi ?

**Oui, tu saisis le montant compté — c'est tout l'intérêt.** Le principe est
celui de n'importe quelle caisse :

1. La caisse calcule **l'attendu** toute seule : fond d'ouverture + ventes
   en espèces − sorties d'espèces. Personne ne le saisit.
2. **Tu comptes physiquement le tiroir.** L'écran de clôture du POS présente
   les **coupures une à une** — 50, 20, 10, 5 dinars, puis les pièces — et
   tu tapes *combien de chacune*. Il totalise pour toi ; tu ne fais pas
   l'addition.
3. L'écart — **compté − attendu** — s'affiche, et part au back-office.

Un écart **peut être négatif**, et il le reste : aucune borne à zéro. C'est
tout son intérêt. Un écart isolé de quelques centaines de millimes est une
erreur de rendu de monnaie ; un écart récurrent **chez le même employé** est
un signal, et c'est pour cela que le nom figure sur la ligne.

> Si le système saisissait lui-même le compté, il n'y aurait plus d'écart —
> donc plus de contrôle, et une caisse qui « tombe juste » tous les soirs
> sans que personne n'ait rien vérifié.

### 4.5 — Stock

Quatre cartes en tête : produits suivis, ruptures, stock faible, **valeur du
stock** (quantités × coût d'achat).

Puis « À réapprovisionner », et le tableau complet : prix, coût, **marge par
produit**, stock, seuil, **état** et **En vente**.

Les deux dernières colonnes ne disent pas la même chose, et c'est le point
qu'il faut retenir de cet écran :

- **État** — *OK · Faible · Rupture* — est **calculé** à partir des ventes et
  du seuil. Il informe, il ne décide rien (§6, « Le seuil d'alerte »).
- **En vente** est un **interrupteur** : c'est le seul mécanisme qui retire
  réellement un produit de la carte des caisses (§5.3).

**Vérifie que la vente a bien décrémenté** : Coca-Cola devait être à 48, tu en
as vendu 2 au ticket 1 → il doit afficher **46**. Déplie la ligne : *« Depuis
le comptage : 2 vendu(s) »*.

> **Rien n'a bougé ?** Le stock se calcule **côté serveur** à partir des
> ventes synchronisées. Vérifie que l'écran **Sync** de la caisse annonce
> « À jour ».

### 4.6 — Cuisine

À faire **entre l'envoi et l'encaissement du ticket 3**.

L'écran affiche les commandes **envoyées et pas encore encaissées**, les plus
anciennes d'abord, avec l'attente en minutes qui passe à l'orange à 10 min et
au rouge à 20. Aucun montant : la cuisine prépare, elle n'encaisse pas.

Clique **Prêt** → le bon grisonne. Encaisse le ticket à la caisse → il
disparaît de l'écran.

**Les onglets de poste** — *Tous les postes · Cuisine · Bar* — apparaissent
dès qu'il y a plus d'un poste de préparation. La caisse émet déjà **un bon par
poste** : la pizza part en Cuisine, le Coca au Bar. L'écran mélangeait les
deux, et le barman triait les pizzas à l'œil pour trouver ses cafés. Le poste
d'un produit se règle au **Catalogue**.

> « Tous les postes » reste le défaut : dans un snack à un seul écran, c'est
> ce qu'on veut.

> Cet écran a besoin du **réseau** (il lit le serveur). La caisse, elle,
> encaisse hors ligne. Si la cuisine perd Internet elle perd l'affichage, pas
> les commandes : elles réapparaissent au retour du réseau.

---

## 5. Les trois manipulations qui prouvent que ça marche

Les deux premières sont des vérifications. La troisième est la plus
importante : elle explique pourquoi une rupture de stock ne se comporte pas
comme on l'attend — et ce qu'il faut faire à la place.

### 5.1 — Le stock revient quand on annule

Note le stock de **Frites** (30). Encaisse un ticket avec 3 Frites →
synchronise → Stock affiche **27**.

Fais **annuler** cette commande par un manager (PIN `1357`) → synchronise →
Stock revient à **30**, et la vente disparaît du tableau de bord.

> Aucun compteur n'est décrémenté nulle part : le stock est **recalculé** à
> chaque lecture. C'est ce qui le rend insensible aux annulations et aux
> reprojections.

### 5.2 — La caisse encaisse hors ligne

**Oui, cela marche aussi sur Vercel**, et c'est la question qu'il faut se
poser. Le bundle du POS est **entièrement local** : Vercel ne sert que des
fichiers statiques, un service worker les met en cache dès la première visite,
et SQLite vit dans IndexedDB. Aucun code ne vient du réseau — c'est ce que
vérifie la garde du mode avion à chaque build. Le serveur de sync ne sert qu'à
**échanger des données**, jamais à faire tourner l'application.

**L'essai** — charge la page une première fois (le service worker s'installe),
puis coupe le Wi-Fi. Le bandeau passe **Hors ligne**.

Encaisse une vente normalement — **rien ne bloque**. Le compteur `⇅ n` monte.
Recharge même la page : elle s'ouvre toujours, la caisse est toujours ouverte,
et le poste est repris sans PIN.

Rends le réseau : le compteur redescend à `0` tout seul, et la vente apparaît
au back-office.

> **Une réserve, et elle est réelle.** Sur la cible **web**, le navigateur
> peut évincer IndexedDB s'il manque de place — c'est sa prérogative, pas un
> défaut de Kaissi. *Diagnostic* → bloc **Stockage** le dit noir sur blanc, et
> installer la page comme application (icône « Installer » dans la barre
> d'adresse) obtient le stockage persistant. Pour un restaurant qui tourne
> tous les jours, la cible **APK** reste la cible nominale : son SQLite natif
> n'est évinçable par personne.
>
> Le stock, lui, ne bougera qu'après la synchronisation — il est calculé côté
> serveur.

### 5.3 — Rupture : ce qui bloque, et ce qui ne bloque pas

C'est la question la plus importante de ce document, parce que la réponse
n'est pas celle qu'on attend. **Deux mécanismes distincts** :

| | **En vente / En rupture** | **Stock calculé** |
|---|---|---|
| Qui décide | un humain, au back-office | le système, à la lecture |
| Où | Stock → colonne **En vente** | Stock → colonnes **Stock** et **État** |
| Effet sur la caisse | le produit **passe en « Rupture »** et refuse d'être ajouté | **aucun** |
| Vrai quand ? | au moment où on clique | peut dater de plusieurs heures |

**Fais l'essai.** Back-office → **Stock** → ligne *Pizza Margherita* → clique
**En vente**, qui bascule en **En rupture**. Sur la caisse : **Sync**, puis
retourne dans une commande. La Pizza Margherita est barrée, marquée
**RUPTURE**, et un clic dessus affiche :

> *Pizza Margherita est en rupture de stock : il a été retiré de la carte
> depuis le back-office.*

Le produit reste **visible et cliquable**. C'est délibéré : un bouton grisé ne
dit rien, et le caissier tape trois fois dessus avant d'aller chercher le
gérant. Un clic, une phrase, et il sait quoi répondre au client.

Ce réglage passe par le **catalogue**, déjà synchronisé : toutes les tablettes
l'apprennent au cycle suivant, sans rien réinstaller. Le geste inverse remet
le produit en vente.

#### Pourquoi le stock CALCULÉ, lui, ne bloque rien

Pizza Margherita est à **0** au stock. Laisse-la **En vente** et vends-en une.
**La caisse ne refuse rien**, et après synchronisation le stock affiche **−1**.

Ce n'est pas un oubli, c'est la règle qui porte le produit :

- **Hors ligne, cette quantité est un souvenir.** La tablette a le dernier
  stock reçu — il peut avoir trois heures et deux livraisons de retard.
  Refuser une pizza qui est en cuisine, c'est perdre le client *et* garder
  une donnée fausse : le pire des deux mondes.
- **Deux tablettes hors ligne ne peuvent pas se mettre d'accord.** Chacune
  croit qu'il reste une part. Un blocage local n'en est donc pas un — il
  donne l'illusion d'une garantie qu'il ne tient pas.
- **Le négatif est l'information, pas le bug.** Un stock à −1 dit exactement
  une chose : *il manque une réception à saisir, ou le comptage de référence
  était faux*. Le borner à zéro effacerait le seul signal qui appelle à
  recompter, et le stock paraîtrait juste en étant faux. C'est aussi pour
  cela que **−1 s'affiche en « Rupture »**, jamais en « presque en
  rupture » : négatif et zéro sont le même état.

> **En résumé** : ce n'est pas au stock d'arbitrer une vente, c'est au
> gérant. Le bouton **En rupture** lui donne ce pouvoir en un clic, et sa
> décision est vraie au moment où il la prend. Le stock, lui, garde son rôle
> : alerter, chiffrer, et dire quand recompter.

Pour repartir propre après cet essai : Stock → *Ajuster* → **Recompter le
stock** avec la quantité réelle. Le comptage repose la référence à maintenant,
et les ventes antérieures cessent d'être soustraites.

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

#### D'où vient le chiffre affiché

Une seule formule, appliquée **à chaque lecture de l'écran** :

```
stock = comptage de référence
      + mouvements manuels saisis DEPUIS ce comptage
      − quantités vendues DEPUIS ce comptage
```

Aucun compteur n'est décrémenté nulle part. C'est ce qui rend le stock
insensible aux annulations : annuler une commande la retire du calcul, et la
quantité revient d'elle-même (§5.1). Un compteur, lui, devrait défaire
*exactement* ce qu'il a fait — y compris quand la commande change d'état entre
deux — et dériverait en silence.

#### Le seuil d'alerte

C'est **la quantité en dessous de laquelle il faut recommander**. Rien de
plus : **aucun e-mail, aucune notification, aucun envoi**. Il ne fait que
changer la pastille **État** et faire remonter le produit dans « À
réapprovisionner », en haut de l'écran Stock.

L'état se calcule ainsi, dans cet ordre :

| Condition | État |
|---|---|
| produit non suivi | **Non suivi** |
| quantité **≤ 0** (zéro **ou négatif**) | **Rupture** |
| quantité **≤ seuil** | **Faible** |
| sinon | **OK** |

C'est pourquoi *Ojja merguez* à **6** avec un seuil de **8** est **Faible** :
`6 ≤ 8`. Ce n'est pas `8 − 6 = 2` — la soustraction n'entre nulle part. Il
suffit d'être *sous* le seuil.

Le seuil est **facultatif** : sans lui, un produit passe directement de
« OK » à « Rupture » à zéro, sans prévenir. C'est tout ce qu'on perd à ne pas
le remplir.

Comment le choisir : la quantité consommée pendant le délai de réapprovision-
nement, plus une marge. Livraison hebdomadaire, 8 pizzas par semaine → seuil
à 10 ou 12.

#### Le module « Mouvement »

C'est le **journal des variations de stock qui ne sont pas des ventes**. Les
ventes se déduisent toutes seules ; tout le reste se saisit ici, et ne
s'écrase jamais — un mouvement **s'ajoute**, il ne remplace pas. L'historique
dit donc *pourquoi* le stock a bougé.

| Motif | Quand l'utiliser | Signe |
|---|---|---|
| **Réception** | Une livraison arrive | Saisir la quantité reçue, en **positif** |
| **Perte** | Casse, péremption, vol, plat raté | Saisir un nombre **positif** — le système le retranche |
| **Correction** | Erreur de saisie ou d'inventaire ponctuelle | Positif ou négatif, au choix |

Un exemple complet : *le livreur apporte 24 Coca* → **Mouvement** → Réception
`24`, note « Livraison Sotubi 03/09 ». Le stock passe de 46 à 70, et la ligne
reste au journal.

**Mouvement ou Recomptage ?** Les deux existent parce qu'ils ne répondent pas
à la même question :

| | **Mouvement** | **Recompter le stock** |
|---|---|---|
| Ce qu'on sait | *combien a bougé* (« +24 reçus ») | *combien il y a* (« j'en ai compté 19 ») |
| Effet | ajoute au calcul | **repose la référence à maintenant** |
| Conséquence | l'historique s'allonge | les ventes antérieures cessent d'être soustraites |
| Quand | au fil de l'eau | après un inventaire, ou quand le chiffre est faux |

En clair : **le mouvement raconte, le recomptage recadre.** Après un
inventaire, ne saisis pas la différence en correction — recompte. C'est aussi
le geste qui répare un stock négatif.

| Autre geste | Quand | Effet |
|---|---|---|
| **En vente / En rupture** | Plus de pâte à pizza ce soir | Retire le produit de la carte des caisses (§5.3) |
| **Arrêter le suivi** | Produit non stocké (café, eau du robinet) | Retire le produit des alertes et du calcul |

---

## 7. Si quelque chose ne va pas

| Symptôme | Cause · geste |
|---|---|
| `Could not find the table 'kaissi.stock_items'` | Cache de schéma PostgREST périmé. Supabase → SQL Editor → `notify pgrst, 'reload schema';` |
| Opérations refusées « signé par un autre appareil » | Recharge la caisse (Ctrl+Maj+R) : elle adopte son identité au démarrage. Puis « Abandonner ces opérations d'un ancien appairage ». |
| Terminal **non appairé** | Caisse → **Sync** → l'écran de mise en service demande l'**e-mail et le mot de passe** d'un compte gérant : plus de jeton à recopier. `pnpm sync:appairer` reste le chemin de dépannage. |
| « Failed to fetch » à l'appairage | `SYNC_ORIGINES` sur Railway doit contenir l'URL **exacte** du POS. |
| Écran Cuisine vide, ou erreur `kitchen_ready` | Migration **0018** non appliquée. Toutes les migrations doivent passer, dans l'ordre. |
| Push refusé sur une vente pourtant valide | Un employé du POS n'existe pas côté serveur (`orders.opened_by`). Migration **0020** les crée. |
| Stock inchangé après une vente | La vente n'est pas synchronisée : l'écran **Sync** dit-il « À jour » ? |
| Tableau de bord vide | Mauvaise période, ou vente non synchronisée. Vérifie d'abord **Tickets**. |
| CA inférieur au total des tickets | **Normal** : le CA est HT, les tickets TTC. |
| « Votre compte n'est rattaché à aucun établissement » | `pnpm sync:acces --restaurant <uuid> --email … --role admin` |
| Le détail d'un ticket répond « server-side exception » | Corrigé (§4.3). Si cela réapparaît, c'est une autre page : note le *Digest* et le chemin. |
| Bloc **Caisses** vide dans Journée | Le POS remonte ses services depuis la migration **0022**. Vérifie qu'elle est passée, puis synchronise. |
| Le POS redemande un PIN à chaque rechargement | Corrigé : le poste est repris. Si cela persiste, le navigateur a évincé IndexedDB — voir *Diagnostic* → Stockage. |
| Un produit reste vendable alors qu'il est à 0 | **Normal** : le stock ne bloque pas. Pour le retirer de la carte, Stock → **En rupture** (§5.3). |
| « Rupture » sur un produit qu'on a réapprovisionné | La colonne **En vente** est restée sur *En rupture* : re-clique pour le remettre en vente. |

---

## 8. Remettre la démo à zéro

Dans le **SQL Editor** de Supabase.

**Effacer les ventes** (garde catalogue, employés, stock) :

```sql
-- order_events est en insertion seule : le déclencheur bloque même le
-- propriétaire. On le désactive le temps du ménage — un privilège réservé à
-- une base de démonstration, JAMAIS à une base de production réelle.
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
> navigateur (Paramètres → Données de site), puis ré-appaire.

**Remettre tous les produits en vente**, si l'essai du §5.3 en a retiré :

```sql
update kaissi.products set is_available = true
 where restaurant_id = '01930000-0000-7000-8000-000000000002';
```

---

## 9. Ce qui n'est pas encore là — et pourquoi

Trois limites que la démonstration met en évidence. Elles sont assumées, pas
oubliées : chacune est écrite ici pour qu'on la choisisse, plutôt que de la
découvrir en clientèle.

**1. « Prêt » ne prévient pas le serveur en salle.** Le marqueur reste sur
l'écran de cuisine. Le porter jusqu'à la tablette demande un canal de descente
dédié : `kitchen_ready` n'est ni un événement de commande, ni du référentiel,
et la règle 4 interdit un curseur horodaté — il lui faut son propre
`bigserial`, plus un badge sur l'écran de salle. C'est le prochain chantier.

**2. Aucun écran ne crée de remboursement.** La lecture est complète, pas
l'écriture. Aujourd'hui, une erreur se répare **avant** l'encaissement, par
annulation de ligne ou de commande. Un vrai remboursement doit décider ce
qu'il fait de la TVA et du stock — ce n'est pas une case à cocher.

**3. L'écran de cuisine a besoin du réseau.** Il lit le back-office. La
caisse, elle, encaisse hors ligne : c'est *elle* qui porte la promesse du
produit. Porter la cuisine dans le POS la rendrait indépendante d'Internet à
son tour.

Et une question ouverte, volontairement laissée telle quelle :

**Faut-il masquer « Diagnostic » aux caissiers ?** Mon avis : **non**. C'est
un écran de **lecture** — état du stockage, appairage, réseau, version du
schéma — et rien de ce qu'il montre ne vaut de l'argent. Or c'est exactement
la page qu'il faut ouvrir quand une caisse ne synchronise plus, à 20 h, sans
le gérant sur place. La cacher ne protège rien et laisse le caissier sans
recours ; le vrai garde-fou est ailleurs — jeton d'appareil révocable, RLS,
journal d'audit. Le seul reproche défendable était l'encombrement du bandeau,
et les liens **Salle** et **Sync** le règlent.
