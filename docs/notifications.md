# Allumer les notifications de rupture de stock

Un gérant qui apprend une rupture par un serveur en salle l'apprend une heure
trop tard. Les alertes vont le CHERCHER : notification sur son téléphone,
e-mail en secours.

Ce guide couvre les deux, de la génération des clés à la vérification. Compte
**dix minutes**, une seule fois.

---

## Ce qui parle à quoi — la carte, avant les commandes

Trois pièces, et une seule d'entre elles envoie quoi que ce soit :

| Pièce | Rôle | Ce qu'elle connaît |
|---|---|---|
| **Le navigateur** du gérant | s'abonne, reçoit, affiche | la clé **publique** |
| **Le back-office** (Vercel) | propose le bouton « Recevoir les alertes » | la clé **publique** |
| **Le service de sync** (Railway) | balaie le stock et **envoie** | les **deux** clés |

> **La clé privée ne descend jamais vers le navigateur.** C'est la même règle
> que pour `SUPABASE_SERVICE_ROLE_KEY` : elle monte vers le service, elle ne
> descend pas vers le client. Le back-office n'envoie aucune notification —
> il enregistre seulement à qui en envoyer.

Le balayage tourne **toutes les 15 minutes** dans le service de sync. Il ne
réveille personne deux fois pour la même rupture : `stock_alerts` retient ce
qui est déjà parti, et ne rouvre une alerte qu'après un retour en stock.

---

## 1. Générer la paire de clés VAPID

**Sur ton PC, dans un terminal** — n'importe quel dossier :

```bash
npx web-push generate-vapid-keys
```

```
=======================================
Public Key:
BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U

Private Key:
UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls
=======================================
```

Trois choses à savoir tout de suite :

- **Ces clés sont un couple.** En changer une plus tard invalide **tous** les
  abonnements existants : chaque gérant devra recliquer sur « Recevoir les
  alertes ». Génère-les une fois, garde-les.
- **La privée est un secret.** Elle ne va ni dans le dépôt, ni dans un
  message, ni dans une variable préfixée `NEXT_PUBLIC_`.
- **Elles ne coûtent rien et n'expirent pas.** Il n'y a pas de compte à créer,
  pas de quota : VAPID sert seulement à prouver au service de notification
  (Google, Apple, Mozilla) que c'est bien toi qui envoies.

Si `npx` n'est pas disponible, la même paire s'obtient depuis le dépôt :

```bash
# Depuis la racine du dépôt Kaissi
node -e "const {generateVAPIDKeys}=require('web-push');console.log(generateVAPIDKeys())"
```

---

## 2. Poser les clés — trois variables, deux endroits

### 2.1 Railway — le service de synchronisation (celui qui ENVOIE)

**Railway → ton projet → le service `sync` → onglet `Variables` → `New
Variable`.**

| Nom | Valeur |
|---|---|
| `VAPID_PUBLIC_KEY` | la clé publique |
| `VAPID_PRIVATE_KEY` | la clé privée |
| `VAPID_SUBJECT` | `mailto:contact@res2boost.com` |

`VAPID_SUBJECT` est **obligatoire** au sens de la spécification Web Push, et
doit être un `mailto:` ou une URL `https:`. Un service de notification refuse
un sujet mal formé, et le message d'erreur ne dit pas lequel — d'où la valeur
par défaut posée dans le code. Mets-y une adresse que tu relèves : c'est celle
que Google contacte si tes envois posent problème.

Railway redéploie tout seul après l'ajout. Attends la fin.

### 2.2 Vercel — le back-office (celui qui PROPOSE le bouton)

**Vercel → ton projet → `Settings` → `Environment Variables` → `Add New`.**

| Nom | Valeur | Environnements |
|---|---|---|
| `VAPID_PUBLIC_KEY` | la clé **publique**, la même | Production, Preview, Development |

Et rien d'autre. Pas de clé privée ici.

> **Vercel ne redéploie PAS tout seul après un ajout de variable.** C'est le
> piège classique : on ajoute la variable, on recharge, le bouton reste
> absent, et on croit que la clé est mauvaise. Va dans `Deployments`, ouvre le
> dernier, `⋯` → **Redeploy**.

La variable n'est **pas** préfixée `NEXT_PUBLIC_`, et c'est voulu : la page de
stock est un composant serveur, elle lit la clé et la passe au bouton. Une
variable `NEXT_PUBLIC_` serait inscrite dans le JavaScript livré — sans
danger pour une clé publique, mais elle prendrait l'habitude, et la prochaine
serait privée.

### 2.3 En secours : l'e-mail (facultatif, recommandé)

Une notification ne part pas si le téléphone est éteint depuis deux jours.
L'e-mail, si.

| Où | Nom | Valeur |
|---|---|---|
| Railway | `RESEND_API_KEY` | `re_…`, depuis [resend.com](https://resend.com) → API Keys |
| Railway | `ALERTES_EXPEDITEUR` | `Kaissi <alertes@ton-domaine.tn>` |

Le domaine de l'expéditeur doit être vérifié chez Resend, sinon les messages
partent en indésirables. Sans `RESEND_API_KEY`, tout le reste fonctionne :
seules les notifications partent.

---

## 3. S'abonner, depuis le téléphone du gérant

1. Ouvre le back-office **en HTTPS** — `https://…vercel.app` ou ton domaine.
2. **Stock**, puis le bouton **« Recevoir les alertes »** en haut.
3. Le navigateur demande l'autorisation : **Autoriser**.

**Attendu** : le bouton passe à « Alertes activées », et une notification de
test arrive dans les secondes qui suivent.

Trois conditions, et elles ne sont pas négociables :

- **HTTPS obligatoire.** `http://localhost` marche en développement ; aucune
  autre adresse en clair ne marchera jamais. C'est une règle des navigateurs,
  pas un réglage.
- **Sur iPhone : l'application doit être ajoutée à l'écran d'accueil.** Safari
  n'accepte les notifications web que depuis une application installée
  (`Partager` → `Sur l'écran d'accueil`), depuis iOS 16.4. Dans l'onglet
  Safari ordinaire, le bouton ne s'affichera pas, et ce n'est pas un bogue.
- **Un abonnement par NAVIGATEUR, pas par personne.** Le même gérant, sur son
  téléphone et sur son ordinateur, s'abonne deux fois — et couper l'un ne
  taira pas l'autre. C'est volontaire.

---

## 4. Vérifier que ça marche vraiment

### Le chemin court

Mets un produit suivi à zéro : **Stock → Ajuster → Quantité 0 → Enregistrer**.
Attends le prochain balayage (≤ 15 min). La notification arrive, et l'article
est sorti de la carte.

### Le chemin qui dit POURQUOI, quand ça ne marche pas

**Railway → le service `sync` → `Logs`.** Le balayage écrit une ligne à chaque
passage. Cherche :

| Ce que tu lis | Ce que ça veut dire |
|---|---|
| `VAPID non configuré : aucune notification envoyée` | les variables ne sont pas arrivées jusqu'au service — vérifie l'orthographe, puis le redéploiement |
| `RESEND_API_KEY absente : aucun e-mail envoyé` | normal si tu n'as pas fait le §2.3 |
| `abonnement expiré` | le navigateur a révoqué l'abonnement (application désinstallée, données effacées). La ligne est retirée toute seule ; il suffit de recliquer sur « Recevoir les alertes » |
| rien du tout | le service ne tourne pas, ou le balayage n'est pas démarré |

Et en base, ce qui répond à « suis-je vraiment abonné » :

```sql
select user_id, alertes_stock, created_at
from kaissi.push_subscriptions
where restaurant_id = '‹ton-uuid›';
```

Une ligne par navigateur abonné. Zéro ligne : le clic n'a pas abouti — regarde
la console du navigateur, l'erreur y est.

---

## 5. Les trois pannes qu'on rencontre vraiment

**« Notifications non configurées sur ce serveur (clé VAPID absente). »**
Le back-office ne voit pas `VAPID_PUBLIC_KEY`. Neuf fois sur dix : la variable
est bien posée sur Vercel, mais **le projet n'a pas été redéployé**. Une
variable d'environnement n'est lue qu'à la construction.

**Le bouton n'apparaît pas du tout, sur iPhone.**
L'application n'est pas sur l'écran d'accueil. Voir §3.

**Les notifications marchaient, elles ne marchent plus.**
Quelqu'un a régénéré les clés VAPID. Une paire changée invalide tous les
abonnements existants — chaque gérant doit recliquer sur « Recevoir les
alertes ». C'est pour cela qu'on garde la première paire.

---

## Ce que ce système ne fait PAS, et pourquoi

**Il ne prévient pas la caisse.** Une tablette hors ligne ne reçoit rien, et
c'est cohérent : ce n'est pas au caissier de gérer un réapprovisionnement.
Ce qui atteint la caisse, c'est le retrait du produit de la carte — par le
catalogue, comme un changement de prix.

**Il ne bloque aucune vente.** L'alerte informe ; `products.is_available`
décide. Les deux sont volontairement séparés : une notification manquée ne
doit jamais empêcher d'encaisser.

**Il ne réveille pas vingt fois.** Une alerte par produit reste ouverte tant
que la rupture dure, et vingt produits d'un même établissement font **une**
notification groupée — pas vingt vibrations le jour de l'inventaire.
