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

```bash
# Renseigner le SDK (à mettre dans ~/.zshrc ou ~/.bashrc)
export ANDROID_HOME="$HOME/Library/Android/sdk"        # macOS
# export ANDROID_HOME="$HOME/Android/Sdk"              # Linux
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/tools"
```

---

## 2. Prérequis sur l'appareil

Une **tablette Android** (ou un terminal Sunmi) :

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
   - Migrations locales → version 1, `schema_initial` ;
   - Synchronisation → Réseau **Hors ligne**, opérations en attente > 0 dès que
     tu as ajouté un article.

### ❌ Échec — et ce que ça veut dire

| Symptôme | Cause probable |
|---|---|
| Écran blanc, ou « Page non disponible » | Un `server.url` a été réintroduit dans `capacitor.config.ts`, ou `webDir` ne pointe pas sur `dist` |
| « Démarrage impossible » | SQLite n'a pas pu s'ouvrir ou migrer — le message exact est affiché à l'écran |
| Menu vide, 0 produit | La graine ne s'est pas installée ; regarder l'étape « Graine du catalogue » dans Diagnostic |
| Stockage → mode **memoire** | La détection Capacitor a échoué ; l'application tourne comme une page web, les ventes ne survivraient pas au redémarrage |
| Démarrage lent (> 5 s) | Une ressource distante est attendue et part en timeout — le bundle n'est pas autonome |

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
