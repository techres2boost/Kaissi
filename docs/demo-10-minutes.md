# Kaissi — la démo en 10 minutes

**Pour qui** : la personne qui présente à l'équipe.
**Le fil rouge, à dire en ouvrant** : *« Deux applications, la caisse et le
back-office. Une promesse : la caisse ne s'arrête jamais, même sans
Internet. »*

Le guide complet (2 heures, toutes les fonctions) reste
[`demo.md`](demo.md). Ce document-ci est un **scénario** : on le suit ligne
par ligne, sans improviser.

---

## Avant la démo — 15 minutes avant, hors chrono

| ✓ | À préparer |
|---|---|
| ☐ | `https://kaissi-production.up.railway.app/sante` répond `"etat":"ok"`. Sinon, pas de démo : rien n'arriverait au back-office. |
| ☐ | **Écran 1 — la caisse** : tablette Android avec l'application, ou `https://kaissi-pos.vercel.app` dans Chrome. Mise en service sur **Snack Lac 1** (☰ → Synchronisation → « À jour »). Aucune caisse ouverte : si une l'est, ☰ → **Clôturer la caisse**. Laisser l'écran sur **Prise de poste**. |
| ☐ | **Écran 2 — le back-office** : `https://kaissi-backoffice.vercel.app`, compte administrateur, page **Tableau de bord**. |
| ☐ | **Écran 3 — la cuisine** : fenêtre privée, compte **cuisine** (sinon, un 2ᵉ onglet du back-office admin) → **Préparation**. |
| ☐ | **Couper Internet** doit prendre 2 secondes : mode avion sur la tablette, ou Chrome → F12 → onglet *Network* → *Offline*. Le tester une fois. |
| ☐ | Un **téléphone** avec l'application installée (Play, test fermé, ou TestFlight) — pour la dernière minute. |
| ☐ | Une **répétition à blanc** du scénario, puis ☰ → Clôturer la caisse pour repartir de zéro. |

Les codes : **Karim** (serveur) `9753` · **Salma** (caissière) `2468` ·
**Ahmed** (gérant) `1357`.

---

## Le scénario — vue d'ensemble

| Chrono | Séquence | Ce qu'on montre |
|---|---|---|
| 0:00 – 0:30 | 1. Le pitch | Les trois écrans, une phrase |
| 0:30 – 1:30 | 2. La journée commence | Pointeuse, prise de poste au PIN, fond de caisse |
| 1:30 – 3:00 | 3. Une commande | Rupture de stock, options, prix libre, envoi cuisine, « Prêt » |
| 3:00 – 4:30 | 4. **Internet coupé** | Remise, encaissement, ticket — sans réseau, puis tout remonte |
| 4:30 – 5:15 | 5. Un remboursement | 1 Coca sur 2, autorisé par le gérant |
| 5:15 – 5:45 | 6. L'arabe | La caisse se retourne de droite à gauche |
| 5:45 – 8:15 | 7. Le back-office | Chiffre du jour, TVA, ticket, stock, heures |
| 8:15 – 9:15 | 8. La clôture | Comptage, écart, rapport Z |
| 9:15 – 10:00 | 9. Sur un téléphone, et la suite | La même caisse dans la poche ; ce qui reste à faire |

---

## Le scénario — pas à pas

### 1. Le pitch — 0:00 → 0:30

Montrer les trois écrans, de gauche à droite : *« La caisse, celle du
serveur. Le back-office, celui du patron. L'écran de la cuisine. »*

### 2. La journée commence — 0:30 → 1:30

1. **Caisse** : sous la prise de poste, **Pointer mon arrivée ou ma sortie**
   → **Karim Jelassi** → `9753` → **Pointer l'arrivée** → **OK**.
   *« Karim arrive. Il pointe sans prendre la caisse. »*
2. **Salma Trabelsi** → `2468`.
   *« Le code dit QUI fait chaque geste. »*
3. Fond de caisse : `5` `0` → **Ouvrir la caisse**.

### 3. Une commande — 1:30 → 3:00

1. Touche la **table 3**.
2. Touche **Pizza Margherita** → le message dit qu'elle est **en rupture**.
   *« Le stock est à zéro : le serveur l'a retirée de la carte, tout
   seul. »*
3. **Escalope panée frites** → la cuisson est **obligatoire** : **À point**
   → **Ajouter**. *« Sans cuisson, la cuisine ne recevrait pas le plat. »*
4. Catégorie **Boissons** → **Coca-Cola 33cl**, puis **+** sur la ligne
   → 2 Coca.
5. Tuile **Prix libre** (en fin de carte) → montant `3` → désignation
   `Supplément sauce` → **Ajouter**.
   *« Ce qui n'est pas à la carte s'encaisse quand même. »*
6. **Cuisine**.
7. **Écran 3** : la commande arrive — l'escalope côté **Cuisine**, les Coca
   côté **Bar**, **aucun montant**. Toucher **Prêt**.
8. **Caisse** : retour à la **Salle** → bandeau **« Prêt à servir · Table
   3 »** (quelques secondes ; sinon ☰ → Synchronisation → Synchroniser
   maintenant).

### 4. Internet coupé — 3:00 → 4:30 ⭐ le moment fort

1. **Couper Internet.** Le bandeau de la caisse passe hors ligne.
   *« Le Wi-Fi du restaurant vient de tomber. Un samedi soir. »*
2. Table 3 → **Remise** → **Happy hour** (10 %).
3. **Encaisser** → **Espèces** → la première suggestion (le compte juste).
   La note est soldée : la vente se clôt seule, sans second bouton.
4. Le **ticket** s'affiche à l'écran, la monnaie à rendre en grand
   au-dessus → **Terminer**.
   *« Encaissé. Sans réseau. La vente attend sur la tablette. »*
5. **Rétablir Internet.** Le compteur d'attente redescend à 0, l'état repasse
   « À jour ».
   *« Tout est remonté. Une vente n'est jamais perdue, ni comptée deux
   fois. »*

### 5. Un remboursement — 4:30 → 5:15

1. ☰ → **Reçus** → le premier ticket → **Rembourser…**
2. Coche **2 × Coca-Cola** → **−** une fois → « 1 sur 2 ».
3. Motif **Client mécontent** → **Rendre …**
4. **Autorisation requise** : **Ahmed** → `1357`.
   *« Salma demande, le gérant autorise. Son nom reste dans le journal.
   Rien n'est effacé : le remboursement s'ajoute. »*
5. Fermer, ☰ → **Ventes** pour revenir à la salle.

### 6. L'arabe — 5:15 → 5:45

☰ → **Langue** → **العربية** → la caisse se retourne de droite à gauche,
les montants restent lisibles. ☰ → **Langue** → **Français**.

### 7. Le back-office — 5:45 → 8:15

Sur l'**écran 2** :

1. **Tableau de bord** (rafraîchir) : la vente de la table 3 est là.
   *« Ce qui a été encaissé hors ligne il y a deux minutes. »*
2. **Rapports → Récapitulatif des ventes** : la **TVA par taux**, la
   remise, et la ligne **Remboursements**.
3. **Rapports → Reçus** → le ticket de la table 3 : le même ticket qu'à la
   caisse, avec « Remboursé ».
4. **Articles → Stock** : le **Coca a baissé** ; la **Pizza** est en
   rupture.
5. **Rapports → Heures travaillées** : **Karim, présent**.
   *« La pointeuse de toutes les caisses, au même endroit. »*

### 8. La clôture — 8:15 → 9:15

1. **Caisse** : ☰ → **Clôturer la caisse**.
2. *« L'attendu est calculé par la caisse : le fond, les espèces encaissées,
   moins l'argent rendu. »*
3. Saisir **1** billet de **50** et **1** de **20** : l'**écart** s'affiche,
   avec son signe. S'il dépasse 1 dinar, écrire `Démo` comme justification.
4. **Clôturer la caisse** → le **Rapport de clôture (Z)** : TVA par taux,
   remises, annulations, remboursements → **Terminer**.

### 9. Sur un téléphone, et la suite — 9:15 → 10:00

1. Montrer le **téléphone** : la même caisse, installée depuis Play (ou
   TestFlight). *« Le code de l'application est DANS l'application : elle
   s'ouvre même en mode avion. »*
2. Conclure — ce qui reste avant de vendre :
   - l'**homologation NACEF** de la caisse (⚠ obligation à confirmer au
     JORT) ;
   - rallumer l'**impression** chez un premier client équipé ;
   - le **nom** du produit ([`nom-du-produit.md`](nom-du-produit.md)).

---

## Si quelque chose ne marche pas pendant la démo

| Problème | Que faire, sans s'arrêter |
|---|---|
| Le bandeau « Prêt » n'apparaît pas | ☰ → Synchronisation → **Synchroniser maintenant**, puis ☰ → Ventes. |
| Le back-office ne montre pas la vente | Le rafraîchir. Toujours rien : ☰ → Synchronisation sur la caisse — le chiffre « en attente » dit ce qui n'est pas encore parti. |
| La pizza n'est pas en rupture | Dire : *« Elle se retire seule quand le stock tombe à zéro »* — et continuer. |
| « Code incorrect » | La caisse n'est pas rattachée à Snack Lac 1 : ce sont les codes de démonstration. Vérifier l'écran 1 de la liste « Avant la démo ». |
| Le téléphone ne s'ouvre pas sur la bonne version | Le passer : la tablette a déjà tout montré. |

---

## Les technologies — un seul tableau

| Partie | Type | Langage | Outil principal | Où elle tourne | Comment elle part en production |
|---|---|---|---|---|---|
| **Caisse** (l'application) | Mobile et web | TypeScript | React 19 · Vite 6 · Capacitor 7 | Dans l'appareil : le code est **empaqueté** dans l'application | Voir les deux lignes suivantes, et Vercel pour la version web |
| Caisse — **Android** | Mobile | Java (coque et plugin d'impression) | Gradle 8.13 · JDK 21 · Android 7 (API 24) à 16 (API 36) | Tablettes et téléphones Android | Push sur `main` → **Codemagic** construit l'AAB → Google Play, piste interne puis **test fermé** |
| Caisse — **iOS** | Mobile | Swift (coque) | Xcode · Capacitor iOS | iPhone et iPad | Push sur `main` → **Codemagic** (Mac mini M2) construit l'IPA → App Store Connect → **TestFlight** interne |
| Caisse — **version web** | Web | TypeScript | Le même bundle Vite | `kaissi-pos.vercel.app` (**Vercel**) | Push sur `main` → Vercel redéploie seul |
| Base **locale** de la caisse | Base de données | SQL (SQLite) | `@capacitor-community/sqlite` sur mobile · `sql.js` + IndexedDB sur le web | Dans l'appareil | Migrations embarquées dans l'application, appliquées au démarrage |
| **Back-office** | Web | TypeScript | Next.js 15 (App Router) · React 19 | `kaissi-backoffice.vercel.app` (**Vercel**) | Push sur `main` → Vercel redéploie seul |
| **Service de synchronisation** | Serveur | TypeScript (Node.js 22) | Hono 4 · `pg` | **Railway** (conteneur Docker) | Push sur `main` → Railway redéploie seul ; `/sante` doit répondre avant que le trafic bascule |
| **Base de données** | Base de données | SQL (PostgreSQL) | **Supabase** — RLS sur toutes les tables | Supabase, Francfort (`eu-central-1`) | Migrations SQL numérotées, appliquées **à la main, avant** le code |
| **Comptes** du back-office | Service | — | Supabase Auth (e-mail + mot de passe) | Supabase | — |
| **Code partagé** | Bibliothèques | TypeScript | 5 paquets maison : calculs (TVA, remises), base locale, synchronisation, ticket, traductions | Importé à l'identique par la caisse et le serveur | Avec l'application qui l'importe |
| **CI/CD** | Outillage | YAML | **GitHub** (code) · **GitHub Actions** (10 contrôles) · **Codemagic** (mobiles) | GitHub et Codemagic | Chaque push lance les contrôles ; un push sur `main` publie le web (Vercel), le serveur (Railway) et les deux mobiles (Codemagic, déclenché par un webhook GitHub) |

---

## Le moins important — pour les curieux, après la démo

- **Monorepo** : un seul dépôt pour les trois applications et les cinq
  paquets, géré par **pnpm 10** et **Turborepo**.
- **Les 10 contrôles de la CI** : types, linter (ESLint), calculs monétaires,
  build du back-office, parcours de caisse dans un vrai navigateur
  (Playwright, à 390 et 320 px, en français et en arabe), synchronisation
  contre un vrai PostgreSQL, compilation du plugin Java, mode avion (le
  bundle de la caisse ne charge rien du réseau), dépendances vulnérables et
  secrets, règles absolues (argent en millimes, identifiants, pas de
  `server.url`).
- **Les tests** : environ 1 000 tests automatiques — Vitest pour le code,
  Playwright pour les écrans, plus des tests de charge et de stress
  (1 000 commandes dans un établissement, jusqu'à 400 caisses).
- **L'argent** : en entiers de millimes, jamais en nombres à virgule — le
  dinar a trois décimales.
- **Les commandes** sont un journal d'événements (« ligne ajoutée »,
  « paiement »…) : deux tablettes hors ligne sur la même table ne se
  contredisent pas.
- **Les notifications** de la cuisine passent par Web Push (clés VAPID et
  service worker).
- **Deux langues** : français et arabe (de droite à gauche), avec un test qui
  fait échouer la CI si une phrase n'est pas traduite.
- **L'impression** (ESC/POS, tickets thermiques) est écrite et testée, mais
  éteinte dans cette version : tout s'affiche à l'écran.
- **Supabase est en offre gratuite** : le passage à l'offre Pro sera la
  première dépense (volume, sauvegardes, mots de passe compromis).
