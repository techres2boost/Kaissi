# Kaissi — architecture, version courte

Résumé opérationnel de l'analyse préalable. Le dossier complet est le document
de référence ; celui-ci tient dans le dépôt pour qu'on n'ait pas à le chercher.

---

## En une phrase

Un monorepo avec deux applications : un **POS SPA (Vite + React) empaqueté dans
Capacitor**, Android d'abord, qui lit et écrit dans un **SQLite local** et ne
parle au réseau que via un **moteur de synchronisation** ; et un **back-office
Next.js** sur Vercel. Les deux pointent sur un **Postgres Supabase unique**,
multi-tenant, avec RLS. Les commandes sont synchronisées comme un **journal
d'événements append-only**, ce qui fait disparaître 90 % des conflits au lieu
de les résoudre.

---

## Les deux corrections structurantes

### 1. Le POS est empaqueté, pas chargé depuis une URL

Stampi et Box utilisent Capacitor avec `server.url` : la coque native charge le
site distant dans une WebView. Parfait pour une carte de fidélité. **Disqualifiant
pour un POS** : quand Internet tombe, la WebView n'a plus rien à charger et
l'application ne s'ouvre même pas.

On ne peut pas « ajouter une couche SQLite » par-dessus ce pattern : le problème
n'est pas la donnée, c'est que le code de l'application lui-même viendrait du
réseau.

Bubblewrap / TWA : même problème fatal, sans accès aux périphériques. Retiré du
plan.

### 2. Vite + React pour la caisse, Next.js pour le back-office

SSR, Server Components et Server Actions supposent tous un aller-retour serveur —
exactement ce qu'un POS ne peut pas se permettre, ni en latence ni en
disponibilité. Next.js reste excellent pour le back-office : rapports rendus côté
serveur, administration, invitations.

---

## Le modèle qui règle le problème de synchronisation

La plupart des projets POS échouent sur la synchronisation parce qu'ils
synchronisent des **lignes mutables** : deux appareils modifient la même ligne,
il faut arbitrer, on perd des données. La solution n'est pas un meilleur arbitre,
c'est de changer la modélisation.

Une commande n'est pas une ligne qu'on modifie. C'est une **suite d'événements
immuables**.

```
Tablette A ──► line.added {plat: "Pizza Margherita", qty: 1}
Tablette B ──► line.added {plat: "Coca 33cl", qty: 2}

Reconnexion → les DEUX événements sont appliqués.
Résultat : la commande contient les 3 articles. AUCUN CONFLIT.
```

Les événements additifs **commutent** : l'ordre d'arrivée ne change pas le
résultat. Pour la minorité de champs réellement conflictuels — numéro de table,
statut, nom du client — dernier-écrivain-gagne arbitré par `(server_seq,
device_id)`, et l'ancienne valeur reste visible dans le journal.

### Le protocole

| Mécanisme | Règle |
|---|---|
| **Curseur** | Un bigserial serveur (`change_log.seq`, `order_events.server_seq`). Jamais un timestamp : les horloges des tablettes dérivent, sont réglées à la main, changent de fuseau. |
| **Idempotence** | Index unique sur `event_id`. Le même événement renvoyé cinq fois est inséré une fois. C'est ce qui garantit « jamais de double encaissement ». |
| **Push** | `POST /sync/push` avec un lot issu de l'`outbox` locale. Le serveur applique en une transaction, renvoie les acceptés, les rejetés et le nouveau curseur. L'appareil ne vide son outbox que sur **accusé de réception**. |
| **Pull** | `GET /sync/pull?since=<seq>`. Pagination obligatoire : un appareil resté trois semaines hors ligne peut avoir 40 000 événements de retard. |
| **Rejets** | Notifiés dans l'interface, jamais avalés en silence. Le gérant doit voir « 2 opérations nécessitent votre attention ». |
| **Versionnement** | Chaque requête porte `protocol_version`. Le serveur supporte N−2. Sans ça, une mise à jour casse les appareils encore hors ligne. |
| **Projection** | Le serveur replie les événements en `orders` / `order_items`. L'appareil fait le même repli localement, **avec le même code**. |

---

## Trois régimes de fonctionnement

| Régime | Situation | Traitement |
|---|---|---|
| **1** | En ligne | Push/pull via le cloud. KDS réveillé par WebSocket, repli en polling 3 s. Latence perçue 1–3 s. |
| **2** | Internet coupé, LAN vivant | Le cas fréquent et le plus mal traité. Chaque appareil continue seul ; les imprimantes réseau marchent toujours. Le partage de table est temporairement dégradé — à assumer et à **afficher clairement**. |
| **3** | Hub LAN | Un appareil devient source de vérité locale. **Pas avant la Phase 8** : la cible initiale tourne à 1–2 terminaux, où le régime 2 dégradé ne se remarque même pas. |

---

## Argent — le piège tunisien

Le dinar tunisien a **trois** décimales, pas deux. Toute bibliothèque, tout
schéma ou tout format d'API qui suppose « centimes = ×100 » produit des erreurs
d'arrondi silencieuses qui n'apparaissent qu'après des mois de production.

L'ordre de calcul est figé dans `packages/domain/src/totaux.ts` et couvert par
des tests exhaustifs. Les deux sources d'écart les plus fréquentes :

- **étape 4** — la remise globale doit être répartie **au prorata** sur les
  lignes ; sans répartition, la base taxable par taux est fausse, donc la TVA
  aussi ;
- **étape 6** — la TVA s'arrondit **par taux** puis se somme. Jamais l'inverse.

Un garde-fou moins évident : le résidu de répartition ne peut pas simplement
atterrir sur la dernière ligne. Sur un ticket qui mêle un plat à 3,333 TND et un
supplément à 0,001 TND, cela rendrait la base de la dernière ligne **négative**
et casserait la TVA du groupe. Le résidu remonte donc de la dernière ligne vers
la première, sans jamais faire dépasser une part au-delà de son poids.

---

## Sécurité

- **RLS obligatoire** sur toutes les tables, dès la première migration. Le
  filtrage applicatif ne remplace jamais RLS : c'est la dernière ligne de
  défense contre une fuite entre deux restaurants concurrents.
- **Double application** des permissions : l'appareil masque ce qui est interdit
  (UX), le serveur revalide systématiquement à la réconciliation. Un appareil
  compromis ne doit rien pouvoir forcer.
- **Opérations à autorisation renforcée** : remise au-delà d'un seuil,
  annulation d'une vente encaissée, modification de prix, ouverture du tiroir
  hors vente, remboursement. Elles exigent le PIN d'un manager — et génèrent un
  événement d'audit **même si elles sont refusées**.
- **Clé `service_role` jamais exposée** côté client, jamais dans le bundle
  Capacitor. Le POS n'a que son jeton d'appareil. La CI le vérifie.

---

## Audit et anti-fraude

Le patron achète aussi le logiciel pour savoir ce qui se passe quand il n'est
pas là.

- `audit_events` en insertion seule (REVOKE **et** déclencheur).
- **Chaînage par hash** : chaque ligne stocke `prev_hash` et son propre `hash`.
  Une suppression ou une modification en base casse la chaîne et devient
  détectable. Peu coûteux à implémenter, très convaincant en démonstration.
- Les événements générés hors ligne portent `client_ts` **et**
  `server_received_at` : un écart anormal est en soi un signal.

> **Règle d'or.** Une annulation n'efface jamais rien. Elle ajoute un événement
> d'annulation. L'état visible change ; l'historique ne perd jamais d'information.

---

## Paliers de montée en charge

| Palier | Commandes/jour | Ce qui change |
|---|---|---|
| 1 → 10 | ~5 000 | Rien de spécial. Supabase Pro, index de base. |
| 10 → 100 | ~50 000 | Rollups nocturnes, pooling Supavisor, monitoring des requêtes lentes. |
| 100 → 500 | ~250 000 | Réplique de lecture, sync sur process Node dédié, partitionnement mensuel de `order_events`. |
| 500 → 2 000 | ~1 M | Realtime maison, rollups incrémentaux, base analytique séparée. |
| 2 000 → 10 000 | ~5 M | Sharding par organisation — possible **sans réécriture** uniquement parce que `organization_id` est présent partout depuis la première migration. |

---

## Feuille de route

| Phase | Durée | Contenu |
|---|---|---|
| **0** | ~2 sem. | **Fondations** — monorepo, domaine + tests, schéma Postgres + RLS, schéma SQLite + migrations, coque Capacitor qui démarre en mode avion. |
| **1** | ~6 sem. | MVP caisse : catalogue, prise de commande, paiement, ticket, shifts, back-office minimal. |
| **2** | ~6 sem. | Offline & synchronisation : outbox, push/pull, idempotence, curseurs, journal d'exceptions. **Jalon PowerSync.** |
| **3** | ~4 sem. | Cuisine : KOT par station, KDS, impression avec file et retentatives, transfert/fusion d'addition. |
| **4** | ~6 sem. | Stock & recettes, food cost. |
| **5** | ~4 sem. | Multi-établissement. |
| **6** | ~4 sem. | CRM, fidélité, paiements. |
| **7** | à cadrer | Fiscalité & conformité Tunisie — **avec un expert-comptable**, pas depuis la documentation. |
| **8** | continu | Passage à l'échelle, hub LAN, anti-fraude, iOS de consultation. |

Phases 0 à 3 ≈ 4 à 5 mois à une personne à plein temps pour un produit vendable
à un premier client réel. **Vendre dès la fin de la Phase 3.**

---

## Le jalon écrit à l'avance

> Si, à la fin de la Phase 2, la synchronisation n'est pas fiable en test avec
> **trois appareils** et des coupures réseau simulées, on bascule sur
> **PowerSync** sans débat.

L'écrire maintenant évite de s'entêter plus tard.
