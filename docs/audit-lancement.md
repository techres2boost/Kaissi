# Audit technique de lancement — 11 au 13 novembre 2026

**Question** : Kaissi est-il prêt pour une mise en production et une
commercialisation ? **Règle suivie** : aucun test n'est déclaré passé sans
avoir été exécuté ; aucun échec n'est masqué. Tout ce qui suit a été lancé
sur une base PostgreSQL 16 recréée de zéro à partir des 49 migrations de
production.

---

## Verdict

**Techniquement : oui, pour un lancement encadré.** Le chemin de chaque
vente a tenu sous 1 000 caisses simultanées, sous un service tué net en
pleine charge, sous un redémarrage brutal de PostgreSQL et sous un réseau qui
coupe les requêtes au milieu. Aucune vente perdue, aucune doublée, totaux au
millime dans **tous** les scénarios.

**Deux défauts réels ont été trouvés et corrigés pendant l'audit** (§3) — dont
un qui aurait fait tomber le service à chaque maintenance de Supabase.

**Ce qui empêche encore une vente OUVERTE n'est pas technique** :
l'homologation NACEF ([`conformite-fiscale.md`](conformite-fiscale.md)), et
les points d'exploitation du §6.

---

## 1. Tests fonctionnels et de non-régression

| Suite | Résultat |
|---|---|
| Domaine (monnaie, TVA, remises, réduction d'événements) | **239 / 239** |
| Base locale (migrations SQLite, outbox, immuabilité) | **136 / 136** |
| Impression ESC/POS | **42 / 42** |
| Client de synchronisation | **6 / 6** |
| Back-office | **167 / 167** |
| Traductions arabes | **11 / 11** |
| Caisse (unitaires) | **82 / 82** |
| Synchronisation, contre un vrai PostgreSQL | **433 / 433** |
| Back-office à 390 et 320 px, français et arabe | **55 + 55** |
| **Total automatique** | **1 171 tests, 0 échec** |

Parcours complets dans un navigateur (Chromium), sur la caisse réelle :

| Parcours | Étapes | Résultat |
|---|---|---|
| Journée de service (poste, caisse, commande, cuisine, remise escaladée, encaissement, clôture) | 26 | ✅ |
| Largeur téléphone 390 / 320 px, FR + AR | 69 | ✅ |
| Carte tenue depuis la caisse | 10 | ✅ |
| Remboursement sous PIN gérant | 12 | ✅ |
| Gestes de commande (libérer, changer de table, prix libre, annuler) | 10 | ✅ |
| Suppression de compte | 8 | ✅ |
| Inscription depuis la caisse (cible web) | 6 | ✅ |
| **Mise en service — refus serveur visible** | 5 | ❌ puis ✅ |
| **Première mise en service d'une caisse déjà utilisée** | 7 | ❌ puis ✅ |
| **Cible web : survie à un rechargement** | 7 | ❌ puis ✅ |

**Trouvaille.** Les trois derniers parcours **échouaient depuis des
semaines** sans que personne le sache : ils dataient d'avant l'écran
d'accueil et ne tournaient **pas en CI**. Le produit n'était pas en cause
(une fois remis à jour, ils passent) — mais trois garanties n'étaient plus
vérifiées. Ils sont remis à jour **et ajoutés à la CI**. Un test qui ne
tourne nulle part ne protège rien.

Contrôles statiques : typecheck ✅, lint 0 erreur (55 avertissements de
style), audit de dépendances : 0 avis élevé ou critique, 3 modérés non
exploitables (§4).

---

## 2. Charge et performance — service en processus séparé

Nouveau banc : `apps/sync/test/audit-lancement.test.ts`. Contrairement aux
bancs précédents, le service y est lancé **par la commande de production**,
dans un processus à part, et une sonde lit `/proc` et `pg_stat_*` deux fois
par seconde : on mesure le CPU et la mémoire **du service**, pas du
générateur de charge.

```bash
KAISSI_AUDIT=1 pnpm --filter @kaissi/sync exec vitest run test/audit-lancement.test.ts --silent=false
```

### Résultats (pool de 10 connexions, 4 cœurs, une seule machine)

| Scénario | Caisses | Commandes | Durée | Débit | Push p50 | Push p95 | 5xx | Perdues / doublées |
|---|---|---|---|---|---|---|---|---|
| **H1** — 1 000 commandes à la même seconde, **un seul** établissement | 1 000 | 1 000 | 76 s | 13 cmd/s | 2,9 s | 6,0 s | 0 | **0 / 0** |
| **H2** — 1 000 commandes à la même seconde, 250 établissements × 4 caisses | 1 000 | 1 000 | **7,9 s** | **127 cmd/s** | 5,9 s | 6,3 s | 0 | **0 / 0** |
| **H3** — 1 000 caisses **en ligne**, 5 ventes chacune geste par geste, 20 gérants sur le tableau de bord | 1 000 | 5 000 | 101 s | 49 cmd/s · 405 req/s | 3,7 s | 4,4 s | 0 | **0 / 0** |
| **H4** — endurance 3 min, 100 caisses en continu | 100 | 9 262 | 181 s | 51 cmd/s | 309 ms | 374 ms | 0 | **0 / 0** |

### Ressources mesurées

| Scénario | CPU service moy / max | RAM service | CPU PostgreSQL moy / max | Transactions/s max | Rapport gérant p95 |
|---|---|---|---|---|---|
| H1 | 28 % / 162 % | 980 Mo | 107 % / 290 % | 5 975 | — |
| H2 | 55 % / 102 % | 1 034 Mo | 204 % / 288 % | 9 384 | — |
| H3 | 63 % / 108 % | 1 240 Mo | 205 % / 300 % | 9 403 | **26 ms** |
| H4 | 64 % / 82 % | 831 → **831 Mo** | 205 % / 239 % | 6 609 | — |

(100 % = un cœur plein.)

### Lecture

- **Le goulot est PostgreSQL, pas le service.** Le service ne dépasse
  jamais un cœur et demi ; la base tourne à 2 à 3 cœurs. C'est la forme
  saine : le code ne gaspille pas, la base fait le travail.
- **La forme de la charge compte plus que son volume.** Mille commandes
  dans **un** restaurant (H1) prennent 76 s ; les mêmes réparties sur 250
  restaurants (H2) prennent **8 s**. Le verrou de numérotation est par
  établissement : c'est voulu (curseur sans trou, migration 0043), et la
  production a la forme de H2. Dans H1, 4 000 requêtes ont dépassé le délai
  de 15 s de la caisse, qui a réessayé — **et tout est arrivé, une fois**.
  Mille caisses dans un seul restaurant n'existent pas.
- **Aucune fuite mémoire.** Trois minutes de charge soutenue : 831 Mo au
  début, 831 Mo à la fin, latence stable.
- **Les lectures du back-office ne gênent pas les encaissements** : 7 724
  rapports lus pendant H3, p95 à 26 ms.
- **La mémoire du service (~1 Go sous charge) est à surveiller** sur une
  petite instance Railway : c'est le tas de Node qui absorbe les lots en
  vol. À dimensionner à 2 Go minimum.

---

## 3. Résilience — les deux défauts trouvés, et corrigés

| Scénario | Commandes | Indisponibilité | Requêtes rejouées | Perdues / doublées | Verdict |
|---|---|---|---|---|---|
| **R1** — service tué (`kill -9`) **deux fois** en pleine charge, puis relancé | 800 | 2,0 s + 2,0 s | 600 | **0 / 0** | ✅ tient |
| **R2** — PostgreSQL redémarré **brutalement** (`-m immediate`) en pleine charge | 800 | 0,4 s | 97 | **0 / 0** | ❌ puis ✅ |
| **R3** — chaque requête coupée à 12 ms : la réponse se perd, la caisse renvoie | 600 | — | 7 179 | **0 / 0** | ✅ tient |

### Défaut n° 1 — le service MOURAIT quand PostgreSQL coupait une connexion 🔴

**Constat.** Au premier passage de R2, le service s'est arrêté net :
`Unhandled 'error' event`. Quand le serveur de base coupe une connexion,
la bibliothèque `pg` émet l'erreur sur le pool — et un événement `error`
sans écouteur **fait tomber Node**.

**Pourquoi c'est grave.** Ce n'est pas un cas d'école : **Supabase coupe les
connexions à chaque maintenance**, chaque bascule de son pooler, chaque
redémarrage de la base. À chaque fois, le service entier serait tombé,
requêtes en cours comprises, jusqu'à ce que Railway le relance.

**Second passage, second chemin.** Une fois le pool protégé, le même
scénario a trouvé le cas d'une connexion **en cours d'usage** — l'erreur
part alors sur la connexion elle-même, toujours sans écouteur.

**Correction** (`apps/sync/src/depot-postgres.ts`) : un écouteur sur le pool
**et** sur chaque connexion à sa création. La requête en cours échoue
normalement, la caisse réessaie, l'idempotence fait le reste. **Rejoué :
service resté debout, 0 vente perdue.**

### Défaut n° 2 — la taille du pool n'était pas réglable 🟠

Sous mille envois simultanés, presque tout le temps de réponse est de
l'**attente d'une connexion** : ni le service ni la base ne sont à bout,
c'est la file devant le pool qui s'allonge. Cette taille était écrite en
dur à 10. Elle se règle désormais par **`SYNC_POOL_MAX`** (1 à 100, 10 par
défaut ; une valeur illisible retombe sur 10). ⚠ Ne pas dépasser ce que
l'offre Supabase accorde en connexions.

---

## 4. Sécurité

Exécuté (suite `securite`, `rls-*`, `limitation-debit`, `cors`,
`suppression-compte` — toutes vertes) :

| Contrôle | Résultat |
|---|---|
| Requêtes énormes sans jeton (2 Mo) | refusées avant lecture (413) |
| Injection SQL dans les champs libres | stockée comme du texte, base intacte |
| Identifiants non-UUID, paramètres de pull hostiles | refusés, jamais interpolés |
| Un jeton valide écrit / lit chez **un autre** restaurant | **refusé** |
| Une caisse signe au nom d'une autre caisse | **refusé** |
| Une exception interne fuit dans la réponse | non : message dans les journaux seulement |
| Jeton fabriqué, jeton révoqué | refusés (401 / 403) |
| RLS sur **toutes** les tables, forcée, avec politique | ✅ |
| Vues qui contourneraient RLS | aucune |
| Privilèges du rôle anonyme | **aucun** |
| Caisse : `update` / `delete` sur le référentiel | **aucun** |
| Bourrage d'identifiants | limité par IP **et** par compte (429 + Retry-After) |
| Clé `service_role` dans du code livré à un navigateur | aucune (garde de CI) |

**Revue statique** : une seule requête SQL du service construit un nom de
table par interpolation (`arbitrerReferences`) — les noms viennent d'une
**liste fixe du code**, jamais d'une entrée. Aucune autre. Côté back-office,
la recherche de clients échappe `% _ , ( ) \` avant le filtre PostgREST.
Aucun `dangerouslySetInnerHTML`, `eval` ni `new Function`.

**Dépendances** : 0 avis élevé ou critique. Restent 3 modérés, non
exploitables ici : `@hono/node-server` (`serveStatic`, jamais appelé — mais
c'est le serveur de production : montée 1.x → 2.x à faire dans son propre
changement), `minimatch` et `glob` (outils de développement).

**Non fait, et dit** : pas de test d'intrusion externe, pas d'analyse
dynamique (DAST) contre la production, pas d'audit des règles Supabase Auth
au-delà de l'avis « mot de passe compromis » (exige l'offre Pro).

---

## 5. Offline-first

Couvert par des tests **exécutés** :

- **Encaissement sans réseau** : le bundle de la caisse ne référence aucune
  URL distante (garde du mode avion, à chaque build) ; les parcours
  navigateur encaissent sans serveur.
- **Trois tablettes, coupures franches et aléatoires** : aucune vente perdue,
  aucune dupliquée, totaux identiques au millime
  (`banc-trois-appareils.test.ts`).
- **Reconnexion en tempête** : 1 000 caisses à la même seconde (H1, H2).
- **Accusé perdu** : 7 179 requêtes coupées puis renvoyées (R3) — zéro
  doublon. C'est la garantie « jamais de double encaissement ».
- **Conflits** : les ajouts concurrents commutent ; les champs conflictuels
  sont arbitrés par `(server_seq, device_id)`.
- **Survie de la caisse web à un rechargement** en plein service : poste,
  caisse ouverte et commande en cours conservés.

**Non couvert automatiquement** : une coupure sur une **vraie tablette**
Android ou iOS (le banc simule le protocole, il ne pilote pas l'appareil).
C'est le geste de démonstration — à refaire à chaque version publiée.

---

## 6. Risques et limites — ce que ces tests ne disent pas

1. **Une seule machine.** Service, base et charge partagent quatre cœurs,
   sans latence réseau. En production, Railway et Supabase ajoutent 20 à
   80 ms par aller-retour et partagent leurs machines. Ce qui se transpose :
   les invariants, le comportement en panne, les ordres de grandeur.
2. **Offre gratuite de Supabase.** 500 Mo — environ **7 à 14 Ko par vente**
   mesurés ici. Dix restaurants actifs la remplissent en un an. Passer en Pro
   est la première dépense ([`dossier-cto.md`](dossier-cto.md) E1).
3. **Mémoire du service** : ~1 Go sous forte charge. Instance Railway à
   **2 Go minimum**.
4. **Aucune alerte active** — ✅ corrigé le 13 novembre : centre de
   supervision livré (0050), incidents envoyés par webhook
   (`SYNC_ALERTES_WEBHOOK`), erreurs de la caisse et du back-office au même
   journal. Reste la sonde EXTERNE, à poser chez un tiers
   ([`deploiement.md`](deploiement.md) § 6 ter).
5. **Sauvegardes jamais restaurées.**

## 7. Recommandations, par ordre

| # | Action | Effort |
|---|---|---|
| 1 | Déployer ce lot : il corrige la mort du service à chaque maintenance Supabase | fait, à pousser |
| 2 | Instance Railway à 2 Go, `SYNC_POOL_MAX=20` après vérification du quota Supabase | 10 min |
| 3 | Supabase Pro (volume, sauvegardes, mots de passe compromis) | une décision |
| 4 | Sonde externe sur `/sante` (toutes les 5 min) + `SYNC_ALERTES_WEBHOOK` | 30 min — § 6 ter |
| 5 | Restaurer une sauvegarde pour de vrai | ½ journée |
| 6 | Supervision historique + incidents | ✅ fait (0050) |
| 7 | `@hono/node-server` 2.x, dans son propre changement testé | ½ journée |
