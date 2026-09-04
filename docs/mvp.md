# Kaissi — le MVP, et rien de plus

Ce document décrit **la version minimale mise en production** : ce qu'elle
contient, ce qui est volontairement éteint, comment la lancer, comment la
déployer.

Le reste de `docs/` reste vrai et plus détaillé. Celui-ci est le chemin court.

---

## 1. Le noyau

Un POS n'a pas besoin de cinquante modules pour être vendable. Il en faut un
seul, qui va au bout :

```
catalogue → commande → paiement → vente → cuisine → ticket
```

| Module | Où il vit | État |
|---|---|---|
| 🔐 Connexion / rôles | PIN sur la tablette · e-mail au back-office | **fait** |
| 📦 Catalogue (produits, catégories, prix, TVA) | back-office `/‹resto›/catalogue` | **fait** |
| 🛒 Caisse (commande, panier, remises, paiement) | POS | **fait** |
| 👨‍🍳 Cuisine (« commandes à préparer ») | back-office `/‹resto›/preparation` | **fait** |
| 🧾 Ticket | affiché à l'écran du POS | **fait** |
| 📈 Administration (journée, clôture, employés) | back-office | **fait** |
| 📊 Stock, coûts et marges | back-office — voir [`gestion.md`](gestion.md) | **fait** |

Deux choses valent la peine d'être dites, parce qu'elles ne se voient pas :

- **Les totaux sont calculés à un seul endroit** (`packages/domain`), importé
  à l'identique par la caisse et par le serveur. Il n'y a pas deux façons de
  calculer une TVA dans ce dépôt, donc pas d'écart à expliquer au client.
- **La caisse encaisse hors ligne**, et se réconcilie sans perdre ni dupliquer
  une vente. C'est vérifié contre un vrai PostgreSQL avec trois terminaux et
  des coupures réseau (`apps/sync/test/banc-trois-appareils.test.ts`).

---

## 2. L'impression est ÉTEINTE — et rien n'a été supprimé

Un restaurant qui démarre n'a pas encore d'imprimante réseau configurée. Une
file d'impression qui accumule des travaux impossibles à sortir allume un
badge rouge permanent — donc un badge que plus personne ne regarde.

Le module d'impression (`packages/printing`, le plugin Java, la file
persistante, `kitchen_sends`) est **écrit, testé et conservé**. Il est
simplement débranché par un drapeau de build, `apps/pos/src/config.ts`.

Tant qu'il est éteint :

| Avant | Maintenant |
|---|---|
| Bon de cuisine imprimé | **Écran de cuisine** au back-office, plus l'aperçu du bon sur la tablette après l'envoi |
| Ticket client imprimé | **Ticket affiché** après l'encaissement, à l'écran de la caisse |
| Rapport de clôture imprimé | Récapitulatif à l'écran, plus l'écran « Journée » du back-office |
| Badge « tickets non imprimés » | absent — rien n'attend une imprimante |

Ce qui **n'a pas** changé : `kitchen_sends` continue d'enregistrer ce qui est
parti en cuisine. Un article envoyé ne repart jamais — sinon la cuisine
referait un plat déjà servi. C'est cette trace, et non le papier, qui porte
la garantie.

### La rallumer

```bash
pnpm pos:build:impression       # APK
pnpm pos:build:web:impression   # web
```

Rien d'autre — et ces commandes marchent aussi sur Windows, ce que
`VITE_IMPRESSION=1 pnpm …` ne fait pas : cette syntaxe est celle d'un shell
POSIX, et `cmd.exe` répond « n'est pas reconnu en tant que commande interne ».

L'écran Diagnostic retrouve la configuration des imprimantes, les tickets
repartent en file, et l'écran de cuisine continue de fonctionner — les deux ne
s'excluent pas. Le détail est au §7.

---

## 3. Ce qui n'est pas dans le MVP

**Les recettes et le stock d'ingrédients.** Le coût est saisi par produit
fini — un burger a un coût, pas « 1 pain + 1 steak ». C'est suffisant pour
calculer une marge, et cela évite de construire une nomenclature avant d'en
avoir l'usage.

Le stock simple, lui, **est** livré : quantités, seuils, alertes, mouvements
manuels, et décrément automatique à la vente. Tout est dans
[`gestion.md`](gestion.md).

---

## 4. Les trois postes

| Poste | Application | Identité | Ce qu'il voit |
|---|---|---|---|
| **Caissier / serveur** | POS (tablette ou navigateur) | PIN à 4 chiffres, validé **hors ligne** | Salle, commande, encaissement, clôture |
| **Cuisine** | back-office, `/‹resto›/preparation` | compte e-mail, rôle `cuisine` | Uniquement les commandes à préparer — aucun montant |
| **Gérant / admin** | back-office | compte e-mail, rôle `gerant` ou `admin` | Journée, catalogue, employés, cuisine |

Le rôle décide de la page d'arrivée : un cuisinier qui se connecte atterrit
sur l'écran de cuisine, pas sur un rapport financier qui ne le concerne pas.

Qui a besoin de quoi, concrètement :

- **Serveur, caissier** → un PIN, posé par le gérant depuis *Employés*.
  Aucun compte, aucun mot de passe : ils n'ouvrent jamais un navigateur.
- **Cuisine, gérant, comptable** → un compte Supabase, relié une fois par
  `pnpm sync:acces` (§6, étapes 2 et 8).

> **Le PIN trace, il ne protège pas.** Quatre chiffres, c'est dix mille
> combinaisons : il répond à « QUI a fait cette action », pas à « qui a le
> droit d'entrer ». Ce qui protège l'argent, c'est le jeton d'appareil
> révocable, RLS et le journal d'audit.

---

## 5. Lancer en local (aucun compte, aucune installation)

```bash
pnpm install
pnpm test:rapide     # 245 tests — domaine, schéma local, ESC/POS
pnpm pos:dev         # la caisse dans le navigateur
```

PIN de démonstration : `2468` (caissier), `1357` (gérant), `9753` (serveur).

> `pnpm pos:dev` utilise une base **en mémoire** : tout disparaît au
> rechargement, et le catalogue vient de la graine locale. C'est un aperçu,
> pas une caisse. Le bandeau l'affiche.

Rejouer une journée entière de service dans un vrai navigateur :

```bash
pnpm parcours        # exige « pnpm pos:dev » lancé dans un autre terminal
```

---

## 6. Mettre en production — pas à pas

Compte à peu près **deux heures** la première fois, dont l'essentiel en
attente de builds.

### Ce qu'il faut avoir sous la main

| | Où l'obtenir | Coût |
|---|---|---|
| Node ≥ 22 et pnpm ≥ 10 | `node -v` / `pnpm -v` | — |
| Un compte **Supabase** | supabase.com | gratuit pour démarrer |
| Un compte **Railway** | railway.app | ~5 $/mois après l'essai |
| Un compte **Vercel** | vercel.com | gratuit |
| Le dépôt sur GitHub | déjà fait | — |

Android Studio n'est **pas** nécessaire : la caisse part d'abord en version
web. L'APK vient après, quand le restaurant tourne.

### La carte, avant de commencer

```
      ┌──────────────────────┐
      │  Supabase Postgres   │   la vérité, protégée par RLS
      └──────────┬───────────┘
        SQL      │      SQL
     ┌───────────┴────────────┐
     ▼                        ▼
┌─────────────┐        ┌──────────────┐
│ Back-office │        │ API de sync  │   process Node persistant
│  (Vercel)   │        │  (Railway)   │
│  Next.js    │        └──────┬───────┘
└─────────────┘               │ HTTPS, jeton d'appareil
  admin + cuisine             ▼
  clé PUBLIQUE          ┌───────────┐
  session utilisateur   │    POS    │  encaisse HORS LIGNE
                        │ (Vercel   │  et rattrape ensuite
                        │  ou APK)  │
                        └───────────┘
```

Les deux applications ne se parlent **jamais** directement. Elles se
retrouvent dans la base. C'est la source de confusion la plus fréquente.

---

### Étape 1 — Supabase : la base

**1.1** supabase.com → **New project**. Note le mot de passe de base de
données qu'il te demande de choisir : il n'est plus jamais affiché ensuite.
Région : **Frankfurt (eu-central-1)** est la plus proche de la Tunisie.

**1.2** Applique les migrations. Le plus simple, sans installer la CLI :
ouvre **SQL Editor** et colle le contenu de chaque fichier de
`supabase/migrations/`, **dans l'ordre numérique**, de `0001` à `0018`. Un
fichier à la fois, « Run » entre chaque.

> Elles ne se modifient jamais après application, et chacune est
> transactionnelle : une migration qui échoue ne laisse rien à moitié fait.
> Si l'une échoue, **arrête-toi** et lis le message — ne saute pas à la
> suivante.

Avec la CLI Supabase, c'est une seule commande :

```bash
supabase link --project-ref <ton-ref>
supabase db push
```

**1.3 — Vérifie.** Dans le SQL Editor :

```sql
select count(*) from kaissi.products;    -- 17 (jeu de démonstration)
select count(*) from kaissi.restaurants; -- 1  (« Snack Lac 1 »)
select id, name from kaissi.restaurants; -- note l'UUID, tu en auras besoin
```

Si `kaissi.products` n'existe pas, les migrations ne sont pas passées.

**1.4 — La chaîne de connexion.** En haut du projet, bouton **Connect** →
onglet **Session pooler** → prends cette URI-là (port `5432`).

L'hôte doit ressembler à `aws-0-<région>.pooler.supabase.com`, et
l'utilisateur à `postgres.<ref>` (avec le point). C'est **le bon choix pour
deux raisons**, pas une :

- l'API de sync ouvre plusieurs connexions, et le pooler évite de saturer la
  base ;
- surtout, la **connexion directe** `db.<ref>.supabase.co` ne résout
  aujourd'hui **qu'en IPv6**, et Railway (comme Render et Fly) n'a pas de
  sortie IPv6. La choisir donne un conteneur qui plante au démarrage sur
  `connect ENETUNREACH 2a05:…` — l'erreur exacte, et la plus déroutante,
  puisqu'elle ressemble à un pare-feu. Le pooler, lui, répond en IPv4.

Ne prends donc **ni** « Direct connection », **ni** la chaîne `DIRECT_URL`
que propose l'onglet ORMs/Prisma — c'est aussi la connexion directe.

```
postgresql://postgres.abcdefgh:MOT2PASSE@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
```

**Laisse `MOT2PASSE` littéralement dans l'URL** et mets le vrai mot de passe
à part, dans `DATABASE_PASSWORD`. Il n'est alors jamais analysé comme une
URL, donc jamais à encoder — et `password authentication failed` cesse
d'être un jeu de devinettes.

> ⚠ Ce mot de passe donne un accès **complet** à la base. Il ne va que dans
> les variables d'environnement du serveur de sync et dans ton
> `apps/sync/.env` local. Jamais dans le dépôt, jamais dans le POS.

**1.5 — Les clés publiques.** Bouton **Connect** → **App Frameworks**, ou
Project Settings → API. Note :

- `NEXT_PUBLIC_SUPABASE_URL` — `https://<ref>.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — la clé **publique** (`sb_publishable_…`
  ou l'ancien JWT `eyJ…` de rôle `anon`).

> La clé **secrète** (`sb_secret_…` / `service_role`) ne sort **jamais** de
> ce tableau de bord. Le back-office refuse de démarrer si on la lui donne :
> elle contourne RLS, et le cloisonnement entre restaurants reposerait alors
> sur la vigilance de chaque `where` écrit à la main.

---

### Étape 2 — Ton compte administrateur

**C'est l'étape qu'on oublie, et sans elle rien ne s'ouvre.** Un compte
Supabase seul ne donne accès à rien : les politiques RLS ne rendent aucune
ligne à un compte sans appartenance. C'est voulu — mais il faut donc créer la
première appartenance à la main, une fois.

**2.1 — Crée le compte.** Supabase → **Authentication** → **Users** →
**Add user** → **Create new user**. Saisis ton e-mail et un mot de passe, et
**coche « Auto Confirm User »** — sans quoi tu ne pourras pas te connecter
avant d'avoir cliqué sur un lien de confirmation.

**2.2 — Prépare la connexion locale.** Sur ton poste :

```bash
cp apps/sync/.env.example apps/sync/.env
```

Édite `apps/sync/.env` : colle l'URI du §1.4 dans `DATABASE_URL` (avec
`MOT2PASSE` tel quel) et le vrai mot de passe dans `DATABASE_PASSWORD`,
entre guillemets.

**2.3 — Relie le compte à l'établissement :**

```bash
pnpm sync:acces                       # liste les établissements et leur UUID
pnpm sync:acces --restaurant <uuid> --email toi@exemple.tn --role admin \
                --nom "Ton Nom" --pin 4271
```

Le script affiche `ACCÈS ACCORDÉ`. Il est **rejouable** : le relancer met le
rôle à jour au lieu d'échouer.

> Pourquoi un script et pas un bouton : créer un compte Supabase exige la clé
> `service_role`, qui contourne RLS. Elle n'a rien à faire dans une
> application web. Ce script tourne sur **ton** poste, avec la connexion
> PostgreSQL — jamais depuis un navigateur.

Le `--pin` est facultatif : il te sert seulement si tu encaisses toi-même sur
la tablette.

---

### Étape 3 — L'API de synchronisation (Railway)

Sans elle, une caisse fonctionne, mais **seule** : le back-office ne voit
aucune vente, et la cuisine aucune commande.

**3.1** railway.app → **New Project** → **Deploy from GitHub repo** → ton
dépôt.

Railway lit le `railway.json` **à la racine du dépôt** : il y trouve le
builder Dockerfile, le chemin `apps/sync/Dockerfile` et la sonde `/sante`. Ni
build command, ni start command, ni port à saisir.

> Laisse **Root Directory vide** (la racine). Le Dockerfile copie
> `pnpm-lock.yaml` et `packages/domain` : son contexte de build est le
> monorepo entier, pas `apps/sync`. Pointer Railway sur `apps/sync` casse le
> build à la première ligne `COPY`.

**3.2 — Variables** (onglet *Variables*) :

| Nom | Valeur |
|---|---|
| `DATABASE_URL` | l'URI du §1.4, avec `MOT2PASSE` laissé tel quel |
| `DATABASE_PASSWORD` | le vrai mot de passe, **sans encodage** |
| `DATABASE_CA` | le **contenu** du certificat Supabase (voir juste en dessous) |

Le certificat, c'est le piège suivant, et il est réel : le pooler Supabase
présente un certificat signé par **sa propre autorité**, que Node ne connaît
pas. Sans lui, le conteneur démarre puis crashe sur `self-signed certificate
in certificate chain`.

En local on donne un **chemin** de fichier ; dans un conteneur, un chemin ne
désigne rien. Il faut donc le **contenu** :

1. Supabase → **Project Settings → Database → SSL Configuration →
   « Download certificate »**. Tu obtiens `prod-ca-2021.crt`.
2. Ouvre-le dans un éditeur de texte, copie **tout** (de `-----BEGIN` à
   `-----END-----`).
3. Railway → *Variables* → **Raw Editor** (il accepte les valeurs
   multi-lignes) → ajoute `DATABASE_CA` avec ce contenu collé tel quel.

> `DATABASE_CA` porte le contenu ; `DATABASE_CA_FILE` un chemin. N'utilise
> **pas** `DATABASE_CA_FILE` sur Railway : le fichier `C:\…` de ton PC
> n'existe pas dans le conteneur — c'est exactement ce qui échoue sinon.

Ajoute enfin une quatrième variable, `SYNC_PORT`, à `8787` :

| Nom | Valeur |
|---|---|
| `SYNC_PORT` | `8787` |

Pourquoi la fixer : Railway injecte de son côté un `PORT` **imprévisible**
(souvent `8080`), et le domaine public que tu généreras à l'étape 3.4 route
vers **un** port précis. Si le service écoute le `PORT` injecté pendant que
le domaine pointe ailleurs, le conteneur est parfaitement sain mais le
domaine répond `502` — le symptôme le plus déroutant, puisque les logs sont
verts. En figeant `SYNC_PORT=8787`, on aligne les trois : le service écoute
`8787`, le Dockerfile l'expose, et le domaine y pointera.

Pas de `NODE_ENV` (le Dockerfile le pose). Laisse `SYNC_ORIGINES` de côté :
tu ne connais pas encore les URL de Vercel, on y revient à l'étape 6.

**3.3 — DÉPLOIE.** Railway *empile* les modifications sans les appliquer : en
haut à gauche, un bandeau **« Apply N changes »** avec un bouton **Deploy**.
Tant que tu ne cliques pas dessus, **rien n'est construit et rien ne tourne**.

C'est le piège le plus courant de cette étape, et son symptôme n'a rien
d'évident :

```bash
curl https://TON-DOMAINE/sante
{"status":"error","code":404,"message":"Application not found","request_id":"…"}
```

Ce JSON-là vient du routeur de Railway, **pas de Kaissi** : le domaine existe,
mais il n'y a aucun conteneur derrière. Notre API répondrait
`{"etat":…}`, en français. Si tu vois `status`/`code`/`request_id`, c'est
Railway qui parle — clique sur *Deploy*, ou regarde l'onglet *Deployments* :
il doit y avoir un déploiement **Active**.

**3.4** *Settings → Networking → Generate Domain*. Tu obtiens quelque chose
comme `https://kaissi-production.up.railway.app`. Railway demande **« Enter
the port your app is listening on »** : saisis **`8787`** — le même que le
`SYNC_PORT` du §3.2. C'est ce numéro-là qui doit correspondre, sinon 502.

> Si tu avais déjà généré le domaine sur un autre port, corrige-le ici :
> *Settings → Networking*, puis remets le port cible à `8787`.

**3.5 — Vérifie :**

```bash
curl https://TON-DOMAINE/sante
# {"etat":"ok","protocole":1,"base":"joignable","horodatage":"…"}
```

`/sante` joint **la base**, pas seulement le processus : un service qui répond
`ok` prouve que la chaîne complète tient. S'il répond autre chose, le message
dit laquelle des deux est en cause — n'avance pas tant qu'il n'est pas vert.

---

### Étape 4 — Le back-office (Vercel)

**4.1** vercel.com → **Add New → Project** → ton dépôt GitHub.

**4.2 — Réglages :**

| Réglage | Valeur |
|---|---|
| Framework Preset | Next.js |
| **Root Directory** | `apps/backoffice` |
| Build Command | `cd ../.. && pnpm install --frozen-lockfile && pnpm --filter @kaissi/backoffice build` |
| Install Command | *(laisser vide — le build s'en charge)* |
| Output Directory | *(par défaut)* |

**4.3 — Variables d'environnement** (les deux du §1.5) :

| Nom | Valeur |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | la clé **publique** |

**4.4 — Deploy**, puis **vérifie** : ouvre l'URL, connecte-toi avec l'e-mail
et le mot de passe du §2.1. Tu dois atterrir sur **Journée**, avec les
onglets *Cuisine · Journée · Catalogue · Employés*.

> **« Votre compte n'est rattaché à aucun établissement »** → l'étape 2.3 n'a
> pas été faite, ou pas sur le bon restaurant. Relance `pnpm sync:acces`.
>
> **Une erreur qui parle de schéma** → `kaissi` n'est pas exposé à l'API REST.
> Supabase → Project Settings → API → *Exposed schemas* → ajoute `kaissi`.
> (La migration 0012 le fait, mais l'interface Supabase écrase ce réglage si
> on y touche ensuite.)

---

### Étape 5 — Le POS en version web (Vercel)

Le même dépôt, un **second** projet Vercel.

**5.1** Vercel → **Add New → Project** → le même dépôt.

**5.2 — Réglages :**

| Réglage | Valeur |
|---|---|
| Framework Preset | **Other** |
| **Root Directory** | `apps/pos` |
| Build / Install / Output | *(laisser vide)* |

`apps/pos/vercel.json` porte déjà la commande de build, la réécriture SPA et
les en-têtes du service worker. Aucune variable d'environnement.

**5.3 — Deploy**, puis **vérifie** : ouvre l'URL. Tu dois voir l'écran
**Prise de poste** avec les employés de démonstration.

- Il ne doit **pas** y avoir l'étiquette « démo — mémoire » : si elle
  apparaît, le build n'a pas pris la cible web.
- Menu **Diagnostic** → bloc *Stockage* : « Mode : web », « Persistance :
  Oui ». S'il y a une ligne **Réserve**, lis-la : le navigateur a refusé le
  stockage persistant, et les données restent évinçables. Installe la page
  comme application (icône « Installer » dans la barre d'adresse) pour
  l'obtenir.

PIN de démonstration : `2468` (caissier), `1357` (gérant).

---

### Étape 6 — Autoriser le POS web à parler à l'API (CORS)

Maintenant que tu connais les deux URL Vercel, retourne dans Railway →
*Variables* et ajoute :

| Nom | Valeur |
|---|---|
| `SYNC_ORIGINES` | `https://ton-pos.vercel.app,https://ton-backoffice.vercel.app` |

**Deux adresses DISTINCTES**, séparées par une virgule : celle du **POS**
d'abord, celle du back-office ensuite. Pas de virgule superflue, pas de barre
oblique finale. Railway redéploie seul.

> ⚠ **C'est l'oubli le plus coûteux de toute la liste**, et le plus facile à
> rater : coller deux fois le back-office, ou oublier le POS, laisse
> l'appairage échouer. L'APK Android appelle par le réseau natif et ignore
> CORS ; un POS servi dans un navigateur, non. Sans l'adresse EXACTE du POS
> ici, l'étape 7 échoue sur « Failed to fetch » — et depuis la version
> actuelle, le POS te dit alors précisément quelle adresse ajouter.
>
> L'adresse du POS est son URL de **production** Vercel (`kaissi-pos.vercel.app`),
> pas une URL de prévisualisation `kaissi-xxxx-….vercel.app`. Ouvre le POS par
> son domaine de production, sinon son origine ne correspondra pas.

---

### Étape 7 — Appairer la caisse

**7.1** Sur ton poste (le `apps/sync/.env` du §2.2 est déjà prêt) :

```bash
pnpm sync:appairer --restaurant <uuid> --libelle "Caisse 1" --prefixe P1
```

Le jeton `kdev_…` s'affiche **une seule fois**. Note-le.

> Le préfixe numérote les tickets (`P1-000001`). Il est unique par
> établissement : une deuxième caisse prend `P2`, sinon deux tickets
> différents porteraient le même numéro.

**7.2** Sur la caisse (l'URL du §5) : bandeau du haut → bouton **⇅ local** →
saisis l'URL de l'API Railway (§3.3) et le jeton. Le jeton est **vérifié
avant d'être enregistré** : un appairage annoncé réussi en est un.

**7.3 — Vérifie** : le badge du bandeau passe de `⇅ local` à `⇅ 0`, et
l'écran de synchronisation affiche **À jour**.

---

### Étape 8 — L'équipe

**8.1 — Les serveurs et caissiers** : back-office → **Employés** →
*Embaucher*. Nom, rôle, code PIN. Aucun compte de connexion nécessaire : ils
tapent leur PIN sur la tablette, et le rôle fixe leur plafond de remise.

**8.2 — La cuisine**, qui elle ouvre un navigateur, a besoin d'un compte :

```bash
# 1. Supabase → Authentication → Users → Add user (Auto Confirm coché)
# 2. puis, sur ton poste :
pnpm sync:acces --restaurant <uuid> --email cuisine@snack.tn --role cuisine \
                --nom "Chef Mounir"
```

Le poste de cuisine ouvre alors l'URL du back-office, se connecte, et arrive
**directement** sur l'écran de cuisine. Il ne voit ni les montants, ni le
catalogue, ni les employés.

**8.3 — La carte** : back-office → **Catalogue**. Les prix modifiés
descendent sur les tablettes à la synchronisation suivante, sans rien
réinstaller.

---

### Étape 9 — Le test qui décide

Fais un vrai service de bout en bout, dans cet ordre :

1. **Caisse** : PIN → ouverture de caisse → commande sur une table →
   *Cuisine*.
2. **Cuisine** (autre écran, back-office `/preparation`) : la commande apparaît
   en moins de 30 secondes. Clique **Prêt**.
3. **Caisse** : encaisse. Le ticket s'affiche.
4. **Back-office → Journée** : la vente y figure, avec sa TVA ventilée.
5. **Le test qui compte** — coupe le Wi-Fi de la caisse :
   - la caisse continue d'encaisser, le bandeau passe *Hors ligne* ;
   - remets le réseau : le compteur `⇅ n` redescend à 0 tout seul, et les
     ventes apparaissent dans *Journée*.

Si les cinq passent, tu es en production.

---

### Étape 10 — L'APK Android (quand tu veux)

La version web suffit pour ouvrir. L'APK reste la cible **nominale** : son
SQLite natif n'est évinçable par personne, et c'est elle qu'il faut viser
pour un restaurant qui tourne tous les jours.

```bash
pnpm pos:build                                    # + contrôle du mode avion
pnpm --filter @kaissi/pos exec cap sync android
cd apps/pos/android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Prérequis : JDK 21 et le SDK Android. La tablette s'appaire exactement comme
au §7. La signature pour distribution est décrite dans
[`deploiement.md` §4.3](deploiement.md).

---

## 7. Rallumer l'impression, le jour venu

Un seul drapeau, aucun code à réécrire :

```bash
pnpm pos:build:web:impression    # cible web
pnpm pos:build:impression        # cible Android
```

Sur Vercel, remplace la commande de build du projet POS par
`pnpm build:web:impression`. Puis, sur la tablette : *Diagnostic* → bloc
**Imprimantes** → adresse IP de l'imprimante et port (`9100` presque
toujours) → *Tester*.

L'écran de cuisine continue de fonctionner : les deux ne s'excluent pas.

---

## 8. Vérifier avant de livrer

```bash
pnpm test:rapide                        # domaine, schéma local, ESC/POS
pnpm typecheck                          # tout le monorepo
pnpm pos:build && pnpm pos:build:web    # les deux cibles + mode avion
pnpm db:test && pnpm --filter @kaissi/sync test && pnpm db:test:stop
```

Le dernier exige Docker ou un PostgreSQL local : il vérifie RLS,
l'idempotence et le banc à trois appareils contre une vraie base.

---

## 9. Quand quelque chose ne va pas

| Symptôme | Cause la plus probable |
|---|---|
| « Votre compte n'est rattaché à aucun établissement » | `pnpm sync:acces` pas encore lancé (§2.3) |
| Erreur qui parle de « schema » au back-office | `kaissi` retiré des *Exposed schemas* de Supabase |
| `{"status":"error","code":404,"message":"Application not found"}` | Railway : les modifications sont en attente. Clique **Deploy** (§3.3) |
| Railway échoue sur un `COPY` du Dockerfile | *Root Directory* pointe sur `apps/sync` : remets-la à la racine (§3.1) |
| Railway construit avec Nixpacks au lieu du Dockerfile | `railway.json` doit être à la **racine** du dépôt, pas dans `apps/sync` |
| « Failed to fetch » à l'appairage | `SYNC_ORIGINES` n'inclut pas l'URL **exacte** du POS (§6). Le POS affiche laquelle ajouter. Fréquent : le back-office collé deux fois, le POS oublié |
| `password authentication failed` | mot de passe de **base**, pas celui du **compte** Supabase — Project Settings → Database → *Reset database password* |
| Railway plante sur `connect ENETUNREACH 2a05:…` | `DATABASE_URL` pointe sur la connexion **directe** (IPv6). Prends le **Session pooler** (§1.4) |
| `{"code":502,"message":"Application failed to respond"}` | le conteneur a démarré puis a **crashé** — ouvre *Deploy Logs*, le message y est en clair |
| `self-signed certificate in certificate chain` sur Railway | il manque `DATABASE_CA` (le **contenu** du certificat Supabase), ou tu as mis `DATABASE_CA_FILE` avec un chemin qui n'existe pas dans le conteneur (§3.2) |
| 502 alors que les logs disent « en écoute sur le port N » | le domaine public route vers un **autre** port que `N`. Fixe `SYNC_PORT=8787` et pointe le domaine sur `8787` (§3.2, §3.4) |
| Le POS affiche « démo — mémoire » | build fait avec la mauvaise cible : `pnpm pos:build:web` |
| Écran de cuisine vide | la caisse n'est pas appairée, ou rien n'a encore été envoyé en cuisine |
| Le badge `⇅ n` ne redescend pas | API de sync injoignable : `curl .../sante` |
| Une opération « refusée » sur la caisse | règle métier, pas une panne. L'écran *Sync* dit laquelle |

**Le serveur de sync tombe ?** Rien d'urgent. Les caisses continuent
d'encaisser : elles écrivent en local et gardent tout dans leur outbox. Au
retour, elles rattrapent seules. C'est exactement ce que vérifie le banc à
trois appareils.

---

## 10. Ce qui viendra après, dans cet ordre

1. **Imprimante** — un drapeau à basculer, le code est déjà là (§2, §7).
2. **Recettes** — décomposer le coût d'un plat en ingrédients (§3).
3. **Écran de cuisine hors ligne** — aujourd'hui la cuisine lit le
   back-office, donc le réseau. Le porter dans le POS lui-même le rendrait
   indépendant d'Internet, comme la caisse.
4. **Comptes en libre-service** — aujourd'hui, donner un accès au back-office
   passe par `pnpm sync:acces` sur le poste de l'exploitant. Acceptable pour
   un restaurant, à automatiser quand il y en aura vingt.
