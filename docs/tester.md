# Tester Kaissi — les étapes exactes

Trois niveaux, du plus rapide au plus proche du réel. Fais-les dans l'ordre :
chacun élimine une classe de problèmes avant le suivant.

| Niveau | Durée | Ce que ça prouve |
|---|---|---|
| **A. Automatique** | 1 min | Les calculs, le protocole, les règles |
| **B. Navigateur** | 5 min | Le parcours de caisse tient debout |
| **C. Tablette + serveur** | 1 h | Ça marche pour de vrai |

---

## A. Tests automatiques

```bash
pnpm install
pnpm test        # 257 tests
pnpm typecheck
```

### Ce que couvre chaque suite

| Suite | Tests | Prouve |
|---|---|---|
| `@kaissi/domain` | 151 | Monnaie, TVA par taux, remises au prorata, permissions, shift, PIN, audit |
| `@kaissi/db-local` | 45 | Migrations, projections, outbox, immuabilité locale |
| `@kaissi/printing` | 26 | Rendu ESC/POS des trois tickets |
| `@kaissi/sync` | 35 | Protocole, idempotence, RLS, **banc à trois appareils** |

### Le banc à trois appareils

C'est le **jalon de décision de la Phase 2** : si ce test échoue, la règle
écrite à l'avance dit de basculer sur PowerSync.

```bash
# Il lui faut un vrai PostgreSQL. Une commande le prépare entièrement :
# base jetable (Docker si disponible, sinon cluster local), amorce Supabase,
# puis les migrations de PRODUCTION appliquées telles quelles.
pnpm db:test

pnpm --filter @kaissi/sync test

pnpm db:test:stop            # quand tu as fini
```

Si la base manque, les tests s'arrêtent sur **un** message qui dit quoi faire,
au lieu de trente-cinq échecs identiques dont la cause réelle est noyée à la
fin de la sortie.

<details>
<summary>Le faire à la main, si tu préfères contrôler chaque étape</summary>

```bash
initdb -D /tmp/pgkaissi -U postgres --auth=trust
pg_ctl -D /tmp/pgkaissi -o "-p 5433 -c listen_addresses=127.0.0.1" -l /tmp/pg.log start

export PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres
psql -f apps/sync/test/amorce-supabase.sql
for f in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -f "$f"; done
```

Sur Debian/Ubuntu, `initdb` et `pg_ctl` ne sont pas dans le `PATH` : ils sont
dans `/usr/lib/postgresql/16/bin`.
</details>

Il rejoue un service entier avec des coupures réseau — dont la pire : le
serveur écrit, la réponse se perd. Il vérifie trois propriétés dures :

1. **aucune vente perdue** ;
2. **aucune vente dupliquée** ;
3. **totaux identiques au millime** entre tablettes et serveur.

---

## B. Parcours de caisse dans un navigateur

```bash
# Terminal 1
pnpm --filter @kaissi/pos dev

# Terminal 2
pnpm --filter @kaissi/pos test:parcours
```

Il rejoue une journée : prise de poste, ouverture de caisse, commande sur
table, article à options, envoi en cuisine, remise sous plafond, remise
au-dessus du plafond avec escalade manager, encaissement, monnaie rendue,
table libérée. Il échoue s'il y a **la moindre erreur console**.

### À la main

Ouvre `http://localhost:5173`.

| Étape | À faire | À vérifier |
|---|---|---|
| 1 | Choisir *Salma Trabelsi*, PIN `2468` | La caisse se déverrouille |
| 2 | Fond de caisse `50` → Ouvrir | On arrive sur le plan de salle |
| 3 | Toucher la table 3 | La commande s'ouvre |
| 4 | Boissons → Coca-Cola | Ajouté en **un** clic |
| 5 | Plats → Pizza Margherita → Fromage | Le total tient compte du supplément |
| 6 | **Cuisine** | « 2 article(s) envoyé(s) — 2 bon(s) » |
| 7 | **Cuisine** à nouveau | « Tout est déjà parti » — jamais de doublon |
| 8 | Remise → 10 % | Appliquée directement |
| 9 | Remise → 50 % | **Demande le PIN d'un manager** (`1357`) |
| 10 | Encaisser → Espèces → suggestion supérieure | Monnaie rendue affichée |
| 11 | Encaisser et imprimer | Retour salle, table 3 **libre** |
| 12 | Bandeau → **🖨 3** | Trois tickets en attente (pas d'imprimante) |

> En navigateur, la base est **en mémoire** : tout est perdu au rechargement.
> C'est voulu. Le seul mode de production est l'APK.

---

## C. Sur une vraie tablette

Voir [`deploiement.md`](deploiement.md) pour les détails. En résumé :

### C.1 L'APK

```bash
pnpm --filter @kaissi/pos build
pnpm --filter @kaissi/pos exec cap sync android
cd apps/pos/android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### C.2 Le mode avion — le critère qui compte

```bash
# 1. MODE AVION ACTIVÉ sur la tablette
adb shell settings get global airplane_mode_on   # doit renvoyer 1

# 2. Tuer VRAIMENT l'application (pas le bouton Retour)
adb shell am force-stop tn.res2boost.kaissi

# 3. Rouvrir
adb shell monkey -p tn.res2boost.kaissi -c android.intent.category.LAUNCHER 1
```

**Succès** = l'app s'ouvre en moins de 2 s, bandeau « Hors ligne », 17
produits affichés, Diagnostic → « Mode avion : Réussi », Stockage → **natif**.

Si Stockage indique `memoire`, les ventes ne survivraient pas au redémarrage.

Procédure complète et table de diagnostic : [`tester-mode-avion.md`](tester-mode-avion.md).

### C.3 La persistance

```bash
# Mode avion toujours activé
# 1. Ajouter 3 produits, noter le compteur d'événements
adb shell am force-stop tn.res2boost.kaissi
# 2. Rouvrir → Diagnostic → « Opérations en attente » ≥ au compteur noté
```

Si le compteur est retombé à 0, la base n'est pas persistante.

### C.4 L'impression

⚠ **Jamais testé sur un appareil réel.** C'est le premier point à vérifier
sur le terrain.

```bash
# Vérifier que l'imprimante répond
nc -vz 192.168.1.50 9100

# Journal du plugin natif
adb logcat | grep -i "ImprimanteReseau\|Capacitor/Plugin"
```

Table de diagnostic : [`tester-mode-avion.md`](tester-mode-avion.md) §9.

### C.5 La synchronisation

```bash
# 1. Générer un jeton
export DATABASE_URL='postgresql://…'
node apps/sync/scripts/appairer.mjs \
  --restaurant 01930000-0000-7000-8000-000000000002 --prefixe P1

# 2. Sur la tablette : bandeau → ⇅ local → saisir URL + jeton
# 3. Encaisser une vente
# 4. Vérifier côté serveur
```

```sql
select ticket_number, total_millimes, status from kaissi.orders
order by opened_at desc limit 5;

select label, last_seen_at, retard_evenements from kaissi.etat_appareils;
```

### C.6 Le test à trois tablettes

Le vrai test terrain, à faire avant le premier client :

1. trois tablettes appairées, préfixes `P1` / `P2` / `P3` ;
2. les trois en **mode avion** ;
3. chacune ouvre une commande et encaisse ;
4. rallumer le réseau sur les trois **en même temps** ;
5. vérifier : aucune vente perdue, aucune dupliquée, et

```sql
select count(*), sum(total_millimes) from kaissi.orders where status='close';
-- doit correspondre EXACTEMENT à la somme des trois tablettes
```

---

## Vérifier les garanties en base

```sql
-- Aucune table sans RLS → 0 ligne
select c.relname from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='kaissi' and c.relkind='r' and not c.relrowsecurity;

-- Immuabilité → doit ÉCHOUER
update kaissi.order_events set type='order.cancelled'
where event_id = (select event_id from kaissi.order_events limit 1);

-- Intégrité du journal d'audit
select * from kaissi.verifie_chaine_audit('01930000-0000-7000-8000-000000000002');
```

---

## Ce que la CI vérifie à chaque PR

| Job | Contenu |
|---|---|
| Domaine | Calculs monétaires, schéma local, ESC/POS |
| Types | Tout le monorepo |
| Mode avion | Build + aucune dépendance réseau dans le bundle |
| Plugin natif | `ImprimanteReseau.java` compile, annotations Capacitor présentes dans le bytecode |
| Parcours de caisse | Journée complète dans Chromium |
| Synchronisation | 35 tests contre un vrai PostgreSQL |
| Règles absolues | Pas de `server.url`, pas de flottant, `_millimes`, journaux append-only, PIN jamais en clair |
