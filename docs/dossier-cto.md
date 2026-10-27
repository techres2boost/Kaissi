# Dossier CTO — ce qu'il faut savoir, et le suivi

**Date** : 27 octobre 2026 · **Pour** : le CTO · **Mise à jour** : à chaque
décision prise. Le §10 est le tableau de suivi ; le reste explique pourquoi
une ligne y est.

Ce document ne remplace ni [`CLAUDE.md`](../CLAUDE.md) (les règles qui ne se
contournent pas) ni [`system-design.md`](system-design.md) (le pourquoi
technique). Il répond à une autre question : **qu'est-ce qui peut tuer ce
produit, et qu'est-ce que j'arbitre ?**

---

## 1. Le produit en une phrase

> Kaissi est une caisse de restaurant **dont l'encaissement ne s'arrête
> jamais**. Tout le reste — stock, recettes, CRM, rapports — est du logiciel
> de gestion classique, que n'importe qui sait écrire.

**C'est la seule contrainte qui a façonné l'architecture**, et c'est aussi le
seul argument qu'aucun concurrent tunisien ne peut copier sans réécrire son
produit ([`positionnement-marche-tunisien.md`](positionnement-marche-tunisien.md)).

Trois conséquences que vous devez pouvoir défendre devant n'importe qui :

1. **Le code de la caisse est dans l'APK**, jamais sur un serveur. Pas de
   `server.url`, pas de TWA. Une WebView qui charge son code depuis le réseau
   ne s'ouvre pas quand le réseau tombe — ce n'est pas un problème de données,
   c'est l'application entière qui manque.
2. **Aucun aller-retour serveur sur le chemin de la caisse.** Ajouter un
   article doit rester sous les 50 ms. Pas de Server Action, pas de Server
   Component. Next.js est réservé au back-office, où il est le bon outil.
3. **Les commandes sont un journal d'événements**, pas des lignes mutables.
   Deux tablettes hors ligne qui ajoutent chacune un article à la table 12
   donnent une commande à trois articles, sans conflit. C'est ce qui fait
   disparaître 90 % des conflits au lieu de les arbitrer.

---

## 2. L'état réel — mesuré le 27 octobre 2026

### En production

| | Valeur | Commentaire |
|---|---|---|
| Organisations | **8** | Toutes de démonstration |
| Établissements | **9** | Idem |
| Caisses actives (non révoquées) | **33** | Nos appareils de test et de démo |
| Événements de commande | **651** | |
| Ventes closes | **96** | Pour **13 276,270 TND** de chiffre simulé |
| Dernière vente | 24/10/2026 | |
| Taille de la base | **16 Mo** | Sur 500 Mo de l'offre gratuite |
| Avis de sécurité Supabase | **1** | Protection « mot de passe compromis » désactivée (exige l'offre Pro) |
| **Clients payants** | **0** | — |

> **À dire tel quel, à tout le monde.** Il n'y a aucun client. Les 9
> établissements sont des démonstrations. Toute affirmation du type « déjà
> déployé chez X restaurants » serait fausse, et se vérifie en une requête.

### Le code

| | Valeur |
|---|---|
Âge du dépôt | **6 semaines** (premier commit le 14 septembre 2026)
Commits | 50
Lignes de TypeScript | ≈ **67 500** (back-office 27 500 · POS 11 000 · sync 8 900 · domaine 7 300 · base locale 8 400 · i18n 2 600 · impression 1 200)
Fichiers de tests | **110**
Migrations Postgres | **49**
Migrations SQLite locales | **19**
Jobs de CI | **10**, dont le banc à trois appareils contre un vrai PostgreSQL
Dépendances directes du POS | **13**
Dépendances directes du service de sync | **5** (`hono`, `@hono/node-server`, `pg`, `web-push`, `@kaissi/domain`)

**Les deux derniers chiffres sont un actif, pas une anecdote.** Une caisse
avec treize dépendances directes a une surface d'attaque et une dette de mise
à jour minuscules. C'est délibéré, et il faut le défendre : chaque
bibliothèque ajoutée au POS est une chose de plus qui peut casser le mode
avion.

### L'infrastructure

| Morceau | Où | Région | Offre |
|---|---|---|---|
| Base + Auth | Supabase (projet `mzrbpbqpkpbbndtijipw`, PostgreSQL 17.6) | **eu-central-1** (Francfort) | **Gratuite** |
| Service de synchronisation | Railway, redéploiement auto depuis `main` | — | Gratuite |
| Back-office | Vercel | — | Gratuite |
| Publication mobile | Codemagic → Play (test fermé) + TestFlight | — | — |

---

## 3. Les huit règles — et ce que coûte d'en casser une

Elles sont dans [`CLAUDE.md`](../CLAUDE.md). Ce qui suit est ce qu'un CTO doit
en retenir : **le prix de l'erreur**, parce que c'est ce qui justifie de
refuser un raccourci en revue de code.

| Règle | Ce qui arrive si on la casse |
|---|---|
| **1. Millimes entiers, jamais de flottant** | Le dinar a **trois** décimales. Une bibliothèque qui suppose « centimes = ×100 » produit des écarts de caisse silencieux, découverts après des mois de production — et inexplicables au client |
| **2. UUIDv7 généré par l'appareil** | Une tablette ne pourrait pas ouvrir une commande sans réseau. Tout le produit tombe |
| **3. `organization_id` ET `restaurant_id` partout** | L'ajouter après coup sur 40 tables et 500 millions de lignes : plusieurs mois. Maintenant : vingt minutes |
| **4. Curseur = bigserial serveur, jamais un timestamp** | Les horloges des tablettes dérivent et changent de fuseau. Un curseur temporel **perd des événements sans qu'on sache lesquels** |
| **5. Index unique sur l'identifiant d'événement** | C'est **la** garantie « jamais de double encaissement ». Sans elle, tout l'édifice tombe |
| **6. `order_events` et `audit_events` en insertion seule** | Plus de journal inaltérable : l'argument fiscal **et** la confiance du client disparaissent ensemble |
| **7. Les totaux à UN SEUL endroit** | Dupliquer le calcul produit des écarts de caisse impossibles à expliquer. C'est le pire des bugs : il a l'air juste |
| **8. Français** | Cohérence du dépôt et des messages d'erreur vus par le client |

**La nuance de la règle 7, à connaître**, parce qu'elle revient en revue :
une **règle** (arrondir la TVA par taux puis sommer) vit dans
`packages/domain` et nulle part ailleurs. Une **somme** d'entiers déjà décidés
n'est pas une décision — c'est ce qui autorise `kaissi.rapport_ventes()` à
additionner dans PostgreSQL au lieu de faire remonter cinquante mille lignes.
La frontière n'est pas déclarative : `apps/sync/test/rapports-agreges.test.ts`
fait tourner **les deux chemins** sur le même jeu de ventes et exige l'égalité
au millime.

---

## 4. Les risques — par ordre de ce qui peut tuer le produit

### R1 🔴 L'homologation NACEF — le seul vrai bloquant

Un restaurant exploité **en société** est, depuis juillet 2026, probablement
tenu d'utiliser une caisse homologuée. Lui vendre Kaissi aujourd'hui, c'est
lui vendre un risque d'amende.

Et nous **ne savons pas ce qu'exige le cahier des charges** — en particulier
pour une vente faite hors ligne, qui est notre raison d'être. Les trois
scénarios vont de « quelques semaines » à « remise en cause du
positionnement ».

**Détail, calendrier, sources et les douze questions à poser** :
[`conformite-fiscale.md`](conformite-fiscale.md).

**Action** : télécharger le cahier des charges cette semaine. Rien n'est plus
urgent, et rien d'autre ne débloque la vente.

### R2 🔴 La propriété du code — personne ne l'a lu en entier

| | |
|---|---|
| Commits par **Claude** | 35 sur 50 |
| Commits par **Salem Haddad Becha** | 15 sur 50 |
| Humains ayant lu `apps/sync/src/depot-postgres.ts` en entier | **à vérifier — probablement zéro** |

**Le risque n'est pas que l'IA s'en aille.** C'est qu'un samedi à 21 h, une
caisse ne remonte plus rien et que **personne dans l'équipe ne sache lire
`reprojeter()`**. C'est exactement ce qui est arrivé le 23 octobre : la panne
`order_events_device_id_seq_device_key` a demandé de comprendre l'interaction
entre un compteur local, la reprise d'installation (migration 0021) et une
contrainte d'unicité. Ce diagnostic-là ne s'improvise pas.

**Ce qui atténue, et c'est solide** : `CLAUDE.md` dit *pourquoi* chaque
décision a été prise, 110 fichiers de tests figent le comportement, et chaque
migration porte son commentaire de panne. **C'est l'actif le plus précieux du
dépôt** — plus que le code lui-même, parce que c'est lui qui rend le code
reprenable.

**Ce qu'il faut faire** : désigner un **propriétaire humain pour chacune des
quatre zones critiques**, avec obligation de pouvoir en expliquer le
fonctionnement sans relire :

| Zone | Pourquoi elle est critique | Propriétaire |
|---|---|---|
| `packages/domain` | Tout l'argent passe par là | **à désigner** |
| `apps/sync` (push, pull, reprojection) | Toute vente passe par là | **à désigner** |
| `packages/db-local` (migrations) | Une migration à moitié appliquée sur une tablette à Sfax **n'est pas réparable à distance** | **à désigner** |
| `apps/pos` (session de caisse, outbox) | C'est là que l'argent est saisi | **à désigner** |

### R3 🟠 Zéro client réel — on ne sait pas ce qui manque vraiment

Six semaines de développement, 110 fichiers de tests, et **aucun service réel
un samedi soir**. Tout ce que nous croyons savoir sur les manques vient d'un
benchmark et de notre raisonnement.

L'expérience dit que les trois premiers irritants d'un vrai service ne seront
pas dans notre liste. Deux exemples déjà vus **en démonstration**, qu'aucun
test ne montrait : le bandeau débordait sur un vrai iPhone, et un ajout envoyé
après « prêt » arrivait en cuisine déjà coché.

**Ce qu'il faut faire** : un pilote encadré de 3 à 5 établissements, choisis
parmi ceux que l'obligation **ne vise pas encore** (⚠ à faire trancher client
par client par l'expert-comptable), installés et suivis par vous chaque
semaine. **Pas de vente ouverte avant.**

### R4 🟠 L'exploitation — on apprend les pannes par le client

| Sujet | État | Conséquence |
|---|---|---|
| **Collecte d'erreurs** | ❌ Aucune (pas de Sentry) | Une erreur de back-office n'est connue que si le client appelle |
| **Alerte active** | ❌ L'écran Surveillance *montre*, il ne *prévient* pas | Le service peut être tombé depuis trois heures sans que personne le sache |
| **Sauvegardes** | ⚠ Celles de l'offre gratuite, **jamais restaurées** | Une sauvegarde non testée n'est pas une sauvegarde |
| **PITR** | ❌ Exige l'offre Pro | Pas de retour en arrière fin après une erreur humaine |
| **Astreinte** | ❌ Personne | « Qui répond le samedi soir ? » n'a pas de réponse |
| **Mots de passe compromis** | ⚠ Exige l'offre Pro ; un garde-fou maison refuse les plus courants | Partiellement couvert |
| **Migrations Postgres** | ⚠ Appliquées **à la main** | Oublier une migration met `/sante` en 503 — c'est voulu, et ça a déjà sauvé un déploiement (0045) |

**Le plus urgent des six : l'alerte.** Une sonde externe sur `/sante` qui
envoie une notification coûte une heure et change la nature du service rendu.

### R5 🟠 Les dépendances d'infrastructure — quatre fournisseurs, aucun contrat

| Fournisseur | Ce qu'il porte | Si ça tombe | Porte de sortie |
|---|---|---|---|
| **Supabase** | Base, Auth, RLS | Les caisses **continuent d'encaisser** ; rien ne remonte | PostgreSQL est portable ; Auth (GoTrue) est le point d'accroche |
| **Railway** | Service de synchronisation | Idem | `fly.io` ou Render, documenté ([`deploiement.md`](deploiement.md) §2) |
| **Vercel** | Back-office | Le patron ne voit plus ses rapports ; les caisses tournent | Next.js s'héberge ailleurs |
| **Codemagic** | Publication mobile | On ne publie plus | Les builds se font à la main (`pnpm pos:aab`) |
| **Apple / Google** | Distribution | 🔴 Pas de porte de sortie sur iOS | Sur Android, un APK s'installe hors magasin (`pnpm pos:apk`) |

> **Le point rassurant, et il mérite d'être dit en clientèle** : si Supabase,
> Railway et Vercel tombent tous les trois en même temps, **les restaurants
> continuent d'encaisser**. Aucun concurrent cloud ne peut en dire autant.

**Le risque réel est Apple** : la règle 3.1.1 (achat intégré). Kaissi se vend
à des entreprises, hors application — c'est une position **défendable, pas un
fait acquis**, et c'est Apple qui tranche ([`stores.md`](stores.md)).

### R6 🟡 Le volume de la base — l'offre gratuite ne tient pas une clientèle

Mesuré : **7 à 10 Ko par ticket** avec les index.

| Restaurant | Tickets/jour | Par mois | Par an |
|---|---|---|---|
| Petit snack | 100 | ~25 Mo | ~300 Mo |
| Restaurant actif | 300 | ~75 Mo | ~900 Mo |

L'offre gratuite (500 Mo) tient la démonstration et deux ou trois pilotes
quelques mois. **Dix restaurants actifs la saturent en un an.** Le passage à
l'offre Pro débloque aussi les sauvegardes téléchargeables, le PITR et la
protection des mots de passe : c'est **la première dépense à engager**.

**Et on ne purge pas les ventes** — une vente est une pièce comptable. Ce qui
est purgé automatiquement : le registre d'idempotence (`sync_mutations`, 30
jours pour les ventes, 180 pour les créations de catalogue) et les marqueurs
« prêt » (7 jours). ⚠ La durée de conservation légale relève de
l'expert-comptable.

### R7 🟡 Le nom — « KAISSE » existe et vise les mêmes clients

`kaisse.tn` vend une caisse aux cafés et restaurants tunisiens, avec le même
discours, sous un nom quasi identique. Si leur marque est déposée, **c'est
nous qui devrons changer** — plus tard, et plus cher.

À trancher **avant le dépôt d'homologation**, qui se fera sous un nom de
produit. Propositions et analyse :
[`nom-du-produit.md`](nom-du-produit.md) (« Dima » recommandé).

Ce qui ne change pas si on renomme : l'`applicationId` Play et le bundle id
iOS (ils ne se modifient jamais après publication, et personne ne les voit),
et les noms internes (`@kaissi/*`, schéma `kaissi`).

### R8 🟡 Le juridique — rien n'est écrit

- **CGV / CGU** : inexistantes. Elles doivent dire ce qu'on garantit **et ce
  qu'on ne garantit pas** — notamment qu'une tablette perdue avant
  synchronisation perd ses ventes non remontées (l'écran de révocation le dit
  déjà au gérant).
- **Contrat de traitement** avec chaque restaurant : nous traitons les données
  de *leurs* clients (fiche client, téléphone).
- ⚠ **Transfert de données hors de Tunisie.** La base est à **Francfort**.
  Les données personnelles de clients tunisiens traversent donc la frontière.
  C'est une **question à poser à un juriste tunisien** : y a-t-il une
  déclaration ou une autorisation à obtenir auprès de l'instance nationale de
  protection des données ? Je n'ai pas pu vérifier le texte applicable, et
  **ce n'est pas une question à trancher par raisonnement** : si une
  autorisation ou un hébergement local est exigé, cela change le choix
  d'infrastructure, donc autant le savoir avant d'y mettre dix clients.

### R9 🟢 Le pari du moteur de synchronisation maison

La règle avait été écrite **à l'avance** : si la synchronisation n'est pas
fiable en test avec trois appareils et des coupures réseau, on bascule sur
**PowerSync**, sans débat. Le banc passe contre un vrai PostgreSQL : aucune
vente perdue, aucune dupliquée, totaux identiques au millime. **Le moteur
maison est conservé.**

Mais le vrai test n'est pas le banc : c'est cinquante restaurants, trois
tablettes chacun, des réseaux tunisiens, pendant six mois.
**Gardez la porte de sortie documentée** et ne la refermez pas par
commodité.

---

## 5. Les coûts

### Aujourd'hui

Essentiellement **zéro** : toutes les offres sont gratuites. C'est tenable
pour la démonstration, pas pour des clients.

### Ce qu'il faut budgéter (⚠ tarifs à vérifier sur les pages des éditeurs)

| Poste | Quand | Pourquoi |
|---|---|---|
| **Supabase Pro** | **Maintenant** | 8 Go, sauvegardes téléchargeables, PITR, protection des mots de passe. C'est le déblocage de trois risques d'un coup (R4, R6) |
| Railway payant | Au premier client | Un service qui ne s'endort pas |
| Sentry | Semaine 3 | Arrêter d'apprendre les pannes par le client |
| Sonde externe sur `/sante` | Semaine 3 | Une heure de travail, change tout |
| **Expert-comptable** | **Semaine 1** | Le point qui débloque la vente |
| **Juriste** | Semaine 2 | CGV, traitement des données, transfert hors Tunisie |
| **Dossier d'homologation NACEF** | Dès lecture du cahier des charges | ⚠ Coût inconnu — à faire chiffrer |
| 2–3 imprimantes thermiques du marché | Semaine 2–3 | Valider l'impression sur du vrai matériel |
| Compte développeur Apple | Déjà engagé | — |

---

## 6. Ce qui manque fonctionnellement

Détail complet et effort estimé :
[`fonctionnalites-manquantes.md`](fonctionnalites-manquantes.md).

| Manque | Gravité | Effort |
|---|---|---|
| **Impression** (écrite et testée, **éteinte**) | 🟠 Un restaurant attend du papier | Peu de code ; **1 à 2 semaines de terrain** |
| **Diviser l'addition en parts égales** | 🟠 Demandé à chaque service en salle | 1 à 2 jours |
| Diviser l'addition **par articles** | 🟡 | 1 à 2 semaines (touche au domaine) |
| **Z fiscal** (compteurs cumulés, numéro de clôture) | ⚠ Dépend du cahier des charges NACEF | Moyen |
| Fusionner deux tables | 🟡 | Moyen |
| Services (entrée, plat, dessert) | 🟡 Restauration assise | Moyen |
| Pourboire, reçu par SMS | 🟢 Peu demandé en Tunisie | Faible |

**Déjà fait et qu'il ne faut pas reconstruire** : annuler/libérer une table,
transférer une table, prix libre, remboursement (y compris partiel d'une
ligne), pointeuse, ticket Z de gestion, création d'articles depuis la caisse
hors ligne, arabe complet avec RTL.

---

## 7. Ce qu'il ne faut PAS faire

Cette liste vaut un budget. Chaque ligne est une proposition qui reviendra,
avec de bonnes raisons apparentes.

| Ne pas faire | Pourquoi, en une phrase |
|---|---|
| **Un `server.url` ou une TWA Bubblewrap** — « juste pour aller vite sur le Play Store » | Le **code** de l'application viendrait du réseau : sans connexion, elle ne s'ouvre pas |
| **Une Server Action sur le chemin de la caisse** | Chaque aller-retour rend la caisse inutilisable en service, et impossible hors ligne |
| **Synchroniser des lignes mutables** plutôt que des événements | On retombe dans l'arbitrage de conflits qu'on a passé six semaines à faire disparaître |
| **Un flottant pour de l'argent**, ou supposer deux décimales | Écarts de caisse silencieux, découverts des mois plus tard |
| **Un timestamp comme curseur de synchronisation** | Des événements perdus, sans savoir lesquels |
| **Bloquer une vente sur une donnée de stock périmée** | Refuser de vendre une pizza sur un souvenir de trois heures est le pire des deux mondes |
| **Exposer la clé `service_role` côté client** | Le cloisonnement entre restaurants reposerait sur la vigilance de chaque `where` écrit à la main |
| **Créer un compte `auth.users` en SQL** | GoTrue échoue sur un `NULL` au lieu de `''` : « E-mail ou mot de passe incorrect », sans que rien ne dise pourquoi. **Vu en production** |
| **Toucher au flux d'argent** (encaissement intégré) | On entre dans le périmètre des établissements de paiement : agrément BCT, capital, contrôle prudentiel ([`conformite-fiscale.md`](conformite-fiscale.md) §4) |
| **Supprimer une partie du module d'impression** « puisqu'elle ne sert pas » | Les règles qu'il porte sont celles du jour où on le rallume, et `kitchen_sends` sert déjà |
| **Téléverser un AAB à la main** | Il consommerait un `versionCode` que la CI croirait libre, et Play ne libère jamais un numéro |
| **Ouvrir la vente sans le point fiscal** | Un bug d'interface se corrige en une heure ; une non-conformité découverte chez cinquante clients, non |
| **Construire fidélité, livraison, QR, vitrine** | Exclus du périmètre, et à relier plutôt qu'à reconstruire |
| **Partir sur bornes de commande, réservations, API publique** | Hors cible aujourd'hui |

---

## 8. Les décisions qui vous appartiennent

Elles ne sont pas techniques : elles arbitrent entre des risques. Personne
d'autre ne peut les prendre.

| # | Décision | Les termes | Ma recommandation |
|---|---|---|---|
| **D1** | **Homologation : construire ou s'associer ?** | Développer notre MDF (contrôle total, délai inconnu) ou s'adosser à un acteur déjà accrédité (plus vite, dépendance) | **Décider après lecture du cahier des charges**, pas avant. Si le scénario « boîtier matériel » se confirme, l'association redevient sérieuse |
| **D2** | **Le nom** | Garder « Kaissi » (risque KAISSE) ou renommer avant l'homologation | **Renommer**, et avant le dépôt. Le coût ne fera que monter |
| **D3** | **Le prix et le modèle** | 29 TND/mois (bas de marché), 59–89 TND (notre recommandation), ou achat unique à la tunisienne | **Les deux** : un abonnement par établissement et une formule payée une fois ([`positionnement-marche-tunisien.md`](positionnement-marche-tunisien.md) §6) |
| **D4** | **Impression : maintenant ou après le pilote ?** | La rallumer demande du matériel et une semaine de service réel | **Maintenant, chez un seul client équipé.** Un restaurant sans ticket papier, ça se saura au premier contrôle |
| **D5** | **Supabase Pro : maintenant ou au premier client ?** | Une dépense contre trois risques levés | **Maintenant.** C'est la moins chère des assurances |
| **D6** | **Qui est d'astreinte le samedi soir ?** | Un nom, un numéro, dans le contrat | À trancher **avant** le premier client, pas après le premier incident |
| **D7** | **Moteur de synchronisation** | Maison (tenu) ou PowerSync | **Maison**, et garder la porte de sortie documentée. À réexaminer à 50 établissements |
| **D8** | **Hébergement des données** | Francfort, ou local si le droit tunisien l'exige | ⚠ **Question au juriste avant d'y mettre dix clients** (R8) |

---

## 9. Ce qui est solide — pour ne pas tout noircir

Un dossier de risques donne une image fausse si on ne dit pas ce qui tient.
Tout ce qui suit est **mesuré, pas affirmé** :

| Garantie | La preuve |
|---|---|
| Encaissement hors ligne, **sans plafond ni expiration** | `verifier-mode-avion.mjs`, vérifié à chaque PR |
| **Aucune vente perdue ni dupliquée**, trois appareils, coupures franches et aléatoires | `apps/sync/test/banc-trois-appareils.test.ts`, contre un vrai PostgreSQL |
| Montée en charge : 1 → 50 caisses, 100 commandes/h × 800 | [`charge-et-securite.md`](charge-et-securite.md) |
| Stress : 1000 commandes dans un établissement, jusqu'à **400 caisses** | Aucune vente perdue ni doublée, même au-delà de la limite |
| Totaux **identiques au millime** entre la caisse et le serveur | `rapports-agreges.test.ts` fait tourner les deux chemins |
| **Isolation entre clients** | RLS forcée sur toutes les tables, aucun privilège `anon`, clé publique seule au back-office, garde de CI |
| **Aucune vente ne peut être modifiée** | Insertion seule + déclencheur de blocage, audit chaîné par hash |
| Une **migration manquante ne casse pas la production** | `/sante` répond 503 `schema_incomplet`, Railway ne bascule pas le trafic |
| Une **commande incalculable n'arrête pas le lot** | `ErreurCalcul` isolée par commande dans `reprojeter()` |
| Deux langues, **arabe RTL complet** | Couverture vérifiée en CI : un texte en dur fait échouer la PR |
| Téléphone **et** tablette | Largeurs 390 et 320 px testées à chaque PR, en français et en arabe |
| Publication automatique | Push sur `main` → Play (test fermé) + TestFlight |

---

## 10. Tableau de suivi

**Légende** : 🔴 bloque la vente · 🟠 à faire avant le pilote · 🟡 à faire
avant la vente ouverte · 🟢 plus tard · ⛔ décidé : on ne le fait pas.

Mettez ce tableau à jour à chaque décision. Une ligne qui change d'état sans
que personne ne le note est une ligne qu'on refera.

### Conformité et juridique

| # | Point | État | Priorité | Qui | Verdict |
|---|---|---|---|---|---|
| F1 | Télécharger le cahier des charges NACEF (`homologation.nacef.tn`) | ❌ | 🔴 | CTO | **À faire cette semaine** |
| F2 | Répondre à « comment une vente hors ligne est-elle sécurisée puis transmise ? » | ❌ | 🔴 | CTO | À faire — **chiffre tout le projet** |
| F3 | Vérifier la liste officielle des systèmes homologués | ❌ | 🔴 | CTO | À faire |
| F4 | Séance expert-comptable, 12 questions écrites, réponses dans le dépôt | ❌ | 🔴 | Direction | À faire semaine 1 |
| F5 | Références exactes des textes (JORT) archivées | ❌ | 🔴 | Expert-comptable | À faire |
| F6 | Module MDF (sécurisation des données fiscales) | ❌ | 🔴 | — | **En attente de F1** |
| F7 | QR code + identifiant MDF sur le ticket | ❌ | 🔴 | — | En attente de F1 |
| F8 | Transmission vers la plateforme du ministère | ❌ | 🔴 | — | En attente de F1 |
| F9 | Z fiscal (compteurs cumulés, numéro de clôture) | ❌ | 🔴 | — | En attente de F1 |
| F10 | Processus fournisseur : certificat client, SAV, déclaration des maintenances | ❌ | 🟠 | Direction | À faire — **organisationnel** |
| F11 | Inscription TTN / El Fatoora **pour Res2Boost** | ❌ | 🟠 | Direction | À faire avant le 1ᵉʳ client payant |
| F12 | Taux de TVA restauration, droit de timbre, durée de conservation | ⚠ | 🔴 | Expert-comptable | À faire valider |
| F13 | CGV / CGU | ❌ | 🟠 | Juriste | À faire |
| F14 | Contrat de traitement des données (par restaurant) | ❌ | 🟠 | Juriste | À faire |
| F15 | ⚠ Transfert des données hors de Tunisie (base à Francfort) | ❌ | 🟠 | Juriste | **À instruire avant 10 clients** |

### Produit

| # | Point | État | Priorité | Qui | Verdict |
|---|---|---|---|---|---|
| P1 | Impression : valider sur 2–3 imprimantes du marché, puis rallumer | 🟡 Écrite, testée, éteinte | 🟠 | CTO | **À faire** (D4) |
| P2 | Diviser l'addition en parts égales | ❌ | 🟠 | — | À faire — 1 à 2 jours |
| P3 | Diviser l'addition par articles | ❌ | 🟡 | — | Après le pilote |
| P4 | Fusionner deux tables | ❌ | 🟡 | — | Après le transfert (fait) |
| P5 | Services (entrée, plat, dessert) | ❌ | 🟢 | — | Plus tard |
| P6 | Pourboire, reçu par SMS ou e-mail | ❌ | 🟢 | — | Plus tard |
| P7 | Facturation client (module de factures) | ⛔ | — | — | **Exclu** — mais ne dispense pas de F1 |
| P8 | Fidélité, livraison, menu QR, vitrine | ⛔ | — | — | **Exclu** — à relier, pas à reconstruire |
| P9 | Bornes de commande, réservations, API publique | ⛔ | — | — | **Hors cible** |
| P10 | Terminal de paiement carte intégré | ⛔ | — | — | **Ne jamais toucher au flux d'argent** (§7) |

### Exploitation

| # | Point | État | Priorité | Qui | Verdict |
|---|---|---|---|---|---|
| E1 | Supabase Pro (8 Go, PITR, sauvegardes, mots de passe) | ❌ | 🟠 | CTO | **À faire maintenant** (D5) |
| E2 | **Restaurer une sauvegarde pour de vrai**, une fois | ❌ | 🟠 | CTO | À faire — une sauvegarde non testée n'en est pas une |
| E3 | Sentry (collecte d'erreurs) | ❌ | 🟠 | — | À faire semaine 3 |
| E4 | Sonde externe sur `/sante` avec alerte | ❌ | 🟠 | — | **À faire — une heure de travail** |
| E5 | Astreinte : un nom, un numéro, dans le contrat | ❌ | 🟠 | Direction | À faire (D6) |
| E6 | Protection « mot de passe compromis » | ⚠ Partielle | 🟡 | CTO | Avec E1 |
| E7 | Purge de `sync_mutations` | ✅ 30/180 jours | — | — | Fait |
| E8 | Processus de facturation de l'abonnement | ❌ | 🟠 | Direction | Tableur pour 5 pilotes ; processus au-delà |
| E9 | Environnement de recette distinct de la production | ❌ | 🟡 | CTO | À instruire — les migrations s'appliquent à la main |

### Organisation et marché

| # | Point | État | Priorité | Qui | Verdict |
|---|---|---|---|---|---|
| O1 | Propriétaire humain pour chacune des 4 zones critiques | ❌ | 🔴 | CTO | **À faire** (R2) |
| O2 | Trancher le nom du produit | ❌ | 🟠 | Direction | **À faire avant l'homologation** (D2) |
| O3 | Trancher le prix et le modèle | ❌ | 🟠 | Direction | À faire (D3) |
| O4 | Tester les concurrents, Wi-Fi coupé, en vidéo | ❌ | 🟠 | CTO | À faire — **une après-midi, meilleur support de vente** |
| O5 | Demander un devis à ASM, TMS, Numedia | ❌ | 🟡 | Direction | À faire |
| O6 | Pilote encadré : 3 à 5 établissements non visés par l'obligation | ❌ | 🟠 | Direction | Après P1, P2 et F4 |
| O7 | Passage en production Play + soumission App Store | ❌ | 🟡 | CTO | Après le pilote |
| O8 | Réexaminer le moteur de synchronisation | ✅ Tenu | 🟢 | CTO | À 50 établissements (D7) |

---

## 11. Si je devais résumer en cinq lignes

1. **La technique n'est pas le problème.** Ce qui bloque la vente est fiscal,
   contractuel et organisationnel — rien de tout cela ne se règle en écrivant
   du code.
2. **Un seul chantier compte : l'homologation NACEF.** Et il commence par
   télécharger un document.
3. **Le plus grand risque interne est que personne n'ait lu le code.** Quatre
   propriétaires humains, cette semaine.
4. **Zéro client. C'est le chiffre à regarder**, pas les 110 fichiers de
   tests. Un pilote de cinq restaurants apprendra plus que deux mois de
   développement.
5. **Ce qui est construit est solide et rare.** Encaisser sans réseau, sans
   jamais perdre ni doubler une vente, exact au millime, avec un journal que
   personne ne peut modifier — c'est ça qui ne se copie pas.
