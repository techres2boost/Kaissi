# Tester Android et l'impression sans tablette ni imprimante

Tu as un PC Windows et un iPhone. Ça suffit pour tout tester sauf le dernier
maillon — le papier qui sort. Voici comment, et ce que chaque étape prouve
réellement.

> **L'iPhone ne servira pas.** Le POS est empaqueté pour Android uniquement.
> Capacitor sait produire une application iOS, mais cela exige un Mac (Xcode
> ne tourne pas sous Windows) et un compte développeur Apple. Ce n'est pas
> prévu avant longtemps : le marché visé est Android.

---

## Ce que chaque niveau prouve

| Niveau | Matériel | Prouve | Ne prouve pas |
|---|---|---|---|
| Navigateur | rien | L'interface et les calculs | Ni le mode avion, ni SQLite réel, ni l'impression |
| **Émulateur + imprimante virtuelle** | rien | L'APK démarre, SQLite persiste, **le mode avion**, la chaîne ESC/POS jusqu'au socket | Que du papier sorte |
| Tablette réelle | ~150 DT | Tout ce qui précède, sur du vrai matériel | Que ton modèle d'imprimante accepte ces octets |
| + imprimante thermique | ~200 DT | **Tout** | — |

L'émulateur couvre donc l'essentiel, y compris **le critère de sortie du
projet** : l'application démarre-t-elle en mode avion ?

---

## 1. Installer Android Studio · 30 min (Windows)

> **Oui, ton PC Windows suffit.** L'émulateur Android est une vraie tablette
> Android qui tourne dans une fenêtre sur ton PC. Aucun appareil physique n'est
> nécessaire pour tout tester (sauf le papier de l'imprimante).

**Android Studio « Quail 3 » (2026.1.3) convient parfaitement** — c'est plus
récent que Ladybug, donc au-dessus du minimum requis.

1. Télécharge et installe depuis
   [developer.android.com/studio](https://developer.android.com/studio)
   (~1 Go, ~8 Go installés). Garde les cases par défaut : **Android SDK**,
   **SDK Platform-Tools**, **Android Virtual Device**.
2. Au **premier lancement**, l'assistant « Setup Wizard » télécharge le SDK.
   Laisse-le finir — c'est lui qui installe ce qui manquait (`ERR_SDK_NOT_FOUND`).

### Le JDK — tu as Java 17, il en faut 21

Pas besoin d'installer quoi que ce soit : **Android Studio embarque son propre
JDK 21** (le « JBR »). Il faut juste dire à tes outils de l'utiliser.

Dans PowerShell, une fois Android Studio installé :

```powershell
setx ANDROID_HOME "$env:LOCALAPPDATA\Android\Sdk"
setx JAVA_HOME "C:\Program Files\Android\Android Studio\jbr"
```

**Ferme et rouvre TOUS tes terminaux** (`setx` ne s'applique qu'aux nouveaux),
puis vérifie :

```powershell
adb version                 # doit répondre une version
java -version               # doit dire 21 (via JAVA_HOME)
```

> Ton `java -version` global peut rester à 17 pour PyCharm : ce qui compte,
> c'est que `JAVA_HOME` pointe le JBR 21 pour les builds Android.

---

## 2. Créer un appareil virtuel (la « tablette ») · 10 min

Android Studio → **More Actions** (ou l'icône ⋮) → **Virtual Device Manager**
→ **Create Device**.

- **Modèle** : un format tablette — *Pixel Tablet* ou *Nexus 10*. Le POS est
  dessiné pour un écran large ; sur un téléphone, la grille des produits est
  serrée.
- **Image système** : API 34 ou 35. Prends la variante *sans* Google Play,
  elle démarre plus vite et aucun service Google n'est nécessaire.
- Termine, puis **lance l'appareil avec ▶**. Une tablette Android apparaît
  dans une fenêtre : c'est là que tournera Kaissi.

---

## 3. Lancer l'imprimante virtuelle · 1 min

Dans un terminal, à la racine du dépôt :

```bash
node apps/pos/scripts/imprimante-virtuelle.mjs
```

Elle écoute le port **9100** en TCP — exactement comme une Epson TM-T20 ou
une Xprinter du marché tunisien — et affiche dans le terminal ce qui sortirait
sur le papier :

```
══════════════════════════════════════════════
TICKET #1 — 515 octets — 10.0.2.15:52660 — 1 ms
══════════════════════════════════════════════
               Snack Lac 1
        Rue du Lac Turkana, Tunis
------------------------------------------
Ticket P1-000431        27/08/2026 12:40
Table 12 - 2 couverts - Salma
------------------------------------------
1 x Pizza Margherita             16,000
    Fromage 1,500
2 x Coca-Cola 33cl                8,400
------------------------------------------
                       Sous-total   24,400
                       TVA 19 %      2,555
                       TVA 7 %       0,550
                             TOTAL  24,400
──────────────────────────────────────────────
✂  coupe du papier
💰 ouverture du tiroir-caisse
🔤 jeu de caractères : page 19 (CP858)
```

Les trois dernières lignes comptent autant que le ticket : elles disent que
la **coupe**, l'**impulsion vers le tiroir-caisse** et le **jeu de caractères**
sont bien dans la charge. Ce sont précisément les octets qu'on ne voit pas sur
un aperçu texte, et ceux qui manquent le plus souvent.

Ajoute `--brut` pour voir les octets en hexadécimal.

---

## 4. Installer le POS sur l'émulateur · 5 min

Il y a deux chemins. **Le premier est le plus fiable** pour débuter — c'est
Android Studio qui gère le SDK, le JDK et l'émulateur, sans configuration.

### Chemin A — par Android Studio (recommandé)

```bash
# 1) Construire le bundle web et le copier dans le projet Android
pnpm pos:build
pnpm --filter @kaissi/pos exec cap sync android
```

Puis **ouvre le dossier `apps/pos/android` dans Android Studio**
(File → Open → ce dossier), attends la fin de l'indexation Gradle, sélectionne
ton émulateur en haut, et appuie sur le **▶ vert**. Kaissi s'installe et se
lance sur la tablette virtuelle.

> C'est ce qui remplace `pnpm pos:android` quand la ligne de commande ne
> trouve pas le SDK (`ERR_SDK_NOT_FOUND`) ou Android Studio
> (`Unable to launch Android Studio`) : ces erreurs viennent de variables
> d'environnement non posées, qu'Android Studio, lui, connaît déjà.

### Chemin B — tout en ligne de commande

Fonctionne **une fois `ANDROID_HOME` et `JAVA_HOME` posés** (§1) et l'émulateur
allumé :

```bash
pnpm pos:android
```

Cette commande construit le bundle, vérifie le mode avion, copie le tout dans
l'APK, compile et installe. Le premier build Gradle prend cinq à dix minutes ;
les suivants, moins d'une minute.

> Si tu vois `ERR_SDK_NOT_FOUND`, c'est que `ANDROID_HOME` n'est pas vu par ce
> terminal : ferme-le, rouvre-en un neuf (les `setx` du §1 ne s'appliquent
> qu'aux nouveaux terminaux), ou prends le chemin A.

### Configurer l'imprimante

Dans l'application, onglet **Diagnostic** en haut à droite, puis fais défiler
jusqu'au bloc **Imprimantes**. Deux stations y sont listées — *Cuisine* et
*Bar* — avec l'adresse de démonstration `192.168.1.50`, qui ne répond à rien
sur ton émulateur.

Remplace l'adresse des deux par :

```
10.0.2.2     port 9100
```

> `10.0.2.2` n'est pas une adresse au hasard : c'est ainsi que l'émulateur
> Android désigne **la machine hôte**, donc ton PC. `127.0.0.1` depuis
> l'émulateur désignerait l'émulateur lui-même, et la connexion échouerait
> sans que l'erreur ne dise pourquoi.

La saisie est enregistrée à la frappe — il n'y a pas de bouton « Enregistrer ».
Appuie sur **Tester** au bout de la ligne : la colonne « Dernier essai » doit
afficher *Joignable en N ms*, et le terminal de l'imprimante virtuelle doit
signaler une connexion.

> Cette saisie vaut pour **cet appareil**. Une fois la tablette appairée,
> `stations` devient un référentiel tiré du serveur et c'est le back-office
> qui fait autorité — sinon deux tablettes du même restaurant imprimeraient à
> deux endroits différents.

---

## 5. Le test qui compte : le mode avion

C'est le critère de sortie du projet. **Tout se passe dans la fenêtre de
l'émulateur**, pas sur ton PC : c'est le réseau de la *tablette* qu'on coupe,
et le mode avion de Windows ne la concerne pas.

### 5.1 Laisser une trace à retrouver

Dans l'émulateur : passe une commande, envoie-la en cuisine, encaisse. Le
ticket doit apparaître dans le terminal de l'imprimante virtuelle.

Note le nombre affiché dans **Diagnostic → Synchronisation → opérations en
attente**. C'est lui qui prouvera, tout à l'heure, que rien n'a été perdu.

### 5.2 Couper le réseau de la tablette

Deux façons, au choix.

**À la souris, dans l'émulateur.** Clique dans la fenêtre de l'émulateur, puis
tire la barre du haut vers le bas — deux fois, pour déplier tous les
raccourcis. Touche **✈ Airplane mode** (ou *Mode avion*) : la vignette
s'allume, l'icône Wi-Fi disparaît de la barre d'état et un petit avion la
remplace.

> Le pavé de boutons **à droite de la fenêtre** de l'émulateur (volume,
> rotation, ⋮) est une télécommande matérielle : le mode avion ne s'y trouve
> pas. Il est dans Android lui-même, comme sur une vraie tablette.

**En ligne de commande**, depuis un terminal de ton PC :

```bash
adb shell cmd connectivity airplane-mode enable
adb shell settings get global airplane_mode_on     # doit répondre 1
```

Dans les deux cas, vérifie **dans l'application** : le bandeau du haut doit
passer de « ● En ligne » à **« Hors ligne »**.

### 5.3 Tuer complètement l'application

**Ne te contente pas du bouton Accueil ni de Retour** : une application en
arrière-plan garde sa base ouverte en mémoire et masquerait exactement le bug
qu'on cherche.

Dans l'émulateur : le bouton **▭** (carré, en bas ou en balayant depuis le
bas), puis **balaye la vignette Kaissi vers le haut** pour la fermer.

Ou, en ligne de commande — plus sûr, parce que sans ambiguïté :

```bash
adb shell am force-stop tn.res2boost.kaissi
```

### 5.4 Rouvrir, toujours en mode avion

Touche l'icône Kaissi dans l'émulateur, ou :

```bash
adb shell monkey -p tn.res2boost.kaissi -c android.intent.category.LAUNCHER 1
```

**Elle doit démarrer en moins de deux secondes et afficher le plan de salle.**
Si c'est le cas, la promesse du produit tient : le code de l'application est
dans l'APK, pas sur le réseau.

### 5.5 Ce qu'il faut regarder ensuite

| Où | Ce qui doit s'afficher |
|---|---|
| Bandeau du haut | **Hors ligne** |
| Diagnostic → verdict | « Réussi. 17 produits lus depuis SQLite local, réseau **INDISPONIBLE** » |
| Diagnostic → Stockage | Mode **natif**, persistance **Oui** |
| Diagnostic → Synchronisation | opérations en attente **≥** le nombre noté au § 5.1 |

Ce dernier point est le second test, et il compte autant que le premier : si
le compteur est retombé à zéro, la base n'est pas persistante et les ventes du
service seraient perdues au redémarrage.

Enfin, remets le réseau (`adb shell cmd connectivity airplane-mode disable`) :
le bandeau doit repasser « En ligne » tout seul.

La table des symptômes d'échec, et ce que chacun signifie, est dans
[`tester-mode-avion.md`](tester-mode-avion.md).

---

## 6. Vérifier que le back-office atteint la tablette

C'est la chaîne complète, et elle ne peut se voir que sur un appareil
**appairé** — jamais dans `pnpm pos:dev`, dont la base est en mémoire et le
catalogue figé sur la graine locale. L'écran affiche d'ailleurs
**« démo — mémoire »** dans ce cas.

1. Lance l'API de synchronisation sur ton PC — un terminal **dédié**, qu'on
   laisse ouvert (elle doit afficher « API de synchronisation Kaissi — port
   8787 » et **rester** là) :
   ```bash
   pnpm sync:dev
   ```
   Pour la mettre en ligne plutôt que sur ton PC, voir
   [`deploiement.md`](deploiement.md).
2. Appaire l'émulateur, dans un **autre** terminal :
   ```bash
   node apps/sync/scripts/appairer.mjs --restaurant <uuid> --prefixe E1
   ```
   Le jeton n'est affiché **qu'une fois**.
3. Dans l'application : bandeau → **⇅ local** → saisis l'URL et le jeton.

   ```
   http://10.0.2.2:8787
   ```

   > Encore `10.0.2.2` : depuis l'émulateur, c'est ainsi qu'on désigne ton PC.
   > `localhost` désignerait l'émulateur lui-même.
   >
   > Le HTTP **en clair** est refusé par Android depuis la version 9. L'APK de
   > débogage porte une exception limitée à cette seule adresse
   > (`app/src/debug/res/xml/network_security_config.xml`). L'APK de
   > production ne l'a pas : en production, l'API est en **HTTPS**. Si tu vois
   > `ERR_CLEARTEXT_NOT_PERMITTED`, c'est que tu testes un build `release`
   > contre une URL en clair.
4. Change un prix dans le back-office.
5. Reviens sur l'émulateur, ouvre **⇅** et force une synchronisation.

Le nouveau prix apparaît. S'il n'apparaît pas, l'écran de synchronisation
montre les curseurs et les opérations rejetées — un rejet ne se réessaie
jamais tout seul, c'est une règle métier qui remonte au gérant.

---

## Ce qui reste impossible sans matériel

| Manque | Pourquoi ça compte |
|---|---|
| **Une vraie imprimante thermique** | Les modèles diffèrent sur le jeu de caractères, la commande de coupe et le brochage du tiroir. L'imprimante virtuelle valide **notre** charge, pas la tolérance du matériel |
| Une vraie tablette | L'émulateur n'a ni la lenteur d'un appareil d'entrée de gamme, ni son Wi-Fi capricieux, ni ses doigts gras |
| Le tiroir-caisse | Il est piloté **par l'imprimante**, jamais par un câble séparé. Sans imprimante, aucun tiroir |

Une Xprinter XP-58 ou XP-80 réseau se trouve autour de 200 dinars à Tunis.
C'est le seul achat qui manque pour lever la dernière inconnue du projet.
