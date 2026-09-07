# Publier Kaissi sur les stores

Loyverse a une application native sur les deux stores, et un back-office web.
C'est le bon modèle, et c'est celui que Kaissi vise. Ce document dit comment
y aller, et **pourquoi le chemin n'est pas celui de Digital Fidelity**.

> ### « Je génère le Bubblewrap ? »
>
> **Non.** Pour Kaissi, jamais — et ce n'est pas une préférence, c'est la
> raison d'être du produit. Le §1 explique pourquoi en trois paragraphes.
>
> Ce qui remplace Bubblewrap est **déjà fait** : le projet Android
> (`apps/pos/android/`) et le projet iOS (`apps/pos/ios/`) sont dans le
> dépôt, et `codemagic.yaml` construit les deux paquets signés. Il ne reste
> aucune étape de développement — voir le §2 bis pour le parcours, clic par
> clic.

---

## 0. Ce qu'on réutilise de Digital Fidelity, et ce qu'on ne réutilise pas

La question n'est pas « faire comme Stampi » ou « faire autrement » : c'est
que **la moitié administrative est identique, et la moitié technique est
l'inverse**.

| | Digital Fidelity / Stampi | Kaissi | On réutilise ? |
|---|---|---|---|
| Compte Google Play (25 $) | ✔ | ✔ | **Oui** — le même compte développeur porte les deux applications |
| Compte Apple Developer (99 $/an) | ✔ | ✔ | **Oui** — même équipe, mêmes certificats |
| Compte Codemagic | ✔ | ✔ | **Oui** — et le groupe de variables `ios_signing` **tel quel** |
| Fiche du store, captures, confidentialité | ✔ | ✔ | Le **processus**, pas le contenu : ce sont deux produits |
| **Bubblewrap / TWA** | ✔ le bon choix là-bas | ✘ **disqualifiant** | **Non** — §1 |
| **`server.url`** dans la config Capacitor | ✔ | ✘ **interdit**, vérifié par la CI | **Non** |
| Le bundle applicatif | téléchargé au lancement | **empaqueté** dans l'APK | **Non** |
| La base de données | le réseau | SQLite dans l'appareil | **Non** |

Autrement dit : **tout ce qui coûte de l'argent et du temps administratif se
réutilise ; rien de ce qui touche à la façon dont l'application charge son
code ne se réutilise.** C'est exactement l'inverse de l'intuition, et c'est
pour cela que ce document existe.

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

## 2 bis. Le parcours complet, dans l'ordre des clics

Deux listes. Chaque ligne renvoie au détail plus bas quand il y en a un.

### Android — de zéro à « en ligne »

| # | Où | Quoi | Une seule fois ? |
|---|---|---|---|
| 1 | ton PC | `keytool …` → le keystore, **et sa sauvegarde** (§3.1) | oui, **pour la vie du produit** |
| 2 | Codemagic | *Teams → Code signing identities → Android keystores* → téléverser sous le nom **`kaissi_keystore`** | oui |
| 3 | play.google.com/console | créer le compte développeur, **25 $** | oui |
| 4 | Play Console | *Créer une application* → nom, langue par défaut **français**, gratuite | oui |
| 5 | Play Console | *Configuration → Intégrité de l'application* → activer **Play App Signing** | oui |
| 6 | Play Console | fiche : icône 512, bannière 1024×500, captures **téléphone ET tablette**, description (§3.4) | à chaque refonte |
| 7 | Play Console | *Règles → Contenu de l'application* : confidentialité, **Data safety**, classement, public cible | oui, puis à chaque changement |
| 8 | ton PC | incrémenter `"version"` dans `apps/pos/package.json` (§3.2) | **à chaque envoi** |
| 9 | Codemagic | *Start new build* → workflow **`pos-android`** | à chaque envoi |
| 10 | Play Console | *Test → Test interne* : le brouillon est là, ajouter les testeurs, **promouvoir** | à chaque envoi |
| 11 | Play Console | *Production → Créer une release* → soumettre à la revue | quand tu es prêt |

Compter **une à deux semaines** pour la première validation, quelques heures
pour les suivantes.

### iOS — de zéro à TestFlight

| # | Où | Quoi | Une seule fois ? |
|---|---|---|---|
| 1 | developer.apple.com | compte Apple Developer, **99 $/an** | oui, **renouvelable** |
| 2 | App Store Connect | *Utilisateurs et accès → Intégrations → Clés App Store Connect* : créer une clé **App Manager**, télécharger le `.p8` (**une seule fois**), noter *Issuer ID* et *Key ID* | oui |
| 3 | Codemagic | groupe de variables **`ios_signing`** : `ASC_ISSUER_ID`, `ASC_KEY_ID`, `ASC_PRIVATE_KEY` (le contenu du `.p8`), `CERTIFICATE_PRIVATE_KEY` — **c'est le groupe de Stampi, rien à ressaisir** | oui |
| 4 | App Store Connect | *Mes applications → +* → nouvelle application, *Bundle ID* **`tn.res2boost.kaissi`** (à enregistrer d'abord dans *Certificates, Identifiers & Profiles* s'il n'existe pas) | oui |
| 5 | ton PC | reporter l'**Apple ID à dix chiffres** de la fiche dans `APP_STORE_APPLE_ID`, dans `codemagic.yaml` | oui |
| 6 | ton PC | incrémenter `"version"` dans `apps/pos/package.json` | **à chaque envoi** |
| 7 | Codemagic | *Start new build* → workflow **`pos-ios`** (machine `mac_mini_m2` : **aucun Mac à acheter**) | à chaque envoi |
| 8 | App Store Connect | *TestFlight* : la build arrive, traitement 10–30 min, puis installable | à chaque envoi |
| 9 | App Store Connect | fiche, captures **iPad obligatoires**, confidentialité | à chaque refonte |
| 10 | App Store Connect | *Notes pour le relecteur* : **compte de démonstration** (e-mail + mot de passe), un PIN de caisse, et la phrase qui désamorce la 4.2 — voir §4 | à chaque envoi |
| 11 | App Store Connect | *Soumettre pour révision* | quand tu es prêt |

Compter **24 à 48 h** pour la revue Apple, une fois la fiche complète.

> **Aucune de ces deux listes ne contient d'étape de code.** C'est le sens du
> §1 : le travail technique est fait, et il l'a été dans le bon ordre — d'abord
> l'empaquetage, ensuite les magasins. Dans l'autre sens, on aurait publié une
> caisse qui ne s'ouvre pas sans réseau.

---

## 3. Android — Google Play

Le projet Android est prêt : `applicationId tn.res2boost.kaissi`, minSdk 23,
targetSdk 35, signature de production câblée.

### 3.1 Le keystore, une seule fois dans la vie du produit

> **Deux malentendus à lever avant de taper quoi que ce soit.**
>
> **1. Le mot de passe, tu le CHOISIS.** `keytool` ne te demande pas un mot de
> passe existant : il crée un fichier neuf, et te demande d'inventer le mot de
> passe qui le protégera. Six caractères au minimum. Rien ne s'affiche pendant
> que tu tapes — pas même des étoiles. C'est normal.
>
> **2. `keystore.properties` n'existe pas encore, et c'est voulu.** Tu ne le
> trouveras nulle part dans le dépôt : il contient des mots de passe, il est
> dans `.gitignore`, et c'est **à toi de le créer**. Sans lui, seul le build
> de *debug* fonctionne — exactement ce qu'on veut : une CI ne doit pas
> pouvoir signer une version de production.

**Sur Windows**, `~` n'existe pas : ni `cmd.exe` ni PowerShell ne le
remplacent par ton dossier personnel, et `keytool` cherche alors un dossier
littéralement nommé `~`. Donne un chemin complet.

```powershell
# PowerShell, depuis n'importe où
keytool -genkey -v -keystore C:\Users\salem\kaissi-release.keystore `
  -alias kaissi -keyalg RSA -keysize 2048 -validity 10000
```

```bash
# macOS / Linux
keytool -genkey -v -keystore ~/kaissi-release.keystore \
  -alias kaissi -keyalg RSA -keysize 2048 -validity 10000
```

Les questions arrivent dans cet ordre :

| La question | Ce qu'il faut répondre |
|---|---|
| `Enter keystore password` | **Invente-le.** 6 caractères minimum. Note-le tout de suite. |
| `Re-enter new password` | le même |
| `What is your first and last name?` | `Res2Boost` — c'est le *CN* du certificat, pas ton nom |
| `organizational unit` / `organization` | `Kaissi` / `Res2Boost` |
| `City`, `State`, `country code` | `Tunis`, `Tunis`, **`TN`** (deux lettres) |
| `Is CN=…, correct?` | `oui` — ou `yes` selon la langue de ton Java |
| `Enter key password for <kaissi>` | **Appuie sur Entrée** pour reprendre le même |

> Rien de tout cela n'est vérifié par qui que ce soit, et rien n'est visible
> par tes clients. Ce qui compte, c'est le fichier produit et son mot de passe.

**Vérifie qu'il est bien là** — cette commande le lit et affiche son contenu :

```powershell
keytool -list -v -keystore C:\Users\salem\kaissi-release.keystore
```

Tu dois y voir `Alias name: kaissi` et une validité de ~27 ans (10 000 jours).

**Ensuite, crée le fichier de configuration.** Il va dans
`apps/pos/android/keystore.properties` — à côté de `build.gradle`, pas à la
racine du dépôt :

```properties
storeFile=C:/Users/salem/kaissi-release.keystore
storePassword=celui-que-tu-viens-de-choisir
keyAlias=kaissi
keyPassword=le-meme-si-tu-as-fait-Entree
```

> ⚠ **Des barres obliques normales, même sur Windows.** Un fichier
> `.properties` est lu par Java, où `\` ouvre une séquence d'échappement :
> `C:\Users` devient `C:Users` et Gradle t'annoncera un keystore introuvable
> sans dire pourquoi. Écris `C:/Users/…`, ou double les barres :
> `C:\\Users\\…`.

Sous PowerShell, pour le créer sans éditeur :

```powershell
cd C:\Users\salem\PycharmProjects\Kaissi\apps\pos\android
@"
storeFile=C:/Users/salem/kaissi-release.keystore
storePassword=TON_MOT_DE_PASSE
keyAlias=kaissi
keyPassword=TON_MOT_DE_PASSE
"@ | Set-Content -Encoding ASCII keystore.properties
```

> ⚠ **Sauvegarde le fichier `.keystore` ailleurs, aujourd'hui.** Le perdre,
> c'est ne plus jamais pouvoir mettre à jour l'application installée sur les
> tablettes de tes clients — Google refuse une mise à jour signée par une
> autre clé, et il n'y a aucun recours. Google Play Signing en garde une copie
> côté Google, à condition de l'activer au premier envoi : **fais-le.**
>
> Et le mot de passe avec, ailleurs que dans ta tête. Un keystore dont on a
> perdu le mot de passe est exactement aussi inutile qu'un keystore perdu.

**Si tu construis par Codemagic, ce fichier ne te sert pas.** Codemagic
reçoit le keystore et ses mots de passe dans *Teams → Code signing identities*
(§2 bis, étape 2) et fabrique lui-même l'équivalent. `keystore.properties` ne
sert qu'à signer **depuis ton PC**.

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

## 4. iOS — l'App Store

**Le projet iOS existe désormais** : `apps/pos/ios/`, versionné comme le
projet Android et pour la même raison — il accueillera le plugin
d'impression en Swift le jour où l'impression se rallume, et le régénérer
perdrait ce code.

`appId` `tn.res2boost.kaissi`, cible iOS 14, orientation **paysage
d'abord** (une caisse est posée sur un comptoir), et
`ITSAppUsesNonExemptEncryption = false` dans l'`Info.plist` — sans cette
clé, App Store Connect repose la question de l'export de cryptographie à
chaque envoi et bloque TestFlight tant que personne n'y répond à la main.

**Ce qui reste vrai, et qu'aucun outil ne change :**

| | |
|---|---|
| **99 $/an** | compte développeur Apple, renouvelable |
| Une machine macOS | Xcode n'existe que là. **Codemagic en fournit une** (`mac_mini_m2`) : c'est la seule raison pour laquelle nous n'avons pas besoin d'acheter un Mac. |
| Le plugin d'impression | écrit en **Java** aujourd'hui. Une version Swift est à écrire le jour où l'impression se rallume. Aujourd'hui elle est éteinte : ce n'est pas bloquant. |
| La revue Apple | plus stricte que Google. Une application de caisse doit être **testable par le relecteur** : compte de démonstration obligatoire dans les notes de revue, sinon rejet immédiat. |

> **La guideline 4.2 ne nous menace pas comme elle menace Stampi.** Apple
> refuse les « sites emballés ». Kaissi n'en est pas un : le bundle est dans
> le paquet, la base est locale, l'application fonctionne en mode avion. Ce
> qui était une contrainte d'architecture devient ici un argument de revue —
> et il faut l'écrire noir sur blanc dans les notes du relecteur.

Sur un Mac, en local, si l'on veut ouvrir Xcode :

```bash
pnpm install
pnpm pos:build
pnpm --filter @kaissi/pos exec cap sync ios
cd apps/pos/ios/App && pod install
open App.xcworkspace
```

---

## 4 bis. La chaîne de construction — `codemagic.yaml`

Deux workflows à la racine du dépôt, **lancés à la main** (Codemagic →
*Start new build*) :

| Workflow | Machine | Produit |
|---|---|---|
| `pos-android` | linux | `app-release.aab` signé, publié sur la piste **interne** de Play, en brouillon |
| `pos-ios` | `mac_mini_m2` | `.ipa` signé, envoyé à App Store Connect (**pas** soumis à la revue) |

Les deux commencent par `pnpm pos:build`, donc par la **garde du mode
avion** : un `server.url`, une ressource distante ou une clé Supabase dans
le paquet font échouer la construction avant même de toucher au magasin.

**Pourquoi aucun déclencheur sur `push`**, contrairement à Stampi : chaque
construction iOS brûle un numéro de build chez Apple, et chaque envoi Android
brûle un `versionCode` que Play ne rend jamais. Publier est une décision, pas
un effet de bord d'un commit.

**Ce qu'il faut poser dans Codemagic, une fois :**

1. *Teams → Code signing identities → Android keystores* : téléverser le
   keystore sous le nom **`kaissi_keystore`**.
2. Groupe de variables **`ios_signing`** — c'est **le même que Stampi**, avec
   les mêmes noms (`ASC_ISSUER_ID`, `ASC_KEY_ID`, `ASC_PRIVATE_KEY`,
   `CERTIFICATE_PRIVATE_KEY`) : il n'y a rien à ressaisir.
3. Groupe **`google_play`** avec `GCLOUD_SERVICE_ACCOUNT_CREDENTIALS`, si
   l'on veut la publication automatique. Sans lui, l'AAB reste disponible en
   artefact.
4. Après avoir créé la fiche dans App Store Connect, reporter son *Apple ID*
   à dix chiffres dans `APP_STORE_APPLE_ID` (`codemagic.yaml`). Tant qu'il
   est vide, le numéro de build retombe sur le compteur de Codemagic — la
   première construction n'échoue donc pas faute d'une fiche qui n'existe
   pas encore.

---

## 5. Dans quel ordre

1. **Maintenant** — l'APK signé, installé à la main. Zéro attente, correction
   le jour même.
2. **Quand deux ou trois clients tournent** — Google Play. La mise à jour
   automatique cesse d'être un confort et devient nécessaire : on ne va pas
   réinstaller à la main sur quinze tablettes.
3. **iOS** — le projet et la chaîne de construction existent (§4 et §4 bis) ;
   il reste le compte développeur à 99 $/an et la fiche App Store. L'iPad
   reste rare en restauration tunisienne : à ouvrir quand un client le
   demande, sans travail technique à refaire ce jour-là.

Le back-office reste web, sur les trois étapes. Personne n'encaisse dans un
back-office, et une page web s'ouvre depuis n'importe quel poste sans rien
installer.
