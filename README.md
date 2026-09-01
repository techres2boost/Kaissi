# Kaissi

**POS et gestion de restaurant offline-first** pour le marché tunisien — Res2Boost.

> La caisse ne doit **jamais** s'arrêter. Un restaurant qui ne peut pas encaisser
> désinstalle le logiciel le soir même et le dit à tous ses confrères.

État : **MVP prêt à partir en production.** Plusieurs terminaux encaissent en
parallèle, hors ligne, et se réconcilient sans perdre ni dupliquer une vente.
Le gérant administre sa carte et ses employés depuis un navigateur, la cuisine
lit ses commandes sur un écran, et le ticket s'affiche à l'encaissement.

> **L'impression est éteinte dans ce périmètre**, et rien n'a été supprimé :
> c'est un drapeau de build. Le pourquoi, et comment la rallumer, sont dans
> **[`docs/mvp.md`](docs/mvp.md)**.

---

## 👉 Par où commencer

**Tu veux mettre le MVP en production ?** →
**[`docs/mvp.md`](docs/mvp.md)** : le périmètre, les commandes, le
déploiement, en un seul document court.

**Tu n'as encore rien lancé ?** Va directement à
**[`docs/decouverte.md`](docs/decouverte.md)**.

C'est un parcours en cinq étapes qui te fait *voir* le produit fonctionner,
dans un ordre où chaque étape ne demande que ce que la précédente a installé.
Chaque étape dit la commande, ce que tu dois voir, et ce que ça prouve.

```bash
pnpm install
pnpm test:rapide     # étape 1 — 225 tests, aucune installation supplémentaire
pnpm pos:dev         # étape 2 — le POS dans ton navigateur
```

Les étapes 1 à 4 se font entièrement sur ton poste : **ni Android, ni Supabase,
ni imprimante**. L'étape 5 est le back-office, l'étape 6 la tablette réelle en
mode avion — le seul test qui compte vraiment.

---

## Documentation

| Document | Pour |
|---|---|
| **[`docs/mvp.md`](docs/mvp.md)** | **Le périmètre livré** — ce qui est dedans, ce qui est éteint, comment déployer |
| **[`docs/demo.md`](docs/demo.md)** | **Démonstration de bout en bout** — un service joué en 30 min qui remplit tous les écrans |
| **[`docs/gestion.md`](docs/gestion.md)** | **Ventes, coûts, marges et stock** — les écrans de gestion et leur protocole de test |
| **[`docs/decouverte.md`](docs/decouverte.md)** | **Commencer ici** — voir le produit tourner en cinq étapes |
| [`docs/fonctionnel.md`](docs/fonctionnel.md) | **Comprendre** chaque module et pourquoi il est ainsi |
| [`docs/tester.md`](docs/tester.md) | **Tester** en détail — de l'automatique à la tablette |
| [`docs/deploiement.md`](docs/deploiement.md) | **Déployer** — Supabase, Railway, Vercel, APK Android |
| [`docs/tester-sans-tablette.md`](docs/tester-sans-tablette.md) | **Tester Android et l'impression sans matériel** — émulateur + imprimante virtuelle |
| [`docs/tester-mode-avion.md`](docs/tester-mode-avion.md) | Le critère de sortie : démarrer sans réseau |
| [`docs/architecture.md`](docs/architecture.md) | Les décisions structurantes, en version courte |
| [`CLAUDE.md`](CLAUDE.md) | Les huit règles absolues du dépôt |

---

## Commandes

| Commande | Ce qu'elle fait | Prérequis |
|---|---|---|
| `pnpm test:rapide` | 225 tests : domaine, schéma local, ESC/POS | aucun |
| `pnpm pos:dev` | Le POS dans le navigateur (base **en mémoire**) | aucun |
| `pnpm pos:build:web` | Le POS comme site statique (base **persistante**) | aucun |
| `pnpm sync:acces` | Donner à un compte l'accès au back-office | `DATABASE_URL` |
| `pnpm persistance` | La caisse web survit-elle à un rechargement ? | `preview:web` lancé |
| `pnpm parcours` | Rejoue une journée de service dans Chromium | `pnpm pos:dev` lancé |
| `pnpm imprimante` | Imprimante ESC/POS virtuelle sur le port 9100 | aucun |
| `pnpm sync:dev` | L'API de synchronisation, en local | `DATABASE_URL` |
| `pnpm db:test` | PostgreSQL jetable + schéma de production appliqué | Docker **ou** PostgreSQL |
| `pnpm test` | **Tout**, synchronisation comprise | `pnpm db:test` d'abord |
| `pnpm typecheck` | Types de tout le monorepo | aucun |
| `pnpm verifier:avion` | Le bundle ne dépend d'aucune ressource distante | aucun |
| `pnpm verifier:natif` | Le plugin Java d'impression compile | JDK 21 |
| `pnpm pos:android` | Build + installation sur une tablette branchée | Android Studio |
| `pnpm backoffice:dev` | Le back-office Next.js | un projet Supabase |

> `pnpm test` inclut la synchronisation, qui exige un vrai PostgreSQL. Sans
> base, elle s'arrête sur un message qui dit quoi faire — pas sur trente-cinq
> échecs identiques. Pour la boucle de développement courante :
> `pnpm test:rapide`.

### Codes PIN de démonstration

| Employé | Rôle | PIN | Plafond de remise |
|---|---|---|---|
| Ahmed Ben Salah | gérant | `1357` | sans limite |
| Salma Trabelsi | caissier | `2468` | 10 % |
| Karim Jelassi | serveur | `9753` | 5 % |

**À changer avant toute mise en service réelle.**

---

## Ce qui fonctionne aujourd'hui

| Brique | État |
|---|---|
| `packages/domain` — monnaie, TVA, remises, permissions, shift, PIN, audit | ✅ 154 tests |
| `packages/db-local` — SQLite miroir, migrations, projections, outbox | ✅ 45 tests |
| `packages/printing` — ESC/POS : ticket, KOT, rapport de caisse | ✅ 26 tests |
| `apps/sync` — protocole, idempotence, RLS, reprojection serveur | ✅ 57 tests |
| Schéma Postgres + RLS + audit chaîné | ✅ 30 tables, **toutes sous RLS**, 70 politiques, 0 alerte de sécurité |
| **Démarrage et vente en mode avion** | ✅ vérifié en CI |
| **Prise de poste par PIN**, hors ligne (Argon2id) | ✅ |
| **Shift** — fond, mouvements d'espèces, clôture avec écart signé | ✅ |
| **Commande** — tables, variantes, modificateurs, notes | ✅ |
| **Remises** avec plafond par rôle et escalade manager | ✅ |
| **Cuisine** — KOT par station, jamais réimprimé | ✅ |
| **Encaissement** — espèces, carte, mixte, monnaie rendue | ✅ |
| **Synchronisation multi-appareils** avec coupures réseau | ✅ banc à 3 appareils |
| **Appairage** par jeton révocable | ✅ |
| Plugin natif Android d'impression TCP 9100 | ⚠️ compile et vérifié en CI, **jamais testé sur imprimante réelle** |
| **Back-office** — journée, catalogue, employés | ✅ 32 tests |
| **Rapport de journée** — CA, TVA par taux, encaissements, écarts de caisse | ✅ |
| **Catalogue** — produits, prix, TVA, stations, disponibilité | ✅ |
| **Employés** — rôles, PIN Argon2id, suspension | ✅ |
| **Embauche d'un employé** — nom, rôle, PIN, sans compte de connexion | ✅ |
| Variantes et modificateurs au back-office | ⏳ Phase 1 bis |
| KDS, stock, CRM | ⏳ Phases 3 à 6 |

### Le jalon de la Phase 2 est tenu

Le dossier d'architecture fixait la règle à l'avance :

> Si, à la fin de la Phase 2, la synchronisation n'est pas fiable en test avec
> trois appareils et des coupures réseau simulées, on bascule sur PowerSync
> sans débat.

Le banc passe — aucune vente perdue, aucune dupliquée, totaux identiques au
millime près. **On garde le moteur maison.** PowerSync reste la porte de sortie
si le passage à l'échelle révélait autre chose.

---

## Ce que la CI vérifie à chaque commit

Huit jobs, dont quatre sont des **gardes** plutôt que des tests : ils ne
vérifient pas que le code marche, ils vérifient qu'une règle absolue n'a pas
été contournée.

| Job | Ce qu'il empêche |
|---|---|
| `domaine` | Une régression dans les calculs monétaires |
| `types` | Qu'un contrat entre paquets se rompe sans que personne ne le voie |
| `mode-avion` | Qu'une dépendance réseau se glisse dans le bundle du POS |
| `plugin-natif` | Qu'une faute de signature Java dorme jusqu'au prochain build Gradle |
| `back-office` | Un lien mort, ou une colonne renommée sans mettre à jour `schema.ts` |
| `parcours-caisse` | Qu'une journée de service cesse de tenir debout |
| `synchronisation` | Une vente perdue ou dupliquée sous coupure réseau |
| `regles-absolues` | `server.url`, flottant pour de l'argent, colonne monétaire sans `_millimes`, journal devenu modifiable, PIN en clair, **clé `service_role` dans le code** |

---

## Structure

```
apps/pos          Terminal de caisse — Vite + React → Capacitor Android
apps/backoffice   Back-office — Next.js → Vercel
apps/sync         API de synchronisation — Hono sur Node

packages/domain       ⚑ calculs monétaires et machines d'état. Zéro I/O.
packages/db-local     schéma SQLite + migrations locales
packages/sync-client  outbox, curseurs, retentatives
packages/printing     rendu ESC/POS
packages/ui           jetons de style partagés

supabase/migrations   schéma Postgres, RLS, fonctions
scripts/              outillage local (PostgreSQL jetable)
docs/                 découverte, fonctionnel, test, déploiement
```

---

## Conventions

Elles sont dans [`CLAUDE.md`](CLAUDE.md) et **ne se contournent pas
silencieusement**. Les cinq à connaître avant d'écrire une ligne :

1. **Argent** en entiers de millimes (le TND a 3 décimales), jamais de flottant.
2. **UUIDv7 côté client** pour toute entité créable hors ligne.
3. **`organization_id` + `restaurant_id`** sur chaque table.
4. **Curseur de sync** = bigserial serveur, jamais un timestamp.
5. **Le POS est empaqueté** — jamais de `server.url` Capacitor.

---

## Base de données

Le schéma est appliqué sur le projet Supabase `POS System`
(`mzrbpbqpkpbbndtijipw`, région `eu-central-1`, PostgreSQL 17).

Tout vit dans le schéma `kaissi` ; `public` reste vide, donc rien n'est exposé
par PostgREST sans décision explicite. Les **30 tables** ont RLS activée **et**
forcée.

Le même schéma s'applique **tel quel** sur un PostgreSQL nu (`pnpm db:test`) :
c'est ce qui permet aux tests d'intégration d'exercer le SQL de production, et
non une simulation.
