# Tester le mode avion sur un appareil réel

C'est le **critère de sortie de la Phase 0** : l'application doit s'ouvrir et
afficher son menu **sans aucun réseau**. Ce document donne la procédure exacte,
et surtout comment distinguer un vrai succès d'un faux positif.

---

## 0. Pourquoi ce test est le seul qui compte

Un POS qui fonctionne au bureau, avec le Wi-Fi, ne prouve rien. Le pattern
qu'on refuse ici — une coque Capacitor qui charge un site distant — passe très
bien tous les tests tant que le réseau est là, et échoue à 100 % le jour où il
tombe. La seule vérification honnête est : **avion activé, application tuée,
application rouverte**.

---

## 1. Prérequis sur ta machine

| Outil | Version | Vérification |
|---|---|---|
| Node | ≥ 22 | `node -v` |
| pnpm | ≥ 10 | `pnpm -v` |
| JDK | 21 | `java -version` |
| Android Studio | Ladybug ou plus récent | — |
| Android SDK | API 34+ | `sdkmanager --list_installed` |

**macOS / Linux** — dans `~/.zshrc` ou `~/.bashrc` :

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"        # macOS
# export ANDROID_HOME="$HOME/Android/Sdk"              # Linux
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/tools"
```

**Windows** — dans **PowerShell** (`setx` ne s'applique qu'aux terminaux
ouverts *ensuite* : ferme et rouvre tous tes terminaux après) :

```powershell
setx ANDROID_HOME "$env:LOCALAPPDATA\Android\Sdk"
setx JAVA_HOME "C:\Program Files\Android\Android Studio\jbr"
```

> Pas besoin d'installer un JDK 21 séparé sous Windows : Android Studio
> embarque le sien (le « JBR »). Ton `java` global peut rester en 17 pour le
> reste de tes projets.

**Tu n'as pas de tablette ?** Un émulateur Android suffit pour ce test, y
compris pour le critère de sortie. Toute la procédure d'installation est dans
[`tester-sans-tablette.md`](tester-sans-tablette.md) ; reviens ici ensuite
pour le § 4.

---

## 2. Prérequis sur l'appareil

Une **tablette Android** (ou un terminal Sunmi), ou un **émulateur** :

1. Réglages → À propos → taper 7 fois sur « Numéro de build » ;
2. Réglages → Options pour les développeurs → **Débogage USB** activé ;
3. brancher en USB, accepter l'empreinte affichée ;
4. vérifier : `adb devices` doit lister l'appareil en `device` (pas `unauthorized`).

---

## 3. Construire et installer

```bash
pnpm install

# Construit le bundle ET vérifie qu'il ne dépend d'aucun réseau.
# Cette commande ÉCHOUE si quelqu'un a réintroduit une dépendance distante.
pnpm --filter @kaissi/pos build

# Copie dist/ dans android/app/src/main/assets/public
pnpm --filter @kaissi/pos exec cap sync android

# Compile l'APK et l'installe sur l'appareil branché
pnpm --filter @kaissi/pos exec cap run android
```

Si `cap run` ne trouve pas l'appareil :

```bash
pnpm --filter @kaissi/pos exec cap open android   # ouvre Android Studio
# puis Run ▶ depuis l'IDE
```

---

## 4. Le test proprement dit

### 4.1 Couper le réseau — vraiment

Sur l'appareil :

1. **Mode avion : ACTIVÉ** ;
2. vérifier que le Wi-Fi ne s'est pas rallumé tout seul (certaines surcouches
   Android le font) ;
3. si l'appareil a une carte SIM, vérifier que les données mobiles sont coupées.

Contrôle en ligne de commande :

```bash
adb shell settings get global airplane_mode_on   # doit renvoyer 1
adb shell dumpsys connectivity | grep -i "NetworkAgentInfo"   # doit être vide
```

### 4.2 Tuer complètement l'application

**Ne pas se contenter du bouton Retour.** Une application en arrière-plan garde
son état en mémoire et masquerait le problème.

```bash
adb shell am force-stop tn.res2boost.kaissi
```

Ou : Réglages → Applications → Kaissi → **Forcer l'arrêt**.

### 4.3 Rouvrir

```bash
adb shell monkey -p tn.res2boost.kaissi -c android.intent.category.LAUNCHER 1
```

---

## 5. Ce que tu dois voir

### ✅ Succès

1. L'application s'ouvre en moins de deux secondes.
2. Le bandeau du haut affiche **« Hors ligne »** en orange.
3. L'écran **Caisse** affiche les catégories (Plats, Snacks, Boissons,
   Desserts) et les 17 produits, avec leurs prix en dinars à trois décimales
   (`14,500 TND`).
4. Toucher un produit l'ajoute au ticket, avec sous-total, ventilation de TVA
   par taux et total.
5. Onglet **Diagnostic** :
   - « Mode avion — critère de sortie de la Phase 0 » → **Réussi** ;
   - Stockage → mode **natif**, persistance **Oui** ;
   - Migrations locales appliquées → **toutes** celles de
     `packages/db-local/src/migrations/` (aujourd'hui `001_schema_initial` et
     `002_phase1_caisse`) ;
   - Synchronisation → Réseau **Hors ligne**, opérations en attente > 0 dès que
     tu as ajouté un article.

### ❌ Échec — et ce que ça veut dire

| Symptôme | Cause probable |
|---|---|
| Écran blanc, ou « Page non disponible » | Un `server.url` a été réintroduit dans `capacitor.config.ts`, ou `webDir` ne pointe pas sur `dist` |
| **« Démarrage impossible »** | SQLite n'a pas pu s'ouvrir ou migrer — voir le § 5.1, le message exact est affiché à l'écran |
| Menu vide, 0 produit | La graine ne s'est pas installée ; regarder l'étape « Graine du catalogue » dans Diagnostic |
| Stockage → mode **memoire** | La détection Capacitor a échoué ; l'application tourne comme une page web, les ventes ne survivraient pas au redémarrage |
| Démarrage lent (> 5 s) | Une ressource distante est attendue et part en timeout — le bundle n'est pas autonome |

### 5.1 « Démarrage impossible » — lire le message

L'écran affiche toujours le message SQLite d'origine. Il est le seul
diagnostic utile : sans lui, une panne de base sur la tablette d'un client à
Sfax serait indiagnosticable à distance.

| Message | Cause | Correction |
|---|---|---|
| `Queries can be performed using SQLiteDatabase query or rawQuery methods only.` | Une instruction **renvoyant une ligne** a été envoyée par `execute()` ou `run()` — typiquement `PRAGMA journal_mode = WAL`, qui répond `wal` | Tout PRAGMA doit partir par `query()`. C'est ce que fait `adaptateurCapacitor` (§ 5.2) |
| `Base locale en version N, application prévue pour la version M` | Un APK **plus ancien** a été installé par-dessus une base plus récente | Réinstaller la bonne version. Le refus est volontaire : écrire dans un schéma inconnu détruirait des données |
| `Échec de la migration locale N (…)` | Le SQL d'une migration est refusé par le moteur de la tablette | La transaction a été annulée, la base est intacte en version N−1. Reproduire le cas dans `packages/db-local` (§ 5.2) |
| `Database not opened` | Une connexion précédente n'a pas été relâchée après un rechargement à chaud | Forcer l'arrêt de l'application et rouvrir |

### 5.2 Pourquoi le moteur SQLite d'Android n'est pas SQLite tout court

Le plugin `@capacitor-community/sqlite` ne parle pas directement à SQLite : il
passe par **SQLCipher**, dont l'`execSQL()` **lève une exception dès qu'un
`sqlite3_step()` renvoie une ligne**. Deux conséquences qu'aucun test écrit
contre `node:sqlite` n'attrape :

1. **Aucun PRAGMA ne doit passer par `execute()` ni par `run()`.** Beaucoup en
   renvoient une (`journal_mode`, `user_version`, `foreign_keys` sans
   affectation). L'adaptateur les route donc tous par `query()`.
2. **Le SQL des migrations doit respecter le découpeur du plugin**, qui est
   rudimentaire — un `split(";\n")` suivi d'un recollage des déclencheurs :

   - chaque instruction se termine par `;` **suivi d'un saut de ligne** ;
   - le `END;` d'un déclencheur est **seul sur sa ligne**, sinon le
     déclencheur part en morceaux ;
   - un `--` dans une chaîne littérale serait pris pour un commentaire et
     tronquerait l'instruction.

Ces deux règles sont tenues par un test, et non par la vigilance :
`packages/db-local/src/adaptateurs/capacitor.test.ts` rejoue **toutes** les
migrations contre un double qui porte le découpeur du plugin et le refus de
SQLCipher. Un adaptateur ou une migration qui passe ce test démarre sur la
tablette ; c'est le seul moyen de le savoir sans émulateur dans la CI.

```bash
pnpm --filter @kaissi/db-local test    # inclus dans pnpm test:rapide
```

---

## 6. Vérifier la persistance (le second test)

Le mode avion ne suffit pas : les ventes doivent aussi **survivre au
redémarrage**.

1. mode avion toujours activé ;
2. ajouter trois produits au ticket ;
3. noter le compteur « N événement(s) dans le journal local » ;
4. `adb shell am force-stop tn.res2boost.kaissi` ;
5. rouvrir l'application ;
6. onglet Diagnostic → **Opérations en attente** doit être au moins égal au
   nombre d'événements écrits avant l'arrêt.

Si le compteur est retombé à 0, la base n'est pas persistante : l'application
tourne en mode mémoire, ce que le bloc « Stockage » du Diagnostic confirme.

---

## 7. Vérifier qu'aucune requête n'est émise

Le test définitif, avec le réseau **rallumé** — pour prouver que l'application
ne dépend pas du réseau même quand il est disponible :

```bash
# Journal réseau de l'application au démarrage
adb logcat -c
adb shell am force-stop tn.res2boost.kaissi
adb shell monkey -p tn.res2boost.kaissi -c android.intent.category.LAUNCHER 1
adb logcat | grep -iE "kaissi|Capacitor|chromium" | grep -iE "http|fetch|xhr"
```

Aucune requête HTTP ne doit apparaître au démarrage. En Phase 2, seules les
requêtes vers l'API de synchronisation apparaîtront — et jamais sur le chemin
de la caisse.

---

## 8. Test à trois appareils (à faire dès la Phase 2)

À préparer maintenant, à exécuter quand la synchronisation existera :

1. trois tablettes appairées au même établissement ;
2. les trois en mode avion ;
3. chacune ouvre une commande et ajoute des articles ;
4. rallumer le réseau sur les trois **en même temps** ;
5. vérifier : aucune vente perdue, aucune vente dupliquée, les totaux du
   back-office correspondent au millime près à la somme des trois tablettes.

C'est le banc de test qui décide du **jalon PowerSync** : si ce scénario n'est
pas fiable à la fin de la Phase 2, on bascule sans débat.

---

## 9. Tester l'impression réseau (Phase 1)

Le plugin natif `ImprimanteReseau.java` ouvre un socket TCP vers le port 9100.
Il est **écrit mais n'a pas encore tourné sur un appareil** : c'est le premier
point à vérifier sur le terrain.

### 9.1 Sans imprimante

L'application doit encaisser normalement. Les tickets s'accumulent dans la
file et le bandeau affiche un badge « 🖨 N ». Onglet **Diagnostic** → section
« File d'impression » → les échecs sont listés avec leur message d'erreur.

C'est le comportement voulu : **une imprimante éteinte ne bloque jamais une
vente.**

### 9.2 Avec une imprimante réseau

1. brancher l'imprimante en Ethernet sur le même réseau que la tablette ;
2. relever son adresse IP (bouton d'auto-test de l'imprimante, en général) ;
3. la saisir dans l'application : **Diagnostic** → bloc **Imprimantes**, puis
   **Tester** pour vérifier que le port répond avant même d'imprimer ;
4. passer une commande, appuyer sur **Cuisine**.

> La saisie est **locale à l'appareil**. Une fois la tablette appairée,
> `stations` est un référentiel tiré du serveur : le back-office redevient
> autoritaire, sinon deux tablettes du même restaurant imprimeraient à deux
> endroits différents. L'écran de gestion des stations côté back-office
> **reste à écrire** — d'ici là, un restaurant appairé se règle depuis la
> tablette avant appairage, ou en SQL.

Le bon doit sortir en moins de deux secondes. Si rien ne sort :

```bash
# Depuis un poste du même réseau, vérifier que le port répond
nc -vz 192.168.1.50 9100

# Journal du plugin natif
adb logcat | grep -i "ImprimanteReseau\|Capacitor/Plugin"
```

| Symptôme | Cause probable |
|---|---|
| « Connexion refusée » | Mauvaise IP, imprimante éteinte, ou port ≠ 9100 |
| « ne répond pas » | L'imprimante est sur un autre sous-réseau, ou le Wi-Fi de la tablette est isolé (isolation client activée sur la borne) |
| Le bon sort en caractères illisibles | Jeu de caractères de l'imprimante ≠ CP858 — voir `packages/printing/src/index.ts` |
| Rien, aucune erreur | Le plugin n'est pas enregistré : vérifier `registerPlugin(ImprimanteReseau.class)` dans `MainActivity.java` |

### 9.3 Tiroir-caisse

Le tiroir est piloté **par l'imprimante**, jamais par un câble séparé. Il doit
s'ouvrir automatiquement à la clôture d'une commande payée en espèces, et
rester fermé sur un paiement par carte.

---

## 10. Refaire le test en mode PRODUCTION

Tout ce qui précède se fait sur un APK **debug**. Ce n'est pas ce que le
client installera. Les différences réelles, aujourd'hui :

| | debug | release |
|---|---|---|
| Signature | clé de débogage jetable | **ton** magasin de clés |
| `android:debuggable` | vrai | faux |
| **HTTP en clair** | autorisé vers `10.0.2.2` et `localhost` seulement | **refusé, sans exception** |
| Rétrécissement R8 | non | **non** — `minifyEnabled false` dans `app/build.gradle` |

Deux points méritent d'être compris plutôt que subis.

**Le HTTP en clair.** Depuis Android 9, il est refusé par défaut. Une URL de
synchronisation en `http://` échoue donc avec `ERR_CLEARTEXT_NOT_PERMITTED`,
et rien à l'écran ne dit pourquoi. Le build `debug` porte une exception
nominative — `app/src/debug/res/xml/network_security_config.xml` — limitée à
la machine hôte de l'émulateur et à `localhost`, pour que `pnpm sync:dev`
soit joignable pendant le développement. **Le build `release` ne l'a pas, et
ne doit pas l'avoir** : un jeton d'appareil qui traverserait le Wi-Fi du
restaurant en clair serait lisible par n'importe qui. En production, l'API de
synchronisation est en **HTTPS**.

**R8** est délibérément désactivé : un plugin Capacitor est chargé par
réflexion, et le rétrécissement supprimerait une classe qu'aucun appel direct
ne référence. Si un jour quelqu'un passe `minifyEnabled true`, ce test devient
la seule chose qui l'attrapera — et il faudra garder les plugins dans
`proguard-rules.pro`.

Le test du mode avion se rejoue donc sur le `release`, une fois, avant toute
distribution.

```bash
# À la racine du dépôt, dans ton terminal.
pnpm pos:build                                   # build + vérification mode avion
pnpm --filter @kaissi/pos exec cap sync android
```

Puis, dans `apps/pos/android` (PowerShell : remplace `./gradlew` par
`.\gradlew.bat`) :

```bash
./gradlew assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
```

> La création du magasin de clés (`keystore`) et la signature sont décrites
> dans [`deploiement.md` § 4.3](deploiement.md). **Le fichier `.keystore` ne
> doit jamais entrer dans le dépôt** : le perdre, c'est ne plus jamais pouvoir
> mettre à jour l'application déjà installée chez le client.

Rejoue alors les § 4 à 6 **à l'identique**. Ce qu'on cherche spécifiquement :

| À vérifier sur le release | Panne que ça attrape |
|---|---|
| L'application démarre en mode avion | Une ressource distante restée dans le bundle |
| Diagnostic → Stockage = **natif** | Le plugin SQLite absent du build signé |
| Un ticket sort sur l'imprimante (§ 9) | Le plugin `ImprimanteReseau` non enregistré |
| La synchronisation atteint le serveur | Une URL en `http://` refusée par le manifeste — l'API doit être en **HTTPS** en production |
| Les totaux sont identiques au millime | Rien — mais c'est le contrôle qui coûte le moins cher |

Si le debug marche et le release non, lire d'abord :

```bash
adb logcat | grep -iE "ClassNotFound|NoSuchMethod|CLEARTEXT|Capacitor"
```

`CLEARTEXT communication ... not permitted` est le cas le plus fréquent : ce
n'est pas une panne du POS, c'est une URL de synchronisation en clair.

Le reste de la mise en production — API de synchronisation, back-office,
appairage des tablettes, sauvegardes — est dans
[`deploiement.md`](deploiement.md).

---

## 11. Ce qui est vérifié sans SDK Android — et ce qui ne peut pas l'être

Le code natif d'impression est le seul morceau du projet qu'aucun test
TypeScript n'atteint. Il ne se compile normalement qu'au moment du
`./gradlew assembleDebug`, donc tard et sur un poste équipé.

Une vérification intermédiaire comble une partie de cet angle mort :

```bash
pnpm --filter @kaissi/pos verifier:natif
```

Elle ne demande **qu'un JDK 21** — ni SDK Android, ni Gradle, ni appareil — et
tourne à chaque PR (job `plugin-natif`). Elle compile `ImprimanteReseau.java`
et `MainActivity.java` contre les doublures de `apps/pos/scripts/stubs-android/`,
elles-mêmes relues face aux sources réelles de Capacitor dans `node_modules`
(voir le `LISEZMOI.md` de ce dossier : sans ce recoupement, une doublure
périmée ferait passer la vérification sur une API disparue).

### Ce que cette vérification prouve

| Contrôle | Panne qu'il attrape |
|---|---|
| Le Java compile, sans avertissement | Faute de frappe, signature erronée, type incompatible |
| `@CapacitorPlugin(name = "ImprimanteReseau")` présente **dans le bytecode** | Le pont ne trouve pas le plugin — l'impression échoue silencieusement |
| `@PluginMethod` retenue sur `imprimer()` et `tester()` | Le plugin se charge mais aucune méthode n'est appelable |
| Le nom est identique côté TypeScript et côté Java | Le `registerPlugin('…')` du web ne correspond à rien de natif |
| `bridgeBuilder` est initialisé à la déclaration du champ dans `BridgeActivity` | `registerPlugin()` **avant** `super.onCreate()` deviendrait invalide, et le plugin ne serait jamais chargé |
| La permission `INTERNET` est déclarée au manifeste | Le socket TCP échoue avec « Permission denied » |

Les six contrôles ont été validés à l'envers : chaque défaut a été introduit
volontairement, et chacun fait échouer la commande.

### Ce qu'elle ne prouve pas

Elle ne remplace **ni** un build Gradle complet (fusion du manifeste,
ressources, désucrage des lambdas pour `minSdk 23`, R8), **ni** un essai sur
une imprimante réelle. La chaîne ESC/POS → socket → papier n'a de valeur
qu'observée sur un vrai ticket : c'est le § 9 de ce document, et il reste à
faire sur ta machine avec Android Studio et une imprimante thermique.

> Autrement dit : la vérification automatique élimine les fautes bêtes, qui
> sont les plus fréquentes. Elle ne dit rien du papier qui sort.
