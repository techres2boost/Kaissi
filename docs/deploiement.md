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
| JDK | **21 à 23** (21 conseillé) | `pnpm verifier:jdk` |
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
   | `DATABASE_CA` | le **contenu** du certificat Supabase (SSL Configuration → Download certificate) |
   | `SYNC_PORT` | `8787` — fige le port d'écoute |
   | `SYNC_ORIGINES` | les URL du back-office **et du POS web** (pour le CORS) |

   `SYNC_PORT=8787` fixe le port : Railway injecte sinon un `PORT`
   imprévisible, et le domaine public route vers un port précis — un
   désaccord donne un conteneur sain derrière un domaine qui répond 502.
   Génère donc le domaine (§3) sur ce même `8787`. `DATABASE_SSL` reste à sa
   valeur par défaut (activé) : le pooler Supabase exige TLS, et son certificat
   voyage par `DATABASE_CA` (un chemin de fichier ne désigne rien dans un
   conteneur).

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

### 2.4 L'ordre d'un déploiement : la BASE avant le CODE

Railway redéploie le service **tout seul** à chaque push sur `main`. Les
migrations Supabase, elles, s'appliquent **à la main**. Si le code part avant
sa migration, chaque vente reçue échoue.

C'est arrivé (octobre 2026) : le remboursement exigeait la migration 0045,
le code est parti sans elle, et pendant la démonstration plus rien n'arrivait
ni en cuisine, ni au bar, ni au back-office. Rien n'était perdu — les ventes
attendaient dans les caisses et dans le journal — mais tout était invisible.

**La règle :**

1. Une migration nouvelle dans `supabase/migrations/` ? **D'abord** Supabase →
   SQL Editor → coller le fichier → Run.
2. **Ensuite** seulement, pousser le code sur `main`.

**Les garde-fous, depuis :**

- Au démarrage, le service sonde le schéma (`apps/sync/src/schema-requis.ts`,
  une sonde par migration) et imprime en gros celles qui manquent.
- `/sante` répond alors **503 `schema_incomplet`** : Railway, dont la sonde de
  déploiement est `/sante`, **garde l'ancienne version en service** au lieu de
  la remplacer.
- Si une vente arrive malgré tout, la caisse reçoit un **503 qui nomme la
  migration** (« la base de données du serveur n'est pas à jour : une
  migration manque (0045) ») — lisible dans ☰ → Synchronisation — et
  réessaie seule. Dès la migration appliquée, tout remonte sans rien
  ressaisir.
- La CI refuse une migration sans sa sonde (`test/schema-requis.test.ts`).

**En panne, le chemin le plus court** : SQL Editor → coller
`supabase/reparer-production.sql` → Run. Il applique la 0045 et répond en une
ligne s'il reste une migration à passer. Il ne touche aucune vente et se
rejoue sans dommage (`apps/sync/test/reparation-production.test.ts` le met à
l'épreuve sur une base ramenée à l'état de la production).

Vérifier sans rien appliquer : SQL Editor → coller
`supabase/verifier-migrations.sql` → Run. **Aucune ligne** = rien ne manque ;
sinon, une ligne par migration à appliquer.

Vérifier à tout moment : `curl https://<ton-service>/sante`. Un `"etat":"ok"`
dit que la base a tout ce que le code attend.

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

### 4.4 Play Store et App Store

Pour le Play Store il faut un **bundle**, pas un APK :

```bash
./gradlew bundleRelease   # → app/build/outputs/bundle/release/app-release.aab
```

Le numéro de version se pose à **un seul endroit** : `apps/pos/package.json`.
Le `build.gradle` en dérive `versionName` et `versionCode` (`1.4.2` → `10402`).
Play refuse un envoi dont le `versionCode` n'est pas strictement supérieur au
précédent, et un numéro consommé l'est définitivement.

Tout le reste — keystore, captures d’écran, politique de confidentialité,
questionnaire Data safety, et le cas iOS — est dans
[`stores.md`](stores.md), avec la raison pour laquelle une TWA Bubblewrap est
disqualifiée ici alors qu'elle convenait très bien à Digital Fidelity.

> **Tu n'en as pas besoin pour commencer.** Installer l'APK directement sur
> les tablettes de tes premiers clients est plus rapide, et te laisse
> déployer une correction en dix minutes au lieu de trois jours.

---

## 5. Mettre une tablette en service

Sans mise en service, la caisse fonctionne en local. Cette étape ajoute la
synchronisation entre terminaux et l'accès au back-office.

### 5.1 Ce que fait le gérant — et c'est tout

Sur la tablette : bandeau du haut → **⇅ local** → **e-mail et mot de passe du
gérant**, les mêmes que pour le back-office.

C'est fini. Aucun jeton à générer, aucune commande à lancer, aucune adresse à
saisir : l'adresse du serveur est déjà dans l'application (§5.2), et le
préfixe de tickets est attribué par le serveur.

Le compte doit être `admin` ou `gerant` de l'établissement — un caissier ne
décide pas quelle tablette rejoint la caisse. On les rattache avec
`pnpm sync:acces`, une fois, à l'installation.

> **Cette étape ne se refait pas.** Le terminal garde un identifiant
> d'installation dans sa base locale (migration 0021). S'il se remet en
> service — nouveau mot de passe, jeton révoqué, doute du gérant — le serveur
> le RECONNAÎT et lui rend le même appareil, le même préfixe de tickets, et
> laisse partir les ventes encore en attente d'envoi.
>
> Avant la 0021, chaque mise en service créait un appareil de plus. Une
> tablette a fini avec cinq identités en production, et les ventes encore
> dans son outbox portaient l'ancien identifiant : refusées
> « appareil_etranger », donc **jamais arrivées au back-office**.

### 5.2 L'adresse du serveur — une ligne, une fois, dans le dépôt

`apps/pos/deploiement.json` :

```json
{ "urlSync": "https://TON-DOMAINE-RAILWAY" }
```

C'est le SEUL réglage d'installation du POS. Il est dans le dépôt, et pas
dans le tableau de bord d'un hébergeur, pour que le même commit produise le
même bundle sur Vercel, en local et dans la CI — une variable posée dans une
seule des trois interfaces produisait trois builds différents.

`vite.config.ts` et `scripts/verifier-mode-avion.mjs` lisent ce fichier. La
garde du mode avion n'autorise QUE l'hôte déclaré ici : une URL distante
arrivée par accident dans le bundle reste refusée.

Ce n'est pas un `server.url` — le bundle ne charge aucun code depuis cette
adresse, et la caisse s'ouvre et encaisse sans elle.

### 5.3 Le script en ligne de commande reste là

`pnpm sync:appairer --restaurant <uuid> --prefixe P1` fonctionne toujours. Il
sert au dépannage et aux tests, pas à l'installation chez un client.

### 5.4 Une vente qui n'apparaît pas au back-office

Elle n'est pas perdue. `order_events` est la source de vérité ; `orders` n'en
est qu'une projection, et une projection se reconstruit.

**Il n'y a rien à faire.** Le service balaie les derniers événements reçus et
reconstruit les projections manquantes — au démarrage, puis **toutes les
demi-heures**. Aucun redéploiement à déclencher : un service de
synchronisation tourne des semaines sans redémarrer, et faire dépendre la
réparation d'un redéploiement, ce serait la faire dépendre d'une action
humaine.

Deux réglages, si un jour on en a besoin : `SYNC_REPARATION=0` éteint le
balayage, `SYNC_REPARATION_MINUTES` change l'intervalle.

Pour rejouer l'historique ENTIER — plus ancien que la fenêtre de démarrage,
après un changement de calcul des totaux — le script reste là, à réserver aux
heures creuses :

```bash
pnpm sync:reprojeter --restaurant <uuid> --tout
```

### 5.5 Révoquer un appareil perdu

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

### 6.0 Qui voit ces écrans — et pourquoi ils ne sont PAS chez le restaurant

Trois écrans d'exploitation, tous sous `/editeur` :

| Écran | Adresse | Ce qu'il répond |
|---|---|---|
| Clients et formules | `/editeur` | Qui sont nos clients, quelle formule |
| **Centre de supervision** | `/editeur/supervision` | Historique, incidents, journal, terminaux |
| Surveillance du service | `/editeur/surveillance` | L'état du service MAINTENANT |

Ils traversent **tous les restaurants** : chiffres du parc, adresses
réseau, terminaux de chaque client. Un gérant n'y a donc aucun accès, et ce
n'est pas un oubli — il verrait l'activité de ses confrères. Son écran à
lui, c'est « Journée » et les rapports de SON établissement.

Le menu latéral d'un restaurant (Employés, Taxes, Caisses, Abonnement…) ne
les montre jamais : ils vivent sur la page d'ACCUEIL du back-office, celle
qui liste les établissements — on y revient par le logo, ou par
`https://‹back-office›/`.

**Ils n'apparaissent que si le compte connecté est dans `KAISSI_EDITEURS`.**
C'est une variable d'environnement du **service de synchronisation**, chez
Railway — pas un rôle en base, pas une case à cocher :

```
KAISSI_EDITEURS=ton.adresse@res2boost.tn,associe@res2boost.tn
```

Adresses séparées par des virgules, sans espace autour, exactement celles
avec lesquelles on se connecte au back-office (la casse n'a pas
d'importance). Railway redémarre le service tout seul après la
modification ; il faut ensuite **recharger** le back-office.

Si la variable est absente ou ne contient pas ton adresse : les trois liens
ne s'affichent pas, et `/editeur/supervision` tapé à la main répond **page
introuvable**. C'est le comportement voulu — le service relit la variable à
chaque appel, l'interface ne décide de rien.

**L'écran d'abord** : back-office → accueil → **📈 Surveillance du service**
(réservé aux comptes de `KAISSI_EDITEURS`). Il se rafraîchit toutes les
15 secondes et dit en phrases ce qui franchit un seuil :

| Ce qu'il mesure | Seuil d'alerte | Pourquoi |
|---|---|---|
| Envois de ventes en échec (15 min) | > 1 % | Rien n'arrive au back-office |
| Envoi des ventes, 95e centile | > 2 s | La caisse attend |
| Processeur du service | > 80 % d'un cœur | Plus de marge pour un pic |
| Retard de la boucle d'événements | > 200 ms | Chaque requête attend |
| Connexions PostgreSQL | > 80 % du maximum | Prochaine étape : refus |
| Requêtes en attente d'une connexion du pool | > 0 | Le pool (10) est saturé |
| Cache de la base | < 95 % | La base lit le disque |
| Ventes sans projection | > 0 | Invisibles au back-office |
| Opérations rejetées (24 h) | > 0 | Une décision du gérant attend |
| Caisses muettes depuis 24 h | > 0 | Une tablette ne synchronise plus |
| Migrations manquantes | ≥ 1 | Toutes les ventes échouent (§ 2.4) |

Surveillance dit l'état **maintenant**, en mémoire du service. Pour la
mémoire, il y a le **centre de supervision** (§ 6 bis).

> **Pas à pas pour tester tout cela**, écran par écran, avec un tableau de
> diagnostic : [`tester-supervision.md`](tester-supervision.md).

### 6 bis. Le centre de supervision — historique, incidents, journal

Back-office → accueil éditeur → **Centre de supervision** (`/editeur/supervision`),
même réserve : comptes de `KAISSI_EDITEURS`, relus par le service à chaque
appel, 404 pour tout autre compte.

**⚑ Migration 0050 AVANT le déploiement du service.** Sa sonde est dans
`schema-requis.ts` : tant qu'elle manque, `/sante` répond 503 et Railway ne
bascule pas le trafic (règle « la migration avant le code »).

Ce qu'il montre, sur 1 h, 6 h, 24 h, 7 j ou 30 j :

| Volet | Contenu | Source |
|---|---|---|
| Performance et charge | requêtes, 5xx, envoi/réception p95, requêtes simultanées, événements reçus | chaque requête, chronométrée par le service |
| Infrastructure | processeur, mémoire, boucle d'événements, latence, connexions, pool, cache, taille de la base | relevés une fois par période |
| Sécurité | identifiants refusés, jetons d'appareil refusés, appareils révoqués, accès admin refusés, limites de débit — avec le RÉSEAU d'origine (/24, /48) | les statuts 401/403/429 des routes |
| Synchronisation | opérations rejetées (par code), erreurs 5xx du push/pull | réponse du push |
| Terminaux | en ligne / silencieux / muet, dernier envoi, version, rejets 24 h ; mises en service | `devices`, `/appairage` |
| Incidents | toute alerte persistante devient un incident : ouvert → pris en charge → résolu, avec note ; résolution automatique quand la cause disparaît | les mêmes seuils que Surveillance |

Comment c'est écrit — et pourquoi ça ne ralentit pas la caisse :

- **Une ligne par période** (`SYNC_SUPERVISION_SECONDES`, 60 par défaut) et
  par instance du service, jamais une ligne par vente. Les compteurs vivent
  en mémoire ; l'écriture est une transaction toutes les minutes. Mesuré
  sous charge (`test/charge.test.ts`, palier E) : chaque requête est comptée
  exactement une fois, et observer une requête coûte quelques microsecondes.
- **Une écriture qui échoue est abandonnée**, pas réessayée : la supervision
  ne doit jamais entrer en concurrence avec les ventes pour une connexion.
  L'écran signale l'échec de la dernière écriture.
- **Aucune donnée sensible** : adresse IP tronquée au réseau, adresse e-mail
  masquée, tout ce qui ressemble à un jeton retiré des messages, aucun
  montant. Les trois tables sont en RLS forcée « refus à tous » : seul le
  rôle du service les lit et les écrit.
- **Rétention** : points 30 jours, événements 90 jours, incidents résolus
  180 jours — purgés par le service, une fois par heure.
- `SYNC_SUPERVISION=0` éteint le collecteur (l'écran le dit).

**Les erreurs vues chez le client** entrent au même journal, sans tiers :

- **caisse** : toute erreur non attrapée, et toute erreur d'affichage (la
  barrière remplace l'écran blanc par « vos ventes sont enregistrées —
  Relancer la caisse »). Dédupliquées sur la tablette (une ligne par
  erreur, avec son nombre), gardées dans `localStorage` pour survivre au
  plantage, envoyées par `POST /sync/erreurs` APRÈS les ventes — zéro
  requête quand il n'y a rien. Catégorie « Terminaux » ;
- **back-office** : la page d'erreur prévient `POST /admin/erreur-ecran`,
  une fois par erreur et par onglet, avec le `digest` qui la relie au
  journal de Vercel. Chemin réduit à sa forme (identifiants masqués),
  30 au plus par période. Catégorie « Application ».

### 6 ter. Être PRÉVENU — sur un téléphone

Le centre de supervision ne prévient personne tant qu'on ne le regarde
pas. Deux mécanismes, et il faut **les deux** :

**1. Les incidents, par webhook** (service vivant, quelque chose va mal).
Chez Railway, variables du service de synchronisation :

| Variable | Valeur |
|---|---|
| `SYNC_ALERTES_WEBHOOK` | l'adresse **https** du webhook — c'est un **secret** |
| `SYNC_ALERTES_NIVEAU` | `critique` (défaut) ou `attention` |
| `SYNC_ALERTES_LIEN` | `https://‹back-office›/editeur/supervision` (facultatif) |

Le message part à l'OUVERTURE d'un incident, à son AGGRAVATION en critique
et à sa RÉSOLUTION — jamais à chaque minute où il est revu, et au plus 12
par heure. Il porte un champ `text` (et `content`) : Telegram, Slack,
Discord, Google Chat, Mattermost le lisent tels quels. Pour Telegram :
créer un robot avec @BotFather, écrire une fois au robot, puis
`https://api.telegram.org/bot‹JETON›/sendMessage?chat_id=‹VOTRE_ID›`
(l'identifiant se lit sur `https://api.telegram.org/bot‹JETON›/getUpdates`).
Au démarrage, le journal du service dit `Alertes : webhook configuré` ou
`aucune sortie` — jamais l'adresse. Chaque envoi, réussi ou non, est inscrit
au journal de supervision (« Alerte envoyée » / « Alerte non envoyée »).

**2. Une sonde EXTERNE** (service MORT ou injoignable — le webhook ne peut
rien dire, puisque c'est lui qui est tombé). Elle est **déjà en place** :
`.github/workflows/sonde-production.yml`, toutes les 10 minutes, gratuit sur
un dépôt public. Deux requêtes GET : `‹service›/sante` (base et schéma) et la
page de connexion du back-office, adresses lues dans
`apps/pos/deploiement.json` — ce que les caisses appellent vraiment. Un échec
est réessayé deux fois à 20 s avant d'être déclaré : un redéploiement ne
réveille personne. `/sante` répond 503 quand une migration manque — la sonde
le dit, et nomme la migration.

Qui est prévenu :
- **GitHub**, par e-mail, à chaque passage en échec (au compte qui a modifié
  le workflow en dernier) ;
- **le webhook**, au CHANGEMENT d'état seulement (tombé, puis rétabli), si le
  secret du dépôt `SYNC_ALERTES_WEBHOOK` est renseigné — *Settings → Secrets
  and variables → Actions → New repository secret*, la même adresse que chez
  Railway.

À la main : onglet *Actions* → *Sonde de production* → *Run workflow*, ou
`pnpm sonde:production` depuis un poste. ⚑ GitHub suspend un workflow
planifié après 60 jours sans activité sur le dépôt (il prévient par e-mail) :
*Enable workflow* le relance. Une seconde sonde chez UptimeRobot ou Better
Stack reste possible — elle ne dépend pas de GitHub.

**3. La mémoire du service.** Railway redémarre un conteneur qui dépasse sa
limite — sans prévenir, en pleine vente. Le service lit sa limite dans le
cgroup du conteneur et ouvre l'incident `processus.memoire` à 70 % (attention)
puis 85 % (critique) ; le graphique « Mémoire du service » trace le seuil. Si
l'hébergeur n'expose pas la limite, le graphique le dit : renseigner
`SYNC_MEMOIRE_LIMITE_MO` (par exemple `2048` pour une instance de 2 Go).

En SQL, l'état appareil par appareil :

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
   n'est pas une sauvegarde. Il est outillé :

   ```bash
   pnpm db:test     # ou tout PostgreSQL local où l'on peut créer une base
   pnpm sync:restauration --source "postgresql://postgres.‹ref›:‹MOT_DE_PASSE›@‹hôte›:5432/postgres"
   ```

   La source est la chaîne **directe** ou le *session pooler* de Supabase
   (port 5432), jamais le pooler en mode transaction (6543). Le script copie
   le schéma `kaissi` (`pg_dump`), le restaure dans une base JETABLE, puis
   exige : mêmes tables et mêmes nombres de lignes, ventes et paiements
   identiques au millime, CHAQUE chaîne du journal d'audit recalculée sans
   rupture, et le service de synchronisation qui redémarre sur la copie avec
   `/sante` « ok ». Il ne modifie jamais la source et ne lit, de
   `auth.users`, que les identifiants. Il échoue — et nomme la ligne — si une
   seule chose ne revient pas à l'identique : vérifié en falsifiant une ligne
   du journal d'audit. ⚑ Le `pg_dump` local doit être d'une version majeure
   au moins égale à celle de Supabase (`select version()`).

   À refaire **une fois par trimestre**, et après toute migration lourde.
3. Activer le **PITR** dès que tu as des clients payants.

---

## 9. Diagnostic rapide

| Symptôme | Où regarder |
|---|---|
| La tablette ne synchronise pas | Bandeau → **⇅** → état et dernier message du serveur |
| Plus rien n'arrive en cuisine ni au back-office, « ↑↓ N » ne descend pas | ☰ → Synchronisation : « la base de données du serveur n'est pas à jour » → appliquer la migration nommée (§ 2.4) |
| « Action requise » | L'appareil est révoqué, ou le protocole est trop ancien |
| Opérations refusées > 0 | Écran de synchronisation, section « Opérations refusées » |
| Le serveur ne répond pas | `curl https://TON-DOMAINE/sante`, puis les journaux Railway |
| Ticket non imprimé | Diagnostic → File d'impression, et §9 de `tester-mode-avion.md` |
| L'app ne démarre pas hors ligne | `docs/tester-mode-avion.md`, section 5 |
