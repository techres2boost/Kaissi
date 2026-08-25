## Ce que fait cette PR

<!-- En une ou deux phrases, en français. -->

## Phase concernée

<!-- Phase 0 Fondations · 1 MVP caisse · 2 Sync · 3 Cuisine · 4 Stock · 5 Multi-établissement · 6 CRM -->

## Règles absolues — à cocher avant de demander une relecture

- [ ] **Argent** : tout montant est un entier de millimes, colonne suffixée `_millimes`. Aucun flottant introduit.
- [ ] **Taux** : exprimés en points de base entiers (19 % = 1900).
- [ ] **Identifiants** : UUIDv7 générés côté client pour toute entité créable hors ligne. Aucun `serial` ajouté sur ces entités.
- [ ] **Tenance** : `organization_id` ET `restaurant_id` présents sur chaque nouvelle table.
- [ ] **RLS** : activée et testée sur chaque nouvelle table, dès la migration qui la crée.
- [ ] **Immuabilité** : rien n'autorise un UPDATE ou un DELETE sur `order_events` / `audit_events`.
- [ ] **Calculs** : aucune logique de total dupliquée hors de `packages/domain`.
- [ ] **Mode avion** : le POS démarre et affiche son menu sans réseau (`pnpm --filter @kaissi/pos build` passe la vérification).
- [ ] **Langue** : commentaires de code et libellés d'interface en français.

## Vérifications effectuées

- [ ] `pnpm test` passe
- [ ] `pnpm typecheck` passe
- [ ] Migrations appliquées et relues (`supabase/migrations/`)
- [ ] Testé sur un appareil réel, en mode avion (si le POS est touché)

## Points d'attention pour le relecteur

<!-- Décisions discutables, compromis assumés, ce que tu n'as pas fait et pourquoi. -->
