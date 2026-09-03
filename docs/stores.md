# Publier Kaissi sur les stores

Loyverse a une application native sur les deux stores, et un back-office web.
C'est le bon modèle, et c'est celui que Kaissi vise. Ce document dit comment
y aller, et **pourquoi le chemin n'est pas celui de Digital Fidelity**.

---

## 1. Pas de Bubblewrap ici — et ce n'est pas un détail

Digital Fidelity est une TWA Bubblewrap : une coque Android qui ouvre un
Chrome sans barre d'adresse sur une URL distante. Pour un programme de
fidélité, c'est le bon choix — l'application n'a rien à faire sans réseau, et
Bubblewrap coûte une après-midi.

Pour une **caisse**, c'est disqualifiant, et pour une raison qui n'est pas une
question de confort :

> Dans une TWA, **le code de l'application vient du réseau**. Pas seulement les
> données : le code. Quand la connexion tombe, il n'y a rien à charger, et
> l'application ne s'ouvre pas.

Un service worker atténue le problème sans le supprimer. Il faut avoir ouvert
l'application au moins une fois en ligne ; le cache est évinçable par Android
sous pression mémoire ; et une éviction ne se voit qu'au moment où l'on en a
besoin — c'est-à-dire pendant un service, sans réseau, avec la file d'attente
qui s'allonge.

Deux limites de plus, propres au métier :

- **Pas de SQLite natif.** Une TWA n'a que le stockage du navigateur
  (IndexedDB), le même que la cible web, avec la même réserve : le système
  peut le vider. Sur l'APK Capacitor, la base est un fichier de l'application,
  que personne n'évince.
- **Pas d'accès aux périphériques.** Imprimante ESC/POS sur le LAN, tiroir-
  caisse, lecteur de codes-barres : hors d'atteinte depuis un Chrome Custom
  Tab. Le module d'impression est éteint aujourd'hui, mais il est écrit, et il
  se rallume par un drapeau de build.

C'est écrit noir sur blanc dans `CLAUDE.md` et dans `capacitor.config.ts`, et
une garde de CI le vérifie à chaque PR (`verifier-mode-avion.mjs`).

**La bonne nouvelle : on n'en a pas besoin.** L'APK Capacitor existe déjà,
il est empaqueté, il embarque SQLite natif, et son projet Android est dans le
dépôt. Le travail restant pour le Play Store n'est pas du développement.

---

## 2. Les trois formes de Kaissi, et à quoi chacune sert

| | Ce que c'est | Le code vient de | La base | Pour qui |
|---|---|---|---|---|
| **APK / AAB Android** | Capacitor, bundle EMPAQUETÉ | l'appareil | SQLite natif, ineffaçable | la **caisse** d'un restaurant qui tourne |
| **Site web POS** | le même bundle, servi en statique | l'appareil (service worker) | IndexedDB, évinçable | démonstration, dépannage, deuxième poste |
| **Back-office** | Next.js sur Vercel | le réseau | Postgres | gérant, comptable, cuisine |

Les trois restent. La version web n'est pas un brouillon de l'APK : c'est
l'entrée la plus rapide, celle qu'on ouvre en trente secondes chez un
prospect. C'est l'APK qu'on installe le jour où le restaurant ouvre.

---

## 3. Android — Google Play

Le projet Android est prêt : `applicationId tn.res2boost.kaissi`, minSdk 23,
targetSdk 35, signature de production câblée.

### 3.1 Le keystore, une seule fois dans la vie du produit

```bash
keytool -genkey -v -keystore ~/kaissi-release.keystore \
  -alias kaissi -keyalg RSA -keysize 2048 -validity 10000
```

`apps/pos/android/keystore.properties` (déjà dans `.gitignore`) :

```properties
storeFile=/chemin/absolu/vers/kaissi-release.keystore
storePassword=…
keyAlias=kaissi
keyPassword=…
```

> ⚠ **Sauvegarde ce fichier ailleurs, aujourd'hui.** Le perdre, c'est ne plus
> jamais pouvoir mettre à jour l'application installée sur les tablettes de
> tes clients. Google Play Signing en garde une copie côté Google, à condition
> de l'activer au premier envoi — fais-le.

### 3.2 Le numéro de version se pose à UN seul endroit

`apps/pos/package.json` → `"version"`. Le `build.gradle` en dérive
`versionName` et `versionCode` : `1.4.2` devient `10402`.

Play refuse un envoi dont le `versionCode` n'est pas **strictement supérieur**
au précédent, et un numéro consommé l'est définitivement. Donc : on incrémente
la version npm, on ne touche à rien d'autre.

### 3.3 Construire le bundle

```bash
pnpm install
pnpm pos:build                                    # + garde du mode avion
pnpm --filter @kaissi/pos exec cap sync android
cd apps/pos/android && ./gradlew bundleRelease
# → app/build/outputs/bundle/release/app-release.aab
```

Prérequis : JDK 21 et le SDK Android (Android Studio les installe).

### 3.4 Ce que Play demande, et qui n'est pas du code

Compte développeur : **25 $, une fois**. Première validation : compter **une à
deux semaines**, parfois plus pour un premier compte.

À préparer :

- icône 512×512, bannière 1024×500 ;
- 2 à 8 captures d'écran par format (téléphone **et** tablette 7"/10" — Kaissi
  est une application de tablette, Play le vérifie) ;
- une description courte et une longue, en français ;
- une **politique de confidentialité** accessible publiquement : obligatoire,
  et refusée si l'URL ne répond pas ;
- le questionnaire **Data safety** : Kaissi collecte des données de vente et
  un identifiant d'appareil, il faut le déclarer ;
- la catégorie (Entreprise) et le classement de contenu.

> **Tu n'as pas besoin du Play Store pour ouvrir chez un client.** Installer
> l'AAB converti en APK, ou l'APK signé directement, prend dix minutes et
> permet de corriger un bug le jour même au lieu d'attendre une revue. Le
> store sert la crédibilité commerciale et les mises à jour automatiques —
> deux vraies raisons, mais pas des raisons d'attendre pour vendre.

---

## 4. iOS — l'App Store, honnêtement

**Ce n'est pas un `cap add ios` et c'est fini.** Voici l'état réel.

**Ce qui joue en notre faveur :** Capacitor gère iOS, et
`@capacitor-community/sqlite` a une implémentation iOS complète. L'application
elle-même est du web empaqueté — elle tournera.

**Ce que ça coûte vraiment :**

| | |
|---|---|
| Un **Mac** | Xcode n'existe que sur macOS. Pas de contournement légal. |
| **99 $/an** | compte développeur Apple, renouvelable |
| Le projet iOS | `cap add ios`, à créer et à versionner |
| Le plugin d'impression | écrit en **Java** aujourd'hui (`apps/pos/android/…`). Une version Swift est à écrire le jour où l'impression se rallume. Aujourd'hui elle est éteinte : ce n'est pas bloquant. |
| La revue Apple | plus stricte que Google. Une application de caisse doit être **testable par le relecteur** : compte de démonstration obligatoire, sinon rejet immédiat. |

**Mon avis :** l'iPad est rare en restauration tunisienne, et une tablette
Android d'entrée de gamme coûte le dixième d'un iPad. Publier sur l'App Store
avant d'avoir un client qui le demande, c'est 99 $/an, un Mac et une semaine
de travail pour un marché qui n'existe pas encore ici.

Le jour où il existe, rien dans l'architecture ne s'y oppose — c'est
précisément ce que Capacitor achète, et c'est une raison de plus de ne pas
être parti sur une TWA.

---

## 5. Dans quel ordre

1. **Maintenant** — l'APK signé, installé à la main. Zéro attente, correction
   le jour même.
2. **Quand deux ou trois clients tournent** — Google Play. La mise à jour
   automatique cesse d'être un confort et devient nécessaire : on ne va pas
   réinstaller à la main sur quinze tablettes.
3. **Quand un client réclame l'iPad** — iOS. Pas avant.

Le back-office reste web, sur les trois étapes. Personne n'encaisse dans un
back-office, et une page web s'ouvre depuis n'importe quel poste sans rien
installer.
