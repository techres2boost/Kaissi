# Démonstration de bout en bout

Un service complet joué en 30 minutes, qui remplit **tous** les écrans :
tableau de bord, ventes, tickets, journée, stock, cuisine.

À la fin, tu sauras lire chaque chiffre et dire d'où il vient.

> **Rien à installer, rien à `git pull`.** Tout tourne déjà sur Vercel et
> Railway, qui se redéploient à chaque `push` sur `main`. Le dépôt local ne
> sert plus qu'au dépannage : `pnpm sync:acces` (le TOUT premier
> administrateur, quand personne ne peut encore ouvrir le back-office) et
> `pnpm sync:appairer` (appairer une caisse à la main). Les accès suivants —
> cuisine, bar, comptable — se donnent depuis l'écran **Employés**.

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

Trois **réductions** sont également déclarées — *Happy hour* (10 %),
*Personnel* (20 %), *Geste commercial* (−2,000 TND). La caisse les propose au
moment de la remise, et le rapport les regroupe par motif (§5 bis K).

Et trois **clients** : Salem Haddad, Amine Ben Youssef, et une « Dame de la
4 » sans téléphone — de quoi voir tout de suite ce que le bouton **Client**
de la caisse propose (§5 bis M).

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

Table 5 → **Couscous poulet** ×1 → bouton **Remise** → **Happy hour (10 %)**
→ Encaisser.

> Observe : le coût ne bouge pas, la marge baisse. C'est exactement ce qu'un
> gérant doit voir avant d'accorder des remises à la chaîne.

> La remise porte un **motif** parce qu'on l'a choisie dans la liste de la
> maison. « Autre remise… » ouvre la grille libre — et le rapport range alors
> la ligne sous « Sans motif ». Les deux sont légitimes ; §5 bis K explique
> lequel sert à quoi.

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

### 0. La navigation a changé de forme

Le menu est passé **à gauche**, en colonne, groupé :

- en haut, sans titre : **Tableau de bord · Préparation · Journée** — les
  écrans du quotidien ;
- **Rapports** : Ventes · **Par article** · Tickets · **Périodes de travail** ;
- **Configuration** : Menu · Stock · Employés.

Une rangée d'onglets marchait à cinq entrées. À neuf, elle passait à la
ligne, la page sautait d'une hauteur d'onglet selon le rôle de qui regarde,
et « Employés » se retrouvait collé à « Ventes » sans rapport entre les deux.

Sur téléphone, un bouton **☰ Menu** apparaît en haut : la colonne se
superpose au contenu et se ferme en cliquant à côté. Elle ne **pousse** pas
la page — sinon on perd sa place à chaque ouverture.

---

### A. Les postes se créent au Menu, et la catégorie s'y rattache

**LES POSTES (nouveau)**

1. Back-office → **Menu** → section **Postes de préparation**, en haut.

**Attendu** : la liste des postes de l'établissement — *Cuisine*, *Bar* — avec
le **nombre de catégories** rattachées à chacun.

2. Crée un poste : `Pizzeria`. Puis renomme-le `Four à bois`.

**Attendu** : les deux gestes marchent sans quitter la page, et le nouveau
poste apparaît **immédiatement** dans le menu « Poste de préparation » des
catégories, juste en dessous.

3. Essaie d'**archiver** un poste auquel une catégorie est encore rattachée.

**Attendu** : **refus**, avec le nom de ce qui bloque. C'est délibéré : la
clé étrangère laisserait faire, et les catégories perdraient leur poste **en
silence** — leurs lignes cesseraient d'apparaître sur les écrans de
préparation, ce qui ne se voit qu'en plein service et ressemble alors à une
panne.

4. Archive « Four à bois » (rien ne s'y rattache).

**Attendu** : il disparaît de la liste et des menus déroulants. Les commandes
déjà préparées à ce poste gardent la référence — on archive, on ne supprime
jamais.

> **Pourquoi cet écran manquait.** Les postes venaient du jeu de données
> initial. Un restaurant qui voulait un troisième écran — pizzeria, comptoir
> — devait passer par la base. C'est exactement la configuration technique
> qu'on veut faire disparaître : plus rien ici n'exige une ligne de commande.

> **Renommer est sans danger.** Le rattachement d'un employé se fait par
> `memberships.station_id`, jamais par le NOM : renommer « Bar » en
> « Comptoir » ne vide aucun écran.

**LA CATÉGORIE (§8)**

5. Section **Catégories**, juste en dessous. Chaque ligne porte un menu
   **Poste de préparation**. Vérifie : *Boissons → Bar*, *Plats → Cuisine*.
6. Toutes tes catégories ont déjà un poste — j'ai rattaché **Pizza** à la
   Cuisine sur ta base. Si une nouvelle affiche **« non réglé »**, choisis
   son poste. **Le choix s'enregistre au changement du menu**, sans
   bouton — un message de confirmation apparaît.
7. Ouvre la fiche d'un produit (**Modifier**) : il n'y a **plus** de champ
   « Station de préparation ». C'est voulu — le poste vient de la catégorie.

**Attendu** : sur la caisse, après synchronisation, envoyer une commande
mixte (une pizza + un Coca) fait apparaître la pizza sur l'écran Cuisine et
le Coca sur l'écran Bar — jamais les deux au même endroit.

> **Pourquoi ce changement.** Le poste était sur le produit : il fallait s'en
> souvenir à chaque création, et un produit sans poste n'apparaît sur **aucun**
> écran de préparation — ce qui ne se voit qu'en plein service.

---

### B. Un écran séparé pour la cuisine et pour le bar

**Un compte de bar est déjà prêt sur ta base** :

| | |
|---|---|
| Adresse | `bar@kaissi.tn` |
| Mot de passe | `BarYiCbMPdJZZ5T!` |
| Rôle | `bar` |
| Poste rattaché | **Bar** |

> Change ce mot de passe quand tu auras fini de tester : il a circulé dans
> une conversation.

**Tester** :

1. Ouvre le back-office dans une **fenêtre privée** (pour ne pas perdre ta
   session de gérant) et connecte-toi avec ce compte.
2. Tu atterris **directement** sur `/‹resto›/preparation`.
3. **La colonne de gauche ne contient qu'une entrée** : « Préparation ». Ni
   Ventes, ni Tickets, ni Journée — ni même le sélecteur d'établissement.
4. **Le titre porte le nom du poste** — « Bar », pas « Cuisine ».
5. Sur la caisse, envoie une commande **mixte** (une pizza + un Coca).

**Attendu** : l'écran du bar montre **le Coca seul**. La pizza n'y est pas.

6. **Le test qui compte** : tape à la main l'adresse
   `https://‹ton-back-office›/‹resto›/ventes`.

**Attendu** : tu es **renvoyé sur l'écran de préparation**. Avant ce
correctif, cette URL affichait le chiffre d'affaires. Essaie aussi
`/‹resto›/export/ventes` — même refus, aucun fichier.

**Rattacher quelqu'un d'autre à un poste** :

7. Reviens en gérant → **Employés** → clique sur un employé.
8. Choisis le rôle **Cuisine** ou **Bar** : un champ **« Poste tenu »**
   apparaît juste en dessous. Choisis-en un, enregistre.

> Le champ n'apparaît **que** pour ces deux rôles : proposer un poste à un
> caissier poserait une question sans réponse. Et changer le rôle vers un
> rôle qui ne prépare pas **efface** le poste — garder celui d'un ancien
> cuisinier devenu caissier laisserait une donnée que plus rien n'utilise.
>
> « Tous les postes » reste un choix valide : dans un snack à un seul écran,
> c'est ce qu'on veut. Si tu laisses vide sur un rôle de préparation, le
> message de confirmation te le **dit** au lieu de te laisser deviner
> pourquoi l'écran montre tout.

---

### B bis. « Prêt » arrive jusqu'au serveur en salle

C'était la limite n°1 de la section 10 : la cuisine cliquait « Prêt », et le
marqueur restait au back-office. Le serveur en salle repassait donc devant la
cuisine « au cas où » — exactement ce que l'écran devait supprimer.

1. Sur la caisse : ouvre une commande sur la **table 3**, envoie-la en
   cuisine, puis **synchronise**.
2. Back-office → **Préparation** (ou le compte cuisine) → clique **Prêt** sur
   cette commande.
3. Sur la caisse : **synchronise** à nouveau, puis reviens à l'écran
   **Salle**.

**Attendu** : un bandeau **« Prêt à servir · Table 3 »** en haut de l'écran,
la tuile de la table 3 **cerclée de vert clair**, et son badge qui affiche
**« Prêt »** au lieu de « Envoyée ». Touche le bandeau : la commande s'ouvre.

4. Au back-office, **retire** le « prêt » (bouton *Annuler*), puis
   synchronise la caisse.

**Attendu** : le bandeau et le contour **disparaissent**.

> **C'est ce quatrième point qui a demandé le plus de soin.** Retirer un
> « prêt » supprimait la ligne — et une suppression, vue de la tablette, ne
> ressemble à rien : rien ne descend, et le badge serait resté allumé pour
> toujours sur un plat qui ne l'est pas. Le retrait MARQUE donc la ligne au
> lieu de l'effacer. C'est la règle 6 appliquée à un marqueur : une
> annulation ajoute une information, elle n'en retire jamais.

> **Par où ça descend.** Par le **catalogue** — le canal qui porte déjà les
> prix, avec son curseur `seq` bigserial (RÈGLE 4, jamais un horodatage). Un
> troisième flux aurait voulu sa route, son curseur et sa dégradation
> silencieuse pour un simple booléen ; ici la caisse ne fait qu'appliquer,
> exactement comme pour un changement de prix. Une version ancienne du POS
> ignore poliment l'entité qu'elle ne connaît pas.

> **Ce qui a besoin du réseau, et ce qui n'en a pas besoin.** Ce badge en a
> besoin, comme l'écran de cuisine. Son absence ne coûte rien : sans
> synchronisation, on retombe sur l'écran d'avant — et **la caisse continue
> d'encaisser**, hors ligne, sans rien attendre de personne.

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

### E bis. Ventes par article, et les graphiques

**Menu latéral → Rapports → Par article** (`/‹resto›/articles`).

1. Choisis une période d'au moins **trois jours** (sinon le graphique
   journalier te dit, à raison, qu'une seule journée ne fait pas une
   évolution).

**Attendu, dans l'ordre de l'écran** :

- quatre cartes : articles vendus, **ce qui rapporte le plus**, CA net,
  marge brute ;
- **Évolution jour par jour** — une colonne par journée. Survole une
  colonne : tu obtiens le jour, le montant et le nombre de tickets ;
- **Classement des articles** — une barre par article, la plus longue en
  haut, avec quantité, CA, marge et part du CA ;
- le même classement **par catégorie**.

2. **Le test qui compte** : bascule sur **« Par quantité »**.

**Attendu** : le classement **change d'ordre**, et la carte du haut passe de
« Rapporte le plus » à « Le plus vendu ». Ce ne sont pas les mêmes articles —
on vend cent cafés et douze couscous : trier par quantité désigne le café,
trier par chiffre d'affaires désigne le couscous. La décision commerciale
n'est pas la même, donc l'écran refuse de choisir à ta place.

3. Le choix est dans l'**URL** : recharge la page, il tient. Copie le lien à
   quelqu'un, il voit la même chose.

4. Ferme un jour (n'encaisse rien) et regarde le graphique.

**Attendu** : la journée apparaît quand même, à zéro — un trait fin sur la
ligne de base. Un graphique qui saute les jours creux resserre les colonnes
et fait disparaître le lundi de fermeture : on lirait une semaine régulière
là où il y a un trou.

5. **Le piège du soir** : encaisse un ticket **après minuit** (entre minuit
   et 4 h).

**Attendu** : il compte pour la **soirée de la veille**, pas pour le jour
suivant — exactement comme l'écran Journée. Grouper sur la date de calendrier
couperait chaque service en deux à minuit, et le samedi soir paraîtrait
moitié moins bon qu'il ne l'a été.

> **Une seule couleur, et c'est délibéré.** La longueur de la barre porte
> déjà la grandeur ; colorer chaque article n'ajouterait rien. Le validateur
> de palette rejette d'ailleurs la menthe de la marque et l'olive atténuée
> comme deux séries : écart perceptuel 6,8 en deutéranopie, 9,2 même en
> vision normale, sous le plancher de 15. Deux articles voisins seraient
> indiscernables pour une partie des lecteurs.
>
> Et le premier n'est pas coloré différemment : la couleur suivrait le RANG,
> qui change à chaque changement de période, et l'œil apprendrait une
> association fausse.

L'écran **Ventes** porte le même graphique journalier, au-dessus du
récapitulatif financier.

---

### E ter. Le ticket tel qu'il s'imprime, et les périodes de travail

**LE TICKET (§14)**

1. **Rapports → Tickets** → clique **Détail** sur une vente.

**Attendu** : tout en haut, un bloc **« Ticket, tel qu'il s'imprime »** — en
police à chasse fixe, colonnes alignées, exactement ce que la caisse affiche
au moment de l'encaissement.

2. Compare avec l'écran de la caisse après un encaissement.

**Attendu** : **le même texte, au caractère près.** Ce n'est pas une
coïncidence : le back-office ne redessine pas le ticket, il rejoue les
mêmes événements avec le même code de mise en page ESC/POS. Un second
gabarit « pour le web » aurait divergé au premier changement, et le jour où
un client conteste un montant on lui montrerait un document qui ne ressemble
pas à celui qu'il a en main.

3. Le tableau détaillé reste **en dessous** — il répond à une autre question :
   *pourquoi* ce montant, lignes annulées comprises. Le ticket, lui, dit ce
   qu'il y a sur le papier du client.

4. Clique **Exporter ce ticket**.

**Attendu** : un fichier `.txt`, à joindre à une réclamation ou à une pièce
comptable.

**LES PÉRIODES DE TRAVAIL (§17)**

**Rapports → Périodes de travail** (`/‹resto›/periodes`).

5. Choisis une période de plusieurs jours.

**Attendu** : un service par ligne — **ouverte par**, ouverture, **fermée
par**, clôture, durée, fond de caisse, **encaissé**, attendu, compté et
**écart**. Trois cartes en tête : services, écart cumulé, caisses non justes.

6. Fais une caisse volontairement fausse : compte 2 dinars de moins que
   l'attendu.

**Attendu** : l'écart s'affiche **en négatif**, en rouge. Il n'est jamais
borné à zéro ni montré en valeur absolue — un manque et un excédent ne
racontent pas la même histoire.

> **Pourquoi cet écran, alors que « Journée » montre déjà les caisses.**
> « Journée » est un rapport de JOUR, bon pour clôturer le soir. La question
> « qui rend une caisse juste, et qui rend une caisse fausse ? » se lit sur
> plusieurs semaines : un écart isolé ne dit rien, c'est sa RÉPÉTITION chez
> la même personne qui parle.

7. La colonne **Encaissé** vient de `payments.shift_id`, pas d'un découpage
   horaire : une vente encaissée à 1 h du matin reste rattachée au service
   qui l'a prise, et non au suivant.

---

### E quater. Les alertes de rupture vont CHERCHER le gérant (§3)

Jusqu'ici, la rupture était écrite sur l'écran Stock — et personne ne consulte
un écran de stock en plein service. On s'apercevait qu'il n'y avait plus
d'Ojja quand un client en commandait une.

Deux canaux, chacun facultatif : **notification** sur le téléphone ou
l'ordinateur, et **e-mail**. Rien de tout cela n'est nécessaire pour que le
reste marche.

**Ce que l'exploitant fait UNE fois — pas le client, et jamais sur la tablette**

1. Dans un terminal, à la racine du dépôt :

```bash
pnpm sync:cles
```

Il imprime trois lignes. Colle `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` et
`VAPID_SUBJECT` dans **Railway → Variables** (le service de synchronisation),
et la **même** `VAPID_PUBLIC_KEY` dans **Vercel → Environment Variables** (le
back-office). Pour l'e-mail, ajoute `RESEND_API_KEY` et `URL_BACKOFFICE` côté
Railway.

> Ces clés identifient **Kaissi**, pas un restaurant : elles valent pour tous
> les établissements, et on ne les régénère que si la clé privée a fuité — les
> abonnements existants deviendraient tous invalides.

**Ce que le gérant fait, sur son téléphone ou son poste**

2. **Configuration → Stock**. Sous le titre : **« 🔔 M'alerter des ruptures
   sur ce navigateur »**. Clique, puis accepte la demande du navigateur.

**Attendu** : le bouton devient *« Alertes actives sur ce navigateur —
désactiver »*.

3. Refais-le **sur son téléphone**, avec le même compte.

**Attendu** : les deux fonctionnent. Un abonnement vaut pour un
**navigateur**, pas pour une personne : couper celui du comptoir ne doit pas
taire celui de la poche.

**Voir une alerte arriver**

4. Mets un produit à **0** (Stock → *Compter*), ou vends-en le dernier.

**Attendu** : dans le quart d'heure, une notification **« Rupture — ‹produit›
»**, et un e-mail aux gérants et administrateurs. Cliquer dessus ouvre
directement l'écran **Stock** — pas l'accueil.

> Pour ne pas attendre pendant une démonstration : `SYNC_ALERTES_MINUTES=1`
> sur Railway, le temps de l'essai.

5. **Laisse le produit à zéro** et attends le tour suivant.

**Attendu** : **plus rien.** Une alerte part **une seule fois**. Une alerte
qui revient toutes les quinze minutes se coupe — et on coupe alors aussi les
vraies.

6. Fais une **réception** de ce produit, puis remets-le à zéro.

**Attendu** : une nouvelle alerte. C'est la clôture à la réception qui
autorise la suivante ; sans elle, un produit alerté une fois ne le serait
plus jamais.

7. Mets **trois** produits à zéro d'un coup.

**Attendu** : **une seule** notification — « 3 ruptures de stock », les trois
noms dans le corps. Vingt vibrations à la suite le jour d'un inventaire, ce
sont vingt notifications qu'on balaie.

8. Connecte-toi en **caissier** et regarde ta boîte.

**Attendu** : rien. Seuls **gérants et administrateurs** reçoivent : un
caissier ne commande pas les réapprovisionnements.

**Les cas qui n'alertent pas, et c'est voulu**

| Situation | Alerte ? | Pourquoi |
|---|---|---|
| Produit avec **« Rupture auto » décochée** | non | Ce comptage n'est qu'indicatif ; alerter dessus ferait exactement le bruit que ce réglage sert à éteindre. |
| Produit **sans seuil**, quantité 4 | non | Rien n'a été franchi. |
| Produit déjà en rupture qui tombe à **−3** | non | Le négatif est le cas normal d'une vente hors ligne arrivée après coup, pas une nouvelle information. |
| Produit passé de **« faible » à zéro** | **oui** | Ce sont deux nouvelles différentes. |
| **Aucune clé VAPID** configurée | pas d'envoi | L'écran Stock, lui, continue de tout montrer : rien ne dépend d'un fournisseur tiers. |

> **Pour les allumer réellement** — générer les clés VAPID, les poser sur
> Railway et sur Vercel, s'abonner depuis un téléphone, et vérifier :
> [`notifications.md`](notifications.md), dix minutes une seule fois.

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

### G. Ouvrir un accès au back-office — sans terminal

C'était la friction la plus visible : donner un écran à ton cuisinier
demandait de créer le compte dans le tableau de bord Supabase, PUIS de lancer
`pnpm sync:acces`. Deux outils d'administrateur système pour une décision de
patron.

**Ce que l'exploitant pose UNE fois** (toi, pas le client) : sur Railway,
la variable `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Project Settings → API →
`service_role`). Sans elle, l'écran le dit en toutes lettres et
`pnpm sync:acces` reste le chemin.

**Ce que fait le gérant :**

1. **Employés** → clique **Gérer** sur un employé.
2. Bloc **Accès au back-office** : son adresse est préremplie, tape un mot de
   passe (8 caractères au moins) → **Ouvrir l'accès**.

**Attendu** : *« Compte créé. … peut se connecter au back-office dès
maintenant. »* La personne se connecte immédiatement — aucun e-mail de
confirmation à attendre, aucune boîte à relever.

3. Le même employé, plus tard : le bloc affiche **« se connecte déjà avec … »**
   et propose **Changer le mot de passe**. C'est la réponse à « j'ai perdu le
   mot de passe du cuisinier ».

4. Essaie, en **gérant**, d'ouvrir un accès avec le rôle **gérant**.

**Attendu** : refus. *Un gérant exploite, un administrateur distribue* — la
frontière est la même ici que dans RLS (migration 0024), sinon cette route
serait le moyen de la contourner.

> **Le PIN et le mot de passe ne sont pas la même chose**, et l'écran les
> montre côte à côte pour que la différence saute aux yeux : le **PIN** dit
> qui agit sur un terminal, le **mot de passe** ouvre le back-office. Un
> serveur en salle n'a besoin que du premier.

> **Où vit la clé qui crée les comptes.** Dans le service de synchronisation,
> jamais dans le back-office ni dans l'APK. Le back-office l'appelle avec le
> jeton de ta session, et le service relit tes droits **en base** — il ne
> croit pas le navigateur sur parole.

### H. Le PIN et « Suspendre » remarchent

Deux boutons échouaient, pour la même raison invisible.

1. **Employés → Gérer → Réinitialiser le PIN.**

**Attendu** : *« Code PIN réinitialisé. »* Avant, un bandeau rouge
« permission denied for table users » — et rien d'autre à quoi se raccrocher.

2. **Suspendre**, puis **Réactiver**.

**Attendu** : un message de confirmation à chaque fois, et l'étiquette d'état
qui change.

> **La cause était la même, et elle est instructive.** Un gérant n'a pas le
> droit d'écrire *toutes* les colonnes de `users` — le privilège est posé
> colonne par colonne (migration 0014), pour qu'il ne puisse pas changer un
> e-mail ni déplacer quelqu'un vers une autre organisation. Le back-office
> écrivait `updated_at` « en passant », qui n'est pas dans la liste : Postgres
> refusait alors l'écriture **entière**, avec un message qui ne nommait ni la
> colonne ni le mot « colonne ». La correction n'est pas d'élargir le
> privilège — c'est de ne pas écrire cette colonne : un déclencheur la tient
> déjà.
>
> Et « Suspendre » ne disait rien parce que son résultat était **jeté** :
> un bouton qui ne répond ni oui ni non, on le presse trois fois avant de
> conclure que le logiciel est cassé.

---

### I. Le stock : la case mystérieuse, et les groupes

**LA CASE « auto » A CHANGÉ DE PLACE (et enfin de libellé)**

1. **Stock** → une ligne de produit. Sous le bouton d'état, la petite case
   `auto` **n'y est plus**.
2. Clique **Ajuster** : elle est dans le tiroir, avec sa phrase entière —
   *« Retirer ce produit de la carte dès qu'il atteint zéro, et l'y remettre à
   la première réception. »*

> **Pourquoi elle était incompréhensible.** Deux caractères sans phrase, sous
> un bouton qui dit déjà autre chose. On la décochait sans le savoir — et le
> produit restait vendable à zéro, ce qui ressemblait alors à une panne.
> C'est exactement ce qui était arrivé à *Ojja merguez* sur ta base : stock
> **−2**, automatisme **coupé**, donc toujours en vente. Je l'ai laissé tel
> quel : c'est maintenant visible, et c'est ton réglage.

3. Sur une ligne à zéro dont l'automatisme est coupé, la cellule affiche
   **« automatisme coupé »**.

**Attendu** : plus de contradiction à l'écran. « Rupture » et « En stock »
côte à côte sans explication laissaient croire à un bug.

**« EN VENTE » DEVIENT « EN STOCK », ET LES DEUX COLONNES « STOCK » AUSSI**

4. Les en-têtes : la quantité s'appelle **Quantité**, l'état de la carte
   s'appelle **Stock**. Deux colonnes portaient le même nom.

**LE PRODUIT À ZÉRO EST GRISÉ SUR LA CAISSE**

5. Mets un produit à `0` (**Ajuster**, automatisme **coché**), synchronise la
   caisse.

**Attendu** : sur la caisse, la tuile est **grisée, en pointillés, avec
« RUPTURE » en rouge**. Elle reste **cliquable** — et le clic dit *pourquoi* :
« en rupture de stock » ou « retiré de la carte par le gérant ». Un bouton
désactivé ne dit rien, et on tape trois fois dessus.

> **Ce qui retire un produit de la carte, c'est le SERVEUR**, jamais la
> tablette : lui travaille sur le stock calculé à l'instant, une tablette
> hors ligne sur un souvenir vieux de trois heures. La caisse ne fait
> qu'appliquer, comme pour un changement de prix.

**LES PRODUITS SONT RANGÉS PAR GROUPES**

6. **Menu**, puis **Stock** : les produits sont désormais **sous le nom de
   leur catégorie** — Boissons ensemble, Pizzas ensemble, Plats ensemble.

**Attendu** : l'ordre des groupes suit celui des catégories au Menu (les
flèches ↑↓), pas l'ordre alphabétique. La colonne « Catégorie » a disparu :
elle répétait la même valeur sur toutes les lignes d'un groupe.

> Un produit dont la catégorie a été archivée n'est pas perdu : il apparaît
> sous **« Catégorie archivée »**, à la fin. Le faire disparaître de l'écran
> où l'on va justement pour le reclasser serait le pire choix.

---

### J. Les rapports, aux noms et à la forme de Loyverse

La colonne de gauche a changé. Elle porte désormais **exactement** les
intitulés de Loyverse — ce n'est pas de l'imitation, c'est le vocabulaire que
le marché connaît : un restaurateur qui vient de Loyverse cherche
« Récapitulatif des ventes », pas « Ventes ».

| Groupe | Écrans |
|---|---|
| **Rapports** | Récapitulatif des ventes · Ventes par article · par catégorie · par employé · par mode de paiement · Reçus · Réductions · Périodes de travail |
| **Articles** | Liste d'articles · Catégories · Stock · Réductions |
| **Configuration** | Employés · Clients |

> **« Tickets » s'appelle « Reçus ».** L'ancienne adresse `/‹resto›/tickets`
> redirige : un favori ou un lien envoyé par message continue de marcher.

**LES TROIS FILTRES, EN TÊTE DE CHAQUE RAPPORT**

1. Ouvre **Rapports → Récapitulatif des ventes**.
2. En haut : les raccourcis, un **vrai calendrier**, une **tranche horaire**,
   et un **filtre par employé**.
3. Clique sur le bouton de dates : un **mois s'ouvre**. Premier clic, le jour
   de début ; second clic, le jour de fin — la période s'applique et le
   panneau se referme.

**Attendu** : les jours à venir sont éteints (un rapport sur demain rendrait
des totaux justes sur une durée fausse), aujourd'hui est cerclé, et la période
en cours de choix se peint **pendant** qu'on survole. Un champ où l'on tape
« 09/07/2026 » obligeait à traduire « la semaine dernière » en chiffres avant
de pouvoir la demander.

4. Choisis `12 h → 15 h`.

**Attendu** : tous les chiffres de l'écran ne portent plus que sur le service
du midi. Les heures sont celles de **ton** établissement — pas UTC, ce qui
ferait basculer un service de midi dans la tranche du matin.

5. Change de rapport : les filtres **suivent**, ils sont dans l'adresse. Copie
   l'URL, envoie-la : elle rouvre exactement le même rapport.

**LE BANDEAU DE TÊTE**

6. Cinq nombres : **Ventes brutes → Remboursements → Réductions → Ventes
   nettes → Marge brute**.

**Attendu** : ce n'est pas une liste, c'est une **soustraction**. Lue de
gauche à droite, elle répond à « pourquoi le net n'est pas le brut », qui est
la première question devant un rapport.

7. Sous chaque nombre, l'**écart** avec la période précédente **de même
   longueur** : sept jours se comparent aux sept jours d'avant.

**Attendu** : le vert veut dire *favorable*, pas *en hausse*. Plus de
remboursements ou plus de réductions s'affichent en **rouge** même si le
nombre monte. Et quand la période précédente est vide, il n'y a **rien** —
pas « +100 % », qui serait une division par zéro déguisée.

**LE GRAPHIQUE**

8. Deux menus déroulants : **Colonnes / Aires / Ligne**, et **Jours /
   Semaines / Mois**.
9. Prends « 30 derniers jours », puis « Jours », puis « Semaines ».

**Attendu** : trente colonnes deviennent cinq barres lisibles. Le pas par
défaut suit la longueur de la période — au-delà de deux mois, il se met de
lui-même sur « Mois ».

> **Les trois formes ne disent pas la même chose.** Les colonnes sont
> l'honnêteté par défaut : il n'y a rien entre mardi et mercredi, et une
> colonne l'assume. La ligne relie les points, ce qui affirme une continuité
> qui n'existe pas — mais sur trois mois, la tendance devient la vraie
> question.

**LE TABLEAU**

10. En bas : **Colonnes** (choix des champs), tri par en-tête, pagination
    **10 / 25 / 50 / 100**, et **Exporter**.
11. Passe à 25 lignes, trie par « Marge », puis exporte.

**Attendu** : l'export porte sur **toute la période**, jamais sur la page
affichée. Exporter « la page 2 » est le genre de piège qu'on ne découvre
qu'en rapprochant deux totaux qui ne collent pas.

**VENTES PAR ARTICLE (§13.2)**

12. **Rapports → Ventes par article**.

**Attendu** : le **Top 5** en tête, puis le graphique — avec une option de
plus, **Circulaire** — puis le tableau complet.

13. Choisis **Circulaire**.

**Attendu** : cinq parts au maximum, la sixième s'appelle **« Autres (n) »**,
et chaque part porte son **nom** et son **pourcentage** à côté.

> **Pourquoi ces couleurs-là, qui ne sont pas la menthe de la marque.** Ici
> les articles SONT le sujet : c'est de l'identité, pas de la grandeur. Une
> seule teinte déclinée en six valeurs se lit très mal en camembert. La
> palette a été **vérifiée par un validateur** contre ce fond sombre :
> écart perceptuel suffisant en daltonisme, contraste suffisant. Et la
> couleur n'est jamais seule — le nom et le pourcentage sont écrits.

> **La barre dans le tableau a disparu.** Elle répétait le classement que le
> rang disait déjà : « Ojja merguez est premier », écrit deux fois, dont une
> en couleur, dans une colonne qui prenait un tiers de la largeur. C'était
> ton reproche, et il était juste.

**RÉDUCTIONS (§13 et §14.3)**

14. **Rapports → Réductions**.

**Attendu** : combien a été accordé, **quelle part des ventes brutes**,
combien de tickets sont concernés — puis le classement **par employé**, et la
liste des reçus remisés, cliquables.

> **Pourquoi cet écran compte.** Une remise est de l'argent qui sort sans
> qu'aucun billet ne bouge : elle ne laisse ni écart de caisse, ni ligne
> suspecte. Le seul autre moment où on la remarque, c'est quand la marge du
> mois est inexplicablement basse.
>
> Le **motif**, lui, est arrivé : voir **§5 bis K** juste dessous. Le premier
> tableau de l'écran s'appelle désormais **« Par motif »**.

---

### K. Les réductions ont un NOM — de la caisse jusqu'au rapport

Jusqu'ici la caisse enregistrait « −10 % », jamais « pourquoi ». Le rapport
additionnait donc des décisions qui n'ont rien à voir entre elles : un happy
hour de tous les soirs et un geste commercial répété chez la même personne
s'affichaient dans le même total.

**LE RÉFÉRENTIEL — CE QUE LA MAISON PROPOSE**

1. **Articles → Réductions** (le groupe *Articles*, pas *Rapports* — les deux
   écrans portent le même mot, et c'est voulu : ici on **règle**, là-bas on
   **mesure**).
2. Trois réductions sont déjà là : **Happy hour** (10 %), **Personnel**
   (20 %), **Geste commercial** (−2,000 TND).
3. Crée-en une : nom, **Pourcentage** ou **Montant fixe**, la valeur.

**Attendu** : un seul champ de valeur est demandé, celui qui correspond au
type choisi. Une réduction ne peut pas porter les deux — la base le refuse, et
afficher les deux champs laisserait croire le contraire.

4. Renomme « Happy hour » en « Apéro du soir ».

**Attendu** : le message le dit — **les ventes déjà encaissées gardent
l'ancien nom**. Le libellé est **recopié** dans la vente au moment de
l'encaissement, jamais joint. Un rapport qui change quand on renomme un
réglage n'est plus un historique. L'identifiant, lui, reste : les deux noms se
regroupent sur une seule ligne.

5. Archive-en une.

**Attendu** : elle disparaît des propositions de la caisse et passe dans
« Archivées », avec un bouton **Remettre**. Elle n'est pas supprimée : les
ventes passées la mentionnent toujours, et le rapport continue de les
regrouper.

**SUR LA CAISSE**

6. Sur la tablette (ou `pnpm pos:dev`), ouvre une table, ajoute un article,
   puis **Remise**.

**Attendu** : les réductions de la maison **en premier**, avec leur valeur —
un geste, pas une saisie. En dessous, **« Autre remise… »** ouvre la grille
libre 0 / 5 / 10 / 15 / 20 / 25 / 50 %.

> **Pourquoi la saisie libre reste là.** Un geste commercial n'entre dans
> aucune case, et il se décide devant un client qui attend. Obliger à créer
> une réduction au back-office avant de pouvoir l'accorder, c'est refuser de
> vendre pour une question de rangement.

7. Choisis « Happy hour », puis encaisse.
8. Synchronise (**Synchroniser maintenant** dans Diagnostic).

**Attendu** : le référentiel descend par le **catalogue** — le canal qui porte
déjà les prix, avec son curseur `seq` bigserial. Aucune nouvelle route de
synchronisation : une réduction créée au back-office arrive sur la caisse
exactement comme un changement de prix.

**DANS LE RAPPORT**

9. **Rapports → Réductions**.

**Attendu** : un premier tableau **« Par motif »** — la réduction, le nombre
de ventes concernées, le montant, la part des réductions. Le classement **par
employé** et la liste des reçus remisés sont toujours dessous : le motif dit
*quoi*, l'employé dit *qui*, et c'est le croisement des deux qui parle.

10. Fais une remise **sans** la choisir dans la liste (« Autre remise… »).

**Attendu** : elle apparaît sous **« Sans motif »**. La faire disparaître
donnerait un total juste et une répartition fausse.

> **Ce que ces réductions ne changent PAS : les droits.** Le plafond de remise
> reste celui du **rôle**. Une réduction déclarée à 50 % demandera toujours
> l'autorisation d'un responsable — elle nomme la décision, elle ne
> l'autorise pas.

---

### L. Le PIN, la rupture et les départs — trois corrections

**UN CODE PIN CHANGÉ PREND EFFET SUR LA TABLETTE**

1. **Configuration → Employés → Gérer** sur un caissier → **Réinitialiser le
   PIN**.
2. Sur la caisse : **Diagnostic → « Ne pas attendre — envoyer maintenant »**.
3. Regarde la ligne **« Dernier changement reçu »** : elle porte l'heure qu'il
   est, et le nombre d'employés connus.
4. Verrouille, puis reprends le poste avec le **nouveau** code.

**Attendu** : le nouveau code ouvre, **l'ancien est refusé**.

> **Pourquoi cette ligne « Dernier changement reçu » existe.** « Dernière
> synchronisation » dit qu'il y a du réseau — pas que le catalogue a bougé.
> Les deux se ressemblent exactement, et c'est précisément ce qu'on regarde
> quand un code tout juste changé est refusé : la question n'est pas « ai-je
> Internet », c'est « **ce changement-là** est-il arrivé jusqu'ici ».
>
> Le chemin fait quatre sauts — le back-office écrit le hachage, un
> déclencheur journalise une ligne par établissement, la tablette tire la
> page, le miroir l'applique. Les quatre sont désormais couverts par des
> tests, dont celui qui compte : **l'ancien code cesse de marcher**. Un
> ancien code qui continue d'ouvrir la caisse, c'est un employé parti qui
> entre encore.

**UN PRODUIT ÉPUISÉ QUI RESTE EN VENTE LE DIT**

5. **Articles → Stock**, mets un produit à **0**, puis rouvre « Ajuster » et
   **décoche** « Retirer ce produit de la carte dès qu'il atteint zéro ».

**Attendu** : la ligne affiche « En stock », et **juste en dessous**, une
étiquette rouge : **« Épuisé, toujours en vente »**, avec un bouton
**« Rétablir le retrait automatique »**.

6. Clique ce bouton.

**Attendu** : le produit sort de la carte immédiatement, et la caisse le
grise à sa prochaine synchronisation.

> **Ce que cette ligne remplace.** Elle disait « automatisme coupé » en petit
> gris, sous un bouton affichant « En stock » alors que la quantité était à
> −3. Trois signaux qui se contredisent, et c'est le plus discret qui
> expliquait les deux autres — on lisait « En stock » et on concluait à une
> panne. Le mot qui compte n'est pas le réglage, c'est sa **conséquence** : le
> serveur va continuer d'en prendre.

**UN EMPLOYÉ QUI S'EN VA**

7. **Configuration → Employés → Suspendre** quelqu'un.

**Attendu** : il **descend** dans une section repliée, « Ne prennent plus de
poste ». Il ne se lit plus au milieu de l'équipe du jour, mais il reste à un
clic — on réactive quelqu'un qui revient de congé.

8. Déplie la section, et clique **Retirer**.

**Attendu** : une confirmation, puis il disparaît de la liste.

> **Ce n'est pas une suppression, et ça ne peut pas en être une.** Ses ventes
> portent son identifiant : `orders.opened_by`, `shifts.closed_by`, le journal
> d'audit. L'effacer rendrait anonymes des encaissements déjà faits, et un
> rapport de la semaine dernière afficherait « — » là où il y avait un nom.
> Ce qui part, c'est **l'appartenance** — et c'est réversible.
>
> Le bouton n'apparaît **que** pour un employé déjà suspendu : un départ se
> décide en deux temps. Sur la même ligne que « Gérer », il se cliquerait par
> erreur, un jour de service.

---

### M. Clients : qui vient au restaurant

`orders.customer_id` existait depuis le premier schéma, sans table en face.
Elle existe maintenant — et la caisse sait à qui elle vend.

**LE CARNET**

1. **Configuration → Clients** (juste sous « Employés », comme dans Loyverse).
2. Trois fiches sont déjà là : Salem Haddad, Amine Ben Youssef, et une
   « Dame de la 4 » **sans téléphone**.
3. Cherche « 20 12 » dans le champ de recherche.

**Attendu** : Salem sort. La recherche porte sur le **nom, le téléphone et
l'e-mail à la fois** — au comptoir, on tape ce qu'on a sous la main, pas ce
que le logiciel attend.

4. Ajoute un client avec le numéro **20 123 456**, déjà pris.

**Attendu** : un refus qui explique — *« Un client porte déjà ce numéro… ouvrez
sa fiche plutôt que d'en créer une seconde »*. Deux fiches pour la même
personne partagent ses visites en deux, et **aucun des deux totaux n'est
vrai**.

> **Une fiche sans téléphone reste légitime.** « Dame de la 4 » n'en a pas, et
> une seconde fiche sans numéro ne sera pas refusée : l'unicité ne porte que
> sur les numéros réellement saisis.

**LES VISITES SE CALCULENT**

5. Sur la caisse, ouvre une table, ajoute un article, puis **Client** →
   **Salem Haddad**. Encaisse. Synchronise.
6. Reviens sur **Clients**.

**Attendu** : « Total des visites » passe à 1, « Total dépensé » au montant de
la vente, et « Première visite » à aujourd'hui.

> **Rien de tout cela n'est stocké.** C'est une vue sur les commandes closes
> (migration 0031). Un compteur incrémenté par déclencheur devrait défaire
> exactement ce qu'il a fait à chaque reprojection — y compris quand une
> commande passe « annulée » — et dériverait en silence. C'est la même
> décision que pour le stock, et pour la même raison.

7. Renomme la fiche (« Salem Haddad Becha »), puis rouvre le **reçu** de la
   vente.

**Attendu** : le reçu porte toujours **l'ancien nom**. Il est recopié au
moment de la vente, jamais joint — comme le libellé d'une réduction. Un reçu
qui change après coup n'est plus un reçu.

**IMPORTER, EXPORTER**

8. **Exporter** : le CSV contient **tout le carnet**, pas la page affichée.
9. Ouvre-le, ajoute deux lignes, réimporte-le par **Importer**.

**Attendu** : *« 2 client(s) ajouté(s), 3 déjà connu(s) et laissé(s)
intact(s) »*. L'import **n'écrase jamais** une fiche existante — sinon un
fichier réimporté après quelques corrections effacerait en silence ce qu'on
vient de saisir. Et les en-têtes de l'export sont ceux de l'import :
l'aller-retour par un tableur marche tel quel.

10. Importe volontairement une ligne sans nom.

**Attendu** : elle est refusée **nommément** (« Ligne 4 : nom vide »), et les
autres entrent. Un fichier de trois cents clients contient toujours une ligne
bancale ; tout refuser pour elle obligerait à la chercher à l'œil dans un
tableur.

**CE QUE LA CAISSE NE FAIT PAS**

11. Sur la caisse, ouvre **Client** : il n'y a pas de bouton « Nouveau ».

**Attendu**, et volontaire : le protocole de synchronisation ne remonte que
des **événements de commande**. Une fiche créée sur la tablette n'aurait aucun
chemin pour monter, et resterait invisible au back-office et aux autres
terminaux. Un bouton qui produit une fiche que personne d'autre ne verra est
pire que pas de bouton. Rattacher un client existant, en revanche, marche
**hors ligne** — c'est un événement de commande comme un autre.

---

### N. Ouvrir un DEUXIÈME établissement

Jusqu'ici, un seul restaurant. Le schéma est multi-établissements depuis le
premier jour — `organization_id` **et** `restaurant_id` sur presque chaque
table — mais rien ne permettait d'en créer un second depuis l'interface.

1. Connecte-toi avec un compte **administrateur**.
2. Colonne de gauche, tout en bas : **Administration → Établissements**.

**Attendu** : un gérant ne voit pas cette entrée — et s'il tape l'adresse à la
main, la page répond **« introuvable »**, pas « accès refusé ». Il n'a pas à
apprendre que l'écran existe.

3. **Ouvrir un établissement** : un nom, l'établissement dont on reprend les
   réglages, le fuseau, l'heure de bascule.

**Attendu** : l'établissement apparaît immédiatement dans « Vos
établissements », et le message dit combien de réglages ont été repris.

**CE QUI EST COPIÉ, ET CE QUI NE L'EST PAS**

| | Copié ? | Pourquoi |
|---|---|---|
| Taux de taxe | **oui** | sans eux, la caisse ne peut RIEN encaisser |
| Modes de paiement | **oui** | idem — pas même une vente en espèces |
| Postes de préparation | **oui** | un produit sans poste n'apparaît sur aucun écran de cuisine, et cela ne se voit qu'en plein service |
| **La carte** | **non** | on ne devine pas un menu. Ouvrir avec les plats d'un autre restaurant serait plus long à corriger qu'à saisir |
| Les employés | **non** | chacun est rattaché à SON établissement (§9) |
| Le stock, les clients, les ventes | **non** | ce sont des données d'exploitation |

> **Les taux recopiés sont ceux que le modèle utilise déjà**, et c'est
> délibéré : écrire des taux « standard » dans le code reviendrait à affirmer
> une règle fiscale depuis un logiciel. Ce dépôt s'y refuse — c'est un des
> points marqués ⚠ à valider avec un expert-comptable.

4. Va dans **Articles → Liste d'articles** du nouvel établissement, et crée un
   produit. Puis **Configuration → Employés**, et embauche quelqu'un.

**Attendu** : tout fonctionne comme sur le premier. Les deux établissements
sont étanches — RLS ne rend à chacun que ses propres lignes, et c'est vrai
même pour toi qui les administres tous les deux : change d'établissement dans
l'en-tête, les chiffres changent complètement.

> **Pourquoi cet écran passe par le service de synchronisation.** La toute
> PREMIÈRE appartenance à un établissement ne peut pas être créée sous RLS :
> il faudrait déjà y appartenir pour s'y rattacher. Un restaurant créé sans
> appartenance serait invisible de tout le monde — y compris de son auteur —
> et irrattrapable depuis l'interface. Le service, lui, parle à Postgres avec
> un rôle privilégié et pose les deux d'un coup, dans une transaction. Il ne
> croit pas le back-office sur parole pour autant : il relit en base que
> l'appelant est bien administrateur, et **dérive l'organisation de là**,
> jamais du corps de la requête.

**APPAIRER LA CAISSE DU NOUVEAU RESTAURANT**

5. Sur une seconde tablette (ou `pnpm pos:dev` dans une autre fenêtre
   privée) : **Diagnostic → Appairer**, avec l'e-mail et le mot de passe du
   gérant, puis choisis le nouvel établissement.

**Attendu** : elle reçoit son propre préfixe de tickets. Deux terminaux de
deux restaurants différents ne peuvent pas produire le même numéro.

---

### O. La rupture prévient TOUT DE SUITE

6. Mets un produit suivi à **1** (Articles → Stock → Ajuster).
7. Vends-le sur la caisse, et synchronise.

**Attendu** : la notification arrive dans les **secondes** qui suivent — pas
au prochain quart d'heure.

> **Ce qui a changé, et pourquoi ça se voyait.** Le produit sortait de la
> carte tout de suite ; la notification, elle, attendait le balayage
> périodique. Le gérant regardait donc un écran qui lui annonçait la rupture
> et un téléphone qui ne sonnait pas — et en concluait, à raison, que les
> notifications ne marchaient pas.
>
> La reprojection SAIT qu'elle vient de changer la carte : c'est le seul
> instant où l'on sait qu'il y a peut-être quelque chose à annoncer. Elle
> réveille donc le balayage, au lieu de le laisser dormir.

8. Vends coup sur coup trois produits différents qui tombent à zéro.

**Attendu** : **une seule** notification, « 3 ruptures de stock ». Les
déclenchements sont groupés sur quelques secondes — cinq notifications à la
suite se coupent, et on coupe alors aussi les vraies.

> **Le balayage périodique n'a pas disparu**, et il ne doit pas : il rattrape
> ce qu'un service redémarré au mauvais moment aurait manqué, et les seuils
> franchis par un mouvement de stock saisi au back-office. C'est le filet,
> pas le mécanisme principal.

---

### P. L'audit de production — les trois choses qui se VOIENT

L'audit complet est dans **[`docs/audit-production.md`](audit-production.md)** :
ce qui a été corrigé, ce qui a été mesuré puis écarté, et ce qui reste. La
plupart de ses corrections sont invisibles à l'usage — c'est le but. Trois
d'entre elles se vérifient à l'écran, en cinq minutes.

#### P.1 — Un rapport de trois mois s'affiche sans rien charger

1. Ouvre n'importe quel rapport (Rapports → **Ventes par article**) sur la
   période la plus large que le calendrier accepte.

**Attendu** : les chiffres s'affichent, vite, et **sans aucun bandeau**.

> **Ce qui a changé depuis l'audit.** Le chargement des rapports lisait les
> commandes SANS limite : sur un restaurant à sa deuxième année, une période
> longue demandait des dizaines de milliers de lignes d'un coup, et la page
> échouait. Un plafond avait été posé, avec un bandeau qui disait « les
> totaux sont partiels » — un total incomplet qui se déclare reste
> utilisable, un total incomplet silencieux ne l'est pas.
>
> Le plafond n'a plus lieu d'être : **c'est PostgreSQL qui additionne
> maintenant**, et il ne renvoie qu'une trentaine de nombres au lieu de
> cinquante mille lignes. Sept écrans sur neuf ne chargent plus une seule
> ligne de vente.

2. Va sur **Reçus**, avec la même période.

**Attendu** : si la période dépasse 50 000 tickets, le bandeau apparaît —
**là**, et seulement là.

> **Pourquoi le bandeau survit sur cet écran-là.** « Reçus » affiche une
> LISTE de tickets, un par un : une ligne écrite y est une ligne lue, et
> l'agréger n'aurait aucun sens. C'est le seul cas où le plafond protège
> encore quelque chose.
>
> 50 000 n'est pas un nombre choisi au hasard : un restaurant à 55 tickets
> par jour en fait 20 075 par an. Le plafond laisse donc passer un an entier.

#### P.2 — Une page qui casse affiche un écran, pas un mur blanc

3. Va sur une adresse qui n'existe pas : `…/‹resto›/nimportequoi`.

**Attendu** : une page « Page introuvable » en français, avec un lien de
retour — et non l'écran par défaut de Next.js en anglais.

> Il existe aussi un écran d'erreur (avec un bouton « Réessayer ») pour le
> cas où une page échoue vraiment. Avant l'audit, une erreur rendait un
> texte anglais et un « Digest: 857891440 » — exactement ce qui avait été
> remonté en production sur six écrans de rapports. Le digest reste affiché,
> en petit : c'est LUI qui permet de retrouver la trace côté serveur.

#### P.3 — Les tentatives sur les identifiants sont limitées

4. Sur la page de connexion du back-office, ou sur l'appairage d'une
   tablette, tape volontairement un mauvais mot de passe une dizaine de fois
   de suite.

**Attendu** : au bout de quelques essais, la réponse devient « trop de
tentatives », avec un délai avant de pouvoir réessayer.

> **Et ce qui n'est SURTOUT pas limité : `/sync`.** Une tablette qui
> remonte ses ventes après quatre heures hors ligne envoie légitimement des
> centaines de requêtes en rafale. La limiter, c'est perdre des
> encaissements pour se protéger de rien : ce chemin est déjà authentifié
> par un jeton d'appareil révocable. Le limiteur ne couvre que les chemins
> où l'on peut ESSAYER un secret — appairage, comptes, mots de passe.

---

### Q. Trois pannes remontées du terrain, et ce qu'on en a fait

#### Q.1 — L'alerte de rupture arrive AUSSI sans changement de carte

1. Choisis un produit suivi, mets-le à **6** et fixe son seuil d'alerte à **5**
   (Articles → Stock → Ajuster, puis le seuil).
2. Vends-en **un** sur la caisse, et synchronise.

**Attendu** : la notification arrive dans les **secondes**. Le produit reste
en carte — il en reste cinq, on peut encore le vendre.

> **Ce qui ne marchait pas, et pourquoi ça ne se voyait pas.** Le réveil de
> l'alerte était accroché à « la carte vient de changer » : un produit retiré
> parce qu'il tombait à zéro. C'est vrai d'une rupture, et faux de tout le
> reste. Deux cas courants attendaient donc le balayage suivant — jusqu'à un
> quart d'heure — sans que rien nulle part ne l'explique :
>
> - **le seuil bas franchi** : « il ne reste qu'une pizza » est une alerte, et
>   pourtant rien ne sort de la carte ;
> - **un produit retiré à la main** qui tombe à zéro : l'automatisme ne défait
>   jamais une décision humaine, donc il ne bouge rien.
>
> Le réveil pose maintenant la question du balayage lui-même — « y a-t-il une
> alerte à ouvrir sur ces produits ? » — avec **sa** requête. Un seul
> prédicat pour les deux : deux copies auraient fini par diverger, et on
> réveillerait alors sur des cas que le balayage ignore.

3. Refais l'essai sur un produit **retiré à la main** (Articles → le produit →
   « Retirer de la carte »), puis vends-le jusqu'à zéro.

**Attendu** : la notification arrive, et le motif reste « retiré à la main ».

#### Q.2 — Administration → Établissements s'affiche

4. En tant qu'**administrateur** : menu latéral → **Établissements**.

**Attendu** : la liste de tes établissements, et le formulaire d'ouverture
avec sa liste de fuseaux horaires.

> **Ce qui cassait.** La page rendait l'écran d'erreur, sans un mot de plus.
> La liste des fuseaux était déclarée dans le fichier des *actions serveur* —
> et un tel fichier ne peut exporter que des fonctions. Next.js remplace tous
> ses autres exports, côté navigateur, par des mandataires : le formulaire
> recevait un mandataire là où il attendait un tableau.
>
> Ni TypeScript, ni `next build`, ni les dix contrôles de la CI ne le
> voyaient — le remplacement a lieu à l'empaquetage, après eux tous. Un test
> le refuse désormais dans **tout** le dépôt.

#### Q.3 — Le build Android dit enfin ce qui ne va pas

5. Avant de construire l'APK : `pnpm verifier:jdk`.

**Attendu** : « JDK 21 — dans la plage éprouvée (17–23) », ou un message qui
nomme ton JDK et donne la commande exacte pour en changer.

> **Ce qu'on voyait avant** : `BUG! exception in phase 'semantic analysis' …
> Unsupported class file major version 69`. Rien ne nomme Java, rien ne dit
> 25, et le mot « BUG! » accuse le projet alors que la cause est sur le
> poste. Le nombre se traduit en retirant 44 : 69 − 44 = **JDK 25**, que
> Gradle 8.11 ne sait pas lire.
>
> Le contrôle ne pouvait pas vivre dans Gradle : l'échec a lieu en compilant
> `settings.gradle` lui-même, donc avant que la moindre de nos lignes ne
> s'exécute. Il est posé devant, dans les commandes du dépôt. Le détail
> complet est dans [`docs/stores.md`](stores.md).

6. Puis : `pnpm verifier:jdk --ecrire`.

**Attendu** : la ligne est écrite dans **ton** `~/.gradle/gradle.properties`,
et le script te le dit — **même si ton JDK est déjà le bon**.

> **Le silence qui a fini par casser un fichier versionné.** Sur un poste
> dont le JDK du PATH convenait, `--ecrire` n'écrivait rien… et ne disait
> rien non plus : le script sortait sur « ✓ JDK 21 » avant même de regarder
> l'option. On cherche alors ailleurs — et l'endroit où l'on cherche, c'est
> `settings.gradle`, le seul fichier que Gradle nomme dans son erreur. Le
> chemin du JDK y a atterri, et Gradle a répondu :
>
> ```
> settings file '…\apps\pos\android\settings.gradle': 8:
>   Unexpected character: '"' @ line 8, column 1.
>      "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"
> ```
>
> Deux corrections. `--ecrire` fait maintenant ce qu'on lui demande, ou
> explique pourquoi il ne peut pas — jamais rien. Et `pnpm verifier:jdk`
> contrôle `settings.gradle` **avant** le JDK : ce fichier est versionné, une
> ligne de ce genre casserait la construction de tous les autres postes.
>
> Le réglage vaut pour **tous** les projets Gradle du poste : c'est pour cela
> qu'il n'est jamais posé sans qu'on le demande, et que la ligne écrite dit
> comment la retirer.

7. Pour voir le garde-fou à l'œuvre : ajoute une ligne `"C:\un\chemin"` à
   la fin de `apps/pos/android/settings.gradle`, puis relance
   `pnpm verifier:jdk`.

**Attendu** : il nomme la ligne, son numéro, et donne la réparation
(`git checkout -- apps/pos/android/settings.gradle`). Ce contrôle tourne
aussi en CI, sur le fichier réel du dépôt.


---

### Q bis. Le back-office ET la caisse ont la tête de Digital Fidelity

1. Ouvre n'importe quel écran du back-office.

**Attendu** : une colonne vert forêt à gauche, un contenu **clair** —
crème, halo menthe en haut à gauche, terracotta en bas à droite — des cartes
blanches, et des icônes au trait dans le menu. Plus aucun emoji.

2. Passe la souris sur une entrée du menu, puis clique-la.

**Attendu** : au survol, une barre terracotta pousse à mi-hauteur à gauche du
lien, un voile orange l'éclaire et il glisse de trois pixels ; sur la page
courante, la barre est à pleine hauteur et l'icône passe orange.

> **Pourquoi le contenu est passé au clair.** Le back-office était vert sombre
> de bout en bout, comme la caisse — et c'était un raisonnement faux. Une
> tablette est lue debout, en salle, sous des néons : le sombre y repose
> l'œil. Un back-office se lit **assis**, sur un écran de bureau, à côté d'un
> tableur ouvert et de documents blancs. Dans ce contexte le sombre fatigue,
> et les tableaux de chiffres — l'essentiel de ces écrans — se lisent moins
> bien. Digital Fidelity avait déjà tranché ainsi ; on reprend sa charte
> jeton par jeton, pour que les deux produits de la marque ne se ressemblent
> pas « à peu près ».
>
> **Trois couleurs sont devenues illisibles d'un coup, et aucune n'a
> protesté.** L'or de la version sombre tombait à 2,3:1 sur blanc, le vert de
> succès à 1,3:1, le rouge à 2,6:1. Elles s'affichaient encore ; elles ne se
> lisaient plus. C'est la panne de couleur typique — rien ne casse, et on ne
> s'en aperçoit qu'en regardant l'écran de quelqu'un d'autre.
> `apps/backoffice/src/app/palette.test.ts` LIT désormais la feuille de
> styles et refuse tout jeton sous 4,5:1 sur les surfaces où il est
> réellement posé, colonne sombre comprise. Il vérifie aussi les six teintes
> du camembert — contraste sur blanc, et séparation en **deutéranopie**.
>
> **Deux défauts de mise en page que le fond clair a révélés**, tous deux
> antérieurs : les cinq écrans sans colonne (connexion, choix
> d'établissement, administration, page introuvable, page d'erreur) étaient
> décalés de 16 rem vers la droite contre un vide ; et la barre du haut de
> l'administration n'avait **aucun style** — ni `.barre`, ni `.marque`
> n'existaient dans la feuille. Sur fond uni, l'un passait pour une marge
> large et l'autre pour une sobriété voulue.

3. Réduis la fenêtre sous 960 px.

**Attendu** : la colonne se replie derrière une barre **vert forêt** portant
« ☰ Menu » ; le halo menthe repart alors du bord de l'écran, et le tiroir
ouvert laisse voir la marque au lieu de la cacher sous la barre.

4. Ouvre la **caisse** (`pnpm pos:dev`), à côté.

**Attendu** : le **même** habillage. Bandeau vert forêt en haut, zone de
travail claire, cartes blanches, terracotta sur l'écran courant. Un
restaurateur qui passe de ses rapports à sa caisse voit un seul produit.

> **La caisse aussi, et l'argument qui semblait s'y opposer.** Sa feuille de
> styles disait « contraste élevé — écran de tablette sous les néons d'un
> snack ». L'argument tient toujours — et c'est justement pourquoi le clair ne
> le trahit pas : l'anthracite sur blanc donne **16,7:1**, là où l'ivoire sur
> vert profond en donnait 14,0. On ne perd pas de contraste, on en gagne.
>
> ⚠ La réserve, réelle : un écran clair en salle le soir éblouit davantage.
> C'est la luminosité de la tablette qui règle cela, comme sur Loyverse,
> Square et Toast, qui sont tous clairs. Si le terrain dit le contraire, tout
> est dans les jetons en tête de `apps/pos/src/styles.css` : rebasculer coûte
> ce bloc-là, rien d'autre.

5. Clique une catégorie, puis **Diagnostic**.

**Attendu** : la catégorie courante porte un anneau émeraude et son libellé à
l'accent ; l'onglet **Diagnostic** porte un trait terracotta sous le mot.

> **Deux indications étaient fausses, et le fond clair les a révélées.**
>
> La catégorie active se peignait avec `--surface-2`. Sur fond sombre, ce
> jeton est plus CLAIR que le fond : l'onglet courant paraissait soulevé, et
> c'était juste. Sur fond clair, le beige est plus SOMBRE que le blanc des
> onglets voisins — le même code faisait donc paraître l'onglet courant
> **enfoncé, presque désactivé**. Le report d'un jeton avait retourné le sens
> de l'indication.
>
> Et les quatre liens du bandeau — Salle, Sync, Diagnostic, Clôturer — se
> ressemblaient trait pour trait quel que soit l'écran ouvert. Depuis
> Diagnostic, rien ne disait qu'on y était.

6. Regarde le **coin bas-droit** de n'importe quel écran.

**Attendu** : le halo terracotta, et **aucun texte dessus**.

> **Le dégradé est un fond, pas un support de texte** — mesuré, pas supposé.
> Au plus dense du halo terracotta, AUCUNE couleur de texte atténué ne tient
> le 4,5:1 : même assombrie jusqu'à `#333D39`, on plafonne vers 3,7:1. Ce
> n'est donc pas un réglage de couleur, c'est une règle de structure, et c'est
> celle de Digital Fidelity : tout ce qui porte du texte est posé sur une
> surface opaque.
>
> Le halo MENTHE, lui, pardonne — et c'est heureux, parce que c'est là que se
> pose le titre de chaque écran. `--attenue` a été assombri pour y tenir, ce
> qui a du même coup rattrapé le sous-titre de chaque rapport du back-office,
> qui y était à **2,9:1** sans que rien ne le signale. La barre d'onglets de
> la salle, elle, flottait à même le dégradé : elle a désormais son propre
> fond.
>
> Les deux tests de palette figent la règle, halo compris — y compris par une
> assertion **inversée** qui documente la limite du coin terracotta plutôt que
> de la laisser se redécouvrir.

---

### Q ter. La fiche Play : la page publique, l'icône, les captures

1. Sans être connecté — fenêtre privée — ouvre `/confidentialite` du
   back-office.

**Attendu** : la politique de confidentialité s'affiche. **Pas** l'écran de
connexion.

> **C'est exactement ce que Google teste, et c'est ce qui fait rejeter une
> fiche alors que la page existe.** Le middleware redirige tout visiteur sans
> session vers `/connexion` ; la politique aurait donc rendu un écran de
> connexion au robot de Google. On ne le voit pas soi-même : on ouvre l'URL
> dans son navigateur, on est connecté, la page s'affiche. Le chemin est
> maintenant ouvert **explicitement**, et un test vérifie les deux sens — que
> la politique est publique, et que rien d'autre ne l'est devenu.

2. `pnpm visuels`

**Attendu** : quatre fichiers dans `ressources-store/` — l'icône 512 pour
Play, l'icône 1024 pour l'App Store, la bannière 1024 × 500, et un aperçu.

> **Regarde `icone-48-apercu.png` avant de téléverser quoi que ce soit.** Il
> rend l'icône à 48, 72 et 112 px — 48, c'est sa taille réelle dans la liste
> des applications d'un téléphone. Il a servi immédiatement : la première
> version du dessin exprimait l'épaisseur du trait deux fois à l'échelle.
> Parfaite en 512, un K en fil de fer en 48. Sans cet aperçu, elle partait sur
> le magasin.

3. Dans un terminal : `pnpm pos:build:web` puis
   `pnpm --filter @kaissi/pos preview:web`.
   Dans un autre : `pnpm captures`.

**Attendu** : douze captures — quatre par format — en 1920 × 1080,
2048 × 1152 et 2560 × 1440. Toutes en 16:9, ce que Play exige.

> **Pas besoin d'un téléphone.** Les deux cibles de build servent le MÊME
> bundle : `android` l'empaquette dans l'APK, `web` le sert comme site
> statique. Une capture prise sur la cible web montre au pixel près ce que le
> magasin installera.
>
> **Et le script refuse de travailler sur `pos:dev`.** Cette cible affiche une
> étiquette « démo — mémoire » à côté du nom de l'établissement — sur une
> fiche Play, la mention qui dit au visiteur que ce n'est pas une caisse. Le
> script vérifie son absence avant d'écrire, et s'arrête en disant quoi lancer
> à la place.

---

### R. Ouvrir un deuxième client, et changer une caisse d'établissement

#### R.1 — La caisse suit VRAIMENT le nouvel établissement

1. Au back-office, en administrateur : **Administration → Établissements**,
   ouvrez « Snack Lac 2 ».
2. Saisissez-y un ou deux articles, et embauchez un employé.
3. Sur la caisse : bandeau du haut → **Sync** → « Ré-appairer — ou changer
   d'établissement ». Cet écran est joignable **même sans caisse ouverte** :
   mettre un terminal neuf en service est le premier geste, avant de compter un
   fond de caisse. Seul « Diagnostic » l'était jusqu'ici, si bien que cliquer
   « Sync » sur une caisse fermée ne changeait rien à l'écran.
4. Reconnectez-vous, et choisissez **Snack Lac 2** dans la liste.

**Attendu** : la caisse redémarre sur la carte, les employés et le stock du
**second** établissement. Plus rien du premier.

> **Ce qui ne marchait pas.** L'appairage fonctionnait déjà — le serveur
> rendait bien un appareil du second restaurant. C'est la base LOCALE qui
> restait celle du premier, et deux mécanismes invisibles la figeaient :
>
> - le curseur du catalogue suit `change_log.seq`, un compteur **global à
>   toute la base**. La caisse l'avait déjà avancé loin ; les entrées du
>   second restaurant, écrites avant, portaient des numéros inférieurs et
>   n'auraient **jamais** été tirées ;
> - les tables locales contenaient encore l'ancien référentiel. Même en
>   tirant le nouveau catalogue, on aurait obtenu l'**union** des deux : une
>   carte mélangée, sur une caisse.
>
> Le changement remet donc la base locale à zéro.

5. Refaites l'essai **avec une vente non synchronisée** : encaissez hors
   ligne, puis tentez de changer d'établissement sans synchroniser.

**Attendu** : le changement est **refusé**, et le message dit combien
d'opérations attendent et quoi faire.

> **Pourquoi refuser plutôt que prévenir.** Ces ventes portent l'identité de
> l'ancien terminal : après la bascule, le serveur les refuserait
> « appareil étranger », et un rejet ne se réessaie jamais tout seul. Elles
> n'arriveraient **jamais**. Perdre une vente coûte infiniment plus cher que
> de demander une synchronisation de plus.

> **⚑ Le refus était MUET, et c'est ce qui a été corrigé d'abord.** On
> cliquait « Snack Lac 2 » dans la liste, et rien ne se passait : ni message,
> ni bascule. Le bouton restait là. On en concluait que le second
> établissement n'existait pas vraiment.
>
> Le refus était pourtant bien calculé — il l'est depuis le premier jour. Mais
> l'affichage du message vivait dans la branche « formulaire d'identifiants »
> de cet écran, et la branche « liste d'établissements » ne le rendait nulle
> part. Le code faisait tout juste, sauf être lu.
>
> Trois corrections : le message s'affiche **au-dessus** de la bifurcation,
> donc dans les deux cas ; ses paragraphes ne se collent plus en une seule
> ligne ; et un bouton **« ‹ Changer de compte »** offre une sortie — sans
> lui, un mauvais compte enfermait sur un écran qui ne propose que des
> établissements.
>
> Le contrôle se fait aussi désormais **avant** d'appeler le serveur, quand on
> a cliqué un établissement. Il ne s'y faisait qu'après l'enrôlement : un clic
> refusé créait donc, dans l'établissement visé, une caisse qui n'a jamais
> servi — avec son préfixe de tickets. C'est vérifiable dans la base : le
> terminal « P1 » de Snack Lac 2 porte le MÊME `installation_id` que la caisse
> active, a été créé à 12:26:12, et son `last_seen_at` est resté nul — la
> caisse, elle, a continué de synchroniser trois secondes plus tard. Les clics
> suivants réutilisent cette ligne (`installation_id`, migration 0021), donc la
> liste ne s'allonge pas : il reste un terminal fantôme, pas dix.
>
> `pnpm mise-en-service` fige ce comportement dans un vrai navigateur, avec un
> serveur bouchonné qui rend la liste puis un refus. Le test échoue sur le code
> d'avant — c'est ce qui en fait un test.

#### R.1 bis — Une caisse qui a servi en DÉMONSTRATION avant sa mise en service

C'est le cas normal : on déballe la tablette, on montre le produit au
restaurateur, on prend deux commandes pour de faux — puis on la met en
service.

6. Sur une caisse neuve (`pnpm pos:dev`), prenez un poste, ouvrez la caisse,
   ajoutez un article à une table. **Ne synchronisez pas** : il n'y a pas
   encore de jeton.
7. **Sync → Mettre en service**, e-mail et mot de passe du gérant, puis
   choisissez votre établissement dans la liste.

**Attendu** : la caisse **répond**. Elle dit combien d'opérations de
démonstration elle contient, pourquoi elles ne partiront jamais, et ce
qu'elle va effacer — puis attend un **« Effacer et mettre en service »**.
Après confirmation, elle repart sur la carte du bon établissement.

> **« Snack Lac 2 ne marche pas en cliquant dessus. »** Remonté du terrain,
> et c'était vrai : on cliquait sur son établissement, et il ne se passait
> **rien**. Ni message, ni mouvement. On en concluait, logiquement, que le
> second restaurant n'existait pas.
>
> Trois défauts se superposaient, chacun cachant le suivant :
>
> 1. la graine locale écrit l'identité de la caisse de **démonstration** dans
>    la base. Une première mise en service ressemblait donc à un
>    **changement** d'établissement, et le garde-fou du §5 la refusait — avec
>    un conseil impossible à suivre, « synchronisez puis recommencez », alors
>    que la caisse n'a pas encore de jeton et ne peut RIEN synchroniser ;
> 2. ce refus n'était affiché **nulle part** : le message n'existait que dans
>    la branche du formulaire, pas dans celle de la liste des établissements ;
> 3. et même en le levant, la remise à zéro mourait sur le déclencheur
>    d'immuabilité du journal (`order_events` est en insertion seule) — un
>    échec qui ressortait en « blocage CORS », c'est-à-dire qui envoyait
>    fouiller la configuration du serveur pendant que la cause était dans la
>    tablette.
>
> Ce qui sépare les deux situations n'est pas l'outbox, c'est le
> `device_id` : une caisse à qui le **serveur** en a déjà attribué un a des
> ventes récupérables, et le refus la protège. Une caisse encore sur celui de
> la démonstration n'en a aucune — ses événements seraient refusés
> « appareil étranger », définitivement.
>
> La purge du journal, elle, reste une exception **nommée** : un drapeau posé
> et retiré dans la même transaction, jamais un déclencheur désactivé. Un
> échec en cours de route annule tout, drapeau compris.

Pour rejouer ce parcours dans un vrai navigateur :

```bash
pnpm --filter @kaissi/pos dev              # dans un terminal
pnpm --filter @kaissi/pos test:mise-en-service
```

#### R.2 — Ouvrir un client entièrement nouveau

Un **nouvel établissement** s'ouvre au back-office. Une **nouvelle
organisation** — un autre restaurateur, une autre société — se fait depuis le
poste de l'exploitant :

```bash
pnpm sync:nouveau-client                    # liste les clients existants

pnpm sync:nouveau-client \
  --organisation "Chez Fatma SARL" \
  --restaurant "Chez Fatma — Menzah 6" \
  --email fatma@chezfatma.tn \
  --tva "TVA 19 %:1900,TVA 7 %:700"
```

**Attendu** : organisation, établissement et premier administrateur créés en
une transaction. Le client se connecte ensuite avec son e-mail et fait le
reste tout seul.

> **Il n'y a pas de page « Créer mon compte », et c'est une décision.**
> Kaissi n'est pas un logiciel auquel on s'inscrit : c'est un POS qu'on vend,
> qu'on installe, et dont on paramètre les taux de TVA avec le restaurateur.
> Une inscription ouverte laisserait n'importe qui créer une organisation
> dans la base qui porte les ventes des clients existants — et le nouveau
> venu se retrouverait avec une caisse sans TVA, incapable d'encaisser.
>
> Le script **refuse d'ailleurs d'inventer des taux** : soit vous les
> donnez (`--tva`, en points de base — 1900, jamais 0.19), soit vous les
> reprenez d'un client existant (`--modele`), soit il vous dit en toutes
> lettres que la caisse refusera la première vente.


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

C'est **la quantité en dessous de laquelle il faut recommander**. Il change
la pastille **État** et fait remonter le produit dans « À réapprovisionner »,
en haut de l'écran Stock.

Il **déclenche aussi** une notification et un e-mail à l'encadrement, si les
clés VAPID et le fournisseur d'e-mail ont été configurés — voir **§5 bis E
quater**. Sans cette configuration, rien n'est envoyé et l'écran reste la
seule source : c'est délibéré, aucune fonction de gestion ne dépend d'un
fournisseur tiers.

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
| Cliquer un établissement dans la liste de mise en service ne fait rien | Corrigé : le refus s'affiche désormais. S'il persiste, lisez le message — il dit combien d'opérations attendent d'être synchronisées. |
| `Unexpected character: '"'` dans un `.gradle` | Un chemin collé par erreur dans un fichier versionné. `git checkout -- apps/pos/android/<fichier>`, puis `pnpm verifier:jdk --ecrire` pour désigner un JDK sans toucher au dépôt. |
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
> comptable, la cuisine), c'est **Employés → l'employé → « Ouvrir l'accès »**.
> Voir **§5 bis G**.
>
> La clé qui crée un compte Supabase contourne RLS : elle n'a toujours rien à
> faire dans une application web, et elle n'y est pas. Elle vit dans le
> service de synchronisation, et le back-office lui parle avec le jeton de ta
> session — c'est le service qui relit tes droits en base.

---

## 10. Ce qui n'est pas encore là — et pourquoi

Trois limites que la démonstration met en évidence. Elles sont assumées, pas
oubliées : chacune est écrite ici pour qu'on la choisisse, plutôt que de la
découvrir en clientèle.

**1. ~~« Prêt » ne prévient pas le serveur en salle.~~ — FAIT.** Le marqueur
descend désormais jusqu'à la tablette, par le canal du catalogue et son
curseur `seq` bigserial (RÈGLE 4). Voir **§5 bis B bis** pour l'essayer. Il
lui faut le réseau, comme à l'écran de cuisine — et son absence ne coûte
rien : on retombe exactement sur l'écran d'avant.

**2. Aucun écran ne crée de remboursement.** La lecture est complète, pas
l'écriture. Aujourd'hui, une erreur se répare **avant** l'encaissement, par
annulation de ligne ou de commande. Un vrai remboursement doit décider ce
qu'il fait de la TVA et du stock — ce n'est pas une case à cocher.

**3. L'écran de cuisine a besoin du réseau.** Il lit le back-office. La
caisse, elle, encaisse hors ligne : c'est *elle* qui porte la promesse du
produit. Porter la cuisine dans le POS la rendrait indépendante d'Internet à
son tour.

**4. L'application n'est pas encore PUBLIÉE sur les stores** — mais tout ce
qui est du code est fait. Le projet Android et le projet **iOS**
(`apps/pos/ios/`) sont dans le dépôt, et `codemagic.yaml` construit les deux
paquets signés, sur une machine macOS louée à l'heure : il n'y a pas de Mac à
acheter.

Ce qui reste n'est pas du développement : 25 $ chez Google, 99 $/an chez
Apple, des captures d'écran, une politique de confidentialité et le
questionnaire *Data safety*. Les deux constructions se lancent **à la main** —
chaque build iOS brûle un numéro chez Apple, et chaque envoi Android un
`versionCode` que Play ne rend jamais.

Tout est détaillé dans [`stores.md`](stores.md) : le **parcours clic par
clic** des deux magasins (§2 bis), ce qui se réutilise du compte Digital
Fidelity et ce qui ne se réutilise pas (§0), et pourquoi une TWA Bubblewrap
et un `server.url` — le mécanisme qui convient très bien à Stampi — sont
**disqualifiés** pour une caisse : le code de l'application viendrait du
réseau, et sans connexion elle ne s'ouvrirait même pas. La garde du mode
avion le vérifie à chaque construction, sur la configuration `.ts` **et** sur
les configurations natives générées.

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
