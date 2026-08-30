# Mettre Kaissi en production

Objectif : que tu puisses **utiliser l'application comme un vrai client**,
sur une vraie tablette, avec un vrai serveur — et l'améliorer au fil de l'eau.

Trois briques à déployer, indépendantes l'une de l'autre :

| Brique | Où | Pourquoi là |
|---|---|---|
| **Base** | Supabase | Déjà en place (`mzrbpbqpkpbbndtijipw`) |
| **API de sync** | Railway, Fly.io ou Render | Process Node **persistant** — *pas Vercel*, voir §2 |
| **Back-office** | Vercel | C'est son terrain |
| **POS** | APK Android | Empaqueté, jamais servi depuis le web |

> **Ordre conseillé.** Commence par le §4 (APK seul, sans serveur) : tu as une
> caisse utilisable en une heure. Ajoute la sync (§2) quand tu veux plusieurs
> terminaux ou le back-office.

---

## Comment les deux applications se parlent

Elles ne se parlent **pas directement**. Elles se retrouvent dans la **base
Supabase**. C'est le point clé, et la source de la confusion la plus fréquente.

```
   BACK-OFFICE (Vercel)                          POS (APK Android)
   Next.js, navigateur                           empaqueté, hors ligne
        │                                              │
        │ clé PUBLIQUE + session, via RLS              │ jeton d'appareil
        │ (lit et écrit le référentiel)                │
        ▼                                              ▼
   ┌─────────────────────┐                    ┌──────────────────────┐
   │  Supabase Postgres  │◄───── SQL ────────►│  API de sync (Railway│
   │  (schéma kaissi)    │   même base        │  process Node)       │
   └─────────────────────┘                    └──────────────────────┘
                                                       ▲
                                                       │ push / pull HTTP
                                                       │ (jeton d'appareil)
                                                  la tablette
```

Concrètement :

- **Le gérant change un prix** au back-office → écrit dans `kaissi.products` →
  un déclencheur alimente `change_log` → au prochain **pull**, l'API de sync
  le transmet à la tablette. Le prix change en salle sans toucher à l'APK.
- **Le caissier encaisse** sur la tablette → l'APK **push** les
  `order_events` vers l'API de sync → l'API les projette en `orders` →
  le back-office les lit dans l'écran **Journée**.

Donc pour que « tout soit connecté », il ne manque qu'une chose : **l'API de
sync doit être déployée et joignable**, et la tablette **appairée** (§5). La
base et le back-office se parlent déjà directement.

> **La confusion classique.** `pnpm pos:dev` dans un navigateur n'est relié à
> RIEN : sa base est en mémoire, son catalogue vient de la graine locale. Une
> vente n'y remonte jamais au serveur, et un prix modifié au back-office n'y
> descend jamais. L'écran affiche « démo — mémoire » dans ce cas. Seule **l'APK
> installée et appairée** participe à la synchronisation.

---

## 0. Ce dont tu as besoin

| Outil | Version | Vérifier |
|---|---|---|
| Node | ≥ 22 | `node -v` |
| pnpm | ≥ 10 | `pnpm -v` |
| JDK | 21 | `java -version` |
| Android Studio | Ladybug+ | — |
| Compte Railway (ou Fly.io) | gratuit pour démarrer | — |
| Compte Vercel | gratuit | — |

---

## 1. Base de données — Supabase

Le schéma est **déjà appliqué**. Pour vérifier :

```sql
-- Dans le SQL Editor de Supabase
select count(*) from kaissi.products;        -- 17 (jeu de démonstration)
select * from kaissi.etat_appareils;         -- vide tant qu'aucun appairage
```

### Récupérer la chaîne de connexion

Supabase → **Project Settings → Database → Connection string → URI**.

Prends la version **Session pooler** (port `5432`), pas la connexion directe :
l'API de sync ouvre plusieurs connexions et le pooler évite de saturer la base.

```
postgresql://postgres.mzrbpbqpkpbbndtijipw:MOT_DE_PASSE@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
```

> ⚠ Ce mot de passe donne un accès **complet** à la base. Il ne va que dans
> les variables d'environnement du serveur de sync. Jamais dans le dépôt,
> jamais dans l'APK.

#### Deux mots de passe Supabase, à ne pas confondre

C'est le piège le plus coûteux de cette étape, parce que les deux écrans se
ressemblent et que l'erreur renvoyée est la même :

| | Où | À quoi il sert |
|---|---|---|
| **Compte** | avatar en haut à droite → *Account settings* → *Change password* | Se connecter à supabase.com. Demande le mot de passe **actuel**. |
| **Base de données** | *Project Settings* → **Database** → *Database password* → **Reset database password** | Ce que `DATABASE_PASSWORD` attend. Ne demande **aucun** mot de passe actuel — il est régénéré. |

Le second n'est visible **nulle part** après sa création : Supabase ne le
stocke pas en clair. S'il est perdu, il ne se retrouve pas, il se
réinitialise.

Le signe qui distingue les deux à coup sûr : **si l'écran te réclame le mot
de passe actuel, tu es sur celui du compte** — ce n'est pas le bon.

Bonne nouvelle quand `password authentication failed` apparaît : le serveur
a **reconnu ton projet**. Un identifiant de projet erroné donnerait
`Tenant or user not found`. L'URL, l'utilisateur et le certificat sont donc
tous corrects — il ne reste que le mot de passe.

### Retirer le jeu de démonstration

Quand tu passes à un vrai restaurant :

```sql
-- Renomme l'établissement de démonstration plutôt que de le supprimer :
-- les identifiants sont embarqués dans la graine de l'APK.
update kaissi.restaurants
set name = 'Mon Restaurant', address = '…', phone = '…'
where id = '01930000-0000-7000-8000-000000000002';

-- CHANGE LES PIN de démonstration (1357 / 2468 / 9753).
-- Le hachage se génère côté serveur, jamais à la main.
```

---

## 2. API de synchronisation

### Pourquoi pas Vercel

Vercel exécute des fonctions **serverless** : elles démarrent à froid et ne
gardent pas leurs connexions Postgres. Pour l'API de sync, cela veut dire
plusieurs centaines de millisecondes ajoutées à chaque push, et un pool de
connexions qui explose dès que plusieurs terminaux synchronisent. Le dossier
d'architecture tranche : **process Node persistant**.

Railway est le plus simple pour démarrer. Fly.io coûte moins cher à l'échelle.

### 2.0 D'abord : essaie toute la chaîne SUR TON PC

Avant de payer ou configurer quoi que ce soit, tu peux faire tourner l'API de
sync **sur ton PC Windows** et la faire atteindre par l'émulateur Android.
Cela prouve que tout marche, contre ta vraie base Supabase, sans rien déployer.

```bash
# 1) Crée apps/sync/.env à partir du modèle, et mets-y ta chaîne Supabase :
cp apps/sync/.env.example apps/sync/.env
#    puis édite DATABASE_URL dedans (session pooler, port 5432, §1).
#    Ce fichier n'est JAMAIS commité (il est dans .gitignore).

# 2) Lance l'API de sync. Elle lit .env toute seule — pas de variable à
#    reposer dans chaque terminal.
pnpm sync:dev
#    → « API de synchronisation Kaissi — port 8787 » (et ça RESTE affiché)

# 3) Vérifie dans un AUTRE terminal
curl http://127.0.0.1:8787/sante        # {"etat":"ok",...}

# 4) Appaire l'émulateur (le script lit le même .env)
#    L'UUID ci-dessous est le restaurant de démonstration (migration 0007).
pnpm sync:appairer --restaurant 01930000-0000-7000-8000-000000000002 --prefixe E1
#    → note le jeton kdev_… (affiché UNE fois)
```

> **« Ça bouge pas » ?** Si `pnpm sync:dev` affiche « Waiting for file changes
> before restarting… » et rien d'autre, c'est que le process a QUITTÉ : il
> manque `DATABASE_URL`. Avec le fichier `.env` ci-dessus, ce cas disparaît —
> et quand ça marche, tu vois « API de synchronisation Kaissi — port 8787 »
> qui RESTE à l'écran (le serveur tourne, ne le ferme pas).

Sur l'émulateur, l'API de sync de ton PC se joint à l'adresse
**`http://10.0.2.2:8787`** (voir docs/tester-sans-tablette.md). Saisis-la avec
le jeton dans l'application : bandeau du haut → bouton **⇅ local**, qui
affiche le formulaire d'appairage tant que l'appareil n'est pas appairé.

> Le jeton est **vérifié avant d'être enregistré** : un appairage qui
> s'affiche comme réussi en est vraiment un.

Une fois que ça marche en local, le déploiement ci-dessous ne fait que
remplacer `10.0.2.2:8787` par une URL publique.

### 2.1 Railway (recommandé pour commencer)

Railway lit le `railway.json` **à la racine du dépôt** : il y trouve le
builder Dockerfile, le chemin `apps/sync/Dockerfile` (Node 22, sonde de santé,
utilisateur non-root) et le port. Tu n'as donc ni build command, ni start
command, ni port à saisir — et *Root Directory* reste **vide** : le contexte
de build est le monorepo entier.

> Railway EMPILE les modifications : tant que tu n'as pas cliqué sur
> **Deploy** dans le bandeau « Apply N changes », rien ne tourne, et le
> domaine répond `{"status":"error","code":404,"message":"Application not
> found"}` — un message du routeur Railway, pas de Kaissi.

1. **New Project → Deploy from GitHub repo** → `techres2boost/Kaissi`
2. **Variables** (onglet Variables) :

   | Nom | Valeur |
   |---|---|
   | `DATABASE_URL` | la chaîne du §1 (session pooler, port 5432) |
   | `DATABASE_PASSWORD` | le mot de passe de la base, sans encodage |
   | `SYNC_ORIGINES` | les URL du back-office **et du POS web** (pour le CORS) |

   Pas de `SYNC_PORT` : le service écoute le `PORT` que Railway injecte, et
   la plateforme route dessus toute seule. `DATABASE_SSL` reste à sa valeur
   par défaut (activé) : le pooler Supabase exige TLS.

3. **Settings → Networking → Generate Domain** → tu obtiens
   `https://kaissi-sync-production.up.railway.app`

Vérifie :

```bash
curl https://TON-DOMAINE/sante
# {"etat":"ok","protocole":1,"horodatage":"…"}
```

> **Note sur le runtime.** Le service exécute la SOURCE TypeScript directement
> (`node --experimental-strip-types`, plus un petit hook qui résout les
> imports `.js` → `.ts`). Aucune étape de compilation, donc aucun risque que le
> binaire déployé diverge du code relu. Un test de démarrage
> (`apps/sync/test/demarrage.test.ts`) lance cette commande exacte en CI : si
> le conteneur ne peut pas démarrer, le build échoue avant le déploiement.

### 2.2 Fly.io (alternative)

```bash
fly launch --no-deploy --name kaissi-sync --region cdg
fly secrets set DATABASE_URL='postgresql://…'
fly deploy
```

Le `Dockerfile` fourni à la racine d'`apps/sync` couvre les deux plateformes.

### 2.3 Que faire si le serveur tombe

**Rien d'urgent.** Les caisses continuent d'encaisser : elles écrivent en
local et gardent tout dans leur outbox. Au retour du serveur, elles
rattrapent seules. C'est exactement ce que le banc à trois appareils vérifie.

---

## 3. Back-office — Vercel

```bash
npm i -g vercel
cd apps/backoffice
vercel link
```

Réglages du projet Vercel :

| Réglage | Valeur |
|---|---|
| Framework | Next.js |
| Root Directory | `apps/backoffice` |
| Build Command | `cd ../.. && pnpm install --frozen-lockfile && pnpm --filter @kaissi/backoffice build` |
| Install Command | *(vide — fait par le build)* |
| Output Directory | `.next` |

Variables d'environnement :

| Nom | Valeur |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://mzrbpbqpkpbbndtijipw.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | clé **anon** (Project Settings → API) |

> La clé `service_role` ne va **jamais** sur Vercel côté client. Le
> back-office lit via RLS avec la clé anon et la session de l'utilisateur.

```bash
vercel --prod
```

---

## 4. POS Android — l'APK

C'est ici que tu deviens ton propre client.

### 4.1 Construire

```bash
pnpm install
pnpm --filter @kaissi/pos build          # + vérification du mode avion
pnpm --filter @kaissi/pos exec cap sync android
```

### 4.2 APK de test (le plus rapide)

```bash
cd apps/pos/android
./gradlew assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk
```

Installe sur la tablette :

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Ou envoie-toi le fichier `.apk` et installe-le à la main (il faut autoriser
« Sources inconnues » dans les réglages Android).

**À ce stade, tu as une caisse complète qui fonctionne sans aucun serveur.**
PIN de démonstration : `2468` (caissier) ou `1357` (gérant).

### 4.3 APK signé (pour distribuer)

Un APK de debug ne se met pas à jour proprement et expire. Pour un vrai
client, il faut signer :

```bash
# UNE SEULE FOIS — garde ce fichier précieusement et hors du dépôt.
# Le perdre = ne plus jamais pouvoir mettre à jour l'application installée.
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

```bash
cd apps/pos/android
./gradlew assembleRelease
# → app/build/outputs/apk/release/app-release.apk
```

### 4.4 Play Store (plus tard)

Pour le Play Store il faut un **bundle**, pas un APK :

```bash
./gradlew bundleRelease   # → app/build/outputs/bundle/release/app-release.aab
```

Compte développeur Google Play : 25 $ une fois. Compte **une à deux semaines**
de validation pour une première publication.

> **Tu n'en as pas besoin pour commencer.** Installer l'APK directement sur
> les tablettes de tes premiers clients est plus rapide, et te laisse
> déployer une correction en dix minutes au lieu de trois jours.

---

## 5. Appairer une tablette

Sans appairage, la caisse fonctionne en local. L'appairage ajoute la
synchronisation entre terminaux.

### 5.1 Générer un jeton

Depuis ta machine, avec la `DATABASE_URL` de production :

```bash
export DATABASE_URL='postgresql://…'
node apps/sync/scripts/appairer.mjs \
  --restaurant 01930000-0000-7000-8000-000000000002 \
  --libelle "Caisse 1" \
  --prefixe P1
```

Le jeton s'affiche **une seule fois**. Note-le.

Un préfixe **différent par terminal** (`P1`, `P2`, `P3`) : c'est ce qui évite
que deux tablettes hors ligne émettent le même numéro de ticket.

### 5.2 Saisir sur la tablette

Sur la tablette : bandeau du haut → **⇅ local** → formulaire d'appairage.

- **Adresse** : `https://TON-DOMAINE-RAILWAY`
- **Jeton** : `kdev_…`

La tablette **vérifie le jeton avant de l'enregistrer** : si l'appairage
échoue, tu le sais tout de suite, pas en plein service.

### 5.3 Révoquer un appareil perdu

```sql
select kaissi.revoquer_appareil(
  'uuid-de-l-appareil',
  'Tablette volée le 12/03'
);
```

L'appareil est coupé au prochain appel. **Ses ventes locales ne sont pas
perdues** : elles repartiront après un nouvel appairage.

---

## 6. Superviser le parc

```sql
select label, last_seen_at, retard_evenements, operations_refusees
from kaissi.etat_appareils
order by retard_evenements desc;
```

| Colonne | Ce qu'elle dit |
|---|---|
| `last_seen_at` | Dernier contact. Plus de 2 h en plein service = à regarder |
| `retard_evenements` | Écart avec la tête de file. Doit revenir à 0 |
| `operations_refusees` | > 0 = une décision humaine est attendue |

---

## 7. Boucle d'amélioration

C'est le point que tu as demandé : tester en client, et corriger au fil de l'eau.

```bash
# 1. Tu constates un problème sur la tablette
#    → Diagnostic → capture d'écran

# 2. Tu corriges, tu vérifies
pnpm test && pnpm typecheck

# 3. Tu rejoues une journée de service dans un navigateur
pnpm --filter @kaissi/pos dev              # terminal 1
pnpm --filter @kaissi/pos test:parcours    # terminal 2

# 4. Tu pousses — la CI vérifie les règles absolues
git push

# 5. Tu redéploies ce qui a bougé
#    API de sync  → automatique (Railway suit la branche main)
#    Back-office  → automatique (Vercel suit main)
#    POS          → nouvel APK, à réinstaller sur les tablettes
pnpm --filter @kaissi/pos build
cd apps/pos/android && ./gradlew assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
```

### Ce qui se met à jour tout seul, et ce qui ne le fait pas

| Change | Redéploiement |
|---|---|
| Catalogue, prix, employés | **Aucun** — arrive par la sync |
| Logique serveur, protocole | Railway, automatique |
| Rapports du back-office | Vercel, automatique |
| Écrans du POS, calculs | **Nouvel APK** — le bundle est dans l'APK |

C'est le prix de l'offline : le code du POS vit sur l'appareil. C'est aussi
ce qui fait qu'il démarre en mode avion.

---

## 8. Sauvegardes

Avant le premier vrai client :

1. Supabase → **Database → Backups** → vérifier que les sauvegardes
   quotidiennes sont actives (plan Pro).
2. **Faire un test de restauration réel.** Une sauvegarde jamais restaurée
   n'est pas une sauvegarde.
3. Activer le **PITR** dès que tu as des clients payants.

---

## 9. Diagnostic rapide

| Symptôme | Où regarder |
|---|---|
| La tablette ne synchronise pas | Bandeau → **⇅** → état et dernier message du serveur |
| « Action requise » | L'appareil est révoqué, ou le protocole est trop ancien |
| Opérations refusées > 0 | Écran de synchronisation, section « Opérations refusées » |
| Le serveur ne répond pas | `curl https://TON-DOMAINE/sante`, puis les journaux Railway |
| Ticket non imprimé | Diagnostic → File d'impression, et §9 de `tester-mode-avion.md` |
| L'app ne démarre pas hors ligne | `docs/tester-mode-avion.md`, section 5 |
