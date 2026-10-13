# Imprimante — acheter, brancher, tester

Ce guide sert le jour où l'imprimante arrive. En attendant, le §5 montre
comment tout tester sans elle.

> **Où imprime-t-on ?** Uniquement depuis l'**application Android** (APK).
> La caisse web ne peut pas imprimer : un navigateur n'a pas le droit
> d'ouvrir une connexion directe vers une imprimante.

---

## 1. Quoi acheter

### Les critères, à vérifier sur la fiche produit

| Critère | Pourquoi |
|---|---|
| **Thermique 80 mm** | Kaissi met les tickets en page sur 42 colonnes (le 58 mm est prévu, mais moins lisible en cuisine) |
| **ESC/POS** | Le langage que Kaissi envoie. Presque toutes les imprimantes de caisse le parlent |
| **Port Ethernet (RJ45)**, souvent noté « LAN » | Kaissi imprime **par le réseau** (port 9100). ⚠ Une imprimante **USB seule** ou **Bluetooth seule** ne marchera pas |
| **Coupe-papier automatique** | Sinon il faut déchirer chaque ticket |
| **Port tiroir-caisse (RJ11)** | Seulement si tu veux que le tiroir s'ouvre à l'encaissement en espèces |
| **Page de codes PC858** (ou « Western Europe ») | Pour les accents (é, è, à, ç…) et le symbole € |

### Modèles

| | Modèle | Remarque |
|---|---|---|
| **Référence** | **Epson TM-T20III**, version **Ethernet** | Robuste, la plus répandue en caisse |
| **Économique** | **Xprinter XP-N160II**, version **LAN** | Très courante en Tunisie |

Une par poste : une en **cuisine**, une au **bar** si le bar prépare. Le
ticket client sort sur la première des deux (voir §3).

Prévoir aussi : un **câble Ethernet** par imprimante, des **rouleaux 80 mm**,
et un routeur ou un switch avec un port libre par imprimante.

---

## 2. Brancher et trouver son adresse

1. Papier, alimentation, câble Ethernet vers le **routeur du restaurant** —
   le même réseau que la tablette.
2. **Ticket d'auto-test** : imprimante éteinte, garde le bouton **FEED**
   appuyé, allume-la, relâche après 2 secondes. Le ticket imprime son
   **adresse IP** (ex. `192.168.1.87`).
3. **Fixe cette adresse**, sinon elle peut changer au prochain redémarrage
   du routeur et la cuisine ne reçoit plus rien. Le plus simple : dans
   l'interface du routeur, **réserver** cette IP pour l'imprimante (« bail
   DHCP statique » / « DHCP reservation »).

---

## 3. Configurer Kaissi

### Au back-office

1. **Paramètres → Imprimantes cuisine** : pour chaque poste (*Cuisine*,
   *Bar*), saisis l'**adresse IP** et le port **9100**.
2. **Articles → Catégories** : chaque catégorie doit avoir son **poste**
   (Plats → Cuisine, Boissons → Bar). Un article dont la catégorie n'a pas de
   poste n'est imprimé nulle part.
3. Le **ticket client** sort sur le **premier poste qui a une adresse**
   (dans l'ordre de la liste).

La caisse reçoit ces réglages à la synchronisation suivante.

### Allumer l'impression dans l'application

La version distribuée aujourd'hui **n'imprime pas** : les tickets
s'affichent à l'écran. Pour l'allumer :

- **Pour toutes les caisses (Play Store)** : dans **Codemagic**, ajoute la
  variable d'environnement `VITE_IMPRESSION` = `1` au workflow Android, puis
  pousse sur `main`. Le prochain build publié imprime.
- **Pour un essai sur une seule tablette**, sur ton PC, à la racine du dépôt :

```bash
pnpm pos:build:impression
cd apps/pos && npx cap sync android && npx cap run android
```

### Sur la tablette

Menu ☰ → **Diagnostic** → bloc **Imprimantes** → **Tester** sur chaque poste.

**Attendu** : « Joignable en N ms ».

---

## 4. Vérifier que tout marche

| Geste | Attendu |
|---|---|
| Une commande avec un plat et une boisson → **Cuisine** | Un bon sort en cuisine (le plat), un au bar (la boisson). Rien à l'écran |
| Renvoyer **Cuisine** sans rien ajouter | Rien ne ressort : un bon déjà parti n'est **jamais** réimprimé |
| **Encaisser** | Le ticket client sort, coupé ; les accents sont justes (« Escalope panée ») |
| Encaisser en **espèces** | Le tiroir s'ouvre (s'il est branché sur l'imprimante) |
| Débrancher le câble réseau de l'imprimante, encaisser | La vente passe quand même ; un **badge rouge 🖨** apparaît en haut |
| Rebrancher | Le badge disparaît tout seul : le ticket en attente sort |
| Clôturer la caisse | Le ticket de clôture sort |

### Si ça n'imprime pas

| Symptôme | Cause et geste |
|---|---|
| « Connexion refusée » ou « ne répond pas » | Mauvaise IP, imprimante éteinte, ou pas sur le même réseau que la tablette. Refais le ticket d'auto-test et compare l'IP |
| Ça marchait hier, plus aujourd'hui | L'IP a changé : réserve-la dans le routeur (§2.3) |
| Les accents sortent en symboles bizarres | L'imprimante n'accepte pas la page PC858. Les minuscules (é è à ç) doivent rester justes ; signale le modèle |
| Rien ne sort pour une boisson | Sa catégorie n'a pas de poste (§3) |
| Le tiroir ne s'ouvre pas | Il doit être branché sur le port RJ11 **de l'imprimante**, pas sur la tablette |

---

## 5. Tester sans imprimante

Trois niveaux, du plus simple au plus complet.

| Niveau | Ce qu'il prouve | Ce qu'il ne prouve pas |
|---|---|---|
| **Les tickets à l'écran** (version actuelle) | Le **contenu** et la **mise en page** : ce sont exactement les octets qui partiraient à l'imprimante, relus comme elle les lirait | Le réseau, la file d'attente, la coupe, le tiroir |
| **L'imprimante virtuelle** | **Toute la chaîne** jusqu'au réseau : file d'attente, nouvel essai, badge rouge, coupe, tiroir, page de caractères | Le papier |
| **La vraie imprimante** | Tout | — |

Donc oui : les tickets à l'écran suffisent pour valider **ce qui est
imprimé**. Pour valider **que ça part**, l'imprimante virtuelle :

1. Sur ton PC, à la racine du dépôt :

```bash
node apps/pos/scripts/imprimante-virtuelle.mjs
```

   Elle écoute le port 9100 comme une vraie imprimante et affiche chaque
   ticket reçu, avec « ✂ coupe du papier », « 💰 ouverture du tiroir » et
   « 🔤 page 19 (CP858) ».

2. Une caisse **avec l'impression allumée** (§3), qui vise ton PC :
   - émulateur Android : adresse `10.0.2.2`, port `9100` ;
   - tablette sur le même Wi-Fi : l'**IP du PC** (le script l'affiche au
     démarrage), port `9100`.

3. Rejoue le tableau du §4 : chaque ticket apparaît dans le terminal.
   Arrête le script (Ctrl+C) pour simuler une imprimante éteinte : le badge
   rouge doit apparaître, puis disparaître quand tu le relances.

Le pas à pas avec l'émulateur Android est dans
[`tester-sans-tablette.md`](tester-sans-tablette.md).
