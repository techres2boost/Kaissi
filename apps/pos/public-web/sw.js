/**
 * Service worker du POS servi comme site (cible `web`).
 *
 * Il a UNE responsabilité : que l'application s'ouvre sans réseau. C'est la
 * traduction, pour un navigateur, de la règle qui interdit `server.url` dans
 * l'APK — si le code de l'application vient du réseau, une coupure ferme la
 * caisse.
 *
 * Les DONNÉES ne passent pas par ici : elles vivent dans IndexedDB
 * (`donnees/sqlite-web.ts`). Ce fichier ne met en cache que la coque.
 *
 * ── Le piège dans lequel la version précédente est tombée ─────────────────
 *
 * Elle servait `index.html` DEPUIS LE CACHE D'ABORD, et son nom de cache
 * était une constante. Conséquences enchaînées :
 *
 *   • `index.html` mis en cache à la toute première visite y restait pour
 *     toujours ;
 *   • il désigne des fichiers `assets/index-<empreinte>.js` — donc l'ANCIEN
 *     bundle, lui aussi en cache sous un nom qui ne change jamais ;
 *   • `activate` supprimait « les caches dont le nom diffère », mais le nom
 *     ne changeait jamais : il ne supprimait rien ;
 *   • et comme ce fichier lui-même restait identique d'un déploiement à
 *     l'autre, le navigateur ne le réinstallait même pas.
 *
 * Résultat vu en production : une caisse figée sur un bundle vieux de
 * plusieurs jours. Elle affichait encore l'ancien écran d'appairage — celui
 * qui demandait un jeton `kdev_…` — alors que le formulaire à e-mail et mot
 * de passe était en ligne depuis longtemps. Aucun correctif ne pouvait
 * l'atteindre. C'est la pire panne possible : silencieuse, et elle fait
 * chercher les bogues dans du code qui ne tourne pas.
 *
 * ── La stratégie, maintenant ──────────────────────────────────────────────
 *
 *   • navigation → le RÉSEAU d'abord, le cache en repli. En ligne, la caisse
 *     exécute toujours la dernière version ; hors ligne, elle s'ouvre depuis
 *     le cache. Le repli est immédiat : hors ligne, `fetch` échoue tout de
 *     suite. Le délai de 3 s ne sert qu'au réseau LENT, celui qui ne répond
 *     ni oui ni non — et 3 s d'attente une fois au démarrage valent mieux
 *     qu'une version figée pour des semaines.
 *   • ressources bâties (`assets/…`, `.wasm`) → le cache d'abord. Leur nom
 *     porte une empreinte : sous le même nom, le contenu ne change jamais.
 *   • tout le reste (l'API de synchronisation) → le réseau, jamais le cache.
 *     Servir une réponse de sync périmée serait pire que ne rien servir.
 *
 * Et le nom du cache porte la VERSION DU BUILD, remplacée à la construction
 * (`vite.config.ts`). Chaque déploiement produit donc un fichier différent :
 * le navigateur le réinstalle, `activate` efface les caches des versions
 * précédentes, et la page se recharge d'elle-même (`main.tsx`).
 */

// Remplacé au build par l'empreinte du bundle. La valeur littérale ne sert
// qu'au développement, où le service worker n'est de toute façon pas actif.
const VERSION = '__VERSION_BUILD__'
const CACHE = `kaissi-coque-${VERSION}`
const COQUE = ['./', './index.html']

/** Au-delà, on considère le réseau absent et on sert la coque en cache. */
const DELAI_RESEAU_MS = 3000

self.addEventListener('install', (evenement) => {
  evenement.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(COQUE)))
  // La nouvelle version prend la main sans attendre la fermeture de tous les
  // onglets : sur une tablette de caisse, l'onglet n'est jamais fermé.
  self.skipWaiting()
})

self.addEventListener('activate', (evenement) => {
  evenement.waitUntil(
    caches
      .keys()
      // Tous les caches de Kaissi SAUF celui de cette version. Les anciens
      // contiennent l'ancien index.html et ses anciens assets : les garder,
      // c'est garder la panne.
      .then((noms) => Promise.all(noms.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  )
})

/** Rejette après `ms` : un réseau qui ne répond pas n'est pas un réseau. */
function avecDelai(promesse, ms) {
  return new Promise((resoudre, rejeter) => {
    const minuteur = setTimeout(() => rejeter(new Error('délai réseau dépassé')), ms)
    promesse.then(
      (valeur) => {
        clearTimeout(minuteur)
        resoudre(valeur)
      },
      (erreur) => {
        clearTimeout(minuteur)
        rejeter(erreur)
      },
    )
  })
}

async function coqueAJour(requete) {
  const cache = await caches.open(CACHE)
  try {
    const reponse = await avecDelai(fetch(requete), DELAI_RESEAU_MS)
    if (reponse && reponse.ok) {
      // On met à jour la coque hors ligne AVEC ce qu'on vient de servir :
      // les deux ne doivent jamais diverger.
      await cache.put('./index.html', reponse.clone())
      return reponse
    }
  } catch {
    // Hors ligne, ou réseau qui ne répond pas. Ce n'est pas une erreur :
    // c'est le cas nominal d'un restaurant dont la box a lâché.
  }
  const enCache = await cache.match('./index.html')
  if (enCache) return enCache
  // Ni réseau ni cache : première visite hors ligne. On laisse le navigateur
  // afficher SON message, qui dit au moins la vérité.
  return fetch(requete)
}

self.addEventListener('fetch', (evenement) => {
  const requete = evenement.request
  if (requete.method !== 'GET') return

  const url = new URL(requete.url)
  if (url.origin !== self.location.origin) return // API de sync : réseau seul.

  if (requete.mode === 'navigate') {
    evenement.respondWith(coqueAJour(requete))
    return
  }

  evenement.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(requete).then((enCache) => {
        if (enCache) return enCache
        return fetch(requete).then((reponse) => {
          // Seules les réponses complètes et valides entrent en cache : mettre
          // en cache une 404 ou une réponse partielle rendrait la panne
          // permanente.
          if (reponse.ok && reponse.type === 'basic') {
            const copie = reponse.clone()
            void cache.put(requete, copie)
          }
          return reponse
        })
      }),
    ),
  )
})
