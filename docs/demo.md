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

> **Le bandeau porte trois liens permanents : Salle · Sync · Diagnostic.** Le
> badge coloré `⇅ n`, lui, n'apparaît *que* s'il a quelque chose à dire — il
> disparaît donc quand tout va bien, ce qui est précisément le moment où l'on
> cherche à vérifier que tout va bien. D'où le lien **Sync**, toujours là.
>
> **Salle** ramène à l'écran des tables depuis n'importe où.
>
> **L'envoi est automatique**, en continu, dès qu'il y a du réseau : un cycle
> toutes les quinze secondes, avec recul progressif après un échec. Le bouton
> « Ne pas attendre — envoyer maintenant » ne déclenche rien de plus : il
> avance le prochain cycle, pour vérifier tout de suite au back-office.
>
> **Diagnostic** ouvre sur quatre phrases — la carte, vos ventes, Internet,
> l'envoi au bureau. Le reste (SQLite, IndexedDB, migrations, curseurs) est
> replié sous « Détails techniques » : le caissier n'a pas à le lire, mais le
> support doit pouvoir se le faire dicter au téléphone.

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
> chose à construire (§10), pas un réglage oublié. En attendant, la cuisine
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
  > (§10).
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
Le menu porte le taux de chaque produit (**Menu** → fiche produit).

Le **total** de la colonne *Base HT* — les `22,158 TND` de ton écran — est
donc **le CA hors taxe de la journée, toutes lignes confondues**. À ne pas
confondre avec le *Total encaissé* juste au-dessus, qui est **TTC** : la
différence entre les deux, c'est exactement la TVA, le service et le timbre.

**Un exemple, ligne par ligne.** Un article à **13,500 TND** avec une TVA de
**19 % incluse** — « incluse » veut dire que le prix affiché sur la carte est
déjà TTC, ce qui est la règle en restauration :

```
prix affiché (TTC)  13,500
base HT = 13,500 ÷ 1,19  =  11,345
TVA     = 13,500 − 11,345 =   2,155   ← le chiffre que tu cherchais
```

Les **2,155 TND** ne s'ajoutent donc pas aux 13,500 : ils sont **dedans**.
C'est la part que le restaurant reverse à l'État, et le CA qu'il garde sur
cette ligne est 11,345.

Si le taux était **exclusif** — prix hors taxe affiché, TVA ajoutée — la même
ligne donnerait `13,500 × 19 % = 2,565` et un total de `16,065`. Le catalogue
porte ce réglage par taux (`is_included`), et c'est lui qui décide.

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

Quatre cartes en tête : produits comptés, ruptures, stock faible, **valeur du
stock** (quantités × coût d'achat).

> **Il n'y a plus de « suivi » à activer.** Saisir une quantité suffit : le
> bouton dit *Saisir le stock*, puis *Ajuster*. Trois notions — suivre,
> compter, ne plus suivre — pour une seule question, combien en reste-t-il.

Puis « À réapprovisionner », et le tableau complet : prix, coût, **marge par
produit**, stock, seuil, **état** et **En vente**.

Les deux dernières colonnes ne disent pas la même chose, et c'est le point
qu'il faut retenir de cet écran :

- **État** — *OK · Faible · Rupture* — est **calculé** à partir des ventes et
  du seuil. Il informe, il ne décide rien (§6, « Le seuil d'alerte »).
- **En vente** est ce que voit la caisse. Le bouton dit aussi *pourquoi* le
  produit en est sorti : **Rupture (auto)** — le stock est à zéro, ça se lèvera
  seul à la réception — ou **Rupture (manuel)** — tu l'as décidé, et rien ne le
  défera sans toi (§5.3).

**Vérifie que la vente a bien décrémenté** : Coca-Cola devait être à 48, tu en
as vendu 2 au ticket 1 → il doit afficher **46**. Déplie la ligne : *« Depuis
le comptage : 2 vendu(s) »*.

> **Rien n'a bougé ?** Le stock se calcule **côté serveur** à partir des
> ventes synchronisées. Vérifie que l'écran **Sync** de la caisse annonce
> « À jour ».

### 4.6 — Préparation (cuisine et bar)

> L'adresse a changé : c'est **`/‹resto›/preparation`**, plus `/cuisine`.
> Un même écran sert les deux postes, filtré sur le poste.

À faire **entre l'envoi et l'encaissement du ticket 3**.

L'écran affiche les commandes **envoyées et pas encore encaissées**, les plus
anciennes d'abord, avec l'attente en minutes qui passe à l'orange à 10 min et
au rouge à 20. Aucun montant : celui qui prépare n'encaisse pas.

Clique **Prêt** → le bon grisonne. Encaisse le ticket à la caisse → il
disparaît de l'écran.

**Les onglets de poste** — *Tous les postes · Cuisine · Bar* — apparaissent
dès qu'il y a plus d'un poste, **et seulement pour l'encadrement**. Un gérant
a de bonnes raisons de voir ce que chaque poste voit ; un barman, non — son
écran est épinglé sur le sien, et son titre porte le nom du poste.

Le poste se règle désormais **sur la CATÉGORIE**, au Menu (§4.7) : toutes les
boissons partent au bar, y compris celles que tu ajouteras dans six mois.

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

**Un produit tombé à zéro sort de la carte tout seul.** C'est le comportement
attendu, et c'est ce que fait Kaissi. Mais *qui* le décide, et *sur quelle
donnée*, n'est pas anodin — c'est ce que ce chapitre explique.

### Ce qui se passe, en une phrase

Quand la vente arrive au serveur, celui-ci recalcule le stock du produit. S'il
est à **zéro ou en dessous**, il retire le produit de la carte. Le réglage
redescend aux caisses **par le catalogue**, exactement comme un changement de
prix, à la synchronisation suivante.

Sur la caisse, le produit devient barré et marqué **RUPTURE**. Un clic dessus
affiche :

> *Pizza Margherita est en rupture de stock. Il reviendra sur la carte dès que
> le gérant aura saisi la réception.*

Le produit reste **visible et cliquable**. C'est délibéré : un bouton grisé ne
dit rien, et le caissier tape trois fois dessus avant d'aller chercher le
gérant. Un clic, une phrase, et il sait quoi répondre au client.

**Le retour est automatique aussi.** Saisis une réception dans Stock : le
produit repasse en vente au cycle suivant, sans autre geste.

### Trois réglages, à connaître avant de s'agacer

| Dans Stock | Ce que ça fait |
|---|---|
| **En vente / Rupture (auto)** | posé par le système. Se lève seul à la réception. |
| **En vente / Rupture (manuel)** | posé par toi. « On ne fait plus de brik ce soir ». L'automatisme ne le défera **jamais** — sinon une livraison de pâte remettrait en vente ce que tu avais délibérément arrêté. |
| case **auto** | coche par produit. La décocher, c'est dire « je compte ce produit pour savoir où j'en suis, mais je ne veux pas qu'une erreur d'inventaire vide ma carte en plein service ». |

Un produit **non suivi en stock** n'est jamais retiré automatiquement : rien
n'est compté, donc rien ne peut tomber à zéro. C'est le cas de la plupart des
articles d'un snack.

### Pourquoi c'est le SERVEUR qui décide, et pas la tablette

C'est le point qui compte, et il tient en trois lignes :

- **Une tablette hors ligne ne connaît qu'un souvenir.** Sa dernière donnée de
  stock peut avoir trois heures et deux livraisons de retard. La laisser
  refuser une vente sur cette base, c'est refuser une pizza qui est en
  cuisine : on perd le client *et* la donnée reste fausse.
- **Deux tablettes hors ligne ne peuvent pas se mettre d'accord.** Chacune
  croit qu'il reste une part. Un blocage local n'en serait pas un — il
  donnerait l'illusion d'une garantie qu'il ne tient pas.
- **Le serveur, lui, calcule à l'instant.** Il voit toutes les tablettes. Sa
  décision est donc vraie, et la caisse n'a plus rien à arbitrer : elle
  applique un réglage de catalogue, comme un prix.

C'est pour cela que la règle « le stock ne bloque jamais une vente » reste
entière : ce n'est pas le stock **local** qui retire le produit.

### « Comment un stock à −1 peut-il encore être commandé ? »

Il peut, dans **une** situation, et une seule : **la caisse était hors ligne**.

Déroulé exact :

```
stock = 1
  ↓  la caisse perd le réseau
  ↓  elle vend 2 pizzas — elle n'a AUCUNE donnée de stock, elle ne
  ↓  consulte rien ; elle enregistre deux ventes, c'est son métier
  ↓  le réseau revient, les deux ventes partent
  ↓  le serveur recalcule : 1 − 2 = −1
  ↓  il retire le produit de la carte
  ↓  la tablette l'apprend au cycle suivant
stock = −1, produit hors carte
```

Personne n'a mal fonctionné. Le client a été servi, la vente est encaissée, et
le **−1 est la trace exacte de ce qui s'est passé** : on a vendu une pizza de
plus qu'on n'en avait compté. Le borner à zéro effacerait précisément
l'information qui dit « recompte, ou saisis la réception que tu as oubliée ».

C'est aussi pourquoi **−1 s'affiche « Rupture »** et jamais « presque en
rupture » : zéro et négatif sont le même état.

**Pour vérifier toi-même**, sans couper le Wi-Fi : Stock → *Ajuster* →
**Recompter le stock** à `1`. Vends-en deux d'affilée très vite depuis la
caisse : la première passe, et la seconde aussi si la synchronisation n'a pas
eu le temps de faire l'aller-retour. C'est le même phénomène, en accéléré.

**Pour repartir propre** : Stock → *Ajuster* → **Recompter le stock** avec la
quantité réelle. Le comptage repose la référence à maintenant, les ventes
antérieures cessent d'être soustraites, et le produit revient en carte.

---

## 5 bis. Tester les nouveautés — pas à pas

Chaque bloc se teste **seul**, dans l'ordre que tu veux. Le résultat attendu
est écrit : si tu ne l'obtiens pas, c'est un bug, dis-le-moi.

---

### A. Le poste de préparation suit la catégorie

1. Back-office → **Menu** → section **Catégories**.
2. Chaque ligne porte un menu **Poste de préparation**. Vérifie :
   *Boissons → Bar*, *Plats → Cuisine*.
3. Si une catégorie affiche **« non réglé »** (ce sera le cas de « Pizza »),
   choisis son poste. **Le choix s'enregistre au changement du menu**, sans
   bouton — un message de confirmation apparaît.
4. Ouvre la fiche d'un produit (**Modifier**) : il n'y a **plus** de champ
   « Station de préparation ». C'est voulu — le poste vient de la catégorie.

**Attendu** : sur la caisse, après synchronisation, envoyer une commande
mixte (une pizza + un Coca) fait apparaître la pizza sur l'écran Cuisine et
le Coca sur l'écran Bar — jamais les deux au même endroit.

> **Pourquoi ce changement.** Le poste était sur le produit : il fallait s'en
> souvenir à chaque création, et un produit sans poste n'apparaît sur **aucun**
> écran de préparation — ce qui ne se voit qu'en plein service.

---

### B. Un écran séparé pour la cuisine et pour le bar

**Préparer un compte de bar** (une fois) :

1. Back-office → **Employés** → donne le rôle **bar** à quelqu'un.
2. Ce compte doit pouvoir se connecter : s'il n'a pas encore d'accès, lance
   `pnpm sync:acces` depuis ton poste.

**Tester** :

3. Connecte-toi avec ce compte. Tu atterris **directement** sur
   `/‹resto›/preparation`.
4. **Vérifie la barre du haut** : un seul onglet, « Préparation ». Ni Ventes,
   ni Tickets, ni Journée.
5. **Le titre porte le nom du poste** — « Bar », pas « Cuisine ».
6. **Le test qui compte** : tape à la main l'adresse
   `https://‹ton-back-office›/‹resto›/ventes`.

**Attendu** : tu es **renvoyé sur l'écran de préparation**. Avant ce
correctif, cette URL affichait le chiffre d'affaires.

> Si le poste n'est pas reconnu, c'est que l'appartenance n'a pas de station.
> Le repli cherche une station dont le **nom** correspond au rôle (« Bar »).
> Dis-le-moi si tu veux l'interface de rattachement explicite.

---

### C. L'historique du stock, avec le fournisseur

1. Back-office → **Stock** → déplie un produit (**Ajuster**).
2. Formulaire **Mouvement** : quantité `12`, motif **Réception**,
   fournisseur `Sfax Primeurs`, note `Facture 128`. Enregistre.
3. Descends jusqu'à **Historique des mouvements**.

**Attendu** : une ligne avec **date et heure en deux colonnes**, le produit,
**`+12`**, « Réception », « Sfax Primeurs », la note, et **ton nom**.

4. Refais un mouvement en **Perte / casse**, quantité `3`.

**Attendu** : la ligne affiche **`−3`** en rouge. Tu saisis toujours un
nombre **positif** : le signe découle du motif.

5. Ouvre le menu **Motif** : il n'y a plus que deux entrées.

> **« Correction » a disparu de la saisie**, volontairement : entre une
> réception et une perte, un troisième motif attirait tout ce qu'on n'avait
> pas envie de qualifier. Pour repartir d'un comptage propre, c'est le
> formulaire de gauche (*Recompter le stock*) qu'il faut utiliser.
> Les anciennes lignes « Correction » restent visibles dans l'historique.

**Ce qui n'y est PAS** : les ventes. Elles ne sont pas recopiées ici — le
stock les déduit directement des commandes. La colonne « Depuis le comptage :
N vendu(s) » répond déjà à cette question.

---

### D. Ordre du menu, archive, TVA

**Ordre (§10 de ta liste)**

1. **Menu** → section Catégories → clique **↑** sur une catégorie.

**Attendu** : elle échange sa place avec celle du dessus. Les flèches sont
grisées aux extrémités. Il n'y a **plus de champ « Position »** à remplir.

2. Même chose sur une ligne de produit. Les flèches d'un produit le déplacent
   **dans sa catégorie** — jamais au milieu d'une autre.

**Archive (§11)**

3. Archive un produit (**Archiver**).
4. Descends : une section **Archive** apparaît en bas de l'écran Menu.
5. Clique **Remettre**.

**Attendu** : le produit revient dans la liste, **hors vente**. C'est
volontaire — il a peut-être été archivé parce qu'on ne le sert plus ; le
remettre à la carte est une seconde décision (bouton **Remettre** de la ligne).

**TVA (§12)**

6. Ouvre la fiche d'un produit.

**Attendu** : s'il n'y a **qu'un seul taux** dans l'établissement, le menu
« Taux de TVA » **n'apparaît pas**. Le taux part quand même — un menu à une
seule entrée n'est pas un choix. Ajoute un second taux et le menu revient.

---

### E. Qui a FERMÉ la caisse

> Il faut une caisse **ouverte par une personne** et **fermée par une autre**.

1. Sur la caisse : prise de poste avec **Ahmed**, fond de caisse `50`.
2. Encaisse un ticket.
3. **Verrouille** (bouton en haut à droite), puis reprends avec **Salma**.
4. **Clôturer** : saisis le comptage, valide.
5. Synchronise (l'écran Sync doit dire « À jour »).
6. Back-office → **Journée**, tableau **Caisses**.

**Attendu** : **« Ouverte par » = Ahmed**, **« Fermée par » = Salma**.

> Devant un écart, le nom qui compte est celui de la personne qui a **vu les
> billets**. Afficher celui de l'ouverture met en cause quelqu'un qui était
> parti depuis quatre heures.
>
> Les caisses **déjà clôturées avant cette mise à jour** affichent « — » dans
> « Fermée par ». C'est la vérité : l'information n'a jamais été enregistrée.
> Elle n'est pas remplacée par le nom de l'ouverture, qui serait faux.

---

### F. Les exports

Sur **Ventes**, **Tableau de bord**, **Tickets** et **Stock**, une rangée
« Exporter : … » apparaît sous le sélecteur de période.

1. **Ventes** → clique **Par article**.

**Attendu** : un fichier `ventes-par-article-‹resto›-‹du›_‹au›.csv` se
télécharge. Ouvre-le dans Excel : les colonnes sont **séparées**, les accents
corrects (« Crème brûlée », pas « CrÃ¨me »), et tu as *Article, Quantité, CA,
CA (TND), Marge, Marge %, Part du CA*.

2. **Change la période** à l'écran, puis réexporte.

**Attendu** : le fichier suit la période affichée. C'est le piège classique —
on regarde septembre et on télécharge la semaine en cours.

3. **Stock** → **Historique des mouvements**.

**Attendu** : le CSV contient les mouvements du bloc C, fournisseur compris.

4. Le test qui compte pour le cloisonnement : connecte-toi en **cuisine** ou
   **bar** et ouvre `/‹resto›/export/ventes`.

**Attendu** : **redirigé**, aucun fichier. Un export sans garde rendrait
exactement ce qu'on vient de retirer de l'écran.

> **Deux colonnes de montant par ligne**, et c'est voulu : « 24,500 TND » se
> lit, « 24,500 » s'additionne dans le tableur. N'en donner qu'une oblige soit
> à retaper les chiffres, soit à lire « 24500 » partout.

---

## 6. Gérer le menu et le stock

### Changer un prix ou un coût

Back-office → **Menu** → modifier un produit.

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
| **En vente / En rupture** | Plus de pâte à pizza ce soir, machine en panne | Retire le produit de la carte des caisses, **à la main**. Marqué « manuel » : l'automatisme ne le remettra jamais en vente tout seul (§5.3) |
| case **auto** | Produit dont le comptage n'est qu'indicatif | Coupe la rupture automatique pour ce produit : il reste vendable même à zéro |
| **Arrêter le suivi** | Produit non stocké (café, eau du robinet) | Retire le produit des alertes et du calcul, et le remet en vente s'il en était sorti pour cause de stock |

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
| Un produit reste vendable alors qu'il est à 0 | Trois causes : il n'est pas **suivi** en stock ; sa case **auto** est décochée ; ou la caisse n'a pas encore synchronisé. |
| « Rupture (manuel) » sur un produit réapprovisionné | Le retrait manuel ne se lève **jamais** tout seul, par construction. Clique le bouton pour le remettre en vente. |
| Un produit disparaît de la carte sans qu'on comprenne | Stock → son état est à zéro ou négatif. Saisis la réception, ou décoche **auto** si ce produit ne doit pas suivre cette règle. |
| Stock à **−1** ou moins | Une vente est passée pendant que la caisse était hors ligne : c'est la trace, pas un bug (§5.3). Recompte pour repartir juste. |

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

## 9. Admin, gérant, caissier, serveur, cuisine

Cinq rôles, et la question qui revient : **qu'est-ce qui distingue vraiment un
admin d'un gérant ?**

**Sur la caisse : rien.** Les deux ont exactement les mêmes permissions —
annuler une commande, forcer un prix, rembourser, remise sans plafond, ouvrir
le tiroir hors vente. C'est voulu : devant un client qui attend, un
administrateur fait le travail d'un gérant.

**Au back-office : une seule différence, et elle est nette.**

> Un **gérant** exploite l'établissement. Un **administrateur** décide qui
> d'autre obtient ce pouvoir.

| | admin | gérant | caissier | serveur | cuisine | bar |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Encaisser, ouvrir et clôturer la caisse | ✓ | ✓ | ✓ | — | — | — |
| Ouvrir une commande, envoyer en préparation | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Remise | illimitée | illimitée | 10 % | 5 % | — | — |
| Annuler une commande, forcer un prix, rembourser | ✓ | ✓ | — | — | — | — |
| Tableau de bord, ventes, marges | ✓ | ✓ | — | — | — | — |
| Menu, stock, prix, coûts | ✓ | ✓ | — | — | — | — |
| Journée (fond de caisse, écart) | ✓ | ✓ | ✓ | ✓ | — | — |
| Embaucher un caissier, un serveur, un cuisinier | ✓ | ✓ | — | — | — | — |
| **Nommer un gérant ou un administrateur** | **✓** | — | — | — | — | — |
| **Rétrograder ou révoquer un gérant** | **✓** | — | — | — | — | — |
| Écran de préparation | ✓ | ✓ | — | — | ✓ | ✓ |

**Cuisine et bar n'ont QU'UN écran, le leur.** Pas même « Journée », qui
affiche le fond de caisse et l'écart : celui qui prépare n'encaisse pas.

Et ce n'est pas qu'un onglet masqué — la vérification est **côté serveur**.
Une URL tapée à la main (`/‹resto›/ventes`) renvoie un rôle de préparation
sur son propre écran. Jusqu'ici, elle rendait le chiffre d'affaires.

La ligne était mal placée jusqu'ici : un gérant ne pouvait pas créer
d'administrateur, mais il pouvait créer un **gérant** — qui voit tout
l'argent, modifie la carte et gère l'équipe. La protection ne protégeait donc
rien. Elle a été déplacée là où elle a un sens, et **RLS l'applique**, pas
seulement l'interface : ce n'est pas un bouton caché, c'est un refus de la
base de données.

**En pratique, dans un restaurant :** tu es admin. Ton associé ou ton
responsable de salle est gérant — il fait tourner la maison, il n'ouvre pas
les accès. Tout le monde n'a pas besoin d'un compte back-office : un serveur
tape un PIN sur la tablette, c'est tout.

> Pour donner un accès back-office à quelqu'un qui n'en a pas encore (un
> comptable, la cuisine), c'est `pnpm sync:acces` sur ton poste — créer un
> compte Supabase exige une clé qui contourne RLS, et elle n'a rien à faire
> dans une application web.

---

## 10. Ce qui n'est pas encore là — et pourquoi

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

**4. L'application n'est pas encore sur les stores.** L'APK Capacitor existe
et s'installe à la main, ce qui est plus rapide pour les premiers clients.
Google Play demande surtout des choses qui ne sont pas du code — captures
d'écran, politique de confidentialité, questionnaire Data safety. Tout est
détaillé dans [`stores.md`](stores.md), y compris pourquoi une TWA Bubblewrap,
qui convenait très bien à Digital Fidelity, est **disqualifiée** pour une
caisse : dans une TWA, le code de l'application vient du réseau.

Et une question ouverte, volontairement laissée telle quelle :

**Faut-il masquer « Diagnostic » aux caissiers ?** Non — mais le reproche était
juste, et il a été corrigé autrement. C'est un écran de **lecture**, rien de ce
qu'il montre ne vaut de l'argent, et c'est exactement la page qu'il faut ouvrir
quand une caisse ne synchronise plus, à 20 h, sans le gérant sur place. Le
cacher ne protège rien et laisse le caissier sans recours ; le vrai garde-fou
est ailleurs — jeton d'appareil révocable, RLS, journal d'audit.

Le vrai problème n'était pas qu'il soit visible, c'est qu'il s'ouvrait sur
« Mode avion — critère de sortie de la Phase 0 » et « SQLite persisté dans
IndexedDB ». Vrai, utile au support, illisible pour la personne qui tient la
caisse. Il ouvre désormais sur quatre phrases en français, et tout le
technique est replié dessous.
