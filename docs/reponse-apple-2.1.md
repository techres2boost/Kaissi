# Réponse à Apple — Guideline 2.1, Information Needed

**Date** : 1er novembre 2026 · **Objet** : première soumission rejetée pour
informations manquantes.

Ce rejet n'est **pas** un rejet de fond. Apple n'a rien trouvé à redire au
produit : il demande six informations qu'on aurait dû mettre dans les notes
de revue dès le départ. Les textes ci-dessous sont prêts à coller, en
anglais, dans **App Store Connect → Version → Informations pour la revue →
Notes**, et dans la réponse au message d'Apple.

> ⚠ **Deux choses avant de répondre.** Le compte de démonstration donné à
> Apple doit être un compte **dédié**, pas un compte personnel
> d'administration (§2 bis). Et le §7 — la suppression de compte exigée par
> la règle 5.1.1(v) — est désormais **livré** : la vidéo peut montrer le
> parcours entier.

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
| 11 | Retour à l'accueil → **« Supprimer mon compte »** → saisissez les identifiants de démonstration → montrez l'écran « Ce qui sera effacé / Ce qui sera conservé » → **revenez en arrière** | « account deletion flows » (règle 5.1.1(v)). Pas besoin de supprimer pour de vrai : montrer que le parcours existe suffit |

**Ce qu'il ne faut PAS filmer** : rien. Il n'y a ni contenu généré par les
utilisateurs, ni contenu payant dans l'application — dites-le explicitement
dans la réponse (texte au §2 ci-dessous), sinon Apple le redemandera.

**Où filmer** : sur un **iPhone ou iPad réel**, sous la dernière version
d'iOS. **Pas sur le PC, pas dans le simulateur** — Apple le demande
explicitement (« captured on a physical device »), et un enregistrement de
simulateur se reconnaît tout de suite.

**Comment** : Réglages iOS → *Centre de contrôle* → ajouter *Enregistrement
de l'écran*. La vidéo part dans Photos.

**Où la déposer** : dans la fenêtre **« Reply to App Review »**, par
**« Attach File »** — c'est le bon endroit, celui de votre capture. Le
champ *Attachment* de *App Review Information* convient aussi, mais la
réponse est plus sûre : elle est rattachée au message du relecteur.
Si le fichier est refusé pour sa taille, compressez-le (720p suffit) ou
déposez un lien vers un fichier accessible **sans compte**.

---

## 2. Les deux textes — calibrés pour les champs d'App Store Connect

> ⚠ **Les deux champs font 4 000 caractères.** Pas un de plus. Les textes
> ci-dessous tiennent : **3858** et **3869** caractères. Ne les rallongez pas
> sans recompter — un texte tronqué au milieu d'une phrase fait mauvaise
> impression, et c'est un humain qui lit.

### 2.a — Dans « Reply to App Review » (3858 caractères)

C'est la réponse au rejet. Elle répond aux six points, dans l'ordre, et
annonce la vidéo. **Joignez la vidéo par « Attach File », dans cette même
fenêtre.**

```
Thank you for the review. A screen recording captured on a physical iPhone running the latest iOS is attached. It begins with the app launch, with the device in AIRPLANE MODE, and shows the full flow: staff sign-in, opening the cash drawer, taking an order, cashing it, the on-screen receipt, then account registration, sign-in and account deletion.

1. SCREEN RECORDING - attached. The app has NO user-generated content, NO social features, and NO paid content or features, so there is nothing to show for those items and no reporting or blocking mechanism is applicable. Account creation and account deletion are both shown.

2. PURPOSE AND AUDIENCE
Kaissi is a point-of-sale and business-management app for restaurants, cafes and snack bars in Tunisia. It is sold business-to-business to the owner of the establishment; it is not a consumer app.
Problem: Internet connectivity in Tunisia is unreliable. Cloud point-of-sale apps stop working when the connection drops, so the business cannot take orders or complete sales. Kaissi never stops: the whole app is bundled in the IPA, data is stored locally in SQLite, and every calculation runs on the device. Sales made offline synchronise automatically when connectivity returns, with no loss and no duplicates.
Value: the restaurant keeps serving during an outage; staff take orders on a tablet in the dining room; the owner sees the day's figures from a phone. Amounts use integer millimes because the Tunisian dinar has THREE decimal places. The UI is in French and Arabic (RTL).

3. HOW TO TEST - no setup, no network and no account are required.
a) Optionally enable Airplane Mode to verify the app works with no connectivity.
b) Launch the app. On the welcome screen tap "Decouvrir sans compte" (try without an account).
c) Staff sign-in: select "Salma Trabelsi", PIN 2468. (This 4-digit PIN identifies WHICH employee is acting; it is not a security boundary.)
d) Enter any opening cash amount, e.g. 50.
e) Tap table 3, tap any product, then "Encaisser" (cash out) > "Especes" (cash) > a suggested amount. The receipt appears on screen.
To test sign-in and synchronisation, use the demo credentials in the Sign-In Information fields. Account deletion: welcome screen > "Supprimer mon compte", or menu > Synchronisation > "Supprimer mon compte".

4. EXTERNAL SERVICES - the app works fully without all of these; they are used only to synchronise between devices when connectivity is available.
- Supabase (PostgreSQL database and email/password authentication), hosted in Frankfurt, Germany.
- Our own synchronisation service (Node.js) hosted on Railway.
- Apple Push / Web Push, for optional staff notifications when an order is ready.
NOT used: no payment processor, no advertising network, no analytics SDK, no tracking, no AI service, no third-party data provider. No user data is sold or shared.

5. REGIONAL DIFFERENCES - none. No geofencing, no region-dependent feature or content. The app is designed for the Tunisian market, so its defaults are the Tunisian dinar with three decimals and configurable VAT and stamp duty, with French and Arabic. These are settings, identical in every region.

6. REGULATED INDUSTRY / THIRD-PARTY MATERIAL - neither applies.
The app does NOT process, hold, route or transfer any funds, and integrates with no payment processor or card terminal. When a customer pays, staff record WHICH method was used and the amount, exactly as in a paper ledger. This is bookkeeping data entry, not a payment service, so no financial licence is required.
All text, icons and imagery are our own or used under open-source licences. The demonstration data is fictitious and created by us.
Kaissi is licensed to businesses through a direct commercial relationship outside the App Store. There is no in-app purchase and no paywall. We are happy to provide further detail if needed.
```

### 2.b — Dans le champ « Notes » (3869 caractères)

Celui de *App Review Information*, que votre capture montre vide. C'est le
texte **permanent** : il restera pour toutes les soumissions suivantes, et
c'est lui qui évite de revivre ce rejet. Le texte d'aide affiché à côté du
champ parle de la loi chinoise sur les permis — c'est une **indication
générique d'Apple**, pas une restriction du champ. Il sert à toute note
destinée au relecteur.

```
Kaissi is a point-of-sale and business-management app for restaurants, cafes and snack bars in Tunisia. It is sold business-to-business to the owner of the establishment; it is not a consumer app. Its purpose is that the cash register never stops working when the Internet connection drops, which happens often in Tunisia.

HOW TO TEST - no setup, no network and no account are required.
1. Optionally enable Airplane Mode first, to verify the app works with no connectivity at all.
2. Launch the app. On the welcome screen tap "Decouvrir sans compte" (try without an account). This loads a demonstration restaurant stored entirely on the device.
3. Staff sign-in screen: select "Salma Trabelsi", enter PIN 2468. This 4-digit PIN identifies WHICH employee is acting. It is not a security boundary.
4. Enter any opening cash amount, e.g. 50, and confirm.
5. On the floor plan, tap table 3, then tap any product to add it to the order.
6. Tap "Encaisser" (cash out), choose "Especes" (cash), then tap one of the suggested amounts. The sale closes and the receipt is shown on screen.
To test sign-in and server synchronisation, use the credentials in the Sign-In Information fields above, plus the cash register PIN given there.

ACCOUNT CREATION AND DELETION (Guideline 5.1.1(v))
The app allows creating an account: welcome screen > "Creer un compte".
It also allows deleting it, in-app, from two places:
- welcome screen > "Supprimer mon compte";
- menu > Synchronisation > "Supprimer mon compte".
The flow has two steps: the user signs in, the app shows exactly what will be erased (name, email, phone, cash register PIN, back-office access, all establishment memberships) and what will be kept (past sales and the audit log, which are accounting records and no longer carry the user's name), then asks the user to retype their email address to confirm. Deletion is immediate and permanent.

THIS APP IS NOT A WEBSITE WRAPPER (Guideline 4.2)
The entire application is bundled inside the IPA. No remote URL is loaded at runtime: no server.url, no WebView pointing at a website. Please verify by enabling Airplane Mode BEFORE the first launch - the app starts, takes orders and completes a sale with no connectivity at all. This is the core purpose of the product.
The app does contain one button that opens the system browser on our web back office. That is the system browser, not the app: the app itself never loads code from the network.

EXTERNAL SERVICES
The app works fully without all of these; they are used only to synchronise data between devices when connectivity is available.
- Supabase: PostgreSQL database and email/password authentication, hosted in Frankfurt, Germany.
- Our own synchronisation service (Node.js), hosted on Railway.
- Apple Push / Web Push, for optional staff notifications when an order is ready in the kitchen.
Not used: no payment processor, no advertising network, no analytics SDK, no tracking, no AI service, no third-party data provider. No user data is sold or shared.

PAYMENTS (Guidelines 3.1.1 / 3.1.3)
The app does NOT process, hold, route or transfer any funds, and integrates with no payment processor or card terminal. When a customer pays, staff record WHICH method was used and the amount, exactly as in a paper ledger. This is bookkeeping data entry, not a payment service.
Kaissi is licensed to businesses through a direct commercial relationship outside the App Store. There is no in-app purchase and no paywall. A business that has not signed with us simply has no account to sign in with, and can still use the offline demonstration mode.

REGIONS
The app behaves identically in every region. No geofencing, no region-dependent feature or content. Its defaults target Tunisia (dinar with three decimal places, configurable VAT and stamp duty, French and Arabic interface), but these are settings, not restrictions.
```

### 2.c — ⚠ Le compte de démonstration : à refaire avant d'envoyer

Votre capture montre, dans *Sign-In Information*, **votre adresse
personnelle** et un mot de passe de neuf chiffres consécutifs. Je ne les
recopie pas ici : ce document part sur GitHub, et des identifiants n'ont
rien à faire dans un dépôt.

**Trois problèmes, dont deux sérieux.**

| | |
|---|---|
| 🔴 C'est votre compte **personnel** | S'il est administrateur en production, le relecteur d'Apple a accès à tous vos établissements, à leur chiffre d'affaires et à la gestion des accès. Un relecteur n'est pas un attaquant — mais ces identifiants transitent, sont stockés chez Apple, et resteront dans la fiche |
| 🔴 Le **mot de passe** | Il fait partie des tout premiers qu'un attaquant essaie, et il figure dans notre propre liste de refus (`MOTS_DE_PASSE_COURANTS`, `admin-comptes.ts`) : le service le refuserait aujourd'hui à la création. Ce compte a donc été créé avant ce garde-fou, ou hors du service |
| 🟠 **Le PIN de caisse manque** | L'e-mail et le mot de passe ouvrent le back-office ; c'est le **PIN** qui ouvre la caisse. Sans lui, le relecteur reste bloqué à la prise de poste — motif de rejet n° 1 des applications de caisse |

**À faire** : créer un compte dédié (`pnpm sync:nouveau-client`) sur un
établissement de démonstration, avec un vrai mot de passe, puis
**l'essayer soi-même sur un iPhone** avant de l'envoyer. Et ajouter le PIN
dans les Notes (le texte du §2.b y renvoie déjà).

Le parcours « Découvrir sans compte » rend d'ailleurs ce compte presque
inutile pour la revue : le relecteur peut tout tester sans se connecter.
Mais Apple veut des identifiants dès que l'application en propose, donc on
en donne — simplement pas les vôtres.

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

Le §7 (suppression de compte) est **livré** : la vidéo peut donc montrer le
parcours complet, création **et** suppression, ce que le relecteur demandera
de toute façon.

---

## 6. Et Google Play ?

Rien à faire. Play n'a pas d'équivalent de la 2.1 et la publication en test
fermé fonctionne déjà. Le questionnaire de sécurité des données de Play doit
en revanche dire la même chose que le §2 point 4 ci-dessus : aucune donnée
partagée, aucun traqueur.

---

## 7. ✅ La suppression de compte (Guideline 5.1.1(v)) — FAIT

> **Livré le 1er novembre.** Le parcours existe : écran d'accueil de la
> caisse → « Supprimer mon compte », et ☰ → Synchronisation →
> « Supprimer mon compte » pour une caisse déjà en service. En deux temps :
> on s'identifie, l'écran montre **ce qui sera effacé et ce qui sera
> conservé**, puis demande de retaper l'adresse du compte.
>
> **À filmer dans la vidéo** (séquence 11 du §1) : ouvrez l'écran, montrez
> la liste « Ce qui sera effacé / Ce qui sera conservé », puis revenez en
> arrière. Vous n'avez pas à supprimer un compte pour de vrai devant la
> caméra — montrer que le parcours existe et qu'il est atteignable suffit.
>
> `apps/pos/tests/suppression-compte.mjs` le vérifie à chaque PR : retirer
> le lien ferait rouge la CI, pas la revue Apple six semaines plus tard.

**Ce qui suit explique pourquoi c'était nécessaire.** Ce n'est pas dans le message d'Apple, mais
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

### Ce qui a été livré

| | |
|---|---|
| **Effacé** | la connexion au back-office, le nom, l'adresse e-mail, le téléphone, le code PIN de caisse, et tous les rattachements aux établissements |
| **Conservé** | les ventes et le journal d'audit — ce sont des écritures comptables (règle 6), et elles ne portent plus le nom |
| **Le seul refus possible** | être le **dernier administrateur** d'un établissement. L'écran le nomme et dit quoi faire : nommer un autre administrateur, ou supprimer l'établissement |
| **Garde-fous** | mot de passe revérifié à l'instant, adresse exacte à retaper, limites de débit par connexion et par compte |
| **Tests** | 10 tests de service contre un vrai PostgreSQL (`apps/sync/test/suppression-compte.test.ts`) + un parcours navigateur |

**Le piège qu'il a fallu éviter**, et qui aurait donné une suppression de
façade : depuis la migration 0017, `kaissi.users` n'est plus un miroir de
`auth.users` — la contrainte `users_id_fkey` a été retirée et
`auth_user_id` est un lien facultatif en `on delete set null`. Supprimer le
seul compte Supabase aurait laissé **le nom, l'adresse, le téléphone et le
hachage du PIN** intacts en base. La fiche employé est donc **anonymisée**
dans la même transaction.

**Pourquoi anonymiser plutôt que supprimer la ligne** : toutes les
références à un employé sont en `on delete set null`, donc la supprimer
marcherait. Mais une vente dont l'acteur devient nul ne dit plus
« encaissée par quelqu'un qui est parti » — elle dit « encaissée par
personne ». La règle 6 veut que l'historique ne perde jamais d'information,
le droit à l'effacement veut que la donnée personnelle disparaisse : les
deux tiennent ensemble si on efface **l'identité** sans effacer
**l'écriture**.
