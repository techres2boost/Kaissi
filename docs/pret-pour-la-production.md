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

> **Mise à jour du 20 octobre — la quatrième question a très probablement une
> réponse, et elle est « oui ».** D'après la presse tunisienne, un arrêté du
> 14 octobre 2025 impose une caisse **homologuée NACEF** aux cafés et
> restaurants, par étapes jusqu'en 2028 — et les sociétés y seraient déjà
> soumises depuis le 1er juillet 2026. ⚠ Texte officiel non consulté : à
> confirmer au JORT. Analyse, calendrier, sources et plan :
> [`fonctionnalites-manquantes.md`](fonctionnalites-manquantes.md) §2. Ce
> point passe désormais devant tous les autres.
>
> **Mise à jour du 27 octobre** : le sujet a son propre document,
> [`conformite-fiscale.md`](conformite-fiscale.md) — les trois obligations
> séparées (caisse, facture, paiement), les trois scénarios de chiffrage
> selon ce que le cahier des charges dira du hors ligne, et les questions à
> poser. Vue de direction, risques et suivi :
> [`dossier-cto.md`](dossier-cto.md).

**Action** : une séance avec un expert-comptable, ces quatre questions
écrites, ses réponses consignées dans le dépôt. Et, sans attendre, le cahier
des charges du portail homologation.nacef.tn.

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
| Sauvegardes | Selon l'offre Supabase | **Restaurer une fois pour de vrai** (`docs/deploiement.md` §8) ; le **PITR** et les sauvegardes téléchargeables exigent une offre payante |
| Mots de passe compromis | La vérification HaveIBeenPwned de Supabase exige l'offre **Pro** | En attendant : le service refuse lui-même les mots de passe les plus courants et ceux d'un seul caractère répété (`verifierMotDePasse`), et `/appairage` est limité en débit (audit C-1). À activer au passage en Pro |
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

### 2.6 Le volume de la base — on ne purge PAS les ventes

« On ne purge pas les tickets chaque semaine ? la base va déborder. » Non,
et c'est voulu : une vente est une **pièce comptable** et la source de
vérité. La supprimer effacerait les rapports, l'historique des clients et
la preuve d'un écart de caisse. ⚠ Sa durée de conservation légale relève de
l'expert-comptable.

**Ce qui est purgé, automatiquement** (boucle de maintenance du service, une
fois par jour) : les reçus du registre d'idempotence (`sync_mutations`) —
30 jours pour les ventes, dont l'idempotence est déjà tenue par
`order_events` ; 180 jours pour les créations de catalogue et les rejets.
Les marqueurs « prêt » sortent du journal de catalogue après 7 jours. Test :
`apps/sync/test/menage-registre.test.ts` — une vente renvoyée après la purge
reste comptée une fois, au millime.

**Ce que pèse une vente**, mesuré en production le 19/10 : environ 6
événements de 392 octets, la commande (540), ses lignes (277 chacune), le
paiement (176) — de l'ordre de **7 à 10 Ko par ticket** avec les index.
Estimation, à recaler sur les chiffres réels :

| Restaurant | Tickets/jour | Par mois | Par an |
|---|---|---|---|
| Petit snack | 100 | ~25 Mo | ~300 Mo |
| Restaurant actif | 300 | ~75 Mo | ~900 Mo |

**Conséquence** : l'offre gratuite de Supabase (500 Mo de base à ce jour —
à revérifier sur leur page de tarifs) tient la démonstration et deux ou
trois pilotes quelques mois, pas une clientèle. Le passage à l'offre Pro
(8 Go inclus) est la première dépense à prévoir — elle débloque aussi la
protection des mots de passe et les sauvegardes. Plus tard, les exercices
clos s'**archivent** (export, puis stockage froid) ; ils ne se suppriment pas.

**On le voit venir** : l'écran Surveillance alerte à 70 % puis 90 % du
plafond (`KAISSI_LIMITE_BASE_MO`, 500 par défaut — à relever dans Railway
au passage en Pro).

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
| 1 | Expert-comptable (§2.1) · passage à l'offre Pro (§2.6 : volume, mots de passe, PITR) · restauration testée |
| 2 | CGV/CGU et contrat de traitement (§2.3) · processus de facturation (§2.5) |
| 2–3 | Impression validée sur 2–3 imprimantes du marché (§2.2) |
| 3 | Sentry + sonde externe sur `/sante` · numéro d'astreinte |
| 4 | Pilote : 3 à 10 restaurants, installés par vous, suivis chaque semaine |
| +6 à 8 semaines | Bilan du pilote → passage en production Play, soumission App Store, vente ouverte |

**Ce qu'il ne faut pas faire** : ouvrir la vente sans le point fiscal. Un
bug d'interface se corrige en une heure et se publie tout seul ; une
non-conformité fiscale découverte chez cinquante clients ne se corrige pas
par une mise à jour.
