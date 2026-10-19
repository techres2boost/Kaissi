# Kaissi est-il prêt à être VENDU ? — revue honnête

**Date** : 19 octobre 2026 · **Question posée** : « Si demain on part en
production et qu'on commence à vendre la solution aux restaurants (App Store
et Google Play), est-on prêt ? »

## La réponse courte

**Prêt pour un pilote payant ENCADRÉ — 3 à 10 restaurants que vous installez
et accompagnez vous-mêmes. Pas encore pour une vente ouverte à grande
échelle.**

Ce n'est pas la technique qui retient. Le cœur du produit — encaisser sans
réseau, ne jamais perdre ni doubler une vente, des totaux identiques au
millime entre la caisse et le serveur — est fait, mesuré, et tenu en
production. Ce qui manque est **autour** du logiciel : le fiscal, le
contractuel, l'exploitation, l'impression. Ce sont les cinq points du §2, et
aucun ne se règle en écrivant du code seulement.

---

## 1. Ce qui est prêt — et mesuré

| Domaine | État | Preuve |
|---|---|---|
| Encaissement hors ligne | ✅ | Banc 3 appareils + coupures aléatoires : aucune vente perdue ni doublée (`banc-trois-appareils.test.ts`) |
| Montée en charge | ✅ | 1 → 50 caisses, 100 commandes/h ×800, retour d'Internet (`docs/charge-et-securite.md`) |
| Isolation entre clients | ✅ | RLS forcée sur toutes les tables, aucun privilège `anon`, clé publique seule au back-office (`docs/audit-production.md`) |
| Pannes de déploiement | ✅ | Sondes de schéma : un code qui exige une migration absente ne remplace pas celui qui tourne (`/sante` 503) |
| Base de production | ✅ | 9 établissements, 29 caisses actives, 0 rejet de synchronisation, 16 Mo — le 19/10 |
| Deux langues | ✅ | Français et arabe (RTL), couverture vérifiée en CI |
| Téléphone et tablette | ✅ | Largeurs 390 et 320 px testées à chaque PR, caisse et back-office |
| Publication | ✅ | Push sur `main` → Play (test fermé) et TestFlight, automatiquement |
| Interface | ✅ | Refonte du 19/10 : bandeau d'une rangée, ticket lisible, encaissement avec le détail, liste d'articles compacte sur téléphone |

---

## 2. Ce qui BLOQUE une vente ouverte — par ordre de risque

### 2.1 ⚠ Le fiscal — à faire valider par un expert-comptable tunisien

C'est le seul point qui peut exposer **le client** autant que vous. Le modèle
de données est prêt à accueillir les règles (`tax_rates` paramétrable,
`fiscal_number` attribué côté serveur) ; **la règle exacte, elle, ne doit pas
venir de nous** :

- ⚠ les taux de TVA applicables à la restauration, selon le type
  d'établissement ;
- ⚠ le droit de timbre sur les factures et notes ;
- ⚠ la numérotation séquentielle des factures (le numéro de ticket actuel
  est unique par caisse, ce n'est pas une numérotation fiscale validée) ;
- ⚠ l'existence d'une **obligation de certification ou d'homologation des
  logiciels de caisse** — si elle existe pour votre cible, elle conditionne
  la vente elle-même, pas un détail d'affichage.

**Action** : une séance avec un expert-comptable, ces quatre questions
écrites, ses réponses consignées dans le dépôt. Rien n'est à coder avant.

### 2.2 L'impression est éteinte

`IMPRESSION_ACTIVE` est faux par défaut : le ticket client et le bon de
cuisine s'affichent à l'écran. C'était le bon choix pour le MVP, mais **un
restaurant tunisien attend un ticket papier**, et une cuisine sans écran
attend un bon.

Le module est écrit et testé (file persistante, réessais, jamais de
réimpression d'un bon). Ce qui manque est la **validation sur le matériel du
marché** : deux ou trois imprimantes thermiques réellement vendues en
Tunisie, en Wi-Fi et en Ethernet, une semaine de service. Puis
`pnpm pos:build:impression`. Voir `docs/imprimante.md`.

### 2.3 Les contrats — ⚠ à rédiger avec un juriste

- **Conditions générales de vente et d'utilisation** : rien n'existe encore
  dans le produit. Elles doivent dire notamment ce que vous garantissez, et
  ce que vous ne garantissez pas (une vente hors ligne remonte au retour du
  réseau ; une tablette perdue avant synchronisation perd ses ventes non
  remontées — l'écran de révocation le dit déjà).
- **Données personnelles** : la page `/confidentialite` existe et sert aux
  stores. ⚠ Les obligations propres à la Tunisie (déclaration auprès de
  l'instance de protection des données, hébergement à Francfort —
  `eu-central-1`) sont à confirmer par un juriste.
- **Contrat de traitement** avec chaque restaurant : vous traitez les
  données de leurs clients (fiche client, téléphone).

### 2.4 L'exploitation — ce qui se passe à 21 h un samedi

| Sujet | État | À faire |
|---|---|---|
| Sauvegardes | Quotidiennes Supabase | **Restaurer une fois pour de vrai** (`docs/deploiement.md` §8) ; activer le **PITR** avant le premier client payant |
| Mots de passe compromis | ❌ désactivé — seul avis de sécurité Supabase restant | Authentication → Policies → *Leaked password protection*. Coût : zéro |
| Collecte d'erreurs | Journaux structurés, écran Surveillance | Sentry sur le back-office (audit M-6) — aujourd'hui, on apprend une erreur par le client |
| Alerte active | L'écran Surveillance montre, il ne prévient pas | Une sonde externe sur `/sante` qui vous envoie un SMS ou une notification |
| Astreinte | — | Qui répond le samedi soir ? Un numéro, un nom, écrit dans le contrat |
| Purge de `sync_mutations` | Croît sans limite | 90 jours (audit M-5) — pas urgent à 16 Mo |

### 2.5 Vendre et facturer l'abonnement

- **Aucun encaissement d'abonnement n'est intégré** : la formule est
  enregistrée (`subscriptions`), mais le paiement se fait hors application.
  C'est d'ailleurs ce qui tient la position face à Apple (§3) — mais il faut
  un processus : facture mensuelle, virement ou paiement local, relance,
  et ce qui se passe à l'impayé.
- **L'ouverture d'un compte est faite par vous** (route d'administration ou
  `pnpm sync:acces`). C'est cohérent avec une vente accompagnée ; ce n'est
  pas une inscription en libre-service. Pour un pilote, c'est un avantage :
  chaque installation est vue par quelqu'un.

---

## 3. Les stores — ce qui est prêt, ce qui reste un risque

**Google Play** : publication automatique en test fermé, application
empaquetée (aucun `server.url`), fonctionne en mode avion. Le passage en
production est une décision, pas un chantier : fiche, captures, politique de
confidentialité, questionnaire de sécurité des données — tout est décrit
dans `docs/stores.md`.

**App Store** : TestFlight interne fonctionne. Deux risques de revue, tous
deux documentés dans `docs/stores.md` §étapes 9–10 :

1. **4.2 — fonctionnalité minimale** : levé, parce que l'application
   fonctionne réellement sans réseau — le relecteur peut le vérifier en
   trente secondes ;
2. **3.1.1 / 3.1.3 — achat intégré** : Kaissi se vend à des entreprises,
   hors application. C'est une **position défendable, pas un fait acquis** :
   c'est Apple qui tranche. À écrire clairement dans les notes de revue dès
   la première soumission.

---

## 4. Le plan conseillé

| Semaine | Quoi |
|---|---|
| 1 | Expert-comptable (§2.1) · protection des mots de passe · PITR · restauration testée |
| 2 | CGV/CGU et contrat de traitement (§2.3) · processus de facturation (§2.5) |
| 2–3 | Impression validée sur 2–3 imprimantes du marché (§2.2) |
| 3 | Sentry + sonde externe sur `/sante` · numéro d'astreinte |
| 4 | Pilote : 3 à 10 restaurants, installés par vous, suivis chaque semaine |
| +6 à 8 semaines | Bilan du pilote → passage en production Play, soumission App Store, vente ouverte |

**Ce qu'il ne faut pas faire** : ouvrir la vente sans le point fiscal. Un
bug d'interface se corrige en une heure et se publie tout seul ; une
non-conformité fiscale découverte chez cinquante clients ne se corrige pas
par une mise à jour.
