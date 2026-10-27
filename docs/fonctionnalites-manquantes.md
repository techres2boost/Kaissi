# Ce qui nous manque — et ce qui est OBLIGATOIRE avant de vendre

**Date** : 20 octobre 2026 · **Base** : le benchmark du 17 octobre (35 caisses
examinées) · **Méthode** : chaque « manque » ci-dessous a été vérifié dans le
code du dépôt, et les deux plus graves ont été reproduits dans un navigateur.
Ce qui vient de l'extérieur (le cadre légal) est cité avec sa source et marqué
⚠ : rien ici ne remplace la lecture du texte officiel par un expert-comptable.

---

## La réponse en trente secondes

| | Combien | Ce que c'est |
|---|---|---|
| **Obligation légale probable** | 1 | La caisse **homologuée NACEF** (⚠ à confirmer). Elle passe devant tout le reste. |
| **Gestes de caisse obligatoires** | 5 | **Trois sont faits (21 octobre)** : annuler/libérer une table, transférer, prix libre. Reste l'impression (écrite, éteinte) et la division de l'addition. |
| **Attendus, pas bloquants** | 6 | **Trois sont faits (21 octobre)** : pointeuse, remboursement d'une partie de ligne, ticket Z. |
| **Exclus par vous** | 4 | Facturation client, fidélité, livraison et QR, vitrine — **d'accord**, avec une réserve sur le premier (§1). |

---

## 1. Le périmètre que vous avez exclu

| Fonction | Verdict | Pourquoi |
|---|---|---|
| Système de fidélité | ✅ Exclu | Couvert par votre application dédiée. Le benchmark recommandait de **relier**, pas de reconstruire (§07b). |
| Livraison et menu QR | ✅ Exclu | Idem. Seule réserve : une commande en ligne devra un jour arriver en cuisine et dans le chiffre du jour — un chantier d'API, plus tard. |
| Vitrine de produits | ✅ Exclu | Aucune caisse du marché n'en fait un critère d'achat. |
| Facturation du client | ✅ Exclu, **avec une réserve** | Voir ci-dessous. |

**La réserve sur la facturation.** Exclure un module de factures est un
choix de produit, et il tient. Mais l'obligation qui arrive (§2) ne demande
pas un module de factures : elle demande que **chaque vente passe par une
caisse homologuée**. La presse tunisienne l'appelle souvent « facturation
électronique des cafés et restaurants » — ce qui prête à confusion. Exclure
la facturation client **ne dispense pas** du §2.

À noter : le ticket de Kaissi porte déjà le matricule fiscal de
l'établissement, la ventilation de TVA, le timbre, et un champ « Facture n° »
attribué par le serveur (`packages/printing/src/rendu.ts`). Une facture simple
remise sur demande est donc déjà à portée.

---

## 2. Obligatoire n° 0 — la caisse homologuée ⚠

> **Le détail à jour est désormais dans
> [`conformite-fiscale.md`](conformite-fiscale.md)** (27 octobre) : les
> **trois** obligations que la presse mélange — la caisse homologuée NACEF,
> la facture électronique El Fatoora/TTN, et le paiement, pour lequel aucune
> obligation n'a été trouvée côté commerçant — plus les douze questions à
> poser à l'expert-comptable et ce qui manque, point par point, dans le
> ticket. Ce qui suit reste exact, mais s'arrête au 20 octobre.

> **C'est la découverte de cette analyse, et elle change la réponse à la
> question « est-on prêt ».** Le benchmark du 17 octobre l'avait signalée comme
> une question ouverte (« Certification de caisse — ⚠ à faire trancher ») ;
> la presse tunisienne y répond, et la réponse est probablement **oui**.

### Ce que disent les sources (⚠ presse, pas le texte officiel)

Je n'ai **pas** pu lire le texte au Journal officiel : le portail fiscal
n'est pas joignable depuis mon environnement. Ce qui suit vient d'articles de
presse tunisiens d'octobre 2025 à juin 2026, qui concordent sur le cadre et
divergent un peu sur les dates.

- **Le texte** : un arrêté du ministre des Finances du **14 octobre 2025**
  impose une caisse enregistreuse aux établissements de consommation sur
  place (restaurants, cafés, salons de thé). Il s'appuie sur l'article 48 de
  la loi de finances 2016 et le **décret n° 2019-1126** du 26 novembre 2019,
  qui fixe les caractéristiques techniques des caisses.
- **Le système (« NACEF »)** : une caisse chez le professionnel, un **module
  de sécurisation des données fiscales homologué** par le ministère, et une
  **plateforme centrale** du ministère qui reçoit les données de vente.
- **Exigences citées** : rapport électronique **journalier** de clôture et
  des recettes ; le fournisseur remet un **certificat** à l'acheteur, assure
  le service après-vente, et **déclare** les opérations de maintenance au
  ministère.
- **Pour les fournisseurs** : un portail, **homologation.nacef.tn**, donne le
  cahier des charges technique et fonctionnel, le manuel des procédures, des
  tests d'intégration, et la demande d'accréditation. Renseignements : Centre
  d'information fiscale à distance, **81 100 400**.

### Le calendrier annoncé (⚠ à vérifier au JORT)

| Échéance | Qui |
|---|---|
| 1er novembre 2025 | Restaurants touristiques classés, cafés de 2ᵉ et 3ᵉ catégories, salons de thé |
| **1er juillet 2026** | Les autres **personnes morales** (sociétés) — **donc déjà en vigueur** |
| 1er juillet 2027 | Personnes physiques au régime réel |
| 1er juillet 2028 | Toutes les autres personnes physiques (généralisation) |

### Ce que cela veut dire pour nous

1. **Un restaurant exploité par une société ne peut probablement plus
   utiliser Kaissi comme caisse principale** tant que Kaissi n'est pas
   homologué. Lui vendre Kaissi aujourd'hui l'exposerait à une sanction — et
   nous, à la perte de confiance qui va avec.
2. **Les concurrents locaux s'affichent déjà « homologués NACEF »**
   (Megasoft avec son module S-MDF, ASMPOS — affirmations commerciales, pas
   une liste du ministère).
3. **C'est aussi la plus grande opportunité commerciale que vous aurez.**
   D'ici 2028, la loi oblige chaque café et restaurant de Tunisie à choisir
   une caisse homologuée. Ceux qui le seront tôt ramassent le marché ;
   ceux qui ne le seront pas en sortent.

### Notre architecture est une bonne base, pas une réponse

Ce que nous avons déjà, et qu'un cahier des charges fiscal demande presque
toujours : un **journal de ventes inaltérable** (insertion seule, déclencheur
de blocage), un **journal d'audit chaîné par hash**, une **numérotation
attribuée par le serveur**, des **totaux calculés en un seul endroit**, et une
**clôture journalière** avec écart de caisse.

Ce que nous ne savons pas encore : le format du module de sécurisation (logiciel
ou matériel), et surtout **comment il traite une vente faite hors ligne**.
C'est LA question, parce que l'encaissement sans réseau est notre raison
d'être. On ne peut pas l'estimer avant d'avoir lu le cahier des charges.

**Première action, cette semaine** : télécharger le cahier des charges sur
homologation.nacef.tn, et faire confirmer par l'expert-comptable l'arrêté, le
calendrier et la catégorie de chacun de vos futurs clients.

---

## 3. Obligatoire — les gestes sans lesquels un service se bloque

Classés par gravité. Chaque ligne a été vérifiée dans le code.

### 3.1 Annuler une commande, libérer une table ouverte par erreur ✅ fait

> **Fait le 21 octobre.** Ticket → « Plus » → « Libérer la table » (rien
> saisi : sans gérant) ou « Annuler la commande » (motif, PIN d'un gérant).
> Une commande qui a reçu un paiement ne s'annule plus : on encaisse le
> reste, puis on rembourse. Test : `apps/pos/tests/gestes-commande.mjs`.


**Le constat, reproduit dans un navigateur.** Un serveur touche la table 3
par erreur, revient à la salle sans rien saisir : la table reste **« occupée ·
0,000 TND · Ouverte »**. Aucun bouton ne la libère, « Encaisser » est grisé
(rien à encaisser), et elle le reste au service suivant.

**Ce qui est rageant** : la logique existe — `SessionCaisse.annulerCommande()`
et l'événement `order.cancelled`, testés. Il ne manque que le bouton (avec le
PIN d'un gérant si des articles ont déjà été envoyés en cuisine).

**Effort** : 1 à 2 jours.

### 3.2 Transférer une table ✅ fait

> **Fait le 21 octobre.** Ticket → « Plus » → « Changer de table » ; les
> tables occupées ne se choisissent pas. Passer en « à emporter » aussi.


Le client change de table : c'est quotidien. **Même situation** :
`SessionCaisse.transfererTable()` et l'événement `table.moved` existent et
sont gérés par la réduction des événements, mais aucun écran ne les appelle.
Aujourd'hui, il faut annuler et ressaisir — ce qui est impossible (§3.1).

**Effort** : 1 à 2 jours.

### 3.3 L'impression : ticket, bon de cuisine, tiroir-caisse 🟠

Le module est **écrit et testé**, l'ouverture du tiroir-caisse aussi — il est
simplement éteint (`IMPRESSION_ACTIVE`). Le ticket à l'écran suffit à un
snack ; un restaurant attend un ticket papier, et une cuisine sans écran
attend un bon. Si l'homologation (§2) exige une impression particulière,
c'est aussi par là qu'elle passera.

**Effort** : peu de code ; **1 à 2 semaines de terrain** — deux ou trois
imprimantes thermiques vendues en Tunisie, en Wi-Fi et Ethernet, une semaine de
service réel (`docs/imprimante.md`).

### 3.4 Diviser l'addition 🟠

Le paiement en plusieurs fois et en plusieurs moyens existe (espèces + carte
sur la même note). Ce qui manque, c'est **« chacun paie sa part »** :

- **en parts égales** (« divisez par 4 ») — une aide de calcul sur l'écran
  d'encaissement existant : **1 à 2 jours** ;
- **par articles** (« moi, la pizza et le coca ») — touche au domaine : il
  faut répartir les paiements sur les lignes, ou scinder la commande, sans
  toucher aux règles de TVA (règle 7). **1 à 2 semaines**, tests compris.

Pour la restauration assise, c'est demandé à chaque service. Un snack au
comptoir peut s'en passer : commencez par les parts égales.

### 3.5 Article à prix libre (« divers ») ✅ fait

> **Fait le 21 octobre.** Tuile « Prix libre » en fin de carte, pour tous
> les rôles : montant, désignation, taux de TVA, poste de préparation. La
> ligne n'a pas de produit : aucun stock décompté, rangée en « coût non
> saisi » dans les marges.


Le client demande un supplément qui n'est pas à la carte : aujourd'hui, le
caissier n'a aucun moyen de l'encaisser sans le créer d'abord. Toutes les
caisses du benchmark ont un bouton « divers » avec saisie du montant et du
taux de TVA.

**Effort** : 2 à 3 jours.

---

## 4. Attendu, mais pas bloquant le premier jour

| Fonction | Qui l'a | Pourquoi ça peut attendre | Effort |
|---|---|---|---|
| ✅ Pointeuse (heures travaillées) — **fait le 21/10** | Loyverse (payant), Toast, Lightspeed | Au PIN sur la caisse (même verrouillée) ; « Heures travaillées » au back-office, sorties oubliées à corriger. Migration 0048. | — |
| ✅ Rembourser une partie d'une ligne (1 pizza sur 3) — **fait le 21/10** | Loyverse, Square | Unités égales, l'écart d'arrondi à la dernière : rendre unité par unité rend le total au millime. | — |
| Fusionner deux tables | Lightspeed, TouchBistro | Moins fréquent que le transfert (§3.2), qu'il faut faire d'abord. | Moyen |
| Services (entrée, plat, dessert ; « envoyer la suite ») | Toast, Lightspeed | Restauration assise uniquement, pas notre première cible. | Moyen |
| ✅ Rapport de clôture (« ticket Z ») — **fait le 21/10** | Tout le monde | À l'écran à la clôture, imprimé si l'impression est allumée, rouvrable depuis « Périodes de travail ». ⚠ **Pas un Z fiscal** : le Z homologué NACEF (compteurs cumulés, numéro de clôture) viendra du cahier des charges (§2). | — |
| Pourboire, reçu par SMS ou e-mail | Square, Toast | Peu demandé en Tunisie ; le papier passe avant. | Faible |

---

## 5. À ne pas faire maintenant

En plus de vos quatre exclusions : **bornes de commande**, **réservations de
tables** (hors de notre cible), **API publique** (plus tard, pour relier
fidélité et commande en ligne), **terminal de paiement carte intégré**
(dépend des banques tunisiennes, pas de nous).

---

## 6. Ce que nous avons déjà — pour ne pas le reconstruire

Carte (articles, catégories, tailles, options, réductions, création depuis la
caisse hors ligne) · salle, tables, à emporter, couverts · envoi en cuisine et
au bar, écran de préparation, « prêt » par envoi, notifications · paiements
multiples et mixtes · remises (ligne et globale, avec PIN du gérant au-delà
d'un plafond) · service et timbre · remboursement · ouverture et clôture de
caisse, fond de caisse, écart · stock, fournisseurs, réceptions, rupture
automatique · fiches clients · employés, rôles, PIN · rapports (ventes,
articles, catégories, employés, paiements, marges) et exports CSV ·
multi-établissements · français et arabe · **encaissement hors ligne sans
plafond ni expiration** · journal inaltérable chaîné par hash.

---

## 7. Est-on prêt à descendre sur le marché ?

### La réponse : pas en vente ouverte ; oui en pilote — et pas en développant plus de fonctions

Ni « on est prêts », ni « il faut développer encore six mois ». Le cœur du
produit est en avance sur le marché local — le dinar à trois décimales,
l'encaissement sans réseau, un journal que personne ne peut modifier. Ce qui
manque est **étroit** : deux boutons, une imprimante à valider, deux gestes
de caisse, et une homologation.

Ouvrir la vente maintenant serait une erreur pour deux raisons :

1. **⚠ L'obligation NACEF s'appliquerait déjà** aux sociétés (depuis le
   1er juillet 2026) et aux cafés et restaurants classés (depuis novembre
   2025). Vendre une caisse non homologuée à ces clients, c'est leur vendre
   une amende.
2. **Une table ouverte par erreur bloque la salle** (§3.1). Le premier
   samedi soir, le restaurateur le verra — et le racontera.

Retourner développer pendant des mois serait l'autre erreur : chaque mois
passé sans client réel est un mois sans apprendre ce qui manque vraiment, et
un mois de plus pour des concurrents qui sont déjà homologués.

### Le plan, en deux voies parallèles

**Voie 1 — Le pilote (3 à 4 semaines).**

| Semaine | Quoi |
|---|---|
| 1 | ~~Annuler une commande et transférer une table (§3.1, §3.2) · article à prix libre (§3.5)~~ ✅ faits le 21/10 |
| 2 | Diviser l'addition en parts égales (§3.4) · rallumer l'impression chez un premier client équipé (§3.3) |
| 3–4 | **Pilote encadré** : 3 à 5 établissements, installés par vous, suivis chaque semaine — ⚠ choisis parmi ceux que l'obligation ne vise **pas encore** (a priori les personnes physiques, jusqu'en 2027 ou 2028 : à faire confirmer par l'expert-comptable pour chacun) |

**Voie 2 — L'homologation (démarre cette semaine, et devient la priorité n° 1).**

1. Télécharger le cahier des charges sur **homologation.nacef.tn** ; appeler
   le **81 100 400** si l'inscription fournisseur pose question.
2. Faire valider par l'expert-comptable : l'arrêté, le calendrier, et ce
   qu'il change au ticket, à la numérotation et au timbre.
3. Lire le cahier des charges sous un seul angle d'abord : **comment une
   vente faite hors ligne est-elle sécurisée puis transmise ?** C'est ce qui
   décide de l'effort — quelques semaines si une signature locale suffit,
   beaucoup plus s'il faut un boîtier matériel ou une transmission
   immédiate.
4. Chiffrer, puis lancer la demande d'accréditation.

**La vente ouverte commence le jour où Kaissi est homologué.** Pas avant —
et c'est une bonne nouvelle : à ce moment-là, la loi elle-même pousse chaque
restaurant de Tunisie à changer de caisse avant 2028.

### Deux vérifications à faire avant de communiquer

- **Le nom.** Une recherche sur les caisses tunisiennes fait remonter
  « KAISSE » (kaisse.tn), un nom presque identique à « Kaissi ». Je n'ai pas
  pu vérifier ce que propose ce site. Avant tout lancement public, faites
  vérifier le nom auprès de l'INNORPI.
- **La facturation de l'abonnement** (la nôtre, pas celle du restaurant) :
  pour un pilote de cinq clients, un tableur et des virements suffisent. À
  partir d'une dizaine, il faudra un échéancier — c'était le « bloquant pour
  grandir » du benchmark.

---

## Sources

Le cadre légal ci-dessous vient de la presse et de pages d'éditeurs ; **aucune
de ces sources n'est le texte officiel**. À faire vérifier au JORT.

- [Kapitalis — caisses enregistreuses obligatoires dans les cafés et restaurants (nov. 2025)](https://kapitalis.com/tunisie/2025/11/02/tunisie-caisses-enregistreuses-obligatoires-dans-les-cafes-et-restaurants/)
- [Managers — caisses enregistreuses obligatoires dès le 1er juillet 2026](https://managers.tn/2026/06/30/tunisie-caisses-enregistreuses-obligatoires-des-demain-pour-ces-structures/)
- [La Presse — caisses enregistreuses, un pas vers la transparence fiscale](https://www.lapresse.tn/2025/11/01/economie-et-fiscalite-caisses-enregistreuses-un-pas-vers-la-transparence-fiscale/)
- [La Presse — la Tunisie impose la facturation électronique aux cafés et restaurants (oct. 2025)](https://www.lapresse.tn/2025/10/14/la-tunisie-impose-la-facturation-electronique-aux-cafes-et-restaurants-les-details/)
- [La Presse — un système numérique pour les caisses enregistreuses mis en place](https://lapresse.tn/2025/10/17/tunisie-un-systeme-numerique-pour-les-caisses-enregistreuses-mis-en-place/)
- [Webmanagercenter — plateforme pour les fournisseurs et tests d'intégration](https://www.webmanagercenter.com/2025/10/17/553889/caisse-enregistreuse-la-tunisie-met-en-place-une-plateforme-pour-les-fournisseurs-et-tests-dintegration)
- [Webmanagercenter — l'État branche les cafés et restaurants au contrôle automatique](https://www.webmanagercenter.com/2025/11/04/555113/tunisie-caisses-enregistreuses-fiscales-letat-branche-les-cafes-et-restaurants-au-controle-automatique)
- [Webdo — obligatoires dès le 1er juillet](https://www.webdo.tn/fr/actualite/national/restaurants-cafes-et-salons-de-the-les-caisses-enregistreuses-obligatoires-des-le-1er-juillet/398408/)
- [Webdo — lancement du système d'homologation](https://www.webdo.tn/fr/actualite/national/tunisie-fiscalite-lancement-du-systeme-dhomologation-des-caisses-enregistreuses/385862/)
- [Ecotous — la Tunisie passe aux caisses enregistreuses](https://ecotous.tn/cafes-restaurants-salons-de-the-la-tunisie-passe-aux-caisses-enregistreuses/)
- [caisses.tn — calendrier par catégorie (éditeur)](https://caisses.tn/caisses-obligatoires-en-tunisie/)
- [Megasoft — logiciel de caisse et module S-MDF (éditeur)](https://www.megasofterp.com/logiciel-caisse-enregistreuse-tunisie-megasoft-erp/)
- [ASM — homologation de caisses tactiles (éditeur)](https://asmpos.com/caisse-fiscale-tunisie/)
- [jibaya.tn — décret 2019-1126 (portail fiscal ; non joignable depuis mon environnement)](https://jibaya.tn/wp-content/uploads/2025/10/1126%20trait%C3%A9%20fr.pdf)
