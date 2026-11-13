# Réponse à Apple — règles 2.3.8 (icônes) et 3.1.1 (inscription)

Refus du **11 novembre 2026**, version **1.0 (60)**, revue sur iPad Air
11 pouces (M3). Soumission `16dce132-4b24-41b5-87bc-c06c5fd8798b`.

## Ce qu'Apple reproche, et ce qui était vrai

| Règle | Le reproche | Ce qui était vrai | Corrigé par |
|---|---|---|---|
| **2.3.8** | « les icônes semblent être des icônes provisoires » | **Oui.** `cap add ios` et `cap add android` posent l'icône et l'écran de démarrage PAR DÉFAUT de Capacitor (une croix bleue) ; personne ne les avait remplacés. La fiche du magasin, elle, montrait le « K » de Kaissi : deux icônes différentes pour la même application | Toutes les icônes (iOS, Android classique, ronde, adaptative) et tous les écrans de démarrage sont générés depuis `ressources-store/icone-1024.png`, l'icône de la fiche (`apps/pos/scripts/generer-icones.sh`). Une garde de CI refuse le retour des fichiers par défaut, et une icône iOS transparente (`verifier-icones.mjs`) |
| **3.1.1** | « inscription d'entreprise = accès à un mécanisme d'achat externe » | L'écran d'accueil proposait « Créer un compte » : ouvrir un restaurant depuis la tablette | **Sur iOS seulement**, le bouton disparaît : la caisse ne fait que se CONNECTER à un compte existant (`inscriptionPermise()`, `apps/pos/src/config.ts`). Android et la cible web gardent l'inscription : Google ne pose pas cette règle |

Ce qui n'a PAS changé, et qu'il ne faut pas changer :

- **La suppression de compte reste dans l'app** (règle 5.1.1(v)) : des comptes
  existent, ouverts ailleurs, et leur titulaire doit pouvoir les supprimer
  depuis l'iPad.
- **Le mode démonstration** (« Découvrir sans compte ») reste : c'est par lui
  que le relecteur teste.
- **Aucun prix, aucune formule, aucun lien d'achat** n'apparaît dans la caisse.
  Le back-office ouvert dans le navigateur n'a ni inscription ni paiement
  (connexion seulement ; la formule ne change que par Res2Boost).

## Étapes, dans l'ordre

### 1. Le nouveau build (rien à faire — vérifier seulement)

Le correctif est sur `main` : Codemagic construit l'iOS et l'envoie sur
**TestFlight** tout seul (environ 20 à 30 minutes). Dans App Store Connect →
**TestFlight**, attendre un build **supérieur à 60** à l'état « Prêt à
tester ».

### 2. Vérifier sur un iPad (5 minutes) — AVANT de soumettre

Installer ce build par TestFlight, puis :

- [ ] l'icône sur l'écran d'accueil de l'iPad est le **« K » vert et orange** ;
- [ ] l'écran de démarrage est **vert foncé avec le « K »**, plus la croix bleue ;
- [ ] l'écran d'accueil de la caisse n'a **plus** « Créer un compte » — à la
      place : « Le compte du restaurant vous est remis à la mise en place de
      Kaissi. » ;
- [ ] « Se connecter », « Découvrir sans compte » et « Supprimer mon compte »
      sont toujours là.

Si l'un de ces points est faux, **ne soumets pas** : dis-le-moi.

### 3. App Store Connect → ton app → version **1.0**

La version 1.0 n'a jamais été publiée : on garde **1.0**, on change le BUILD.

1. Section **Build** : retirer le build **60** (icône ⊖), puis **+** et choisir
   le nouveau build.
2. **Captures d'écran** (iPad 13 pouces et iPhone 6,9 pouces) : si l'une
   d'elles montre le bouton « Créer un compte », la croix bleue, ou le
   formulaire d'inscription, la **remplacer**. Une capture qui montre une
   fonction absente de l'app est elle-même un motif de refus (2.3.3).
3. **Aperçu vidéo** (App Preview), s'il y en a un : même vérification.
4. **Informations pour la revue (App Review Information) → Notes** :
   remplacer le texte par celui de la section « Notes » ci-dessous (il ne
   dit plus « The app allows creating an account »).
5. **Informations de connexion** : le compte de démonstration ne change pas.
   ⚠ Il doit rester un compte **dédié à Apple**, jamais ton compte personnel.

### 4. Répondre, puis soumettre

1. **Centre de résolution** (le message d'Apple) → **Répondre** : coller le
   texte de la section « Message à Apple ». Apple accepte le français, mais
   l'anglais évite une traduction de plus chez le relecteur.
2. Puis, en haut de la page de la version : **Ajouter pour vérification**
   (*Add for Review*) → **Soumettre à la vérification** (*Submit for Review*).

Répondre sans soumettre ne relance RIEN : c'est la soumission du nouveau
build qui remet l'app dans la file. Compter 24 à 48 heures.

### 5. La vidéo de la règle 2.1 (soumission précédente)

La séquence qui montrait l'inscription sur l'iPad n'est plus possible — et
n'est plus demandée. Pour filmer une suppression RÉUSSIE, le compte jetable
se crée désormais sur Android (ou sur la caisse web), puis on le supprime
depuis l'iPad. Apple ne redemande pas la vidéo tant qu'il ne le dit pas.

## Message à Apple (Centre de résolution) — à coller tel quel

```
Hello,

Thank you for the review. Both issues have been fixed in a new build, which is attached to this submission.

Guideline 2.3.8 - The app icons were indeed the default placeholder icons of the native project. The app icon, the iPad and iPhone home screen icon and the launch screen now all use the final Kaissi icon (the green and orange "K"), identical to the App Store icon.

Guideline 3.1.1 - The account registration feature has been removed from the iOS app. On iPhone and iPad, the welcome screen now only offers to sign in with an existing account, to try the app without an account (offline demonstration mode), and to delete an account. Business accounts are provided to restaurants outside the app, as part of a direct business-to-business relationship. The app contains no price, no plan, no purchase, no paywall and no link to any purchase mechanism.

Account deletion remains available in the app (Guideline 5.1.1(v)), from the welcome screen and from Menu > Synchronisation > "Supprimer mon compte".

The demonstration credentials in App Review Information are unchanged.

Best regards
```

Traduction, pour toi :

> Merci pour la revue. Les deux problèmes sont corrigés dans un nouveau build,
> joint à cette soumission.
>
> 2.3.8 — Les icônes étaient bien les icônes provisoires du projet natif.
> L'icône de l'app, celle de l'écran d'accueil de l'iPad et de l'iPhone et
> l'écran de démarrage utilisent désormais l'icône définitive de Kaissi (le
> « K » vert et orange), identique à celle de l'App Store.
>
> 3.1.1 — L'inscription a été retirée de l'app iOS. Sur iPhone et iPad,
> l'écran d'accueil ne propose plus que de se connecter avec un compte
> existant, d'essayer sans compte (démonstration hors ligne) et de supprimer
> un compte. Les comptes d'entreprise sont remis aux restaurants hors de
> l'app, dans une relation commerciale directe. L'app ne contient ni prix, ni
> formule, ni achat, ni lien vers un achat.
>
> La suppression de compte reste disponible dans l'app (5.1.1(v)).
> Les identifiants de démonstration ne changent pas.

## Notes de revue (App Review Information → Notes) — remplacent les précédentes

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

ACCOUNTS (Guidelines 3.1.1 and 5.1.1(v))
The iOS app does NOT offer account registration. Business accounts are provided to restaurants outside the app, as part of a direct business-to-business relationship. On iPhone and iPad the app only signs in to an existing account.
Account deletion is available in-app, from two places:
- welcome screen > "Supprimer mon compte";
- menu > Synchronisation > "Supprimer mon compte".
The flow has two steps: the user signs in, the app shows exactly what will be erased (name, email, phone, cash register PIN, back-office access, all establishment memberships) and what will be kept (past sales and the audit log, which are accounting records and no longer carry the user's name), then asks the user to retype their email address to confirm. Deletion is immediate and permanent.

THIS APP IS NOT A WEBSITE WRAPPER (Guideline 4.2)
The entire application is bundled inside the IPA. No remote URL is loaded at runtime: no server.url, no WebView pointing at a website. Please verify by enabling Airplane Mode BEFORE the first launch - the app starts, takes orders and completes a sale with no connectivity at all. This is the core purpose of the product.
The app does contain one button that opens the system browser on our web back office, for managers (sign-in only, no registration, no purchase). That is the system browser, not the app: the app itself never loads code from the network.

EXTERNAL SERVICES
The app works fully without all of these; they are used only to synchronise data between devices when connectivity is available.
- Supabase: PostgreSQL database and email/password authentication.
- Our own synchronisation service (Node.js), hosted on Railway.
- Apple Push / Web Push, for optional staff notifications when an order is ready in the kitchen.
Not used: no payment processor, no advertising network, no analytics SDK, no tracking, no AI service, no third-party data provider. No user data is sold or shared.

PAYMENTS (Guidelines 3.1.1 / 3.1.3)
The app does NOT process, hold, route or transfer any funds, and integrates with no payment processor or card terminal. When a customer pays, staff record WHICH method was used and the amount, exactly as in a paper ledger. This is bookkeeping data entry, not a payment service.
There is no in-app purchase, no price, no plan, no paywall, and no link to any purchase mechanism. A business that has not signed with us simply has no account to sign in with, and can still use the offline demonstration mode.
```

## Si Apple refuse encore au titre de 3.1.1

Ce serait pour l'une de ces deux raisons, à vérifier dans cet ordre :

1. **Une capture d'écran ou la vidéo** montre encore l'inscription (étape 3).
2. **Le bouton « Back-office »** : si le relecteur estime que le site ouvert
   permet de s'abonner. Il ne le permet pas aujourd'hui ; si un jour une
   page de prix ou de paiement y apparaît, ce bouton devra disparaître sur
   iOS (ou pointer ailleurs). La règle à garder : **rien, depuis l'iPad, ne
   mène à un achat.**
