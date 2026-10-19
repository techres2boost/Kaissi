# Tester Kaissi sur Android depuis ton PC — comme avec une vraie tablette

Tu as Android Studio : c'est tout ce qu'il faut. L'émulateur Android est une
**vraie tablette Android dans une fenêtre** — même système, même WebView, même
SQLite, même mode avion qu'une Samsung posée sur un comptoir. Ce guide te mène
du PC éteint à une journée de service complète, en 30 minutes la première
fois, 2 minutes les suivantes.

> Le guide long, avec l'imprimante virtuelle et le détail du mode avion, reste
> [`tester-sans-tablette.md`](tester-sans-tablette.md). Celui-ci va à
> l'essentiel.

---

## 1. Une fois : préparer le PC · 5 min

Dans un terminal (PowerShell), à la racine du dépôt :

```powershell
pnpm install
pnpm verifier:jdk --ecrire
```

La seconde commande trouve le JDK 21 qu'Android Studio embarque et le désigne
à Gradle. Si elle répond ✓, c'est fini. Si elle parle d'un JDK 25 : c'est
exactement le piège qu'elle évite (« Unsupported class file major version
69 ») — laisse-la écrire.

---

## 2. Une fois : créer la tablette · 5 min

Android Studio → **More Actions** → **Virtual Device Manager** → **Create
Virtual Device**.

| Réglage | Valeur | Pourquoi |
|---|---|---|
| Catégorie | **Tablet** → *Pixel Tablet* | Le format d'une caisse. |
| Image système | **API 35**, colonne *Services* = **Android Open Source** | L'image « Google Play » fait tourner le Play Store en permanence et sature l'émulateur (« System UI isn't responding »). Kaissi n'utilise aucun service Google. |
| Orientation | **Landscape** | Une caisse est posée à plat, en paysage. |
| RAM / CPU | 4 Go / 4 cœurs, *Graphics : Hardware* | Sinon l'animation des tuiles saccade. |

Lance-la avec ▶. Une tablette démarre dans une fenêtre.

> **Pour tester le téléphone aussi**, crée un second appareil *Pixel 8*
> (catégorie *Phone*). C'est la même application : elle replie le ticket en
> barre basse sous 900 px — exactement ce que tu as vu sur ton iPhone.

---

## 3. Installer Kaissi sur la tablette · 5 min (puis 1 min)

```powershell
pnpm pos:android
```

Une seule commande : elle construit la caisse, vérifie qu'aucun code ne vient
du réseau (la garde du mode avion), copie le tout dans le projet Android,
compile et installe sur l'émulateur allumé. Le premier passage Gradle prend
5 à 10 minutes ; les suivants, moins d'une minute.

Si elle échoue (`ERR_SDK_NOT_FOUND`, `Unable to launch Android Studio`), le
chemin qui marche toujours :

```powershell
pnpm --filter @kaissi/pos cap:sync
```

puis Android Studio → **File → Open** → `apps/pos/android` → choisis
l'émulateur en haut → **▶ vert**.

> **Le build du Play Store, à l'identique ?** `pnpm pos:apk` produit l'APK
> signé ; **glisse-le sur la fenêtre de l'émulateur** et il s'installe.

---

## 4. La mettre en service — exactement comme chez un client · 2 min

1. Au premier lancement : **« Mettre cette caisse en service »**.
2. Ton **e-mail et ton mot de passe** du back-office. Rien d'autre à saisir :
   l'adresse du serveur est déjà dans l'application.
3. Choisis l'établissement (*Snack Lac 1*), puis un employé et son **PIN**.
4. Ouvre la caisse (fond de caisse).

Pour **recommencer de zéro** — une tablette neuve sortie du carton :
*Paramètres* de l'émulateur → *Applications* → *Kaissi* → *Stockage* →
**Effacer le stockage**. Ou, plus radical : Device Manager → ⋮ → **Wipe
Data**.

---

## 5. Une journée de service, sur ton seul PC · 15 min

Garde **deux fenêtres côte à côte** : l'émulateur (la caisse) et Chrome sur
ton PC, ouvert sur le back-office → **Préparation** (l'écran de la cuisine).
Sur l'écran Préparation, touche une fois **« Activer l'alerte sonore »**.

| Geste | Où | Ce que tu dois voir |
|---|---|---|
| Table 1, deux plats, **Cuisine** | Caisse | La commande apparaît en cuisine dans les 15 s, **avec un bip** |
| **Prêt** | Cuisine | Sur la caisse : bandeau **« Table 1 — prête en cuisine »**, bip, et le badge *Prêt* |
| Ajoute un plat à la table 1, **Cuisine** | Caisse | En cuisine, la table revient **« Ajout »** : le nouveau plat en gras, les anciens barrés |
| **Encaisser** | Caisse | La vente apparaît au back-office (*Reçus*, *Tableau de bord*) |
| Touche **Back-office** dans le menu ☰, deux fois | Caisse | La 2ᵉ fois, **aucun mot de passe** redemandé |

---

## 6. Le test qui compte : couper Internet · 5 min

C'est la raison d'être du produit : la caisse ne s'arrête jamais.

1. Sur l'émulateur, fais glisser le haut de l'écran vers le bas → **Mode
   avion**. (Ou : barre latérale de l'émulateur → **⋯** → *Cellular* → *Data
   status : Denied*, et coupe le Wi-Fi.)
2. Prends trois commandes, encaisse-les. Le bandeau affiche **↑↓ 3** : elles
   attendent.
3. **Tue l'application** (bouton carré → glisser Kaissi vers le haut), puis
   rouvre-la, **toujours en mode avion**. Elle doit démarrer, et tes ventes
   doivent être là.
4. Remets le réseau. En moins d'une minute : **↑↓** retombe à **0**, et les
   trois ventes apparaissent au back-office.

Si une vente ne remonte pas : menu ☰ → **Synchronisation**. Le message du
serveur y est écrit en clair (par exemple « une migration manque (0046) »).

---

## 7. Voir ce qui se passe à l'intérieur

- **La console de la caisse** : sur ton PC, Chrome → `chrome://inspect` →
  sous l'émulateur, **inspect** à côté de *Kaissi*. Console, réseau, stockage :
  les mêmes outils qu'un site web. (Fonctionne avec le build installé par
  Android Studio ou `pos:android`, pas avec l'APK signé du Play Store.)
- **Les journaux Android** : Android Studio → **Logcat**, filtre `Capacitor`.

---

## 8. Ce que l'émulateur ne remplace pas

- Le **papier** (impression éteinte en MVP de toute façon — voir
  `tester-sans-tablette.md` pour l'imprimante virtuelle).
- Les **performances d'une tablette d'entrée de gamme** : ton PC est plus
  rapide. Avant une installation chez un client, un essai sur le vrai modèle
  reste utile.
- Les **notifications du téléphone de cuisine écran éteint** : elles passent
  par le navigateur du téléphone (Chrome Android, ou l'icône ajoutée à
  l'écran d'accueil sur iPhone), pas par la caisse.

## Pannes fréquentes

| Symptôme | Remède |
|---|---|
| `Unsupported class file major version 69` | `pnpm verifier:jdk --ecrire` |
| L'émulateur reste noir ou « System UI isn't responding » | Image **Android Open Source**, pas *Google Play* ; *Graphics : Hardware* |
| `ERR_SDK_NOT_FOUND` | Chemin Android Studio du §3 |
| « Connection refused » à la mise en service | L'émulateur n'a pas Internet : redémarre-le (*Cold Boot Now*) |
| L'application montre une ancienne version | `pnpm --filter @kaissi/pos cap:sync` puis ▶ — le bundle n'avait pas été recopié |
