# Charge et sécurité — ce qui a été mesuré, et comment le refaire

> « Si demain j'ai 100 commandes par heure, 100 clients dans une heure, et
> beaucoup de charge, est-ce que l'application tombe ? »

Réponse courte : **la caisse elle-même ne peut pas tomber pour une raison de
charge** — elle encaisse en local, sans réseau. Ce qui peut céder, c'est le
chemin de remontée (service de synchronisation + PostgreSQL). C'est lui qui
est testé ici, contre un vrai PostgreSQL et un vrai serveur HTTP.

```bash
pnpm db:test                                 # base jetable (voir CLAUDE.md)
pnpm --filter @kaissi/sync test:charge       # ~30 s, affiche le rapport
KAISSI_CHARGE=lourd pnpm --filter @kaissi/sync test:charge   # volumes × 5
pnpm --filter @kaissi/sync test -- securite  # l'audit de sécurité
```

Les deux fichiers (`apps/sync/test/charge.test.ts`, `securite.test.ts`)
tournent aussi en CI, à chaque push.

## Les scénarios de charge

Chacun vérifie les trois propriétés qui ne se négocient pas — **aucune vente
perdue, aucune dupliquée** (10 % des lots sont renvoyés, comme sur un réseau
qui hoquette), **totaux exacts au millime** caisse ↔ serveur — plus **zéro
erreur serveur**.

| Scénario | Ce qu'il simule |
|---|---|
| A — service accéléré | 100 clients, 100 commandes, 4 caisses ; chaque geste poussé comme le fait la caisse, un pull après chaque push. L'heure tient en ~4 s : la charge réelle est ~800 fois « 100 par heure ». |
| B — retour d'Internet | 20 caisses hors ligne pendant le coup de feu, 30 ventes chacune, qui se reconnectent **à la même seconde**. Le vrai pic d'un restaurant. |
| C — montée en charge | 1, 5, 10, 25 puis 50 caisses simultanées. |

### Résultats (17 octobre 2026, base locale, pool de 10 connexions)

| Scénario | Caisses | Commandes | Durée | Commandes/s | Push p50 | Push p95 | Erreurs |
|---|---|---|---|---|---|---|---|
| A — service accéléré | 4 | 100 | 4,4 s | 23 | 30 ms | 54 ms | 0 |
| B — retour d'Internet | 20 | 600 | 8 s | 75 | 2,6 s | 4,4 s | 0 |
| C — 10 caisses | 10 | 40 | 1,3 s | 31 | 64 ms | 99 ms | 0 |
| C — 50 caisses | 50 | 200 | 8,2 s | 25 | 347 ms | 510 ms | 0 |
| A × 5 | 4 | 500 | 20,6 s | 24 | 29 ms | 45 ms | 0 |
| B × 5 | 20 | 3 000 | 76 s | 40 | 5,4 s | 11,6 s | 0 |

**Lecture.** Le service absorbe 25 à 75 commandes **par seconde** : 100 par
heure, c'est 0,03 par seconde. La marge est de trois ordres de grandeur.

Le seul point qui se tend est B × 5 : 3 000 ventes rattrapées d'un coup par
vingt caisses **du même établissement**. Leurs envois se rangent derrière le
verrou de numérotation de l'établissement (migration 0043, qui garantit un
curseur sans trou), et le p95 monte à 11,6 s — sous le délai de 15 s de la
caisse, qui de toute façon réessaierait sans rien perdre. Vingt caisses dans
un seul restaurant est un cas d'école.

> ⚠ **Ce que ces chiffres ne disent pas.** La base est locale : aucune
> latence réseau, aucune voisine. Supabase + Railway ajoutent 20 à 80 ms par
> aller-retour et partagent leurs machines — les latences de production
> seront plus hautes. Ce qui se transpose, c'est l'absence d'erreur, de perte
> et de doublon sous concurrence, et la forme de la courbe. La vérité de
> production se lit dans l'écran **Surveillance** (`docs/deploiement.md` § 6).

## 1000 commandes par heure, et le stress jusqu'à la rupture

> « Fais des tests comme si on avait 1000 commandes par heure, et des stress
> tests. »

```bash
pnpm --filter @kaissi/sync exec vitest run test/stress.test.ts --silent=false
KAISSI_STRESS=1 pnpm --filter @kaissi/sync exec vitest run test/stress.test.ts --silent=false   # jusqu'à 400 caisses
```

`apps/sync/test/stress.test.ts`, même banc que la charge
(`test/banc-charge.ts` : la caisse simulée parle le protocole du POS). En
stress, elle se comporte comme la VRAIE caisse : délai de 15 s, outbox
intacte sur une erreur, nouvel essai. Au-delà de la limite, des requêtes
peuvent échouer ; ce qui ne se négocie jamais, même là : **aucune vente
perdue, aucune dupliquée, totaux au millime** — vérifié à chaque palier.

### Résultats (19 octobre 2026, base locale, pool de 10 connexions)

| Scénario | Caisses | Commandes | Durée | Push p50 | Push p95 | Erreurs 5xx | Sans réponse (15 s) |
|---|---|---|---|---|---|---|---|
| **E — 1000 commandes, UN établissement**, 5 gérants sur le tableau de bord | 10 | 1 000 | 36,6 s | 76 ms | 101 ms | 0 | 0 |
| F — 25 caisses simultanées | 25 | 75 | 3,6 s | 201 ms | 377 ms | 0 | 0 |
| F — 50 caisses | 50 | 150 | 6,9 s | 375 ms | 656 ms | 0 | 0 |
| F — 100 caisses | 100 | 300 | 15,2 s | 851 ms | 1,4 s | 0 | 0 |
| F — 200 caisses | 200 | 600 | 38,2 s | 2,2 s | 3,4 s | 0 | 0 |
| F — 400 caisses | 400 | 1 200 | 84 s | 4,3 s | 6,8 s | 0 | 0 |
| G — tempête : 50 caisses × 20 ventes, même seconde | 50 | 1 000 | 17,5 à 18,4 s | 5,0 à 5,5 s | 11,7 à 15 s | 0 | 3 à 6 (deux passages) |
| G — tempête : 100 caisses × 20 ventes | 100 | 2 000 | 38,7 s | 10,2 s | 15 s | 0 | 102 |

**Lecture.**

- **1000 commandes par heure : 36 secondes de travail.** Le service absorbe
  donc environ **98 heures de pointe de ce volume en une heure**, dans le
  pire cas — un seul établissement, où toutes les caisses se rangent
  derrière le même verrou de numérotation (0043) — et pendant que cinq
  gérants rafraîchissent le tableau de bord toutes les 250 ms (p95 des
  rapports : 10 ms). Les lectures du back-office ne ralentissent pas les
  encaissements.
- **La montée en charge ne casse pas** : jusqu'à 400 caisses connectées
  ensemble, zéro erreur, et le p95 reste sous le délai de 15 s de la caisse.
  La latence croît linéairement avec le nombre de caisses : c'est la
  signature d'une file d'attente sur le pool (10 connexions), pas d'un
  effondrement.
- **Ce qui cède en premier, c'est la tempête** : cent caisses DU MÊME
  restaurant, chacune avec vingt ventes en retard, qui se reconnectent à la
  même seconde. Certaines requêtes dépassent les 15 s de la caisse, qui
  abandonne et réessaie — et la vague entière est quand même absorbée en
  39 s, **sans une vente perdue ni doublée**. Cent caisses dans un seul
  établissement n'existe pas ; la marge est dans ce chiffre.

**Ce que le stress a trouvé, et qui est corrigé.**

- Sous saturation, l'attente d'une connexion au pool rendait **500 « erreur
  inattendue »** — en rouge dans les journaux, « Erreur interne du serveur »
  sur l'écran de la caisse. Ce n'est pas une panne mais une file d'attente :
  le service rend désormais **503 `serveur_occupe`**, avec `Retry-After` et
  un message qui dit que les ventes sont conservées
  (`test/serveur-occupe.test.ts`).
- La recherche du jeton d'appareil, première requête de chaque appel,
  n'était dans aucun `try` : sous saturation, Hono rendait un 500 en texte
  brut que la caisse ne sait pas lire. Elle est protégée, et un `onError`
  global garantit qu'aucune route ne rend plus autre chose qu'une réponse du
  protocole.

**Si un jour la tempête devient réelle** (un établissement à quinze
caisses, une coupure d'une heure en plein service), le premier levier est le
pool : `max` au-delà de 10, dans la limite des connexions de l'offre
Supabase. Le second est le pooler de Supabase en mode transaction. Rien de
cela n'est nécessaire au volume d'aujourd'hui.

## Ce que les tests ont TROUVÉ — et qui est corrigé

1. **Interblocage du pool de connexions** (scénario C, palier 25 caisses).
   Pendant une reprojection, le service gardait sa connexion à la base et en
   demandait une seconde pour les alertes de stock. Dix envois simultanés —
   le pool en compte dix — et chacun attendait la connexion d'un autre :
   plus AUCUNE vente ne remontait, sans erreur, indéfiniment. Déclenchable en
   production par dix caisses qui se reconnectent ensemble. Corrigé
   (`depot-postgres.ts`), et le pool refuse désormais d'attendre plus de
   15 s une connexion : une prochaine erreur du même genre rendra un 500
   réessayable, pas un silence.

2. **Une vente « empoisonnée » gelait toute la caisse** (audit de sécurité).
   Une ligne portant un taux de TVA inconnu du serveur faisait échouer la
   reprojection du lot entier : 500, la caisse renvoyait le même lot, qui
   échouait encore — plus rien ne remontait de cette caisse, pour toujours.
   Désormais seule CETTE vente attend (elle est dans le journal, comptée
   « sans projection » par la Surveillance, reprise par le balayage de
   réparation) ; les autres passent. Aucun taux de repli n'est inventé : ce
   serait une règle fiscale.

3. **Requêtes géantes avant authentification** (audit de sécurité).
   `/appairage`, `/inscription` et `/admin/*` lisaient tout leur corps JSON
   avant de savoir qui appelait : quelques centaines de mégaoctets envoyés
   par n'importe qui auraient fait tomber le service de toutes les caisses.
   Plafond désormais : 1 Mo, et 5 Mo pour `/sync/*` (un lot plein pèse
   ~300 ko).

4. **Migration manquante = panne muette** (la panne de la démonstration).
   Voir `docs/deploiement.md` § 2.4.

## L'audit de sécurité — ce qui est vérifié

| Attaque | Attendu |
|---|---|
| Corps de 2 Mo sans jeton sur `/appairage`, `/inscription`, `/admin/*` | 413, avant lecture |
| SQL dans une désignation, HTML/JS dans une note | Stocké à la lettre, rien exécuté, tables intactes |
| Identifiant qui n'est pas un UUID | Refusé, jamais interpolé |
| Paramètres de pull hostiles | Ignorés sans erreur |
| Jeton valide qui écrit chez un autre restaurant | Rien d'accepté, rien d'inséré |
| Jeton valide qui lit chez un autre restaurant | Aucune ligne étrangère |
| Caisse qui signe au nom d'une autre caisse | Refusé |
| Exception interne avec chemin et secret | Réponse générique, rien ne fuit |
| Jetons fabriqués (vide, injection, 10 000 caractères, format plausible) | 401 |
| Jeton révoqué | 403 en push comme en pull |
| Écran Surveillance demandé par un client | 401 |

S'y ajoutent les gardes qui existaient déjà, chacune dans son fichier :
RLS sur toutes les tables (`rls-*.test.ts`), limitation de débit des
identifiants (`limitation-debit.test.ts`), CORS (`cors.test.ts`), et la CI
qui refuse la clé `service_role` hors du service de synchronisation.

**Ce qui n'est PAS couvert ici**, et relève d'un audit externe : les tests
d'intrusion sur l'infrastructure Supabase / Railway / Vercel, l'analyse des
APK et IPA publiés, et la revue des règles d'accès de la console Supabase.
