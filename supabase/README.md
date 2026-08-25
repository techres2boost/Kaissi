# Schéma Postgres — Kaissi

Projet Supabase : **POS System** (`mzrbpbqpkpbbndtijipw`), `eu-central-1`,
PostgreSQL 17.6.

Tout vit dans le schéma **`kaissi`**. Le schéma `public` reste **vide** : rien
n'est exposé par PostgREST sans décision explicite.

---

## Migrations

| Fichier | Contenu |
|---|---|
| `0001_socle.sql` | Schéma `kaissi`, extensions, rôle `kaissi_device`, `uuid_v7()`, fonctions de contexte de sécurité, déclencheur d'immuabilité |
| `0002_tenance.sql` | `organizations`, `restaurants`, `users`, `memberships`, `devices` + fonctions d'accès RLS |
| `0003_taxes_et_catalogue.sql` | `tax_rates`, catalogue complet, salle, `payment_methods` + **générateurs de politiques RLS** |
| `0004_commandes_et_evenements.sql` | `order_events` (append-only), projections `orders`/`order_items`, paiements, shifts |
| `0005_sync.sql` | `change_log` (curseur), `sync_mutations` (idempotence), `sync_cursors` |
| `0006_audit.sql` | `audit_events` chaîné par hash + vérificateur d'intégrité |
| `0007_donnees_demonstration.sql` | Établissement fictif « Snack Lac 1 » |
| `0008_durcissement_fonctions.sql` | `search_path` figé sur toutes les fonctions |

**29 tables, 65 politiques RLS, 81 index.** Aucune table sans RLS — activée
*et* forcée partout.

---

## Les garanties, et comment les vérifier

### Immuabilité (RÈGLE 6)

```sql
-- Doit échouer avec insufficient_privilege
update kaissi.order_events set type = 'order.cancelled' where event_id = '…';
delete from kaissi.audit_events where id = '…';
```

Le `REVOKE` **et** un déclencheur : le REVOKE seul ne protège pas du
propriétaire de la table.

### Idempotence (RÈGLE 5)

```sql
-- Le même event_id inséré cinq fois ne produit qu'une ligne
insert into kaissi.order_events (event_id, …) values ('…', …)
on conflict (event_id) do nothing;
```

### Intégrité du journal d'audit

```sql
select * from kaissi.verifie_chaine_audit('<restaurant_id>');
-- → { valide: true, probleme: 'Journal intègre.' }
```

Modifier ou supprimer une ligne casse la chaîne et rend `valide = false` avec
la position de la rupture.

### Aucune table sans RLS

```sql
select c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'kaissi' and c.relkind = 'r' and not c.relrowsecurity;
-- → doit renvoyer 0 ligne
```

---

## Contexte de sécurité

Deux chemins d'authentification, jamais confondus :

**Humain** — Supabase Auth, rôle `authenticated`. `auth.uid()` → `memberships`
→ accès aux établissements où l'appartenance est active.

**Appareil** — rôle `kaissi_device`. L'API de synchronisation ouvre sa
transaction ainsi :

```sql
begin;
set local role kaissi_device;
select set_config('kaissi.device_id',       '<uuid>', true);
select set_config('kaissi.restaurant_id',   '<uuid>', true);
select set_config('kaissi.organization_id', '<uuid>', true);
-- … le travail, entièrement soumis à RLS …
commit;
```

Les fonctions `kaissi.acces_restaurant()`, `kaissi.acces_organisation()` et
`kaissi.est_gestionnaire()` lisent ce contexte. Elles sont `SECURITY DEFINER`
avec `search_path = ''` — indispensable pour que la politique de `memberships`
puisse interroger `memberships` sans récursion.

> **Un appareil ne modifie jamais le référentiel.** Il le reçoit par le pull de
> synchronisation. L'écriture du catalogue est réservée aux rôles `admin` et
> `gerant`.

---

## Ajouter une table

1. `organization_id` **et** `restaurant_id`, tous deux `not null`.
2. Montants en `bigint`, colonne suffixée `_millimes`, `check (… >= 0)` sauf
   remboursements, écarts de caisse et ajustements de stock.
3. Taux en `integer` de points de base. **Jamais** de `real`, `float` ou
   `double precision` — la CI le vérifie.
4. Clé primaire `uuid` **sans `default`** si l'entité est créable hors ligne :
   l'appareil fournit son UUIDv7.
5. RLS dans **la même migration** :

```sql
-- Référentiel : lecture pour membres et appareils, écriture pour l'encadrement.
select kaissi.protege_referentiel('ma_table');

-- Transactionnel : l'appareil peut aussi INSÉRER.
select kaissi.protege_transactionnel('ma_table');
```

6. Si la table est du référentiel, ajouter son déclencheur `change_log` pour
   qu'elle soit synchronisée vers les appareils :

```sql
create trigger ma_table_change_log
  after insert or update or delete on kaissi.ma_table
  for each row execute function kaissi.journalise_changement();
```

---

## Ce qui viendra plus tard

Volontairement absent de la Phase 0, mais le modèle est conçu pour l'accueillir
sans migration douloureuse :

- **stock et recettes** (`ingredients`, `recipes`, `inventory_movements`
  append-only) — Phase 4 ;
- **achats** (`suppliers`, `purchase_orders`, `goods_receipts`) — Phase 4 ;
- **CRM et fidélité** (`customers` au niveau **organisation**, pour la fidélité
  inter-restaurants) — Phase 6 ;
- **rollups** (`daily_sales_by_product`, `daily_sales_by_employee`) — dès
  ~100 restaurants, pour que les rapports ne touchent plus les tables
  transactionnelles ;
- **partitionnement mensuel** de `order_events` et `audit_events` — les clés
  sont déjà conçues pour que ce soit possible sans réécriture.
