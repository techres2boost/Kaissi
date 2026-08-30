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
| 👨‍🍳 Cuisine (« commandes à préparer ») | back-office `/‹resto›/cuisine` | **fait** |
| 🧾 Ticket | affiché à l'écran du POS | **fait** |
| 📈 Administration (journée, clôture, employés) | back-office | **fait** |
| 📊 Stock | — | **hors MVP**, voir §3 |

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
VITE_IMPRESSION=1 pnpm pos:build       # APK
VITE_IMPRESSION=1 pnpm pos:build:web   # web
```

Rien d'autre. L'écran Diagnostic retrouve la configuration des imprimantes,
les tickets repartent en file, et l'écran de cuisine continue de fonctionner —
les deux ne s'excluent pas.

---

## 3. Ce qui n'est pas dans le MVP

**Le stock.** Il n'est sur le chemin critique d'aucune vente, et la règle du
dépôt dit déjà qu'il ne bloque jamais un encaissement (une donnée de stock
périmée ne doit pas empêcher de vendre une pizza). Le construire maintenant
retarderait la mise en production sans rien débloquer.

La place est réservée : `products.track_stock` existe déjà dans le schéma.

---

## 4. Les trois postes

| Poste | Application | Identité | Ce qu'il voit |
|---|---|---|---|
| **Caissier / serveur** | POS (tablette ou navigateur) | PIN à 4 chiffres, validé **hors ligne** | Salle, commande, encaissement, clôture |
| **Cuisine** | back-office, `/‹resto›/cuisine` | compte e-mail, rôle `cuisine` | Uniquement les commandes à préparer — aucun montant |
| **Gérant / admin** | back-office | compte e-mail, rôle `gerant` ou `admin` | Journée, catalogue, employés, cuisine |

Le rôle décide de la page d'arrivée : un cuisinier qui se connecte atterrit
sur l'écran de cuisine, pas sur un rapport financier qui ne le concerne pas.

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

## 6. Déployer

Quatre briques, indépendantes. Dans cet ordre : chacune est utile même si la
suivante n'est pas encore là.

### 6.1 Base — Supabase

Applique les migrations de `supabase/migrations/` dans l'ordre (SQL Editor,
ou `supabase db push`). Elles sont numérotées et ne se modifient jamais après
application.

Récupère ensuite, dans **Project Settings → Database → Connection string →
URI**, la version **Session pooler** (port 5432).

### 6.2 API de synchronisation — Railway

Sans elle, une caisse fonctionne, mais seule : le back-office ne voit rien, et
la cuisine non plus. C'est donc la première brique serveur.

1. **New Project → Deploy from GitHub repo** → ce dépôt. Railway lit
   `apps/sync/railway.json` et construit avec le Dockerfile : rien à saisir.
2. Variables :

   | Nom | Valeur |
   |---|---|
   | `DATABASE_URL` | la chaîne du §6.1, avec `MOT2PASSE` laissé tel quel |
   | `DATABASE_PASSWORD` | le mot de passe de la base, **sans encodage** |
   | `SYNC_ORIGINES` | les URL du back-office **et du POS web**, séparées par des virgules |

3. **Settings → Networking → Generate Domain**, puis vérifie :

   ```bash
   curl https://TON-DOMAINE/sante     # {"etat":"ok","protocole":1,…}
   ```

> ⚠ **`SYNC_ORIGINES` doit contenir l'URL du POS web.** L'APK appelle par le
> réseau natif et ignore CORS ; un POS servi dans un navigateur, non. Oublier
> cette ligne donne un « Failed to fetch » qui ne dit pas d'où il vient.

### 6.3 Back-office — Vercel

| Réglage | Valeur |
|---|---|
| Root Directory | `apps/backoffice` |
| Framework | Next.js |
| Build Command | `cd ../.. && pnpm install --frozen-lockfile && pnpm --filter @kaissi/backoffice build` |

Variables : `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY`
(clé **publique**, jamais `service_role` — l'application refuse de démarrer
avec la mauvaise).

C'est ici que vivent l'administration **et l'écran de cuisine**.

### 6.4 POS — deux distributions, même code

**a) Web (le plus rapide — aucun outil Android)**

Un second projet Vercel, `Root Directory` = `apps/pos`. Le fichier
`apps/pos/vercel.json` porte déjà la commande de build, la réécriture SPA et
les en-têtes du service worker : il n'y a rien d'autre à régler.

```bash
pnpm pos:build:web       # pour construire en local
```

Ce que cette cible garantit : la caisse s'ouvre et encaisse **sans réseau**
une fois la page chargée une première fois (service worker), et les ventes
survivent au rechargement, à la fermeture de l'onglet et au redémarrage de la
machine (SQLite persisté dans IndexedDB). Vérifié par un test :

```bash
pnpm --filter @kaissi/pos preview:web   # dans un terminal
pnpm persistance                        # dans un autre
```

Ce qu'elle ne garantit pas : l'inviolabilité du stockage. Un navigateur peut
évincer les données d'une origine sous forte pression disque. L'application
demande le stockage persistant au démarrage et **dit à l'écran Diagnostic** si
le navigateur l'a refusé. Installer la page comme application (« Installer »
dans le navigateur) suffit généralement à l'obtenir.

**b) APK Android (la cible nominale)**

```bash
pnpm pos:build                                    # + contrôle du mode avion
pnpm --filter @kaissi/pos exec cap sync android
cd apps/pos/android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Son SQLite natif n'est évinçable par personne. Pour un restaurant qui tourne
tous les jours, c'est cette cible-là qu'il faut viser — la version web permet
de démarrer sans l'attendre. La signature pour distribution est décrite dans
[`deploiement.md` §4.3](deploiement.md).

### 6.5 Appairer un terminal

Sans appairage, la caisse fonctionne en local et ne remonte rien.

```bash
pnpm sync:appairer --restaurant <uuid-du-restaurant> --prefixe P1
```

Le jeton s'affiche **une seule fois**. Sur la tablette : bandeau du haut →
bouton **⇅ local** → saisir l'URL de l'API (§6.2) et le jeton. Le jeton est
vérifié avant d'être enregistré : un appairage annoncé réussi en est un.

---

## 7. Vérifier avant de livrer

```bash
pnpm test:rapide                        # domaine, schéma local, ESC/POS
pnpm typecheck                          # tout le monorepo
pnpm pos:build && pnpm pos:build:web    # les deux cibles + mode avion
pnpm db:test && pnpm --filter @kaissi/sync test && pnpm db:test:stop
```

Le dernier exige Docker ou un PostgreSQL local : il vérifie RLS, l'idempotence
et le banc à trois appareils contre une vraie base.

---

## 8. Ce qui viendra après, dans cet ordre

1. **Imprimante** — un drapeau à basculer, le code est déjà là (§2).
2. **Stock** — quantités par produit, seuil d'alerte, jamais bloquant (§3).
3. **Écran de cuisine hors ligne** — aujourd'hui la cuisine lit le
   back-office, donc le réseau. Le porter dans le POS lui-même le rendrait
   indépendant d'Internet, comme la caisse.
