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
| 4 | App Store Connect | *Mes applications → +* → nouvelle application, *Bundle ID* **`tn.res2boost.kaissi`** (à enregistrer d'abord dans *Certificates, Identifiers & Profiles* s'il n'existe pas), puis accepter l'accord **« Apps gratuites »** (§4 ter, étape 4) | oui |
| 5 | ton PC | reporter l'**Apple ID à dix chiffres** de la fiche dans `APP_STORE_APPLE_ID`, dans `codemagic.yaml` | oui |
| 6 | ton PC | incrémenter `"version"` dans `apps/pos/package.json` | **à chaque envoi** |
| 7 | Codemagic | *Start new build* → workflow **`pos-ios`** (machine `mac_mini_m2` : **aucun Mac à acheter**) | à chaque envoi |
| 8 | App Store Connect | *TestFlight* : la build arrive, traitement 10–30 min, puis installable | à chaque envoi |
| 9 | App Store Connect | fiche : icône 1024, captures **des deux familles d'appareils déclarées**, mots-clés, confidentialité (§4 ter et §4 quater) | à chaque refonte |
| 10 | App Store Connect | *Notes pour le relecteur* : **compte de démonstration** (e-mail + mot de passe), le PIN de caisse, et le paragraphe qui désamorce la 4.2 — texte prêt à coller au **§4 ter, étape 9** | à chaque envoi |
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

```bash
pnpm pos:version            # où en suis-je ?
pnpm pos:version --monter   # 0.1.1 → 0.1.2, soit versionCode 101 → 102
```

> ### ⚠ « Version code 101 has already been used »
>
> **Le numéro est brûlé au TÉLÉVERSEMENT, pas à la publication.** C'est le
> point contre-intuitif, et il coûte un aller-retour à tout le monde la
> première fois :
>
> **« Discard draft release » annule la version, pas la consommation du
> numéro.** On croit repartir de zéro, on reprend le même AAB, et Play le
> refuse. Il n'existe aucun moyen de récupérer un `versionCode` déjà envoyé,
> ni depuis la console, ni par le support.
>
> La seule réponse est de monter :
>
> ```bash
> pnpm pos:version --monter
> pnpm pos:aab
> ```
>
> Ce n'est pas grave : les numéros ne coûtent rien et personne ne les voit.
> Ce que voit l'utilisateur, c'est le `versionName` (`0.1.2`) — sauter des
> `versionCode` au fil des essais est parfaitement normal.
>
> `pnpm pos:aab` affiche désormais le numéro **avant** de construire, pour
> qu'on puisse le comparer à la console Play sans attendre cinq minutes :
>
> ```
>   Version 0.1.2 · versionCode 102
>   (déjà téléversé sur Play ? → pnpm pos:version --monter)
> ```

> **Où en est-on.** Le premier envoi portait le code **100** (`0.1.0`). La
> version est passée à **`0.1.1` → 101** pour l'envoi qui corrige le niveau
> d'API (§3.3 ter). Le prochain sera `0.1.2` → 102.

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
> nombre se traduit en retirant 44 : **69 − 44 = JDK 25**. Gradle 8.13 ne
> sait pas lire ce bytecode et s'arrête avant d'avoir rien construit. C'est
> `pnpm verifier:jdk` qui le dit maintenant, en une phrase et avant Gradle.
>
> #### ⚑ Si `verifier:jdk` a répondu ✓ et que Gradle échoue quand même
>
> C'est arrivé, et le script était en tort. Il lisait le `java` de votre
> **PATH** ; Gradle ne le consulte qu'en **dernier**. Son ordre à lui :
>
> | | Où Gradle regarde | Se corrige |
> |---|---|---|
> | 1 | `org.gradle.java.home` de `~/.gradle/gradle.properties` | `pnpm verifier:jdk --ecrire` |
> | 2 | `org.gradle.java.home` du `gradle.properties` du projet | dans le fichier |
> | 3 | `gradle/gradle-daemon-jvm.properties` (`toolchainVersion`) | dans le fichier |
> | 4 | **`JAVA_HOME`** | variables d'environnement du poste |
> | 5 | le `java` du `PATH` | `PATH` |
>
> Un `JAVA_HOME` posé une fois dans les variables Windows suffisait donc à
> rendre le garde-fou inopérant : `java -version` affichait 21, Gradle
> prenait le 25, et les deux avaient raison.
>
> `verifier:jdk` applique désormais **cet ordre-là**, et **nomme la source
> retenue** :
>
> ```
> ✓ JDK 21 — dans la plage éprouvée (17–23).
>   Source retenue par Gradle : JAVA_HOME.
> ```
>
> Quand la source diverge du `PATH`, il le dit explicitement — c'est la
> phrase qui manquait. Trois tests de bout en bout fabriquent un faux JDK 25,
> le désignent par `JAVA_HOME`, et exigent le refus ; ils échouent sur
> l'ancien code.
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
> Il honore aussi `GRADLE_USER_HOME`, quand cette variable déplace le dossier
> de Gradle. Ce détail a été trouvé en TESTANT le correctif ci-dessus :
> l'écriture visait `~/.gradle` en dur, donc sur un poste qui pose cette
> variable elle annonçait « ✓ ligne ajoutée » dans un fichier que Gradle ne
> lit pas — le même mensonge, sous une autre forme.
>
> **Ce que `pos:aab` ne fait PAS, et c'est un choix.** Il pourrait passer le
> bon JDK à Gradle en ligne de commande (`-Dorg.gradle.java.home=…`) et
> construire malgré un `JAVA_HOME` fautif. Il s'arrête à la place, parce que
> le contourner laisserait votre poste cassé pour Android Studio et pour tout
> autre projet Gradle. Une commande (`--ecrire`) le règle une fois pour
> toutes ; un contournement le règle pour un seul appel.
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

### 3.3 ter « must target at least API level 36 » — et régénérer l'AAB

Play a refusé un bundle avec ceci :

```
Your app currently targets API level 35 and must target at least
API level 36 to ensure it is built on the latest APIs optimized for
security and performance.
```

> ### ⚠ Le message se lit à l'envers la première fois
>
> Play ne demande PAS de descendre à 35. Il CONSTATE qu'on y est, et exige de
> monter à **36**. La phrase nomme les deux nombres dans cet ordre, et c'est
> le premier qu'on retient.

#### Ce qui a été changé, et pourquoi les trois vont ensemble

Monter d'un niveau d'API enchaîne trois versions qui ne se choisissent pas
séparément. C'est la partie qui coûte du temps, parce que chaque erreur donne
un message qui ne nomme **que la version qu'il a sous les yeux** — jamais
celle qu'il faut bouger.

| Fichier | Avant | Après | Pourquoi |
|---|---|---|---|
| `android/variables.gradle` | `compileSdk`/`targetSdk` **35** | **36** | ce que Play exige |
| `android/build.gradle` | AGP **8.7.2** | **8.11.1** | la 8.7 ne connaît pas l'API 36 et refuse de compiler contre elle |
| `android/gradle/wrapper/…properties` | Gradle **8.11.1** | **8.13** | l'AGP 8.11 l'exige |
| `apps/pos/package.json` | `0.1.0` | **`0.1.1`** | le `versionCode` doit augmenter — voir plus bas |

`pnpm verifier:gradle` lit désormais les trois et refuse de les laisser
diverger :

```
✓ AGP 8.11.1 · Gradle 8.13 · compileSdk 36 · targetSdk 36
```

#### ⚠ Le versionCode, l'erreur qui coûte un aller-retour

Play **refuse un bundle dont le `versionCode` n'est pas strictement supérieur
au précédent**, et un numéro consommé l'est définitivement. Le premier envoi
portait le code **100**.

Le numéro est dérivé de `apps/pos/package.json` — `0.1.0` → `100`. Il est
passé à **`0.1.1` → 101**, puis à **`0.1.2` → 102** — le 101 ayant été brûlé
par un téléversement suivi d'un « Discard draft release » (§3.2). À chaque
envoi, `pnpm pos:version --monter` ; jamais le fichier Gradle.

#### Les deux avertissements, et lequel mérite qu'on s'en occupe

**« There is no deobfuscation file »** — exact, et sans conséquence. Il n'y a
rien à déobfusquer : `minifyEnabled false`. Activer R8 réduirait la taille et
**casserait silencieusement les plugins Capacitor**, qui se résolvent par
réflexion — leurs classes n'ont aucune référence statique, R8 les supprime, et
la caisse s'ouvre sur un écran blanc. Cela se règle par des règles `-keep`, une
par plugin, et cela se vérifie sur un appareil. Tant que ce n'est pas fait, un
avertissement vaut mieux qu'une caisse morte en service.

**« This App Bundle contains native code, and you've not uploaded debug
symbols »** — **il restera, et j'ai eu tort d'annoncer le contraire.**

`debugSymbolLevel 'SYMBOL_TABLE'` a bien été ajouté au bloc `release`, et le
réglage est au bon endroit. Mais il demande à AGP d'empaqueter la version
**non dépouillée** des bibliothèques natives — encore faut-il qu'elle existe.

Le seul code natif du bundle vient d'un AAR **précompilé** :
`net.zetetic:sqlcipher-android`, tiré par `@capacitor-community/sqlite`. Ses
quatre `.so` sont publiées déjà dépouillées. Vérifié sur l'artefact réel :

```
$ file jni/arm64-v8a/libsqlcipher.so
… ELF 64-bit LSB shared object, ARM aarch64, dynamically linked, stripped
$ readelf -S jni/arm64-v8a/libsqlcipher.so
… .dynsym seul — aucune .symtab, aucune section .debug_*
```

Les quatre architectures (`armeabi-v7a`, `arm64-v8a`, `x86`, `x86_64`) sont
dans le même état, et aucun autre plugin Capacitor n'embarque de `.so`. AGP
n'a donc **rien** à empaqueter, et Play continue d'avertir. Constaté : le
versionCode **102** porte encore cet avertissement, ce réglage étant en place.

**Conséquence pratique : aucune.** Si SQLCipher plantait, la trace remonterait
en adresses hexadécimales — mais ce serait un plantage dans la bibliothèque
d'un tiers, pas dans notre code, et c'est à Zetetic qu'il faudrait le
rapporter. Kaissi n'a pas de code natif à elle.

La ligne reste dans `build.gradle` : elle est inoffensive, et elle deviendra
vraie le jour où l'application en aura.

#### Régénérer l'AAB — la marche à suivre

```powershell
# 1. Récupérer les corrections
git pull

# 2. Réinstaller — le numéro de version a changé
pnpm install

# 3. Tout enchaîner : contrôles, mode avion, cap sync, bundleRelease
pnpm pos:aab
```

`pnpm pos:aab` fait les cinq étapes dans l'ordre et s'arrête au premier
problème. À la fin :

```
apps/pos/android/app/build/outputs/bundle/release/app-release.aab
```

C'est ce fichier qu'on téléverse.

> **La toute première construction sera longue.** Gradle télécharge sa
> distribution 8.13 (≈ 130 Mio) et le SDK Android 36 s'il manque. Comptez
> cinq à dix minutes, et une seule fois.

#### Si Gradle proteste — les trois messages possibles, et leur réponse

| Message | Cause | Réponse |
|---|---|---|
| `Version code N has already been used` | Le numéro est consommé au téléversement ; « Discard draft » ne le rend pas | `pnpm pos:version --monter` puis `pnpm pos:aab` (§3.2) |
| Pas de lien d'inscription, alors que la version est « available to selected testers » | La VERSION est déployée, l'APPLICATION n'est pas encore publiée | Vider « Modifications en cours d'examen », compléter « Configurer votre application » (§3.5) |
| `Unsupported class file major version 69` | JDK 25, que Gradle ne lit pas | `pnpm verifier:jdk --ecrire` (§3.3 bis) |
| Le même message **alors que `verifier:jdk` répond ✓** | `JAVA_HOME` désigne un autre Java que le `PATH`. Le script le détecte et nomme la source depuis le correctif ; s'il répond encore ✓, votre dépôt est en retard — `git pull`. | `pnpm verifier:jdk --ecrire` |
| `… requires Android Gradle plugin 8.x or higher` | le couple AGP/Gradle a divergé | `pnpm verifier:gradle` le dit avant Gradle |
| `Failed to find target with hash string 'android-36'` | le SDK 36 n'est pas installé | Android Studio → *SDK Manager* → cocher **Android 16 (API 36)** → *Apply* |

Le troisième est le plus probable sur un poste qui n'a jamais construit pour
l'API 36 : le SDK se télécharge depuis Android Studio, pas depuis le projet.

> ### ⚠ Ce qui n'a PAS pu être vérifié ici, et qu'il faut faire une fois
>
> Cette montée de version a été faite sans construire — ce dépôt n'a pas de
> SDK Android. Ce qui A été vérifié : que les trois versions se tiennent
> d'après la table de compatibilité d'Android Studio, que `compileSdk` suit
> `targetSdk`, que les symboles natifs sont demandés (sans effet tant que le
> seul code natif vient d'un AAR déjà dépouillé — voir §3.5), et que les deux
> changements de comportement d'Android 16 les plus cassants ne nous
> concernent pas (voir juste en dessous).
>
> Ce qui reste à faire une fois, chez vous : **lancer `pnpm pos:aab` et
> installer l'APK sur une vraie tablette** avant de publier. Une montée
> d'API ne se valide pas sur le papier.

#### Ce que viser l'API 36 change au comportement — et pourquoi ça passe ici

Deux changements d'Android 16 s'appliquent dès qu'on vise 36. Ce sont ceux
qui cassent le plus d'applications, et ils ont été vérifiés avant de monter :

- **l'affichage bord à bord est imposé** — le contenu passe sous la barre
  d'état et sous la barre de navigation, sans possibilité de s'y soustraire.
  `apps/pos/index.html` porte déjà `viewport-fit=cover`, et `styles.css`
  applique `env(safe-area-inset-*)` sur le `body`. **Rien à faire** ;
- **le verrou d'orientation est ignoré sur les grands écrans.** Le manifeste
  n'en pose aucun, et la caisse est responsive (bascule à 820 px). **Rien à
  faire non plus.**

C'est le genre de vérification qui paraît inutile jusqu'au jour où l'on
découvre le bandeau de la caisse coupé par l'heure du téléphone.

---

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
Google la teste, et un lien mort fait refuser la fiche. **Elle existe déjà** :
`https://‹votre-domaine-vercel›/confidentialite`, servie par le back-office.
Le §3.5 ter explique le piège qui la rendait injoignable malgré tout.

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

#### ⚠ « The link will be shown here when you publish your app »

La version est en ligne — *Available to selected testers*, une date de
publication, « Available on 20 284 devices » — et l'onglet **Testeurs** affiche
pourtant encore cette phrase, sans lien d'inscription. Rien n'est cassé : les
deux écrans ne parlent pas de la même chose.

| Ce que dit l'écran | Ce que ça veut dire |
|---|---|
| *Available to selected testers* | la **version** est déployée sur la piste |
| *…when you publish your app* | l'**application** n'est pas encore publiée |

Le lien d'inscription — `https://play.google.com/apps/testing/‹package›`,
soit `https://play.google.com/apps/testing/tn.res2boost.kaissi` — n'est
fabriqué qu'une fois l'application publiée. Pour une application neuve, ce
n'est pas la mise en ligne de l'AAB qui déclenche cela.

**À vérifier, dans cet ordre :**

1. **Aperçu des publications → « Modifications en cours d'examen ».** Tant
   qu'il reste une ligne — *Start full rollout*, *Countries / regions*,
   *Resume track* —, la configuration de la piste n'est pas appliquée. Les
   contrôles automatiques annoncent « up to 13 minutes » ; l'examen lui-même
   prend de quelques heures à quelques jours au **premier** envoi.
2. **Tableau de bord → « Configurer votre application ».** La liste doit être
   **entièrement** cochée : contenu de l'application, Data safety, classement
   de contenu, public cible, politique de confidentialité. Une seule case
   manquante suffit à laisser l'application non publiée.
3. **Pays / régions de la piste.** Un testeur situé hors des pays ciblés ne
   voit rien, même avec le lien.

**Pour tester tout de suite, sans attendre.** La piste **Test interne** est
disponible en quelques minutes, sans examen, jusqu'à 100 testeurs — et son
lien d'inscription apparaît immédiatement. C'est la bonne piste pour mettre
l'application entre les mains de l'équipe le jour même.

> ⚠ Elle ne compte **pas** pour l'exigence d'accès à la production des
> comptes ouverts depuis fin 2023 — 12 testeurs pendant 14 jours en test
> **fermé**. Le test interne débloque l'essai, pas le compteur : gardez la
> piste fermée en parallèle, c'est elle qui fait courir les 14 jours.

---

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

### 3.5 bis Les quatre champs que Play refuse de laisser vides

Play Console bloque la publication tant que quatre cases ne sont pas
remplies. Toutes les quatre sont produites par le dépôt — rien à dessiner à
la main, rien à photographier avec un téléphone.

| Ce que Play demande | D'où ça sort |
|---|---|
| **URL de politique de confidentialité** | une page du back-office, déjà en ligne — §3.5 ter |
| **Icône 512 × 512** | `pnpm visuels` → `ressources-store/icone-512.png` |
| **Image mise en avant 1024 × 500** | `pnpm visuels` → `ressources-store/banniere-1024x500.png` |
| **Captures téléphone et tablettes** | `pnpm captures` → `ressources-store/captures/` |

---

### 3.5 ter La politique de confidentialité — une page, et une URL qui répond

Google exige une URL **publique**, et il la teste. La page existe :

```
https://‹votre-domaine-vercel›/confidentialite
```

C'est une page du back-office (`apps/backoffice/src/app/confidentialite/`),
donc déjà déployée avec lui — aucun site à créer, aucun hébergement de plus.

> ### ⚠ Le piège qui fait rejeter une fiche alors que la page existe
>
> Le middleware du back-office redirige tout visiteur sans session vers
> `/connexion`. Servie ainsi, la politique aurait rendu **un écran de
> connexion** au robot de Google — qui aurait conclu « politique
> injoignable » et rejeté la fiche. Le plus agaçant est qu'on ne le voit
> pas : on ouvre l'URL dans son propre navigateur, on est connecté, la page
> s'affiche, et on cherche ailleurs.
>
> `apps/backoffice/src/serveur/routes-publiques.ts` ouvre donc ce chemin
> **explicitement**, et `routes-publiques.test.ts` vérifie les deux sens :
> que la politique est bien publique, et que rien d'autre ne l'est devenu —
> y compris qu'un `startsWith` ne laisse pas passer
> `/confidentialite-interne`.
>
> Pour le vérifier vous-même, comme Google le fera :
>
> ```bash
> curl -s -o /dev/null -w "%{http_code} %{num_redirects}\n" \
>   -L https://‹votre-domaine›/confidentialite
> ```
>
> Attendu : **`200 0`**. Un `200 1` signifie qu'il y a eu une redirection —
> donc que la page rendue est l'écran de connexion.

**Deux choses à compléter avant publication**, marquées dans le fichier : la
raison sociale exacte de l'éditeur et son adresse de contact. Elles ne
s'inventent pas depuis le code.

> **Le contenu doit correspondre au formulaire « Sécurité des données ».**
> C'est le troisième motif de refus le plus fréquent : une politique qui parle
> de données que l'application ne collecte pas, ou l'inverse. Celle-ci décrit
> exactement les cinq catégories du tableau du §3.5 — e-mail, nom d'employé,
> identifiant d'appareil, ventes, et le nom de client facultatif — et rien de
> plus.

---

### 3.5 quater L'icône et l'image mise en avant

```bash
pnpm visuels
```

Une commande, quatre fichiers dans `ressources-store/` :

| Fichier | Format | Pour |
|---|---|---|
| `icone-512.png` | 512 × 512 | **Play — icône** |
| `banniere-1024x500.png` | 1024 × 500 | **Play — image mise en avant** |
| `icone-1024.png` | 1024 × 1024 | App Store — icône |
| `icone-48-apercu.png` | — | contrôle, voir plus bas |

Les deux premiers sont ceux que Play réclame. Ils pèsent une centaine de kio,
très loin des limites (1 Mio pour l'icône, 15 Mio pour la bannière).

> **Pourquoi un script plutôt qu'un PNG posé dans le dépôt.** Parce qu'une
> image binaire ne se relit pas. Le jour où la charte bouge — elle vient de
> bouger — un PNG reste en arrière sans que rien ne le signale, et on publie
> une icône d'une palette qui n'existe plus. Ici les couleurs sont les mêmes
> littéraux que les feuilles de styles, la marque est du SVG, et régénérer
> prend trois secondes.

**Deux règles que les magasins imposent, et que le script tient :**

- **aucune transparence, aucun coin arrondi.** Les deux magasins masquent
  l'icône eux-mêmes ; un arrondi dessiné dedans en donne deux, et un fond
  transparent devient noir sur certains thèmes. Le fond est un aplat opaque
  jusqu'au bord ;
- **la marque tient dans les 78 % centraux**, la zone qu'aucun masque ne
  rogne quelle que soit la forme retenue par le lanceur.

> ### `icone-48-apercu.png` — le fichier qui n'est pas à téléverser
>
> Il rend l'icône à 48, 72 et 112 px, côte à côte. 48 px, c'est sa taille dans
> la liste des applications d'un téléphone : c'est là qu'elle sera vue, pas en
> 512.
>
> Il a servi tout de suite. La première version du dessin exprimait
> l'épaisseur du trait **deux fois à l'échelle** — juste à 512, dix fois trop
> fin dès qu'on réduisait. En 512 l'icône était parfaite ; en 48, un K en fil
> de fer. Sans cet aperçu, elle partait sur le magasin.

Si vous préférez partir d'un logo à vous plutôt que de la marque dessinée,
`outils/visuels-store.html` fait la conversion : ouvrez-le dans un
navigateur, déposez une image, récupérez les formats exacts. Rien ne part sur
Internet — le redimensionnement se fait dans la page.

---

### 3.5 quinquies Les captures d'écran, sans téléphone

> **« Comment je fais, je n'ai pas encore l'application sur un téléphone ? »**
>
> On n'en a pas besoin, et ce n'est pas un contournement. Kaissi a **deux
> cibles de build qui servent le même bundle** : `android` l'empaquette dans
> l'APK, `web` le sert comme site statique. Une capture prise sur la cible web
> montre donc, au pixel près, ce que le magasin installera. Ce ne sont pas des
> maquettes — c'est l'application.
>
> C'est d'ailleurs ce que les magasins demandent : une capture doit montrer
> l'application telle qu'elle est. Une image retouchée, ou un écran fabriqué
> dans un outil de dessin, est un motif de refus.

```bash
# Un terminal : servir le build web
pnpm pos:build:web
pnpm --filter @kaissi/pos preview:web

# Un autre : prendre les captures
pnpm captures
```

Douze fichiers, quatre par format, dans `ressources-store/captures/` :

| Dossier | Taille produite | Case Play |
|---|---|---|
| `telephone/` | 1920 × 1080 | **Captures téléphone** (2 à 8) |
| `tablette-7/` | 2048 × 1152 | **Captures tablette 7 pouces** |
| `tablette-10/` | 2560 × 1440 | Captures tablette 10 pouces |

Toutes en **16:9**, tous les côtés entre 320 et 3840 px, bien en dessous des
8 Mio par image. Le parcours capturé est celui d'un service : plan de salle,
prise de commande, encaissement, ticket client — dans cet ordre, qui est
celui d'un restaurateur qui hésite.

> ### ⚠ L'étiquette « démo — mémoire », et pourquoi le script refuse de continuer
>
> `pnpm pos:dev` travaille sur une base **en mémoire** et affiche, à côté du
> nom de l'établissement, une étiquette « démo — mémoire ». Sur une fiche
> Play, c'est exactement la mention qu'il ne faut pas : elle dit au visiteur
> que ce qu'il regarde n'est pas une caisse.
>
> Le script part donc du build `web` servi par `preview`, qui persiste dans
> IndexedDB — l'étiquette disparaît. Et il **vérifie son absence** avant
> d'écrire quoi que ce soit : lancé par erreur contre `pos:dev`, il s'arrête
> et dit quoi lancer à la place.

**Kaissi est une application de PAYSAGE** — une caisse est posée sur un
comptoir — d'où le 16:9 partout, y compris dans la case « téléphone ». Play
accepte les deux orientations ; montrer un portrait donnerait une fausse idée
du produit.

> **Les captures ne sont pas versionnées**, contrairement à l'icône et à la
> bannière. Ce qui est DESSINÉ est dans le dépôt : ça change rarement et ça
> pèse peu. Ce qui est CAPTURÉ est un reflet de l'interface : ça change à
> chaque retouche, ça pèse cinq mégaoctets, et ça se refait en une commande.
> `.gitignore` le dit.

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

## 4 ter. Publier : le parcours App Store Connect, clic par clic

Le pendant du §3.5, pour Apple. Les différences avec Play ne sont pas
cosmétiques, et trois d'entre elles changent le calendrier :

| | Google Play | App Store |
|---|---|---|
| Compte | **25 $, une fois** | **99 $ par AN** — non renouvelé, l'application **disparaît** du magasin |
| Machine | n'importe laquelle | un Mac. `codemagic.yaml` en loue une (§4 bis) — rien à acheter |
| Installer hors magasin | l'APK, à la main (§3.4) | **impossible**. TestFlight est la seule voie, et une build y expire au bout de **90 jours** |
| Revue | 1 à 2 semaines la première fois | **24 à 48 h**, mais plus stricte |

> **Ce troisième point se planifie.** Sur Android, on livre un client
> aujourd'hui avec un APK et on publie plus tard. Sur iOS, il n'y a pas de
> « sources inconnues » : avant publication, tout passe par TestFlight, et un
> testeur externe doit avoir été invité. Ne promettez pas une installation
> iPad pour demain avant d'avoir le compte développeur.

### Étape 1 — Le compte Apple Developer

1. <https://developer.apple.com/programs/enroll/> ;
2. l'identifiant Apple utilisé doit avoir la **double authentification**
   activée — sans elle, l'inscription s'arrête là ;
3. choisissez **Organisation** ou **Personne physique** (voir juste en
   dessous) ;
4. 99 $, puis **chaque année**. Programmez un rappel : un renouvellement
   oublié retire l'application du magasin, et les clients qui changent d'iPad
   ne peuvent plus la réinstaller.

| | Organisation | Personne physique |
|---|---|---|
| Vendeur affiché sur la fiche | la société | **votre nom civil** |
| Pièces demandées | numéro **D-U-N-S** (gratuit, **1 à 2 semaines**), preuve d'autorité légale | pièce d'identité |
| Délai | 1 à 3 semaines | 24 à 48 h |

> **Commencez par là, comme pour Play.** C'est la seule étape dont le délai
> ne dépend pas de vous. Et si vous facturez au nom d'une société, le D-U-N-S
> se demande le premier jour, pas le dernier.

### Étape 2 — Enregistrer l'identifiant de l'application

*Certificates, Identifiers & Profiles* → **Identifiers** → **+** → *App IDs*
→ *App* :

| Champ | Valeur |
|---|---|
| Description | `Kaissi POS` |
| Bundle ID | **Explicit** → `tn.res2boost.kaissi` |
| Capabilities | aucune |

Aucune capacité à cocher : Kaissi n'utilise ni notifications push, ni Apple
Pay, ni iCloud sur l'appareil. En cocher « au cas où » ajoute des droits que
le relecteur demandera de justifier.

> `app-store-connect fetch-signing-files … --create` (workflow `pos-ios`) sait
> le créer tout seul. Le faire à la main une fois laisse une console lisible,
> où l'on retrouve ce qu'on a déclaré.

### Étape 3 — Créer la fiche

App Store Connect → **Mes applications** → **+** → *Nouvelle app* :

| Champ | Ce qu'on met | Pourquoi |
|---|---|---|
| Plateformes | iOS | |
| Nom | `Kaissi — Caisse restaurant` | **30 caractères**, et **unique dans tout l'App Store** — s'il est pris, Apple refuse à la création |
| Langue principale | Français | le marché est tunisien |
| Bundle ID | `tn.res2boost.kaissi` | celui de l'étape 2 |
| SKU | `kaissi-pos-ios` | identifiant interne, jamais affiché, **jamais modifiable** |
| Accès utilisateur | Accès complet | |

Puis, dans *Informations sur l'app*, relevez l'**Apple ID à dix chiffres** de
la fiche et reportez-le dans `APP_STORE_APPLE_ID`, dans `codemagic.yaml`
(§4 bis). Tant qu'il est vide, le numéro de build retombe sur le compteur de
Codemagic.

### Étape 4 — Tarif, disponibilité, et le contrat qui bloque tout

1. *Tarifs et disponibilité* → **Gratuit**. Même raison que sur Play :
   Kaissi se vend en abonnement, avec paramétrage sur place ; l'application
   seule ne se vend pas.
2. Disponibilité : la **Tunisie** au minimum. Rien n'interdit d'ouvrir plus
   large, mais une fiche en français dans quarante pays ne sert personne.
3. *Accords, taxes et banque* → l'accord **« Apps gratuites »** doit être
   **accepté**.

> ⚠ **Le point 3 est le piège le plus bête de tout ce parcours.** Tant que
> l'accord n'est pas accepté, la fiche reste bloquée dans un état d'attente,
> et rien dans l'écran de soumission ne dit que c'est la cause. On cherche du
> côté de la build pendant une heure.

### Étape 5 — Confidentialité (App Privacy)

L'équivalent du *Data safety* de Play, avec le vocabulaire d'Apple. Ce que
Kaissi collecte réellement — **la même vérité que sur Play, les mêmes
réponses** :

| Donnée | Collectée ? | Catégorie Apple | Liée à l'utilisateur ? | Utilisée pour le SUIVI ? |
|---|---|---|---|---|
| Adresse e-mail (compte du gérant) | oui | *Contact Info → Email Address* | oui | **non** |
| Nom (l'employé) | oui | *Contact Info → Name* | oui | **non** |
| `device_id` | oui | *Identifiers → Device ID* | oui | **non** |
| Ventes, tickets | oui | *Financial Info → Other Financial Info* | oui | **non** |
| Position | **non** | | | |
| Contacts, photos, micro, carnet d'adresses | **non** | | | |
| Données d'usage, diagnostics | **non** | | | |

Usage déclaré pour chacune : **App Functionality** — et rien d'autre. Ni
*Analytics*, ni *Product Personalization*, ni *Developer's Advertising*.

**« Utilisée pour le suivi » : non, partout.** Ce mot a un sens précis chez
Apple — croiser ces données avec celles d'autres sociétés à des fins
publicitaires. Répondre « oui » par prudence déclencherait l'obligation
d'afficher la demande **App Tracking Transparency** au premier lancement
d'une caisse, ce qui serait à la fois faux et absurde.

**URL de politique de confidentialité** : obligatoire, publique, et Apple la
teste comme Google. La même que pour Play.

### Étape 6 — Classement par âge

Un questionnaire, dans *Informations sur l'app*. Kaissi : aucune violence,
aucun contenu sexuel, aucun jeu d'argent, aucun contenu généré par les
utilisateurs. Le classement obtenu est **le plus bas**.

> ⚠ **Une seule question peut tout faire basculer : « accès web sans
> restriction ».** Répondre oui fait passer le classement à la tranche
> adulte, et une caisse classée « 18+ » a l'air de tout sauf d'un logiciel de
> gestion. La réponse est **non** : Kaissi n'embarque aucun navigateur, et
> son bundle est local — c'est exactement ce que garantit
> `verifier-mode-avion.mjs` (§1).

### Étape 7 — Envoyer une build

Deux chemins, au choix :

```bash
# 1. Codemagic — aucun Mac nécessaire
#    Start new build → workflow « pos-ios » (§4 bis)

# 2. Sur un Mac, à la main
pnpm install && pnpm pos:build
pnpm --filter @kaissi/pos exec cap sync ios
cd apps/pos/ios/App && pod install && open App.xcworkspace
# Xcode → Product → Archive → Distribute App → App Store Connect → Upload
```

La build apparaît ensuite dans *TestFlight*, en **traitement** pendant 10 à
30 minutes. Si Apple la refuse, un e-mail arrive avec un code `ITMS-…` — il
nomme précisément ce qui manque.

> **La conformité à l'export de cryptographie est déjà répondue.**
> `ITSAppUsesNonExemptEncryption = false` est dans l'`Info.plist` (§4). Sans
> cette clé, App Store Connect repose la question à **chaque** envoi et
> bloque TestFlight tant que personne n'y répond à la main.

### Étape 8 — TestFlight, et l'installation chez un client

| | Testeurs internes | Testeurs externes |
|---|---|---|
| Combien | 100 | 10 000 |
| Qui | les membres de votre équipe App Store Connect | n'importe qui, par e-mail ou **lien public** |
| Revue | **aucune** | *Beta App Review* au premier build, souvent < 24 h |
| Disponible | dès la fin du traitement | après cette revue |

Le testeur installe l'application **TestFlight** depuis l'App Store, ouvre le
lien, et Kaissi s'installe. **C'est aussi la seule façon de faire tourner
Kaissi sur l'iPad d'un client avant publication** — il n'y a pas d'équivalent
de l'APK.

**Installez-la vous-même sur un vrai iPad avant d'aller plus loin**, comme
pour le test interne de Play. Et prévenez le client : une build TestFlight
**expire au bout de 90 jours**.

### Étape 9 — Les informations pour le relecteur

**C'est l'étape qui fait rejeter.** *Version → Informations pour la revue.*

**a. Le compte de démonstration est obligatoire.** Kaissi exige une
connexion : sans compte, le relecteur ne peut pas ouvrir l'application et
rejette (*Guideline 2.1 — App Completeness*). Créez-le pour de bon avec
`pnpm sync:nouveau-client`, sur un restaurant de démonstration, et donnez
**aussi le code PIN de caisse** — l'e-mail et le mot de passe ouvrent le
back-office, le PIN ouvre la caisse. Oublier le second est la version
subtile du même rejet.

**b. Les notes, en anglais.** Le reste de ce document est en français ; ces
notes-là sont lues par le relecteur d'Apple, pas par un client. Un texte
prêt à coller :

```
Kaissi is a point-of-sale application for restaurants in Tunisia.

HOW TO TEST
1. Launch the app. It opens offline — no network needed.
2. Staff sign-in screen: pick "Salma Trabelsi", PIN 2468.
3. Open the cash drawer with any amount, then take an order from
   the floor plan and cash it. A receipt is shown on screen.
4. To test synchronisation: Sync screen → sign in with the demo
   account given in the "Sign-in required" fields above.

THIS APP IS NOT A WEBSITE WRAPPER (Guideline 4.2)
The entire application is bundled inside the IPA. There is no
remote URL loaded at runtime: no `server.url`, no WebView pointing
at a website. Please verify by enabling Airplane Mode before the
first launch — the app starts, takes orders and completes a sale
with no connectivity at all. This is the core purpose of the
product: restaurants in Tunisia lose Internet access regularly,
and a cash register that stops is a queue of customers leaving.

BUSINESS MODEL (Guideline 3.1.3)
Kaissi is sold directly by us to restaurant businesses, with
on-site configuration of their menu, tax rates and staff. It is
not sold to consumers, and no digital content or subscription is
offered for sale inside the app. Accounts are created by us for
the business owner.
```

> **Le paragraphe 4.2 n'est pas une formule, c'est notre argument.** Apple
> refuse les sites emballés. Kaissi n'en est pas un — et le relecteur peut le
> vérifier en trente secondes en coupant le réseau. Lui dire comment le faire
> transforme la contrainte d'architecture du §1 en argument de revue.
>
> **Le paragraphe 3.1.3, lui, est une position à défendre, pas un fait
> acquis.** Apple dispense d'achat intégré les services vendus directement à
> des organisations (*Enterprise Services*), et Kaissi entre dans cette
> description : on le vend à un restaurateur, on paramètre sa carte avec lui.
> Mais c'est Apple qui tranche. Écrivez-le clairement dès la première
> soumission plutôt que d'attendre la question — et attendez-vous, le cas
> échéant, à un échange. C'est le seul risque de revue propre à iOS que
> Kaissi ne contrôle pas.

**c. Coordonnées.** Un e-mail et un téléphone qui répondent : Apple s'en sert
si quelque chose bloque, et une revue en attente d'une réponse dort.

### Étape 10 — Soumettre, et ce qui fait rejeter

*Version → Ajouter pour la revue* → **Soumettre**. Comptez 24 à 48 h.

Choisissez **Publication manuelle** plutôt qu'automatique : une application
approuvée un vendredi soir ne devrait pas partir en ligne pendant que
personne ne regarde.

Les motifs de refus les plus fréquents, tous évitables :

- **compte de démonstration absent, faux, ou sans le PIN** (étape 9a) — de
  loin le premier ;
- **captures d'écran qui ne correspondent pas à l'application**, ou
  incomplètes pour un des deux types d'appareil déclarés (§4 quater) ;
- **4.2 — fonctionnalité minimale** : levée par le paragraphe des notes, et
  par le fait que l'application fonctionne réellement en mode avion ;
- **3.1.1 — achat intégré** : voir l'étape 9b ;
- **politique de confidentialité injoignable**, ou incohérente avec les
  réponses de l'étape 5 ;
- **métadonnées** : une capture qui montre un prix, ou un texte qui promet
  une fonctionnalité absente.

---

## 4 quater. Les textes et les visuels de la fiche App Store

### Ce qui change par rapport à Play, et pourquoi ça change le texte

**Apple n'indexe PAS la description.** Play, si. Chez Apple, la recherche ne
regarde que trois choses : le **nom** (30 car.), le **sous-titre** (30 car.)
et un champ **mots-clés** de **100 caractères**, invisible du public.

Conséquence pratique : la description longue de Play (§3.6) se réutilise
telle quelle pour être *lue*, mais les mots-clés qu'elle porte n'y servent
plus à rien. Ils déménagent dans le champ dédié.

### Les textes

**Nom** — 30 caractères, unique dans tout l'App Store :

```
Kaissi — Caisse restaurant
```

*(26 caractères.)*

**Sous-titre** — 30 caractères, indexé, affiché sous le nom :

```
Encaisse même sans Internet
```

*(27 caractères.)* C'est l'argument, pas une description. Il est indexé :
« encaisse » et « Internet » y travaillent deux fois.

**Mots-clés** — 100 caractères, **séparés par des virgules SANS espace**, au
singulier :

```
caisse,restaurant,snack,café,pos,encaissement,ticket,stock,tva,dinar,tunisie,addition,serveur
```

*(93 caractères.)*

> **Trois règles qui font perdre des caractères pour rien.** Un espace après
> une virgule compte comme un caractère et ne sert à rien. Les mots déjà
> présents dans le **nom** et le **sous-titre** sont déjà indexés : les
> répéter ici gaspille la place — c'est pourquoi « caisse » et « restaurant »
> pourraient sortir de cette liste si l'on manquait de place. Et le pluriel
> est inutile : Apple le gère.

**Texte promotionnel** — 170 caractères, **modifiable sans nouvelle version**,
affiché en tête de description :

```
Kaissi encaisse même quand Internet tombe : l'application est installée sur la tablette, pas sur un site web.
```

*(109 caractères.)* C'est le seul texte qu'on peut changer sans repasser par
la revue — utile pour annoncer une nouveauté sans publier une version.

**Description** — 4 000 caractères. **Reprenez celle du §3.6 telle quelle** :
elle est écrite pour être lue, ce qui est exactement son rôle ici. Retirez la
dernière ligne de contact si vous préférez la mettre dans l'URL de support.

**URL de support** — **obligatoire**, et testée. Une page qui donne un e-mail
et un téléphone suffit ; une URL morte fait rejeter la fiche.

**URL marketing** — facultative. Le site de Res2Boost.

**Copyright** — `2026 Res2Boost`.

**Nouveautés de cette version** — obligatoire à partir de la deuxième
version. Une phrase par changement visible, jamais « corrections diverses » :
c'est ce que lit un client qui hésite à mettre à jour sa caisse un vendredi
soir.

### Les visuels

**L'icône** — 1024 × 1024 PNG, **sans transparence et sans coins arrondis**
(iOS les pose lui-même). `outils/visuels-store.html` la produit, à côté des
formats de Play : ouvrez le fichier dans un navigateur, déposez votre image.
Rien ne part sur Internet.

**Les captures d'écran** — et c'est ici qu'une décision technique se paie.

Le projet iOS déclare `TARGETED_DEVICE_FAMILY = "1,2"` : **iPhone ET iPad**.
Apple exige alors un jeu de captures **pour chacun des deux**, et une fiche
incomplète ne se soumet pas.

Deux options, à trancher avant de préparer les visuels :

| | Garder iPhone + iPad | Passer en iPad seul (`"2"`) |
|---|---|---|
| Captures à fournir | les deux jeux | un seul |
| Ce que ça dit au client | « ça marche aussi sur iPhone » | « c'est une caisse, elle vit sur un comptoir » |
| Travail | deux séries de captures à refaire à chaque refonte | une |

> **Kaissi est une application de tablette**, comme le dit déjà le §3.6 pour
> Play. Un iPhone de 6 pouces n'est pas un poste de caisse : la grille de
> produits y devient inutilisable, et une capture d'iPhone donnerait une
> mauvaise idée du produit. Si vous ne visez pas l'iPhone, le dire dans le
> projet coûte une ligne et supprime la moitié du travail de fiche.
>
> Ce n'est pas une décision de documentation : elle change ce que le magasin
> exige. Elle se prend une fois, avant la première soumission.

Les tailles exactes attendues **changent avec les modèles d'iPad et
d'iPhone** ; App Store Connect affiche, pour chaque emplacement, les
dimensions qu'il accepte au moment où vous téléversez. C'est cette liste-là
qui fait foi — pas un tableau écrit ici, qui vieillirait en silence. Le
principe, lui, ne bouge pas : la plus grande taille de chaque famille suffit,
Apple redimensionne pour les autres.

> **Les captures se prennent, elles ne se fabriquent pas** — même règle que
> pour Play. Sur un iPad : bouton du haut + volume haut (ou bouton principal
> + bouton du haut sur les modèles qui en ont un) ; depuis le simulateur
> Xcode : ⌘S, l'image atterrit sur le bureau. Montrez la prise de commande,
> l'encaissement, le ticket, l'écran Stock — dans cet ordre, c'est le
> parcours d'un restaurateur qui hésite.
>
> ⚠ Et **en paysage** : `UISupportedInterfaceOrientations~ipad` met le
> paysage en premier parce qu'une caisse est posée sur un comptoir. Des
> captures en portrait montreraient une application que personne n'utilise
> comme ça.

**Aperçu vidéo** — facultatif, jusqu'à trois, 15 à 30 secondes. À laisser de
côté pour une première publication : une vidéo qui vieillit mal fait plus de
mal qu'une absence de vidéo.

> ⚠ Comme pour Play : ces textes décrivent ce que le logiciel **sait faire**.
> Ni la fiche, ni la capture d'un ticket ne doivent affirmer un taux de TVA
> ou une règle de timbre — ce sont des paramètres réglementaires, et ils se
> valident avec un expert-comptable.

---

## 5. Dans quel ordre

1. **Maintenant** — l'APK signé, installé à la main. Zéro attente, correction
   le jour même.
2. **Quand deux ou trois clients tournent** — Google Play. La mise à jour
   automatique cesse d'être un confort et devient nécessaire : on ne va pas
   réinstaller à la main sur quinze tablettes.
3. **iOS** — le projet et la chaîne de construction existent (§4 et §4 bis),
   et le parcours de publication est écrit clic par clic (§4 ter, §4 quater) ;
   il reste le compte développeur à 99 $/an et la fiche App Store. L'iPad
   reste rare en restauration tunisienne : à ouvrir quand un client le
   demande, sans travail technique à refaire ce jour-là.

   > Deux réserves à connaître avant de promettre une date : le compte
   > **Organisation** demande un numéro D-U-N-S, qui prend une à deux
   > semaines à obtenir ; et il n'existe **aucun équivalent de l'APK** — avant
   > publication, l'installation chez un client passe par TestFlight.

Le back-office reste web, sur les trois étapes. Personne n'encaisse dans un
back-office, et une page web s'ouvre depuis n'importe quel poste sans rien
installer.
