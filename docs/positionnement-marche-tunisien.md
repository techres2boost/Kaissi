# Positionnement — face à toutes les caisses vendues en Tunisie

**Date** : 27 octobre 2026 · **Destinataire** : le CTO · **Méthode** :
recherche web du 27 octobre 2026, complétée par la lecture du code du dépôt
pour tout ce qui nous concerne.

> ⚠ **Limite de cette note, à lire avant de décider.** Les sites tunisiens
> (`.tn` en particulier) ne sont **pas joignables** depuis mon environnement :
> le proxy de sortie les refuse. Tout ce qui concerne les concurrents vient
> donc de résultats de recherche et de **pages commerciales des éditeurs
> eux-mêmes** — prix affichés, homologation revendiquée. Rien n'est vérifié
> auprès du ministère ni par un essai du produit. Les prix bougent, et une
> page de vente n'est pas une preuve d'homologation.
>
> **Ce qui doit être vérifié à la main avant toute décision commerciale** :
> (1) la liste officielle des systèmes homologués sur
> `homologation.nacef.tn`, (2) les prix réels en demandant un devis, (3) ce
> que chacun fait vraiment quand on coupe Internet — un essai de trente
> secondes qui départage tout le marché.

---

## La réponse en une page

Le marché tunisien de la caisse pour cafés et restaurants se divise en
**quatre familles**, et aucune n'occupe la position que nous visons.

| Famille | Qui | Homologué NACEF | Marche sans Internet | Moderne (tablette, cloud, multi-sites) |
|---|---|---|---|---|
| **A — Caisses fiscales locales** | ASM POS, TMS, Numedia/Cortexpos, Megasoft, caisses.tn, KAISSE | **Revendiqué oui** | Oui (un PC, en local) | Non |
| **B — SaaS cloud tunisiens** | Gastevo, Kesti, Al-Makhzan, Hesabi, BelloCaisse, Awel, Smart Soft | **Non** (Gastevo le dit lui-même) | **Non** | Oui |
| **C — Internationaux** | Loyverse, Square, Odoo, Toast, Lightspeed | Non | Partiellement | Oui |
| **D — ERP / intégrateurs** | Sage, Odoo partenaires, Operacium | Via module | Variable | Oui, mais lourd |
| **→ Kaissi** | nous | **Pas encore** ⚠ | **Oui, par conception** | Oui |

**La case vide du marché, et c'est la nôtre** : *homologué* **et** *vraiment
hors ligne* **et** *moderne*. La famille A a l'homologation mais un logiciel
d'une génération précédente. La famille B a le logiciel moderne mais **meurt
avec la connexion** et n'est pas homologuée. Personne ne tient les trois.

**L'asymétrie qui décide de la stratégie** :

> Ce qui nous manque (l'homologation) s'achète avec du temps administratif et
> quelques semaines de code. Ce qui leur manque (une architecture hors ligne
> d'abord, event-sourcée, exacte au millime) ne se rattrape pas par une mise à
> jour : c'est une réécriture.
>
> **Donc : l'homologation est la priorité numéro un, et il n'y en a pas
> d'autre.** Chaque semaine sans elle est une semaine où la famille A ramasse
> un marché que la loi lui livre.

---

## 1. Famille A — les caisses fiscales locales

Ce sont nos vrais concurrents, parce qu'ils ont la seule chose que nous
n'avons pas.

| Éditeur | Ce qu'il vend | Homologation revendiquée | Prix (⚠ affiché par l'éditeur) |
|---|---|---|---|
| **ASM POS** (`asmpos.com`) | Caisse tactile + logiciel | « 100 % homologuée » | Devis |
| **TMS Tunisia** | « Caisse fiscale homologuée NACEF certifiée » | Oui | Devis |
| **Numedia / Cortexpos** | Caisse tactile + logiciel | « Certifié et homologué par le ministère des Finances via la plateforme NACEF » | Devis |
| **Megasoft ERP** | Logiciel de caisse + module **S-MDF** | Oui, avec son propre module de sécurisation | Devis |
| **caisses.tn** | Logiciel, achat unique | Cite l'arrêté du 14/10/2025 | **820 TND une fois**, sans abonnement |
| **KAISSE** (`kaisse.tn`) | Caisse | Cite l'arrêté du 14/10/2025 | Devis |

**Leurs forces, qu'il ne faut pas sous-estimer** :

1. **L'homologation**, revendiquée et probablement réelle pour plusieurs. En
   face d'un restaurateur qui risque une amende, c'est le seul argument qui
   compte.
2. **Le réseau terrain** : installateurs, SAV, techniciens qui passent. Le
   décret impose au fournisseur un service après-vente et la déclaration des
   maintenances (⚠ §2 de [`conformite-fiscale.md`](conformite-fiscale.md)) —
   une obligation que nous devrons tenir aussi.
3. **L'achat unique**, 820 TND chez `caisses.tn`. Le restaurateur tunisien
   préfère souvent payer une fois que s'abonner. C'est un vrai argument
   culturel, et notre modèle d'abonnement devra y répondre.
4. **Megasoft porte son propre module S-MDF** : il ne dépend de personne pour
   la partie fiscale. C'est exactement ce que nous devrons construire ou
   acheter.

**Leurs faiblesses, et ce sont nos angles** :

| Leur faiblesse | Ce que ça coûte au restaurateur | Notre réponse |
|---|---|---|
| Un PC, dans l'arrière-salle | Un seul poste. Pas de serveur en salle avec une tablette | Autant de tablettes qu'on veut, qui se synchronisent sans conflit |
| Pas de back-office à distance | Le patron doit venir voir sa caisse pour connaître son chiffre | Le chiffre du jour depuis son téléphone, de n'importe où |
| Mono-établissement | Deux restaurants = deux logiciels, deux chiffres à additionner à la main | Multi-établissements d'origine, rapports consolidés |
| Logiciel Windows de génération précédente | Formation longue, serveurs qui refusent de l'utiliser | Une caisse qu'un serveur prend en main en dix minutes |
| Pas d'arabe, ou de l'arabe bancal | La moitié de l'équipe lit mal le français | Français **et** arabe, RTL complet, vérifié en CI |
| Panne du PC = journée perdue | Le disque meurt un samedi soir | Les données vivent sur chaque tablette **et** au serveur |

**Ce qu'il faut aller vérifier chez eux**, parce que ça change le discours :
est-ce que leur caisse continue d'encaisser quand le MDF ne joint plus la
plateforme du ministère ? C'est la question que personne ne pose, et notre
architecture y répond mieux que la leur.

---

## 2. Famille B — les SaaS cloud tunisiens

C'est là que se trouve l'argent facile aujourd'hui, et le piège.

| Éditeur | Cible | Prix (⚠ affiché par l'éditeur) | Homologué NACEF |
|---|---|---|---|
| **Kesti** (`kesti.tn`) | Cafés et restaurants | **29 DT/mois**, sans commission, 1 mois d'essai | Non annoncé |
| **Gastevo** (`gastevo.com`) | Commerce + édition restauration | **20 TND** (1 module), 30 (2), **35 (3)** par point de vente et par mois | **Non — l'éditeur l'écrit lui-même** |
| **Al-Makhzan** | Restauration | **79 TND/mois** ou 790 TND/an, 14 j d'essai | Non annoncé |
| **Hesabi** (`hesabi.tn`) | Facturation + caisse | Gratuit / freemium | Non annoncé |
| **BelloCaisse** | Commerçants | À l'unité | Non annoncé |
| **Awel.tn**, **Smart Soft** | Généralistes | 199 TND/mois · 900 TND (⚠ comparatif 2024, probablement périmé) | Non annoncé |

**Leur force** : le prix, la rapidité d'installation, un marketing de contenu
très actif — Gastevo publie des comparatifs qui se classent avant tout le
monde sur « logiciel de caisse Tunisie ». **C'est une leçon pour nous** :
ils gagnent la recherche Google, pas le terrain.

**Leur faiblesse est structurelle, et elle est fatale pour un restaurant** :

> **Une caisse cloud sans Internet ne s'ouvre pas.** Ce n'est pas un défaut de
> configuration, c'est leur architecture. En Tunisie, la coupure ADSL d'une
> heure un samedi soir n'est pas un scénario théorique.

Et surtout : **Gastevo écrit noir sur blanc qu'il n'est pas une caisse
certifiée NACEF**. Toute cette famille est donc, en l'état, **invendable à un
restaurant soumis à l'obligation** — c'est-à-dire, à terme, à tous.

**Conclusion commerciale** : ce n'est pas contre eux qu'il faut se battre. Ce
sont eux qui, dans dix-huit mois, devront expliquer à leurs clients pourquoi
il faut tout changer.

---

## 3. Famille C — les internationaux

| Solution | Disponible en Tunisie | Le problème |
|---|---|---|
| **Square** | L'application se télécharge, **mais on ne peut pas encaisser une carte** | Mort-né ici |
| **Loyverse** | Oui, gratuit | Pas de TEIF/El Fatoora, dinar à configurer **à la main**, support communautaire, pas d'homologation |
| **Odoo POS** | Via un intégrateur local | Lourd, cher à l'usage (≈ 20 $/utilisateur/mois), conformité par connecteur tiers |
| **Toast, Lightspeed** | Pas présents | — |

**Le point à retenir, et il est pour nous** : aucun international ne gère le
**dinar à trois décimales** correctement sans bricolage, aucun ne connaît le
**droit de timbre**, aucun ne sera homologué NACEF — le marché est trop petit
pour qu'ils construisent un module fiscal tunisien.

C'est précisément la barrière qui protège les acteurs locaux, et donc nous.

---

## 4. Famille D — ERP et intégrateurs

Sage, les partenaires Odoo, Operacium (à partir de 10 €/mois, tarifs en
euros). Ils visent la chaîne de restaurants, le groupe hôtelier, l'entreprise
qui a déjà un comptable interne. **Ce n'est pas notre client**, et ce n'est
pas la peine d'aller le chercher : le cycle de vente est long, l'intégration
est un métier, et le prix n'a rien à voir.

À garder en tête pour plus tard : le jour où une chaîne de dix restaurants
nous appelle, c'est contre eux qu'on sera comparés — et là, le multi-sites
consolidé et les rapports agrégés en SQL (migration 0033) sont de vrais
arguments.

---

## 5. Notre positionnement — la phrase, et ce qui la tient

### La phrase

> **La seule caisse tunisienne qui soit à la fois moderne et qui n'arrête
> jamais d'encaisser.**
>
> Les caisses d'hier marchent sans Internet mais tiennent sur un PC dans
> l'arrière-salle. Les caisses cloud sont belles et s'arrêtent avec la
> connexion. Kaissi encaisse sur tablette, sans réseau, sans limite de durée,
> et le patron voit son chiffre depuis son téléphone.

### Les cinq preuves — vérifiables, pas déclaratives

Un argument de vente qui ne se démontre pas en trente secondes ne sert à
rien. Ceux-là se démontrent.

| Argument | La démonstration | Où c'est tenu dans le code |
|---|---|---|
| **1. Mode avion** | On met la tablette en mode avion **devant le client**, on encaisse trois ventes, on rallume : tout remonte | `apps/pos/scripts/verifier-mode-avion.mjs`, vérifié à chaque PR |
| **2. Aucune vente perdue ni doublée** | Trois tablettes, coupures réseau aléatoires, totaux identiques au millime | `apps/sync/test/banc-trois-appareils.test.ts` |
| **3. Le dinar à trois décimales** | On tape 24,5 → 24,500 TND. Chez les autres, vérifier ce que fait 0,005 | Entiers de millimes, règle 1 ; `packages/domain` |
| **4. Personne ne peut modifier une vente** | Journal en insertion seule, chaîné par hash : une annulation **ajoute** une ligne | `order_events`, `audit_events`, règle 6 |
| **5. Français et arabe** | On bascule la langue devant lui | `packages/i18n`, couverture vérifiée en CI |

### Ce que nous ne dirons PAS

- **« Homologué »** — tant que ce n'est pas écrit sur le portail du ministère.
  C'est la seule ligne rouge commerciale du produit : une fausse déclaration
  d'homologation expose le client à une amende et nous à la fin de l'histoire.
- **« Conforme »** — même raison. On dit « conçu pour la conformité », et on
  montre le journal inaltérable.
- **« Moins cher »** — Hesabi est gratuit et Gastevo à 20 TND. On ne gagne pas
  ce terrain-là, et le gagner attirerait les clients qui partent au premier
  concurrent à 15 TND.

### Notre faiblesse, à dire avant qu'on nous la sorte

| Faiblesse | Ce qu'on répond |
|---|---|
| **Pas homologué** ⚠ | Vrai, et c'est en cours. En attendant on ne vend qu'aux établissements que l'obligation ne vise pas encore (⚠ à faire trancher client par client par l'expert-comptable) |
| **Pas de SAV terrain** | Vrai. Pour le pilote, c'est vous qui installez — et c'est un avantage : chaque installation est vue |
| **Aucun client de référence** | Vrai : 9 établissements en base, tous de démonstration, **zéro client payant** |
| **Pas de ticket papier aujourd'hui** | Le module est écrit et testé, il est éteint. Il se rallume en une commande, après validation sur les imprimantes du marché |
| **Pas de paiement par carte intégré** | Aucun concurrent tunisien ne l'a vraiment non plus, et Square ne peut pas encaisser de carte ici. Ce n'est pas une obligation légale (§3 de [`conformite-fiscale.md`](conformite-fiscale.md)) |

---

## 6. Le prix — la décision qui reste à prendre

Le marché donne trois ancres :

| Modèle | Ancre du marché | Ce que ça dit |
|---|---|---|
| Abonnement bas de gamme | 20–35 TND/mois (Gastevo, Kesti) | C'est le prix d'une caisse **qui s'arrête sans Internet** |
| Abonnement restauration | 79 TND/mois (Al-Makhzan) | Le haut du SaaS local |
| Achat unique | 820 TND (caisses.tn) + matériel 1 500–4 000 TND | Le réflexe culturel |

**Ma recommandation, et c'est une décision de CTO autant que de direction** :

1. **Ne pas se placer en bas.** À 29 TND on se bat contre un produit qui ne
   fait pas le même métier, et on finance mal l'homologation et le SAV.
2. **Viser 59 à 89 TND par mois et par établissement**, caisses
   supplémentaires incluses ou à faible coût — parce que notre architecture
   rend la deuxième tablette presque gratuite, alors qu'elle coûte une licence
   chez la famille A. **C'est un avantage de coût structurel : il faut le
   transformer en avantage de prix.**
3. **Proposer aussi une formule d'entrée payée une fois** (par exemple
   1 490 TND + maintenance annuelle), pour le restaurateur qui refuse
   l'abonnement par principe. Le code n'y change rien : `subscriptions`
   enregistre déjà la formule.
4. **Facturer par établissement, pas par caisse.** Le modèle par caisse
   pousse le client à en mettre moins — exactement le contraire de ce qu'on
   veut, puisque chaque tablette de plus augmente sa dépendance au produit.

⚠ Le point dur n'est pas le prix, c'est **l'encaissement de l'abonnement** :
rien n'est intégré aujourd'hui (§2.5 de
[`pret-pour-la-production.md`](pret-pour-la-production.md)). Pour cinq
pilotes, un tableur et des virements. Au-delà, il faut un processus.

---

## 7. Ce que je ferais à votre place — par ordre

1. **Homologation NACEF** : le dossier, cette semaine. Rien n'est plus
   important, et rien d'autre ne débloque la vente
   ([`conformite-fiscale.md`](conformite-fiscale.md) §5).
2. **Tester les concurrents pour de vrai** : télécharger Kesti, Gastevo,
   Hesabi, Loyverse ; ouvrir un compte d'essai ; **couper le Wi-Fi**. Prendre
   une vidéo de ce qui se passe. C'est notre meilleur support de vente, et il
   coûte une après-midi.
3. **Demander un devis à ASM, TMS et Numedia** en se présentant comme un
   restaurateur. On apprend leur prix réel, leur délai d'installation, et ce
   qu'ils promettent sur l'homologation.
4. **Vérifier la liste officielle des homologués** sur
   `homologation.nacef.tn`. Si ASM et TMS n'y sont pas, le marché est plus
   ouvert qu'il n'y paraît — et c'est l'information la plus précieuse de
   cette note.
5. **Trancher le nom** avant de communiquer : « KAISSE » existe, s'adresse
   aux mêmes clients, et le nom est presque identique
   ([`nom-du-produit.md`](nom-du-produit.md)).

---

## Sources

⚠ Aucune de ces sources n'est officielle. Les pages d'éditeurs sont des pages
de vente ; les prix et les homologations qu'elles annoncent doivent être
vérifiés.

- [Gastevo — caisse enregistreuse en Tunisie : prix, types et fiscalité (2026)](https://gastevo.com/blog/caisse-enregistreuse-tunisie-prix-comparatif-2026)
- [Gastevo — Square, Shopify, Loyverse : quelle caisse en Tunisie ?](https://gastevo.com/blog/logiciels-caisse-internationaux-tunisie-comparatif)
- [Gastevo — comment choisir un logiciel de caisse en Tunisie : 8 critères](https://gastevo.com/blog/comment-choisir-logiciel-caisse-tunisie-2026)
- [Gastevo — caisse enregistreuse vs logiciel de caisse cloud](https://gastevo.com/blog/caisse-enregistreuse-vs-logiciel-caisse-cloud)
- [Kesti — caisse tactile pour cafés et restaurants](https://kesti.tn/)
- [Al-Makhzan — logiciel de gestion pour restaurants](https://al-makhzan.com/)
- [Hesabi — logiciel de caisse POS Tunisie](https://hesabi.tn/logiciel-caisse-pos-tunisie)
- [BelloCaisse](https://bellocaisse.github.io/)
- [caisses.tn — logiciel de caisse](https://caisses.tn/logiciel-de-caisse/) · [comparatif](https://caisses.tn/comparatif-logiciel-caisse-tunisie/) · [caisses obligatoires](https://caisses.tn/caisses-obligatoires-en-tunisie/)
- [ASM POS — homologation de nos caisses tactiles](https://asmpos.com/caisse-fiscale-tunisie/)
- [TMS Tunisia — caisse fiscale homologuée NACEF](https://www.tmstunisia.com/FR/caisse-enregistreuse-fiscale-homologuee-certifiee-tunisie.awp)
- [Numedia — solutions caisses enregistreuses (Cortexpos)](https://www.numedia.tn/solutions-caisses-enregistreuses)
- [Megasoft ERP — logiciel de caisse et module S-MDF](https://www.megasofterp.com/logiciel-caisse-enregistreuse-tunisie-megasoft-erp/)
- [KAISSE](https://kaisse.tn/)
- [Operacium — logiciel caisse restaurants Tunisie](https://operacium.com/fr-tn/activites/restaurants)
- [Loyverse POS — profil](https://www.softwareadvice.com/retail/loyverse-profile/)
- [Odoo POS — revue 2026](https://www.posusa.com/odoo-pos-review/)
