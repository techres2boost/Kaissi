# Tester le centre de supervision — pas à pas

Guide d'exploitation, à faire **une fois** après le déploiement, puis à
rejouer après chaque changement du service. Rien ici ne se fait chez un
client : ces écrans sont ceux de **Res2Boost**, l'éditeur.

---

## 0. Pourquoi tu ne le vois pas dans le menu d'un restaurant

Les trois écrans d'exploitation traversent **tous les restaurants** —
chiffres du parc, terminaux de chaque client, adresses réseau. Un gérant
n'y a donc aucun accès : il verrait l'activité de ses confrères.

Ils ne sont **pas** dans le menu latéral d'un établissement (Employés,
Taxes, Caisses, Abonnement…). Ils vivent sur la **page d'accueil** du
back-office, celle qui liste les établissements : on y revient par le logo
en haut à gauche, ou par l'adresse racine.

| Écran | Adresse | Ce qu'il répond |
|---|---|---|
| Clients et formules | `/editeur` | Qui sont nos clients, quelle formule |
| **Centre de supervision** | `/editeur/supervision` | Historique, incidents, journal, terminaux |
| Surveillance du service | `/editeur/surveillance` | L'état du service **maintenant** |

### Les liens, pour un back-office sur Vercel

En remplaçant le domaine par celui de `apps/pos/deploiement.json`
(`urlBackOffice`, aujourd'hui `https://kaissi-backoffice.vercel.app`) :

- accueil — `https://kaissi-backoffice.vercel.app/`
- **centre de supervision** — `https://kaissi-backoffice.vercel.app/editeur/supervision`
- état instantané — `https://kaissi-backoffice.vercel.app/editeur/surveillance`
- clients et formules — `https://kaissi-backoffice.vercel.app/editeur`
- santé du service (sans compte) — `https://kaissi-production.up.railway.app/sante`

Filtres de période, directement par l'adresse :
`…/editeur/supervision?fenetre=1h`, `6h`, `24h`, `7j`, `30j` ;
on y ajoute `&categorie=securite` (ou `application`, `synchronisation`,
`terminal`) et `&niveau=critique` (ou `attention`, `info`).

---

## 1. Avant tout : être reconnu comme éditeur

**Symptôme** : sur la page d'accueil, aucun bouton « 🧾 Éditeur », « 🛰 Centre
de supervision » ni « 📈 Surveillance du service ». L'adresse tapée à la main
répond « Page introuvable » — volontairement muette, pour ne pas apprendre
l'existence de ces écrans à qui n'y a pas droit.

**Cause** : le compte connecté n'est pas dans `KAISSI_EDITEURS`.

**Correction**, chez **Railway**, sur le service de synchronisation →
*Variables* :

```
KAISSI_EDITEURS=ton.adresse@res2boost.tn,associe@res2boost.tn
```

Les adresses exactes avec lesquelles on se connecte au back-office,
séparées par des virgules, sans espace autour (la casse est ignorée).
Railway redémarre le service tout seul ; **recharge** ensuite le
back-office. Ce n'est ni un rôle en base, ni une case à cocher : le service
relit cette variable à chaque appel, et c'est lui qui décide — pas
l'interface.

> ⚑ Un **administrateur de restaurant** n'est pas un éditeur. C'est le
> CLIENT. Les deux rôles ne se recouvrent jamais.

**Vérification** : l'accueil montre les trois boutons.

---

## 2. Le service répond, et le schéma est complet

Ouvre `https://kaissi-production.up.railway.app/sante` dans un navigateur.

| Réponse | Ce que ça veut dire |
|---|---|
| `{"etat":"ok",…}` | Service debout, base joignable, aucune migration manquante |
| `{"etat":"schema_incomplet","migrationsManquantes":[…]}` | Appliquer la ou les migrations nommées dans Supabase, **puis** redéployer |
| `{"etat":"degrade",…}` | La base ne répond pas au service |
| Rien, ou une erreur du navigateur | Le service est mort → journaux Railway |

C'est la même réponse que lit la sonde externe (§ 7).

---

## 3. Le centre de supervision — ce que tu dois voir

Ouvre `/editeur/supervision`. Parcours, de haut en bas :

- [ ] **Aucun bandeau** « Historique indisponible ». S'il apparaît, il dit
      pourquoi : migration 0050 absente, ou collecteur éteint
      (`SYNC_SUPERVISION=0`).
- [ ] La ligne **« 🔔 Alertes sortantes actives »**. Si tu lis à la place
      « Aucune alerte ne sort du service », c'est que `SYNC_ALERTES_WEBHOOK`
      n'est pas renseigné chez Railway (§ 6).
- [ ] Un bandeau d'état : vert « ✓ Aucun seuil franchi », ou orange, ou
      rouge avec les sujets.
- [ ] Les **indicateurs** : Disponibilité, Requêtes, Erreurs serveur, Échecs
      d'authentification, Limites de débit, Redémarrages, Incidents ouverts,
      Caisses en ligne.
- [ ] Les **graphiques** se remplissent. ⚠ **Compte une à deux minutes après
      un déploiement** : le service écrit une ligne par PÉRIODE (60 s). Sur
      un service qui vient de démarrer, « Aucune mesure sur cette période »
      est normal — attends, puis recharge.
- [ ] Les **filtres de période** (1 h / 6 h / 24 h / 7 j / 30 j) changent
      l'affichage : sur 7 j, les étiquettes de temps portent la date.
- [ ] Le volet **Infrastructure** : processeur, mémoire, latence, connexions,
      pool, cache, taille de la base.
- [ ] Le volet **Terminaux** : chaque caisse appairée, « En ligne » si vue
      dans les 15 dernières minutes.

La page se rafraîchit toute seule toutes les 60 secondes.

---

## 4. Le journal de sécurité — à provoquer

Un journal vide ne prouve rien. Fabrique une ligne :

1. Sur une tablette (ou la caisse web), écran d'accueil → **Se connecter**,
   et saisis volontairement un **mauvais mot de passe**.
2. Attends **une à deux minutes** (le temps d'une période).
3. `/editeur/supervision?fenetre=1h&categorie=securite` → une ligne
   **« Identifiants refusés »**.
4. Contrôle de confidentialité, à faire une fois : la colonne *Origine*
   montre un **réseau** (`197.14.23.0/24`), jamais une adresse complète.
   Aucun mot de passe, aucun jeton n'apparaît nulle part.

Même principe pour un **terminal mis en service** : appaire une caisse, et
la catégorie *Terminaux* porte la ligne.

---

## 5. Les incidents — ouvrir, prendre en charge, résoudre

Un incident naît d'une alerte qui PERSISTE. Pour en voir un sans rien
casser, le plus simple est d'attendre le premier réel — par exemple
« Caisses muettes », dès qu'une caisse appairée ne s'est pas synchronisée
depuis 24 h.

Quand il y en a un, dans **Incidents en cours** :

1. Déplie-le : constat, clé de l'alerte, date d'ouverture, dernière fois vu,
   nombre d'occurrences.
2. Écris une note, puis **Prendre en charge** → le statut passe, avec ton
   adresse.
3. **Marquer résolu** → il descend dans « Incidents résolus sur la période ».
4. Recharge : un second clic sur « Marquer résolu » répondrait « cet
   incident a déjà changé d'état » — c'est la protection contre deux
   personnes qui agissent en même temps.

Un incident dont la cause disparaît se résout **tout seul**, mention
« cause disparue ».

---

## 6. L'alerte sur ton téléphone

**Réglage**, chez Railway → *Variables* du service :

| Variable | Valeur |
|---|---|
| `SYNC_ALERTES_WEBHOOK` | l'adresse **https** du webhook — c'est un **secret** |
| `SYNC_ALERTES_NIVEAU` | `critique` (défaut) ou `attention` |
| `SYNC_ALERTES_LIEN` | `https://kaissi-backoffice.vercel.app/editeur/supervision` |

Pour Telegram : créer un robot avec **@BotFather**, lui écrire une fois,
puis `https://api.telegram.org/bot‹JETON›/sendMessage?chat_id=‹TON_ID›`
(l'identifiant se lit sur `https://api.telegram.org/bot‹JETON›/getUpdates`).
Slack, Discord et Google Chat acceptent leur propre adresse de webhook.

**Test sans rien casser** : pose `SYNC_ALERTES_NIVEAU=attention` le temps
d'un essai. Le prochain incident « attention » — « Caisses muettes » arrive
vite — t'écrit sur Telegram, puis « ✅ résolu » quand il se ferme. Remets
ensuite `critique`, sinon le téléphone sonne pour des broutilles, et une
alerte qui sonne trop est une alerte qu'on coupe.

**Contrôle croisé** : chaque envoi laisse une ligne « Alerte envoyée » dans
le journal, catégorie *Application*. Un échec laisse « Alerte non envoyée »
avec sa raison — on ne croit jamais l'astreinte prévenue sans trace.

Au démarrage, les journaux Railway disent `Alertes : webhook configuré
(niveau critique)` ou `aucune sortie`. Jamais l'adresse : c'est un secret.

---

## 7. La sonde externe — quand le service est MORT

Le centre de supervision prévient quand le service va mal ; il ne peut rien
dire quand il est mort, puisque c'est lui qui parlerait. D'où une sonde
**hors de notre infrastructure** : GitHub Actions, toutes les 10 minutes.

- La voir : onglet **Actions** du dépôt → *Sonde de production*.
- La lancer à la main : *Run workflow* (ou `pnpm sonde:production`).
- Un passage sain affiche :

  ```
  ✓ Service de synchronisation — 2571 ms
  ✓ Back-office — 698 ms
  ```

**À régler une fois** : ajoute le même webhook en secret du DÉPÔT —
*Settings → Secrets and variables → Actions → New repository secret*, nom
`SYNC_ALERTES_WEBHOOK`. Sans lui, une panne n'arrive que par l'e-mail de
GitHub.

⚑ GitHub suspend un workflow planifié après 60 jours sans activité sur le
dépôt ; il prévient par e-mail, et *Enable workflow* le relance.

---

## 8. Les erreurs vues chez le client

- **Back-office** : une page qui casse se signale toute seule. Elle apparaît
  dans le journal, catégorie *Application*, type « Page en erreur au
  back-office », avec le chemin réduit à sa forme (identifiants masqués) et
  le `digest` qui la relie aux journaux Vercel.
- **Caisse** : les erreurs sont regroupées sur la tablette (une ligne par
  erreur, avec son nombre) et remontent à la synchronisation suivante,
  **après** les ventes. Elles apparaissent en catégorie *Terminaux*, type
  « Erreur sur la caisse », avec l'écran et la version.
- Une caisse hors ligne les garde jusqu'au retour du réseau. Une caisse qui
  va bien n'envoie rien : zéro requête.

---

## 9. Ce qui reste à régler, hors de ce guide

| Où | Quoi |
|---|---|
| Railway | Instance **2 Go**, `SYNC_POOL_MAX=20`, `SYNC_MEMOIRE_LIMITE_MO=2048` si le graphique mémoire dit que la limite est inconnue |
| Supabase | Passage **Pro** ; *Authentication* → activer **Leaked password protection** |
| Poste du CTO | `pnpm sync:restauration` une fois contre la production ([`deploiement.md`](deploiement.md) § 8) |

---

## En cas de doute — le tableau de diagnostic

| Ce que tu vois | Cause | Geste |
|---|---|---|
| Aucun bouton éditeur sur l'accueil | Compte hors `KAISSI_EDITEURS` | § 1 |
| « Page introuvable » sur `/editeur/supervision` | Idem | § 1 |
| « Le service de synchronisation ne répond pas » | Service mort ou injoignable | Journaux Railway, puis `/sante` |
| « Historique indisponible : la migration 0050 n'est pas appliquée » | Migration absente | L'appliquer dans Supabase, puis redéployer |
| « Le collecteur de supervision est désactivé » | `SYNC_SUPERVISION=0` | Retirer la variable chez Railway |
| « Aucune mesure sur cette période » | Service démarré il y a moins d'une minute | Attendre, recharger |
| « Aucune alerte ne sort du service » | `SYNC_ALERTES_WEBHOOK` absent | § 6 |
| « La dernière écriture de l'historique a échoué » | La base a refusé l'écriture | Le message dit laquelle ; regarder la base |
| Mémoire : « Limite de l'hébergeur inconnue » | Le conteneur n'expose pas sa limite | `SYNC_MEMOIRE_LIMITE_MO=2048` |
