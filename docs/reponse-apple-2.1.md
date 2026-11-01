# Réponse à Apple — Guideline 2.1, Information Needed

**Date** : 1er novembre 2026 · **Objet** : première soumission rejetée pour
informations manquantes.

Ce rejet n'est **pas** un rejet de fond. Apple n'a rien trouvé à redire au
produit : il demande six informations qu'on aurait dû mettre dans les notes
de revue dès le départ. Les textes ci-dessous sont prêts à coller, en
anglais, dans **App Store Connect → Version → Informations pour la revue →
Notes**, et dans la réponse au message d'Apple.

> ⚠ **À lire avant de répondre.** Le vrai risque n'est pas celui-ci : c'est le
> **§7**, un motif de rejet que la prochaine soumission déclencherait
> presque à coup sûr, et qu'Apple n'a pas encore vu. Lisez-le d'abord.

---

## 1. L'enregistrement vidéo — ce qu'il doit montrer

Apple exige une **capture d'écran vidéo faite sur un appareil physique**, à
jour, qui commence par le **lancement de l'application**. Un enregistrement
depuis le simulateur est refusé.

**Durée visée : 3 à 4 minutes.** Voici le plan de tournage, dans l'ordre.
Chaque séquence répond à une exigence précise de leur message.

| # | Ce que vous filmez | Pourquoi Apple le demande |
|---|---|---|
| 1 | **Activez le mode avion**, visible dans la barre d'état, **avant** d'ouvrir l'application | C'est la preuve de la 4.2 (fonctionnalité minimale) et le cœur du produit. Laissez l'icône avion visible le plus longtemps possible |
| 2 | Lancement depuis l'écran d'accueil iOS, application fermée | « The recording must begin with launching the app » |
| 3 | Écran de bienvenue → **« Découvrir sans compte »** | Le parcours qu'un relecteur suivra |
| 4 | Prise de poste : **Salma Trabelsi**, PIN **2468** | Montre l'identité employé |
| 5 | Ouverture de caisse, fond de **50** | Début de service |
| 6 | Table 3 → **Coca-Cola 33cl** → **Pizza Margherita** + supplément **Fromage** | Le parcours typique |
| 7 | **Encaisser → Espèces →** la suggestion qui solde → le **ticket s'affiche** | « typical user flow » |
| 8 | **Coupez le mode avion**, allez à l'écran **Synchronisation**, montrez les opérations qui remontent | Montre que les ventes faites hors ligne arrivent au serveur |
| 9 | Revenez à l'écran de bienvenue → **« Créer un compte »** → montrez le formulaire d'inscription | **« Account registration, login, and account deletion flows »** |
| 10 | **Connexion** avec le compte de démonstration | Idem |
| 11 | ⚠ **La suppression de compte** | **Voir le §7 — ce parcours n'existe pas encore** |

**Ce qu'il ne faut PAS filmer** : rien. Il n'y a ni contenu généré par les
utilisateurs, ni contenu payant dans l'application — dites-le explicitement
dans la réponse (texte au §2 ci-dessous), sinon Apple le redemandera.

**Comment enregistrer** : réglage iOS *Centre de contrôle* → ajouter
*Enregistrement de l'écran*. Filmez sur un iPhone ou iPad réel sous la
dernière version d'iOS. Téléversez la vidéo dans la réponse App Store
Connect (ou déposez un lien vers un fichier accessible sans compte).

---

## 2. Les six réponses — texte prêt à coller, en anglais

> Copiez ce bloc dans la réponse à Apple **et** dans le champ *Notes* de
> *App Review Information*, pour les soumissions suivantes.

```
Thank you for the review. Please find the requested information below.

────────────────────────────────────────────────────────────────
1. SCREEN RECORDING
────────────────────────────────────────────────────────────────
A screen recording captured on a physical iPhone running the latest
iOS is attached. It begins with the app launch and shows the typical
user flow: staff sign-in, opening the cash drawer, taking an order,
cashing it, and the on-screen receipt.

Please note that the recording begins with the device in AIRPLANE
MODE. This is intentional and is the core purpose of the product
(see section 2 below).

The app contains NO user-generated content, NO social features, and
NO paid content or features of any kind. There is therefore nothing
to show for those items, and no content reporting or blocking
mechanism is applicable.

────────────────────────────────────────────────────────────────
2. PURPOSE AND TARGET AUDIENCE
────────────────────────────────────────────────────────────────
Kaissi is a point-of-sale and business-management application for
restaurants, cafés and snack bars in Tunisia. It is sold business-
to-business to the owner of the establishment; it is not intended
for consumers.

THE PROBLEM IT SOLVES
Internet connectivity in Tunisia is unreliable. Cloud-based point-of-
sale applications stop working the moment the connection drops, which
means a restaurant cannot take orders or complete sales. Kaissi is
built so that the cash register never stops: the entire application
is bundled inside the IPA, all data is stored locally in SQLite, and
every calculation (prices, VAT, discounts, change due) runs on the
device. Sales made while offline are synchronised automatically when
connectivity returns, with no duplicate and no loss.

THE VALUE IT PROVIDES
- The restaurant keeps serving customers during an outage.
- Staff take orders on a tablet in the dining room instead of
  walking to a PC in a back office.
- The owner sees the day's figures from a phone, from anywhere.
- Amounts are handled in integer millimes, because the Tunisian
  dinar has THREE decimal places, not two. Most international
  point-of-sale software assumes two and produces rounding errors.
- The interface is available in French and Arabic (RTL).

────────────────────────────────────────────────────────────────
3. SETTING UP AND ACCESSING THE MAIN FEATURES
────────────────────────────────────────────────────────────────
No setup, no network and no account are required to review the app.

OPTION A — NO ACCOUNT NEEDED (recommended for review)
1. Optionally enable Airplane Mode to verify the app works with no
   connectivity whatsoever.
2. Launch the app.
3. On the welcome screen, tap "Découvrir sans compte"
   ("Try it without an account"). This loads a demonstration
   restaurant stored entirely on the device.
4. Staff sign-in screen: select "Salma Trabelsi", enter PIN 2468.
   (This 4-digit PIN identifies WHICH employee is acting. It is not
   a security boundary — see section 6.)
5. Enter any opening cash amount, e.g. 50, and confirm.
6. The floor plan appears. Tap table 3, then tap any product to add
   it to the order.
7. Tap "Encaisser" (cash out), choose "Espèces" (cash), tap one of
   the suggested amounts. The sale closes and the receipt is shown
   on screen.

OPTION B — WITH AN ACCOUNT (to test synchronisation)
Use the demo credentials provided in the "Sign-In Required" fields
of App Review Information:
  Email:    <À REMPLIR>
  Password: <À REMPLIR>
  Cash register PIN: <À REMPLIR>
From the welcome screen choose "J'ai déjà un compte" and sign in.
Sales then synchronise to our server and appear in the web back
office.

No sample files are needed. The demonstration catalogue (products,
categories, staff) ships inside the app.

────────────────────────────────────────────────────────────────
4. EXTERNAL SERVICES USED
────────────────────────────────────────────────────────────────
The application works fully WITHOUT any of these. They are used only
to synchronise data between devices when connectivity is available.

  - Supabase (PostgreSQL database and user authentication),
    hosted in Frankfurt, Germany (eu-central-1).
    Used for: storing synchronised sales, and email/password sign-in
    for the owner's account.
  - Our own synchronisation service (Node.js), hosted on Railway.
    Used for: receiving sales from devices and sending catalogue
    updates back.
  - Apple Push / Web Push (VAPID), for optional staff notifications
    when an order is ready in the kitchen.

NOT USED, to be explicit:
  - No payment processor. The app does NOT process, hold or transfer
    any funds (see section 6).
  - No advertising network, no analytics SDK, no tracking.
  - No AI or machine-learning service.
  - No third-party data provider.
  - No user data is sold or shared with anyone.

────────────────────────────────────────────────────────────────
5. REGIONAL DIFFERENCES
────────────────────────────────────────────────────────────────
The app behaves identically in every region. There is no geofencing,
no region-dependent feature, and no region-dependent content.

The app is designed for the Tunisian market and its defaults reflect
that: the currency is the Tunisian dinar with three decimal places,
VAT rates and the stamp duty are configurable by the restaurant
owner, and the interface is available in French and Arabic. These
are settings, not regional restrictions: they are the same wherever
the app is opened.

────────────────────────────────────────────────────────────────
6. REGULATED INDUSTRY / THIRD-PARTY MATERIAL
────────────────────────────────────────────────────────────────
Kaissi does not operate in a regulated industry and contains no
protected third-party material.

PAYMENTS: the app does NOT process, hold, route or transfer any
funds, and it integrates with no payment processor or card terminal.
When a customer pays, the merchant's staff records WHICH method was
used (cash, card, etc.) and the amount, exactly as they would write
it in a paper ledger. This is bookkeeping data entry, not a payment
service. Kaissi is therefore not a financial service and requires no
financial licence.

CONTENT: all text, icons and imagery in the app are our own or are
used under open-source licences. The demonstration data (restaurant
name, products, staff names) is fictitious and was created by us.

BUSINESS MODEL: Kaissi is licensed to businesses through a direct
commercial relationship outside the App Store. The app contains no
in-app purchase and no paywall; a restaurant that has not signed with
us simply has no account to sign in with, and can still use the
offline demonstration mode. We believe this falls under Guideline
3.1.3(b) (Multiplatform Services) / enterprise B2B distribution, and
we are happy to provide any further detail you need on this point.
```

**Trois champs à remplir avant d'envoyer** : l'e-mail, le mot de passe et le
PIN du compte de démonstration. Créez-le pour de bon
(`pnpm sync:nouveau-client`), sur un établissement de démonstration — un
compte qui ne fonctionne pas est la version subtile du même rejet
([`stores.md`](stores.md) §étape 9).

---

## 3. Ce qu'il ne faut SURTOUT pas écrire à Apple

| N'écrivez pas | Pourquoi |
|---|---|
| « homologué », « certifié », « conforme NACEF » | **C'est faux aujourd'hui** ([`conformite-fiscale.md`](conformite-fiscale.md)). Et une fois écrit à Apple, c'est écrit |
| « caisse fiscale », « fiscal cash register » | Cela désigne Apple vers un régime réglementé et appelle la question « montrez-nous votre agrément » — celle du point 6 de leur message |
| « paiement », « payment », au sens d'encaisser | L'application **enregistre** un mode de paiement, elle n'encaisse rien. Le mot employé de travers fait basculer le dossier chez l'équipe des services financiers |
| Un compte de démonstration approximatif | Motif de rejet n° 1 des applications de caisse |

La même règle vaut pour la **fiche App Store** (description, captures,
mots-clés) : elle est lue par le relecteur. Une description qui promet une
caisse fiscale homologuée serait, en plus, un problème commercial en Tunisie.

---

## 4. Pourquoi ce rejet est arrivé, et ce qu'on en retient

Apple applique la 2.1 à **toute** première soumission depuis 2025 : ils
demandent systématiquement la vidéo et le descriptif. Ce n'est pas un signal
sur la qualité du produit.

**Ce qui l'a rendu certain, en revanche** : nos notes de revue
([`stores.md`](stores.md) §étape 9) ne contenaient que le parcours de test et
le paragraphe 4.2. Elles ne disaient ni ce que fait l'application, ni pour
qui, ni quels services externes elle utilise. **Tout ce qui est au §2 de ce
document aurait dû s'y trouver dès la première soumission.** C'est corrigé :
collez ce bloc dans les notes, il y restera pour les envois suivants.

---

## 5. Le calendrier réaliste

| Quand | Quoi |
|---|---|
| J+0 | Créer le compte de démonstration, le **tester soi-même sur un iPhone réel** |
| J+0 | Tourner la vidéo (3–4 min, mode avion d'abord) |
| J+1 | Répondre dans App Store Connect, et coller le texte dans les Notes |
| J+1 à J+3 | Réponse d'Apple (la 2.1 se résout d'habitude en un aller-retour) |

⚠ **Mais ne renvoyez pas avant d'avoir lu le §7.**

---

## 6. Et Google Play ?

Rien à faire. Play n'a pas d'équivalent de la 2.1 et la publication en test
fermé fonctionne déjà. Le questionnaire de sécurité des données de Play doit
en revanche dire la même chose que le §2 point 4 ci-dessus : aucune donnée
partagée, aucun traqueur.

---

## 7. ⚠ Le vrai risque — la suppression de compte (Guideline 5.1.1(v))

**Lisez ceci avant de renvoyer.** Ce n'est pas dans le message d'Apple, mais
c'est dans leur demande de vidéo, en toutes lettres :

> *« Account registration, login, and account deletion flows. **Account
> deletion is required in apps that support account creation.** »*

**Kaissi permet de créer un compte depuis la caisse** — écran de bienvenue →
« Créer un compte » (`FormulaireInscription`, appelé par
`apps/pos/src/ecrans/EcranBienvenue.tsx`). La règle 5.1.1(v) d'Apple
s'applique donc : l'application **doit** offrir un moyen de supprimer ce
compte **depuis l'application**.

**Aujourd'hui, la suppression se fait par e-mail**, et c'est tout ce
qu'indique la page de confidentialité :

> « Pour faire supprimer un compte et les données associées, envoyez la
> demande depuis l'adresse e-mail du compte à … »

**Apple refuse explicitement ce schéma.** Une adresse e-mail, un formulaire
web ou un numéro de téléphone ne satisfont pas la règle : le parcours doit
commencer dans l'application. C'est un motif de rejet fréquent, et il
arrivera au prochain envoi — d'autant qu'on va leur **filmer** l'écran de
création de compte.

### La bonne nouvelle : le schéma est déjà fait pour ça

Ce n'est pas un chantier. La base de données a été conçue, dès la migration
0002, pour que la suppression d'un compte soit propre :

| Table | Référence | À la suppression |
|---|---|---|
| `memberships` | `user_id` | **`on delete cascade`** — les appartenances disparaissent |
| `orders`, `order_items`, `shifts`, `audit_events`, `devices`, et 15 autres | `user_id`, `actor_user_id`, `closed_by`… | **`on delete set null`** — la vente reste, le nom s'en va |

C'est exactement ce qu'il faut : **la pièce comptable survit, la donnée
personnelle disparaît**. La règle 6 du dépôt (le journal ne perd jamais
d'information) et le droit à l'effacement ne se contredisent pas ici, parce
que ce qui est effacé est l'identité, pas l'écriture.

### Ce qu'il reste à écrire

1. Une route `POST /admin/comptes/supprimer` dans `apps/sync`, qui
   s'authentifie avec l'e-mail et le mot de passe (la caisse ne porte aucune
   session d'utilisateur — c'est voulu), **relit les droits en base**, et
   refuse si la personne est le **seul administrateur** d'un établissement
   qui existe encore. Le garde existe déjà pour la suppression d'un
   établissement (`POST /admin/restaurants/supprimer`).
2. Un écran dans la caisse, accessible depuis l'écran de bienvenue et depuis
   les réglages : « Supprimer mon compte », avec ce qui est effacé, ce qui
   est conservé et pourquoi, et une confirmation.
3. Le même geste au back-office, pour celui qui n'a pas de tablette sous la
   main.
4. Les traductions arabes, et les tests.

**Mon estimation : 2 à 3 jours.** C'est moins cher qu'un deuxième
aller-retour avec Apple, qui coûte une semaine de calendrier.

### La décision qui vous revient

| Option | Pour | Contre |
|---|---|---|
| **A — Écrire la suppression de compte** (recommandé) | Débloque iOS pour de bon, et c'est de toute façon exigé par le droit des données personnelles, Apple ou pas | 2–3 jours |
| **B — Retirer la création de compte de la caisse** | Supprime l'obligation côté Apple en une heure | On perd une vraie fonction : un gérant ouvre son restaurant depuis la tablette, sans passer par un ordinateur. Et l'obligation légale d'effacement, elle, reste |

**Je recommande A**, et de **ne pas renvoyer à Apple avant que ce soit
fait** : la vidéo demandée montrera l'écran de création de compte, et le
relecteur demandera la suppression dans la foulée. Autant livrer les deux
ensemble.
