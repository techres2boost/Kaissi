# Kaissi

**POS et gestion de restaurant offline-first** pour le marché tunisien — Res2Boost.

> La caisse ne doit **jamais** s'arrêter. Un restaurant qui ne peut pas encaisser
> désinstalle le logiciel le soir même et le dit à tous ses confrères.

État : **Phase 2 — synchronisation**. Plusieurs terminaux encaissent en
parallèle, hors ligne, et se réconcilient sans perdre ni dupliquer une vente.

---

## Documentation

| Document | Pour |
|---|---|
| [`docs/fonctionnel.md`](docs/fonctionnel.md) | **Comprendre** chaque module et pourquoi il est ainsi |
| [`docs/tester.md`](docs/tester.md) | **Tester** — des tests automatiques à la tablette réelle |
| [`docs/deploiement.md`](docs/deploiement.md) | **Déployer** — Supabase, Railway, Vercel, APK Android |
| [`docs/tester-mode-avion.md`](docs/tester-mode-avion.md) | Le critère de sortie : démarrer sans réseau |
| [`docs/architecture.md`](docs/architecture.md) | Les décisions structurantes, en version courte |
| [`CLAUDE.md`](CLAUDE.md) | Les huit règles absolues du dépôt |

---

## Ce qui fonctionne aujourd'hui

| Brique | État |
|---|---|
| `packages/domain` — monnaie, TVA, remises, permissions, shift, PIN, audit | ✅ 151 tests |
| `packages/db-local` — SQLite miroir, migrations, projections, outbox | ✅ 45 tests |
| `packages/printing` — ESC/POS : ticket, KOT, rapport de caisse | ✅ 26 tests |
| `apps/sync` — protocole, idempotence, RLS, reprojection serveur | ✅ 35 tests |
| Schéma Postgres + RLS + audit chaîné | ✅ 32 tables, 0 alerte de sécurité |
| **Démarrage et vente en mode avion** | ✅ vérifié en CI |
| **Prise de poste par PIN**, hors ligne (Argon2id) | ✅ |
| **Shift** — fond, mouvements d'espèces, clôture avec écart | ✅ |
| **Commande** — tables, variantes, modificateurs, notes | ✅ |
| **Remises** avec plafond par rôle et escalade manager | ✅ |
| **Cuisine** — KOT par station, jamais réimprimé | ✅ |
| **Encaissement** — espèces, carte, mixte, monnaie rendue | ✅ |
| **Synchronisation multi-appareils** avec coupures réseau | ✅ banc à 3 appareils |
| **Appairage** par jeton révocable | ✅ |
| Plugin natif Android d'impression TCP 9100 | ⚠️ écrit, **jamais testé sur appareil** |
| Back-office (catalogue, employés, rapports) | ⏳ Phase 1 bis |
| KDS, stock, CRM | ⏳ Phases 3 à 6 |

### Le jalon de la Phase 2 est tenu

Le dossier d'architecture fixait la règle à l'avance :

> Si, à la fin de la Phase 2, la synchronisation n'est pas fiable en test avec
> trois appareils et des coupures réseau simulées, on bascule sur PowerSync
> sans débat.

Le banc passe — aucune vente perdue, aucune dupliquée, totaux identiques au
millime près. **On garde le moteur maison.**

---

## Démarrage rapide

```bash
pnpm install

pnpm test            # 257 tests : domaine, schéma local, ESC/POS
pnpm typecheck       # types de tout le monorepo
pnpm pos:dev         # POS dans le navigateur → http://localhost:5173

# Rejoue une journée de service complète dans un vrai navigateur
pnpm --filter @kaissi/pos test:parcours
```

En navigateur, la base est **en mémoire** : tout est perdu au rechargement.
C'est du confort de développement. Le seul mode de production est l'APK Android.

### Codes PIN de démonstration

| Employé | Rôle | PIN | Plafond de remise |
|---|---|---|---|
| Ahmed Ben Salah | gérant | `1357` | sans limite |
| Salma Trabelsi | caissier | `2468` | 10 % |
| Karim Jelassi | serveur | `9753` | 5 % |

**À changer avant toute mise en service réelle.**

---

## Tester le mode avion sur un appareil réel

C'est le **critère de sortie de la Phase 0**. Voir
[`docs/tester-mode-avion.md`](docs/tester-mode-avion.md) pour la procédure
complète. En résumé :

```bash
# 1. Prérequis : Android Studio + JDK 21, ANDROID_HOME renseigné
# 2. Construire le bundle et le copier dans le projet natif
pnpm --filter @kaissi/pos build
pnpm --filter @kaissi/pos exec cap sync android

# 3. Brancher la tablette (débogage USB activé) et installer
pnpm --filter @kaissi/pos exec cap run android

# 4. ACTIVER LE MODE AVION sur l'appareil
# 5. Tuer complètement l'application, puis la rouvrir
#    → elle doit démarrer et afficher les 17 produits du menu
# 6. Onglet « Diagnostic » → « Mode avion : Réussi »
```

Si l'application démarre avec l'avion activé, la Phase 0 est validée.

---

## Structure

```
apps/pos          Terminal de caisse — Vite + React → Capacitor Android
apps/backoffice   Back-office — Next.js → Vercel
apps/sync         API de synchronisation — Hono sur Node (Phase 2)

packages/domain       ⚑ calculs monétaires et machines d'état. Zéro I/O.
packages/db-local     schéma SQLite + migrations locales
packages/sync-client  outbox, curseurs, retentatives (Phase 2)
packages/printing     rendu ESC/POS
packages/ui           jetons de style partagés

supabase/migrations   schéma Postgres, RLS, fonctions
docs/                 architecture, procédures de test
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
par PostgREST sans décision explicite. Les 29 tables ont RLS activée **et**
forcée, avec 65 politiques.
