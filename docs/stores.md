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

> **Construire sur ton PC plutôt que sur Codemagic** (étape 9) : `pnpm pos:aab`.
> Une commande, les cinq étapes dans l'ordre, et les deux contrôles qui ont
> coûté une soirée chacun posés AVANT Gradle (§3.3). Il faut alors le SDK
> Android en local — Codemagic, lui, n'a besoin de rien sur ton poste.

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

### 3.3 Construire le bundle — une commande

```bash
pnpm install
pnpm pos:aab
# → apps/pos/android/app/build/outputs/bundle/release/app-release.aab
```

`pos:aab` enchaîne les cinq étapes **dans l'ordre**, et pose les contrôles
avant Gradle plutôt qu'après :

| | Étape | Ce qu'elle empêche |
|---|---|---|
| 1 | `verifier:jdk` | « Unsupported class file major version 69 » (voir l'encadré ci-dessous) |
| 2 | `verifier:gradle` | un chemin collé par erreur dans un `.gradle` (voir 3.3 bis) |
| 3 | `pos:build` | un bundle qui dépend du réseau — c'est la garde du mode avion |
| 4 | `cap sync android` | un APK qui embarque la version d'avant |
| 5 | `gradlew bundleRelease` | — |

`pnpm pos:apk` fait la même chose en produisant un **APK signé**, installable
directement : c'est le chemin le plus rapide pour un premier client.

Prérequis : **JDK 17 à 23** — 21 de préférence, c'est celui de la CI — et le
SDK Android (Android Studio installe les deux).

La séquence à la main reste valable, si l'on veut voir chaque étape :

```bash
pnpm verifier:jdk && pnpm verifier:gradle
pnpm pos:build
pnpm --filter @kaissi/pos exec cap sync android
cd apps/pos/android && ./gradlew bundleRelease
```

> ### ⚠ Ne mettez jamais un chemin dans `settings.gradle`
>
> C'est le seul fichier que Gradle nomme dans son erreur, donc celui qu'on
> ouvre — et l'y coller donne :
>
> ```
> settings file '…\apps\pos\android\settings.gradle': 8:
>   Unexpected character: '"' @ line 8, column 1.
>      "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"
> ```
>
> Ce fichier est du **Groovy**, pas une liste de réglages : une chaîne seule
> sur sa ligne n'y veut rien dire. Il est de surcroît **versionné** — la ligne
> casserait la construction de tous les autres postes.
>
> Le chemin d'un JDK va dans le `gradle.properties` de **votre** poste, et
> `pnpm verifier:jdk --ecrire` l'y écrit pour vous. Si le fichier a déjà été
> modifié, `pnpm verifier:jdk` le détecte **avant** Gradle, nomme la ligne et
> donne la réparation :
>
> ```bash
> git checkout -- apps/pos/android/settings.gradle
> ```
>
> C'est `pnpm verifier:gradle` qui le contrôle — sur les cinq scripts Gradle
> versionnés, pas seulement celui-là — et il tourne d'office dans
> `pnpm pos:aab`. Un test le tient aussi sur les fichiers réels du dépôt : la
> ligne ne peut pas passer la porte de la CI.

> ### ⚠ « Unsupported class file major version 69 »
>
> Si `./gradlew` s'arrête là-dessus, **ton JDK est trop récent** — et rien
> dans le message ne le dit :
>
> ```
> A problem occurred evaluating settings 'android'.
> > BUG! exception in phase 'semantic analysis' in source unit '_BuildScript_'
>   Unsupported class file major version 69
> ```
>
> Le mot « BUG! » vient de Groovy et désigne le poste, pas le projet. Le
> nombre se traduit en retirant 44 : **69 − 44 = JDK 25**. Gradle 8.11.1 ne
> sait pas lire ce bytecode et s'arrête avant d'avoir rien construit. C'est
> `pnpm verifier:jdk` qui le dit maintenant, en une phrase et avant Gradle.
>
> **La façon la plus courte — une commande :**
>
> ```bash
> pnpm verifier:jdk --ecrire
> ```
>
> Le script **cherche** un JDK utilisable sur votre poste (Android Studio en
> embarque un, le « JBR » : vous en avez presque sûrement un sans le savoir),
> puis écrit `org.gradle.java.home` dans **votre** `~/.gradle/gradle.properties`.
> Gradle s'en sert alors tout seul, sans rien changer à votre `PATH`, et sans
> avoir à y repenser à chaque terminal.
>
> Deux précautions, dans le script même : il écrit dans le fichier de
> l'**utilisateur** et jamais dans celui du projet — `apps/pos/android/gradle.properties`
> est versionné, un chemin `C:\Program Files\…` y casserait la construction
> de tout le monde — et il **refuse d'écraser** un `org.gradle.java.home` déjà
> présent, qui pourrait servir à un autre projet.
>
> Ce réglage vaut pour **tous** les projets Gradle du poste. Pour revenir en
> arrière, retirez la ligne : elle porte un commentaire qui le dit.
>
> **`--ecrire` fonctionne aussi quand votre JDK est déjà le bon**, et c'est
> volontaire : Gradle peut prendre un **autre** Java que celui de votre
> `PATH` (une variable `JAVA_HOME`, un réglage d'Android Studio, un démon
> déjà démarré). La commande vous dit alors ce qu'elle a écrit, ou pourquoi
> elle n'a rien pu écrire. Elle ne se tait jamais.
>
> **Ou à la main, pour ce terminal seulement** — `pnpm verifier:jdk` (sans
> `--ecrire`) affiche la commande exacte, avec le chemin trouvé chez vous :
>
> ```powershell
> # Windows — PowerShell
> $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
> $env:Path = "$env:JAVA_HOME\bin;$env:Path"
> java -version        # doit afficher 21
> ```
>
> ```bash
> # Windows — Git Bash
> export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
> export PATH="$JAVA_HOME/bin:$PATH"
> ```
>
> La variable ne vaut que pour le terminal en cours : rouvrir une fenêtre la
> perd. C'est le prix de ne rien changer au poste.
>
> **Pourquoi ne pas simplement monter Gradle ?** Ce sera la vraie réponse, et
> elle viendra : Gradle 9 accepte le JDK 25. Mais elle entraîne le plugin
> Android avec elle, et un couple Gradle/AGP ne se change pas sans construire
> un APK pour le vérifier. Tant que ce n'est pas fait ET éprouvé, un message
> clair vaut mieux qu'une montée de version non testée.

### 3.3 bis « Unexpected character: '"' » — un chemin collé dans un `.gradle`

Le second piège du terrain, et il ne ressemble à rien :

```
* Where:
Settings file '…\android\settings.gradle' line: 8

* What went wrong:
Could not compile settings file '…\android\settings.gradle'.
> startup failed:
  settings file '…': 8: Unexpected character: '"' @ line 8, column 1.
     "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"
```

Le JDK est bon, `pnpm verifier:jdk` répond ✓ — et pourtant Gradle refuse. La
cause est dans le message, à condition de la voir : **le chemin du JDK s'est
retrouvé collé dans `settings.gradle`**, pendant le dépannage de l'étape
précédente. Le fichier du dépôt en fait quatre lignes ; il n'en a pas de
huitième.

**Le remède, une ligne :**

```bash
git checkout -- apps/pos/android/settings.gradle
```

Puis pour désigner un JDK à Gradle **sans toucher au dépôt** —
`pnpm verifier:jdk --ecrire`, qui écrit dans *votre* `~/.gradle/gradle.properties`.

> `pnpm verifier:gradle` détecte désormais ce cas et nomme la ligne fautive
> avec **le même numéro que Gradle**. Il est enchaîné par `pnpm pos:aab`, donc
> il tourne de lui-même.
>
> Pourquoi ce contrôle ne peut pas vivre dans Gradle : l'erreur survient en
> **compilant** le script de settings, avant que la moindre ligne de Gradle ne
> s'exécute. Un test écrit dans ce fichier ne serait jamais atteint. Même
> raison que pour le contrôle du JDK.
>
> Il ne refuse pas toute modification — on touche légitimement à
> `app/build.gradle` pour la signature. Il refuse ce qui **ne peut pas** être
> voulu : une ligne qui, hors commentaire, commence par un guillemet ou par un
> chemin Windows. Ce n'est pas du Groovy, et ça n'a jamais compilé.

### 3.4 Où est l'AAB, et comment l'installer chez un client

C'est la question qui vient en premier, et la section précédente y répondait
mal. **L'AAB n'est pas installable** : c'est un format destiné au Play Store,
qui en dérive lui-même les APK adaptés à chaque appareil. Pour installer
directement sur une tablette, il faut un **APK**.

#### Le fichier, après `./gradlew bundleRelease`

```
apps/pos/android/app/build/outputs/bundle/release/app-release.aab
```

Sous Windows, en toutes lettres :
`C:\Users\salem\PycharmProjects\Kaissi\apps\pos\android\app\build\outputs\bundle\release\app-release.aab`

Ce fichier-là part sur Play Console, et **nulle part ailleurs**.

#### Pour installer chez un client : construisez un APK, pas un AAB

```bash
cd apps/pos/android
./gradlew assembleRelease
# → app/build/outputs/apk/release/app-release.apk
```

`assembleRelease` (APK, installable) et `bundleRelease` (AAB, pour Play) sont
deux commandes différentes qui lisent la **même** signature. Vous pouvez faire
les deux à la suite ; ce sont les mêmes octets d'application.

> **Sans keystore, `assembleRelease` échoue** — voir 3.1. C'est voulu : un APK
> non signé ne s'installe pas, et un APK signé par une clé DIFFÉRENTE ne peut
> pas remplacer le précédent. Android refuse alors la mise à jour, et il faut
> désinstaller — donc perdre les données locales de la caisse.

#### Installer l'APK sur la tablette

Trois chemins, du plus simple au plus outillé.

**① Par câble USB, avec `adb`** — le plus rapide quand la tablette est là.

```bash
# Sur la tablette : Paramètres → À propos → taper 7 fois sur « Numéro de build »
#                  puis Options pour développeurs → Débogage USB : activé
adb devices                     # la tablette doit apparaître
adb install -r app-release.apk  # -r = remplace la version installée
```

`adb` est fourni avec Android Studio
(`C:\Users\<vous>\AppData\Local\Android\Sdk\platform-tools\adb.exe`).

**② Par fichier** — quand la tablette est chez le client et vous non.

1. Envoyez l'APK (clé USB, Drive, WeTransfer — il fait ~15 Mo) ;
2. sur la tablette, ouvrez le fichier ;
3. Android demande d'autoriser « Installer des applications inconnues » pour
   l'application qui l'ouvre (le gestionnaire de fichiers, ou Chrome).
   Autorisez : c'est un réglage **par application source**, pas un
   affaiblissement global de l'appareil.

**③ Par Play Console, en test interne** — le meilleur des deux mondes quand le
compte développeur existe déjà. On téléverse l'**AAB**, on ajoute l'adresse
Gmail du client comme testeur, et il installe depuis le Play Store comme
n'importe quelle application — avec les mises à jour automatiques. **Aucune
validation à attendre** : le test interne est disponible en quelques minutes.

> **Vous n'avez pas besoin du Play Store pour ouvrir chez un client.**
> L'APK direct prend dix minutes et permet de corriger un bug le jour même au
> lieu d'attendre une revue. Le store sert la crédibilité commerciale et les
> mises à jour automatiques — deux vraies raisons, mais pas des raisons
> d'attendre pour vendre.

---

### 3.5 Publier : le parcours Play Console, clic par clic

Compte développeur : **25 $, une fois**. Première validation : compter **une à
deux semaines**, parfois plus pour un premier compte. Le test interne, lui,
est disponible tout de suite.

#### Étape 1 — Créer le compte développeur

1. <https://play.google.com/console> → « Créer un compte développeur » ;
2. choisissez **Organisation** si vous facturez au nom d'une société —
   Google demandera un numéro D-U-N-S, à obtenir gratuitement mais qui prend
   **une à deux semaines**. En **Personne physique**, c'est immédiat ;
3. 25 $ par carte, une seule fois pour la vie du compte ;
4. vérification d'identité : pièce d'identité, parfois une adresse. Comptez
   quelques jours.

> **Commencez par là.** C'est la seule étape dont le délai ne dépend pas de
> vous, et tout le reste attend derrière.

#### Étape 2 — Créer l'application

Play Console → **Créer une application**.

| Champ | Ce qu'on met | Pourquoi |
|---|---|---|
| Nom | `Kaissi — Caisse restaurant` | 30 caractères maximum |
| Langue par défaut | Français (France) | le marché est tunisien |
| Application ou jeu | Application | |
| Gratuite ou payante | **Gratuite** | Kaissi se vend en abonnement hors Play : l'application seule ne se vend pas |

> ⚠ **Gratuite → payante est IRRÉVERSIBLE dans ce sens seulement.** On peut
> passer de payant à gratuit, jamais l'inverse. Gratuit est le bon choix ici.

#### Étape 3 — Le tableau de bord vous guide

Play Console affiche une liste de tâches à cocher. Dans l'ordre où elles
bloquent la publication :

**a. Accès à l'application.** Kaissi exige une connexion : il faut le déclarer
et **donner un compte de démonstration** à l'équipe de validation, sinon
elle refuse — elle ne peut pas tester ce qu'elle ne peut pas ouvrir.

Créez-le pour de bon, avec `pnpm sync:nouveau-client`, sur un restaurant de
démonstration. Donnez l'e-mail et le mot de passe dans le champ prévu, avec
une note : *« Se connecter, puis Diagnostic → Synchronisation pour appairer.
La caisse fonctionne aussi sans réseau. »*

**b. Publicités.** Non, Kaissi n'en contient aucune.

**c. Classification du contenu.** Un questionnaire. Réponses : aucune
violence, aucun contenu sexuel, aucun jeu d'argent. Catégorie **Utilitaire /
Productivité / Entreprise**. Résultat attendu : tous publics.

**d. Public cible.** **18 ans et plus.** C'est un outil professionnel ;
déclarer un public enfant déclencherait des obligations (Families Policy) qui
n'ont aucun sens ici.

**e. Sécurité des données (Data safety).** Le formulaire le plus long, et le
seul où une réponse fausse se paie. Ce que Kaissi collecte réellement :

| Donnée | Collectée ? | À déclarer |
|---|---|---|
| Adresse e-mail | oui — le compte du gérant | *Informations personnelles → Adresse e-mail*. Chiffré en transit. Suppression sur demande. |
| Nom | oui — l'employé | *Informations personnelles → Nom* |
| Identifiants d'appareil | oui — `device_id`, pour la synchronisation | *Identifiants de l'appareil ou d'autres identifiants* |
| Ventes, tickets | oui | *Informations financières → Autres informations financières* |
| Position | **non** | |
| Contacts, photos, micro | **non** | |
| Publicité, suivi | **non** | à cocher explicitement : « Ces données ne sont pas utilisées pour le suivi » |

Pour chaque donnée : **chiffrée en transit — oui** (HTTPS partout) et
**l'utilisateur peut demander la suppression — oui**.

**f. Politique de confidentialité.** Une **URL publique qui répond** ;
Google la teste, et un lien mort fait refuser la fiche. Une page statique sur
votre domaine suffit. Elle doit dire : quelles données, pourquoi, combien de
temps, et comment demander la suppression.

**g. Fiche du magasin.** Voir 3.6 pour les textes, et l'outil de visuels.

#### Étape 4 — Téléverser, et commencer par le test interne

1. **Tests → Test interne → Créer une version** ;
2. téléversez `app-release.aab` ;
3. la première fois, Google propose de **gérer la clé de signature**.
   Acceptez **Play App Signing** : Google conserve la clé de distribution, et
   la vôtre (`kaissi-release.jks`) devient la clé de *téléversement*. Si vous
   la perdez, Google peut la réinitialiser — sans Play App Signing, un
   keystore perdu signifie **ne plus jamais mettre à jour l'application** ;
4. ajoutez les testeurs par adresse Gmail, partagez le lien d'inscription ;
5. **installez vous-même depuis ce lien, sur une vraie tablette**, avant
   d'aller plus loin.

#### Étape 5 — Production

**Production → Créer une version**, même AAB, puis « Envoyer pour examen ».
Comptez une à deux semaines la première fois, quelques heures ensuite.

Les motifs de refus les plus fréquents, tous évitables :

- **pas de compte de démonstration** — l'équipe ne peut pas ouvrir
  l'application (étape 3a) ;
- **politique de confidentialité injoignable** (3f) ;
- **Data safety incohérent** avec ce que l'application demande réellement ;
- **captures d'écran de téléphone uniquement**, alors que l'application est
  déclarée compatible tablette. Play le vérifie.

---

### 3.6 Les textes et les visuels de la fiche

#### Les visuels — un outil est fourni

`outils/visuels-store.html` : ouvrez ce fichier dans votre navigateur, déposez
une image, récupérez les formats exacts que Play exige. Rien ne part sur
Internet — le redimensionnement se fait dans la page.

| Visuel | Format exigé | Note |
|---|---|---|
| Icône | 512 × 512 PNG | pas de transparence, pas de coins arrondis (Android les pose) |
| Bannière | 1024 × 500 PNG ou JPEG | s'affiche en haut de la fiche |
| Captures téléphone | 2 à 8, min. 320 px de côté | |
| Captures tablette 7" | 2 à 8 | Kaissi est une application de tablette |
| Captures tablette 10" | 2 à 8 | |

> **Les captures se prennent, elles ne se fabriquent pas.** `adb exec-out
> screencap -p > capture.png` sur une vraie tablette. Montrez la prise de
> commande, l'encaissement, le ticket, l'écran Stock — dans cet ordre : c'est
> le parcours d'un restaurateur qui hésite.

#### Description courte — 80 caractères maximum

```
Caisse pour restaurant. Fonctionne même sans Internet.
```

*(54 caractères.)* C'est la seule phrase que la plupart des gens liront. Elle
dit le produit et l'argument, dans cet ordre.

#### Description longue — 4 000 caractères maximum

```
Kaissi est une caisse enregistreuse conçue pour les restaurants, les snacks
et les cafés tunisiens.

━━ ELLE NE S'ARRÊTE JAMAIS ━━

La coupure Internet est la panne la plus fréquente, et la plus coûteuse : une
caisse à l'arrêt, c'est une file d'attente et des clients qui repartent.

Kaissi est installée SUR la tablette, pas sur un site web. Elle démarre,
prend les commandes, encaisse et imprime sans aucune connexion. Dès que le
réseau revient, tout remonte automatiquement — sans double encaissement, sans
vente perdue, sans rien à faire.

━━ CE QU'ELLE FAIT ━━

• Prise de commande sur plan de salle, ou en vente à emporter
• Encaissement en espèces, carte ou chèque restaurant, avec calcul du rendu
• Ticket client et bon de cuisine
• Écran de préparation pour la cuisine et le bar
• Suivi du stock, avec alerte de rupture qui prévient le gérant
• Réductions justifiées et tracées, par motif
• Fichier clients
• Ouverture et clôture de caisse, avec écart constaté
• Plusieurs tablettes dans le même restaurant, synchronisées entre elles

━━ LE BACK-OFFICE ━━

Depuis un navigateur, sur ordinateur ou téléphone :

• Chiffre d'affaires du jour, de la semaine, du mois
• Ventes par article, par catégorie, par employé, par moyen de paiement
• Marges, sur le chiffre d'affaires hors taxe
• Historique des tickets, avec le détail de chacun
• Stock, réapprovisionnement et inventaire
• Équipe, rôles et codes PIN
• Exports CSV pour le comptable

━━ PENSÉE POUR LA TUNISIE ━━

• Dinar tunisien, avec ses TROIS décimales — 24,500 TND, pas 24,50
• TVA paramétrable par article, plusieurs taux sur le même ticket
• Droit de timbre
• Interface entièrement en français

━━ VOS DONNÉES SONT À VOUS ━━

Chaque restaurant est isolé des autres au niveau de la base de données.
Chaque encaissement est tracé : qui, quand, quel montant. Une annulation
n'efface jamais rien — elle s'ajoute à l'historique.

━━ POUR COMMENCER ━━

Kaissi s'installe avec accompagnement : nous paramétrons votre carte, vos
taux de TVA et votre équipe avec vous.

Res2Boost — contact@res2boost.com
```

*(~2 100 caractères — la moitié de la limite, ce qui laisse de la place.)*

**Les mots-clés comptent**, et ils sont placés naturellement : *caisse,
restaurant, snack, café, tunisien, hors ligne, stock, TVA, dinar, ticket*.
Play indexe ce texte ; le bourrer de mots-clés est en revanche un motif de
refus.

> ⚠ La ligne « TVA paramétrable » et le « droit de timbre » décrivent ce que
> le logiciel SAIT FAIRE, jamais un taux précis. Les taux applicables à la
> restauration sont un paramètre réglementaire — ils se valident avec un
> expert-comptable, et ne s'affirment ni dans le code, ni sur une fiche
> Play.

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
