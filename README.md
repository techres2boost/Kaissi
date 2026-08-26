# Kaissi

**POS et gestion de restaurant offline-first** pour le marché tunisien — Res2Boost.

> La caisse ne doit **jamais** s'arrêter. Un restaurant qui ne peut pas encaisser
> désinstalle le logiciel le soir même et le dit à tous ses confrères.

État : **Phase 1 — MVP caisse**. Un terminal encaisse une journée complète,
entièrement hors ligne. La synchronisation multi-appareils est la Phase 2.

---

## Ce qui fonctionne aujourd'hui

| Brique | État |
|---|---|
| Monorepo pnpm + Turborepo | ✅ |
| `packages/domain` — monnaie, TVA, remises, événements, permissions, shift, PIN | ✅ 150 tests |
| Schéma Postgres + RLS + audit chaîné | ✅ 29 tables, appliqué sur Supabase |
| `packages/db-local` — SQLite miroir, migrations, projections, outbox | ✅ 45 tests |
| `packages/printing` — ESC/POS : ticket client, KOT, rapport de caisse | ✅ 26 tests |
| **Prise de poste par PIN**, validé hors ligne (Argon2id) | ✅ |
| **Shift** — fond de caisse, mouvements d'espèces, clôture avec écart | ✅ |
| **Prise de commande** — tables, variantes, modificateurs, notes | ✅ |
| **Remises** avec plafond par rôle et escalade manager | ✅ |
| **Envoi en cuisine** — KOT par station, jamais réimprimé deux fois | ✅ |
| **Encaissement** — espèces, carte, paiement mixte, monnaie rendue | ✅ |
| **File d'impression** persistante, retentatives, badge d'échec | ✅ |
| Plugin natif Android d'impression TCP 9100 | ⚠️ écrit, **pas encore testé sur appareil** |
| Vérification automatique du mode avion en CI | ✅ |
| Parcours de caisse complet rejoué en CI dans un navigateur | ✅ |
| Moteur de synchronisation (push/pull) | ⏳ Phase 2 |
| Back-office (rapports, catalogue, appairage) | ⏳ Phase 1 bis |

---

## Démarrage rapide

```bash
pnpm install

pnpm test            # 221 tests : domaine, schéma local, ESC/POS
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
