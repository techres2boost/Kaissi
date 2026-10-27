# Conformité fiscale tunisienne — caisse, facture, paiement

**Date** : 27 octobre 2026 · **Destinataire** : le CTO · **Question posée** :
« C'est quoi la nouvelle loi pour le paiement, la caisse, tout ça — sachant
qu'on n'a pas de paiement pour le moment ? »

> ⚠ **Rien dans ce document ne doit être tenu pour la règle applicable.**
> Je n'ai pas pu lire un seul texte officiel : les sites tunisiens
> (`jort.gov.tn`, `homologation.nacef.tn`, `impots.finances.gov.tn`,
> `elfatoora.digital`) sont **refusés par le proxy de sortie** de mon
> environnement. Tout ce qui suit vient de la presse tunisienne, de blogs de
> cabinets et de pages d'éditeurs — des sources qui **se contredisent sur les
> dates**. C'est une carte pour savoir quoi demander, pas une réponse.
>
> **Ce document ne remplace pas une séance avec un expert-comptable
> tunisien.** C'est la règle du dépôt (CLAUDE.md, « Points à valider avec un
> expert-comptable »), et elle vaut doublement ici.

---

## La réponse en trente secondes

**Il n'y a pas « une » nouvelle loi. Il y en a trois, et la presse les
mélange.**

| # | Obligation | Ce qu'elle vise | Nous concerne ? |
|---|---|---|---|
| **1** | **Caisse enregistreuse fiscale homologuée (NACEF)** | La caisse elle-même, chez le restaurateur | 🔴 **OUI — c'est le seul vrai bloquant** |
| **2** | **Facture électronique (El Fatoora / TTN)** | Les factures, pas les tickets | 🟠 Probablement pas la caisse — **mais nous, comme prestataire** ⚠ |
| **3** | **Paiement électronique** | Les banques et établissements de paiement | 🟢 **Aucune obligation trouvée pour le commerçant** |

**Et la réponse directe à votre question** :

> **Ne pas avoir de paiement intégré n'est PAS un problème d'homologation.**
>
> Ce que le cadre NACEF demande, c'est que le ticket **porte le mode de
> paiement** et que la vente soit enregistrée et transmise. Kaissi enregistre
> déjà les modes de paiement (`payment_methods`, espèces, carte, mixte) et les
> porte sur le ticket. **Encaisser une carte** — faire passer l'argent — est
> un métier réglementé, celui des banques et des établissements de paiement.
> Ce n'est pas le métier d'une caisse, et aucun texte trouvé ne l'impose à un
> logiciel de caisse.
>
> ⚠ À confirmer par l'expert-comptable et, si possible, par la lecture du
> cahier des charges NACEF : y a-t-il une exigence sur le **rapprochement**
> entre les encaissements carte et les ventes déclarées ? C'est la seule
> question du sujet « paiement » qui pourrait nous toucher.

---

## 1. Les trois obligations, séparées

### Pourquoi c'est confus

Les articles de presse parlent de « la Tunisie impose la facturation
électronique aux cafés et restaurants » (La Presse, 14 octobre 2025) pour
annoncer... **l'obligation de caisse enregistreuse**. Ce ne sont pas la même
chose, elles ne viennent pas des mêmes textes, et elles n'ont pas le même
calendrier. Confondre les deux conduit soit à croire qu'on est hors sujet,
soit à construire un module de facturation qui ne répond pas à l'obligation.

---

## 2. Obligation 1 — la caisse homologuée NACEF 🔴

**C'est le sujet. Tout le reste est secondaire.**

### Les textes (⚠ non lus)

| Texte | Ce qu'il ferait |
|---|---|
| Article 48 de la **loi de finances 2016** | Le fondement de l'obligation |
| **Décret gouvernemental n° 2019-1126** du 26 novembre 2019 | Les modalités pratiques et les caractéristiques techniques des caisses |
| **Arrêté du ministre des Finances du 14 octobre 2025** | Le calendrier par catégorie d'établissement. ⚠ Une source parle du **JORT n° 125**, une autre d'un décret-loi publié au JORT de décembre 2025 — **les sources divergent, il faut la référence exacte** |

### L'architecture imposée — trois morceaux

D'après un guide tiers (⚠ `dddinvoices.com`, non officiel), le système se
décompose ainsi :

```
  Module de caisse          Module de sécurisation           Plateforme
  (enregistre les     →     des données fiscales       →     du ministère
   transactions)            « MDF » (sécurise et             (reçoit, enregistre,
                             transmet)                        traite)
```

**Le MDF est la pièce que nous n'avons pas, et dont nous ne connaissons pas
la nature.** Logiciel ? Boîtier matériel ? Signature cryptographique locale ?
C'est ce que dit le cahier des charges, et c'est **la seule information qui
chiffre le projet**.

### Ce que le ticket devrait porter (⚠ source tierce)

| Élément | Kaissi aujourd'hui |
|---|---|
| Numéro de ticket séquentiel | ✅ attribué par le serveur, unique par établissement |
| **Identifiant du MDF** | ❌ n'existe pas |
| Horodatage | ✅ |
| Matricule fiscal du contribuable | ✅ (`packages/printing/src/rendu.ts`) |
| Ventilation de TVA | ✅ par taux, arrondie par taux (règle 7) |
| Mode de paiement | ✅ |
| **QR code de vérification** | ❌ n'existe pas |

Deux manques, tous deux dans le ticket. Le reste y est déjà.

⚠ Le standard de signature n'est pas confirmé. La recherche fait remonter le
**TN CEV 2D-Doc** administré par TunTrust / ANCE (hachage des données
essentielles, signature par le certificat de l'émetteur, le tout dans un code
2D). **Aucune source ne dit que les tickets NACEF utilisent ce format** — mais
si c'est le cas, c'est une bonne nouvelle : le format est documenté
publiquement et une signature **locale** est compatible avec le hors ligne.

### Autres exigences citées (⚠ source tierce)

- **Rapport électronique journalier** de clôture et des recettes. → Nous
  avons déjà la clôture journalière avec écart de caisse et le ticket Z ;
  ⚠ ce n'est **pas** un Z fiscal (pas de compteurs cumulés ni de numéro de
  clôture homologué).
- La caisse doit être **enregistrée avant usage** et porter un **certificat
  électronique**.
- Le fournisseur remet un **certificat** à l'acheteur, assure le **service
  après-vente**, et **déclare les maintenances** au ministère. → **C'est une
  obligation d'exploitation pour nous, pas de code.** Il faudra un processus,
  un numéro, et quelqu'un qui répond.
- **Délai de réparation de trois jours** en cas de panne technique, et
  **maximum 10 jours d'indisponibilité par an**. ⚠ Si c'est exact, c'est un
  engagement de service contractuel à tenir — et cela se prépare (astreinte,
  tablette de remplacement).

### Le calendrier (⚠ les sources divergent)

| Échéance | Qui | Statut |
|---|---|---|
| 1er novembre 2025 | Personnes morales : restaurants classés touristiques, salons de thé, cafés de 2ᵉ et 3ᵉ catégories | **Déjà en vigueur** |
| **1er juillet 2026** | Les autres **personnes morales** (sociétés) | **Déjà en vigueur** |
| 1er juillet 2027 | Personnes physiques au régime réel | À venir |
| 1er juillet 2028 | Toutes les autres personnes physiques | Généralisation |

**Conséquence commerciale, et elle est dure** : un restaurant **exploité en
société** est, depuis juillet 2026, probablement tenu d'utiliser une caisse
homologuée. Lui vendre Kaissi aujourd'hui, c'est lui vendre un risque
d'amende. ⚠ La catégorie de chaque prospect doit être tranchée par
l'expert-comptable, un par un.

### LA question qui chiffre tout

> **Comment une vente faite HORS LIGNE est-elle sécurisée, puis transmise ?**

C'est la question à poser en premier au ministère, et la première à chercher
dans le cahier des charges. Trois scénarios, trois projets différents :

| Si le cahier des charges dit… | Effort pour nous | Conséquence sur l'architecture |
|---|---|---|
| **Une signature locale suffit**, la transmission peut être différée | **Quelques semaines** | Idéal. Notre journal d'événements est déjà fait pour ça : on signe à la clôture sur l'appareil, on transmet au retour du réseau |
| **Transmission sous X heures** | Quelques semaines + un suivi | Acceptable. Il faudra un écran qui dit « 3 ventes non transmises depuis 6 h » |
| **Transmission immédiate obligatoire**, ou **boîtier matériel** par caisse | **Plusieurs mois**, et un conflit frontal avec la promesse du produit | 🔴 C'est le scénario qui remettrait en cause le positionnement. Il faut le savoir **maintenant**, pas dans six mois |

**Rien ne se décide avant d'avoir lu ce document.** C'est pour cela qu'il est
l'action n° 1 du §5.

---

## 3. Obligation 2 — la facture électronique (El Fatoora / TTN) 🟠

### Ce que disent les sources

- **Article 53 de la loi de finances 2026** (loi n° 2025-17 du 12 décembre
  2025) étend la facturation électronique obligatoire **aux prestataires de
  services** à compter du **1er janvier 2026**.
- Le circuit passe par **TTN** (Tunisie TradeNet) et la plateforme **El
  Fatoora**, avec une **signature électronique qualifiée** (TunTrust / ANCE),
  un abonnement TTN, des tests de conformité et une déclaration à
  l'administration fiscale.
- **Sanctions** citées : 100 à 500 TND par facture papier, plafonnées à
  50 000 TND par an (⚠ les montants varient d'une source à l'autre).
- ⚠ **Un amendement de report** de l'article 53 aurait été adopté en
  commission des finances en avril 2026 et, au 12 octobre 2026,
  **n'était pas publié au Journal officiel** selon cette source. Le statut
  réel est donc **incertain**.
- Une **Note commune 02/2026** laisserait les prestataires facturer sur papier
  jusqu'à la validation de leur inscription TTN (⚠ lecture d'un blog).

### Est-ce que ça touche la caisse d'un restaurant ?

**Probablement non, et c'est important** : la facturation électronique vise
les **factures**, typiquement entre entreprises. Un ticket de caisse remis à
un particulier n'est pas une facture.

⚠ **Mais je n'ai trouvé AUCUNE source qui le dise explicitement** pour les
cafés et restaurants. C'est une **question à poser en ces termes** :

> « Un restaurant qui remet un ticket de caisse à un client particulier est-il
> soumis à l'obligation de facturation électronique de l'article 53, ou
> l'obligation de caisse homologuée NACEF en tient-elle lieu ? Et que se
> passe-t-il quand ce même restaurant facture une entreprise (un repas
> d'affaires, un traiteur) ? »

Le second cas est le plus probable : **le restaurant qui facture une société
aura besoin d'une facture électronique**. Notre ticket porte déjà un champ
« Facture n° » attribué par le serveur — la base est là, le circuit TTN n'y
est pas.

### Le point que personne n'a vu : ça nous concerne NOUS 🟠

> **Res2Boost est un prestataire de services.** Le jour où nous facturons un
> abonnement à un restaurant, c'est **notre** facture qui doit probablement
> être électronique, via TTN.

Ce n'est pas du code produit : c'est de l'administration d'entreprise. Mais
c'est à régler **avant le premier client payant**, pas après — l'inscription
TTN, le certificat TunTrust et les tests de conformité prennent du temps.
Et cela pèse sur le choix de l'outil de facturation de l'entreprise.

---

## 4. Obligation 3 — le paiement 🟢

### Ce que j'ai cherché, et ce que je n'ai pas trouvé

**Aucune loi tunisienne trouvée n'oblige un commerçant à accepter le paiement
électronique.** J'ai cherché dans la loi de finances 2026, du côté de la BCT,
et dans la presse. Rien.

Le contexte est même l'inverse : en décembre 2024, **5 % seulement** des
800 000 entreprises du pays étaient équipées pour accepter un paiement
numérique. L'État **encourage**, il n'impose pas au commerçant.

### Ce qui existe vraiment, et qui est souvent confondu avec ça

| Texte | Ce qu'il fait | Nous concerne ? |
|---|---|---|
| **Loi n° 41-2024 sur les chèques**, en vigueur le 2 février 2025 | QR code de vérification sur chaque chèque, plateforme centralisée **TuniCheque** gérée par la BCT, dépénalisation des chèques sans provision ≤ 5 000 TND | 🟢 Non — sauf si un jour on accepte le chèque comme mode de paiement et qu'on veut vérifier le QR. Aujourd'hui `payment_methods` n'en a pas besoin |
| **Circulaire BCT n° 2026-10** du 25 septembre 2026 | Refond la réglementation des **établissements de paiement** (sécurité, API ouvertes, entrée en relation à distance). En vigueur trois mois après publication, soit **fin décembre 2026** | 🟠 **Seulement si nous touchions aux flux d'argent** — voir ci-dessous |
| Tendance mesurée (BCT, T1 2026) | Chèques −24,9 % en nombre, paiement de proximité par TPE **+19,7 % en valeur** | Information de marché : la carte progresse, donc l'intégration TPE deviendra un argument commercial |

### La décision d'architecture à prendre, et je la recommande fermement

> **Kaissi ne doit jamais toucher au flux d'argent.**

Dès qu'un logiciel encaisse, détient ou transfère des fonds, il entre dans le
périmètre des **établissements de paiement** — agrément BCT, capital
minimum, contrôle prudentiel, et désormais la circulaire 2026-10. C'est un
autre métier, un autre bilan, un autre calendrier.

**Le bon modèle, le jour où un client demande la carte** : un TPE de sa
banque, à côté de la tablette. Le caissier encaisse sur le TPE, puis **touche
« Carte » sur Kaissi** — exactement ce que fait le produit aujourd'hui. Plus
tard, si un partenaire bancaire expose une API, Kaissi peut **lire** le
résultat d'une transaction pour éviter la double saisie. Lire, pas encaisser.

⚠ Si un jour la direction veut l'encaissement intégré (et la marge qui va
avec), c'est une décision stratégique à instruire avec un juriste bancaire,
pas un chantier technique.

---

## 5. Le plan — ce qu'il faut faire, dans cet ordre

| # | Action | Qui | Quand | Bloque quoi |
|---|---|---|---|---|
| **1** | **Télécharger le cahier des charges** technique et fonctionnel et le manuel des procédures sur `homologation.nacef.tn`. Appeler le **81 100 400** (Centre d'information fiscale à distance) si l'inscription fournisseur coince | CTO | **Cette semaine** | **Tout.** Le chiffrage, la feuille de route, la vente |
| **2** | Lire ce cahier des charges **sous un seul angle d'abord** : la vente hors ligne (§2, « LA question ») | CTO | Dans les 48 h suivantes | Le positionnement produit lui-même |
| **3** | **Vérifier la liste officielle** des fournisseurs accrédités et des systèmes homologués sur le portail. Combien sont réellement homologués ? | CTO | Cette semaine | La lecture du marché ([`positionnement-marche-tunisien.md`](positionnement-marche-tunisien.md)) |
| **4** | **Séance avec un expert-comptable tunisien**, avec ces questions écrites (§6) et ses réponses **consignées dans le dépôt** | Direction | Semaine 1 | La vente, et le choix des clients du pilote |
| **5** | Obtenir les **références exactes** des textes (numéro de JORT, date) et les archiver dans le dépôt | Expert-comptable | Semaine 1–2 | La fin des « ⚠ » de ce document |
| **6** | **Inscription TTN / El Fatoora pour Res2Boost** (certificat TunTrust, abonnement, tests) | Direction | Avant le 1er client payant | Notre propre facturation (§3) |
| **7** | Chiffrer le MDF et **déposer la demande d'accréditation** | CTO | Après 1–2 | La vente ouverte |

---

## 6. Les questions à poser à l'expert-comptable — à copier telles quelles

**Sur la caisse (NACEF)**

1. Quelle est la **référence exacte** de l'arrêté du 14 octobre 2025 (numéro
   et date de JORT) ? Et le décret 2019-1126 est-il toujours le texte
   d'application en vigueur ?
2. Le calendrier du §2 est-il exact ? Un restaurant exploité en **SARL** est-il
   soumis depuis le 1er juillet 2026 ?
3. Un **snack ou un café tenu par une personne physique** (non au régime réel)
   est-il libre jusqu'en **juillet 2028** ? C'est la cible du pilote : la
   réponse décide de qui on peut équiper légalement aujourd'hui.
4. Quelles sont les **sanctions** encourues par le restaurateur qui utilise une
   caisse non homologuée ? Et par le **fournisseur** qui en vend une ?
5. Un logiciel **non homologué** peut-il être utilisé **en parallèle** d'une
   caisse homologuée (pour la gestion, le stock, les rapports) ? ⚠ C'est
   peut-être une voie de marché transitoire, et il faut savoir si elle est
   licite.

**Sur la facture**

6. Un restaurant qui remet un **ticket de caisse** à un particulier est-il
   soumis à l'obligation de **facture électronique** (article 53) ?
7. Quand ce restaurant facture une **entreprise**, que doit porter la facture,
   et doit-elle passer par TTN ?
8. **L'article 53 est-il reporté ?** L'amendement d'avril 2026 a-t-il été
   publié au JORT ?
9. **Res2Boost**, éditeur de logiciel, est-il tenu d'émettre ses propres
   factures d'abonnement par El Fatoora, et depuis quand ?

**Sur les taux et le ticket** (les ⚠ déjà ouverts dans le code)

10. Quels **taux de TVA** s'appliquent à la restauration, selon le type
    d'établissement et le type de vente (sur place / à emporter) ?
11. Le **droit de timbre** : sur quels documents, quel montant, et dans quels
    cas ?
12. Quelle est la **durée de conservation** légale des tickets et du journal
    de ventes ? (Nous ne purgeons pas les ventes — il faut savoir si on doit
    archiver, et combien de temps.)

---

## 7. Ce que notre architecture a déjà, et ce qu'elle n'a pas

**Ce qui joue pour nous** — ce ne sont pas des hasards, c'est ce que demande
presque tout cahier des charges fiscal :

| Exigence habituelle | Chez nous |
|---|---|
| Journal de ventes **inaltérable** | `order_events` en insertion seule : `REVOKE UPDATE, DELETE` **et** un déclencheur de blocage (règle 6) |
| **Piste d'audit** | `audit_events` chaîné par hash — retirer une ligne casse la chaîne et se voit |
| Numérotation **non falsifiable par le poste** | Le préfixe et le numéro viennent du **serveur**, le POS adopte |
| Pas de double comptage | Index unique sur `event_id` (règle 5) |
| Totaux reproductibles | Un seul endroit de calcul, importé à l'identique par la caisse et le serveur (règle 7), testé au millime |
| Clôture journalière | Shift avec fond de caisse, écart, ticket Z |
| Annulation qui ne supprime rien | Un événement d'annulation **s'ajoute** |

**Ce qui manque, et c'est précis** :

| Manque | Nature |
|---|---|
| Le **MDF** (module de sécurisation) | Inconnu — dépend du cahier des charges |
| **QR code** de vérification sur le ticket | Petit, une fois le format connu |
| **Identifiant du MDF** sur le ticket | Trivial |
| **Transmission** vers la plateforme du ministère | Une route de plus dans `apps/sync`, et un suivi côté caisse |
| **Z fiscal** (compteurs cumulés, numéro de clôture) | Moyen — le Z actuel est un rapport de gestion, pas un Z fiscal |
| **Certificat électronique** par caisse | Processus + stockage sûr sur l'appareil |
| Le **processus fournisseur** (certificat au client, SAV, déclaration des maintenances) | **Organisationnel, pas technique** — et c'est souvent ce qui bloque un dossier |

> **La bonne nouvelle, et elle est réelle** : rien dans cette liste ne demande
> de défaire ce qui est fait. Le journal d'événements est précisément la
> structure qu'il faut pour signer une vente à la clôture et la transmettre
> plus tard. Nous n'avons pas construit un produit à adapter : nous avons
> construit la fondation sur laquelle ça se pose.
>
> **La mauvaise** : on ne saura pas si c'est vrai avant d'avoir lu le cahier
> des charges. Et ce document n'est pas accessible depuis ici.

---

## Sources

⚠ **Aucune source officielle n'a pu être consultée.** Presse tunisienne,
blogs de cabinets et pages d'éditeurs uniquement. Les dates et les montants
divergent entre les sources ; là où elles divergent, je l'ai écrit.

**Caisse NACEF**

- [JIBAYA — NACEF : le système national de caisses enregistreuses fiscales](https://jibaya.tn/blog/nacef-le-systeme-national-de-caisses-enregistreuses-fiscales-2/)
- [JIBAYA — avis aux éditeurs de logiciels de caisses et fournisseurs](https://jibaya.tn/blog/avis-pour-les-personnes-et-les-societes-editrices-de-logiciels-de-caisses-ainsi-que-les-fournisseurs-de-caisses-enregistreuses/)
- [Portail d'homologation NACEF](https://homologation.nacef.tn/) *(non joignable depuis ici)*
- [dddinvoices — Tunisia Fiscalization 2026: NACEF Cash Register & POS Guide](https://dddinvoices.com/learn/tunisia-fiscalization) *(tiers, non officiel — source de l'architecture MDF et du contenu du ticket)*
- [La Presse — un système numérique pour les caisses enregistreuses mis en place](https://lapresse.tn/2025/10/17/tunisie-un-systeme-numerique-pour-les-caisses-enregistreuses-mis-en-place/)
- [La Presse — la Tunisie impose la facturation électronique aux cafés et restaurants](https://www.lapresse.tn/2025/10/14/la-tunisie-impose-la-facturation-electronique-aux-cafes-et-restaurants-les-details/)
- [WMC — plateforme pour les fournisseurs et tests d'intégration](https://www.webmanagercenter.com/2025/10/17/553889/caisse-enregistreuse-la-tunisie-met-en-place-une-plateforme-pour-les-fournisseurs-et-tests-dintegration)
- [WMC — 1er novembre, entrée en vigueur de la loi sur les caisses](https://www.webmanagercenter.com/2025/11/03/555112/tunisie-1er-novembre-date-dentree-de-la-loi-relative-aux-caisses-enregistreuses)
- [Webdo — lancement du système d'homologation](https://www.webdo.tn/fr/actualite/national/tunisie-fiscalite-lancement-du-systeme-dhomologation-des-caisses-enregistreuses/385862/)
- [caisses.tn — caisses obligatoires en Tunisie](https://caisses.tn/caisses-obligatoires-en-tunisie/) *(éditeur)*
- [onemag — homologation NACEF, la caisse fiscale obligatoire](https://onemag.tn/homologation-nacef-caisse-fiscale-tunisie)

**Signature et code 2D (⚠ lien avec NACEF non confirmé)**

- [TunTrust — QR-Sign](https://www.tuntrust.tn/fr/content/qr-sign)
- [TN CEV 2D-Doc — gouvernance](https://www.tuntrust.tn/sites/default/files/DOCUMENTS/TN_CEV_2D-Doc_Gouvernance.pdf) · [spécifications techniques](https://www.tuntrust.tn/sites/default/files/DOCUMENTS/ANTS_2D-Doc-v3.0.0.pdf)

**Facture électronique**

- [La Presse — tout comprendre à la facture électronique qui s'impose en 2026](https://www.lapresse.tn/2026/01/07/tout-comprendre-a-la-facture-electronique-qui-simpose-en-tunisie-en-2026/)
- [Managers — qui est concerné, quelles sanctions, comment s'y préparer](https://managers.tn/2025/12/30/facture-electronique-en-tunisie-qui-est-concerne-quelles-sanctions-et-comment-sy-preparer-les-explications-de-kais-fekih/)
- [IA-Consult — ce que la Note commune 02/2026 change](https://ia-consult.tn/blog/facturation-electronique-2026-tunisie/)
- [El Fatoora — Tunisie TradeNet (TTN)](https://elfatoora.digital/index.php?lang=en)
- [EDICOM — l'état de la facture électronique en Tunisie](https://edicomgroup.com/blog/status-electronic-invoicing-tunisia)

**Paiement**

- [Kapitalis — hausse des paiements électroniques et recul des chèques (juin 2026)](https://kapitalis.com/tunisie/2026/06/07/tunisie-l-hausse-des-paiements-electroniques-et-recul-des-cheques/)
- [Managers — nouvelle circulaire BCT 2026-10, ce qui change pour les établissements de paiement](https://managers.tn/2026/09/26/nouvelle-circulaire-de-la-bct-voici-ce-qui-change-pour-les-etablissements-de-paiement/)
- [Business News — la BCT durcit les règles du paiement digital](https://businessnews.com.tn/2026/09/26/paiement-digital-la-bct-durcit-les-regles-dun-marche-qui-peine-encore-a-detroner-le-cash/1420291/)
- [Kapitalis — entrée en vigueur de la plateforme TuniCheque](https://kapitalis.com/tunisie/2025/02/03/entree-en-vigueur-aujourdhui-de-la-plateforme-tunicheque/)
- [AfricanManager — nouvelle loi sur les chèques, ce qui va changer](https://africanmanager.com/nouvelle-loi-sur-les-cheques-ce-qui-va-changer/)
- [AllAfrica — paiement digital, une alternative fiable au chèque (déc. 2024)](https://fr.allafrica.com/stories/202412070234.html)
