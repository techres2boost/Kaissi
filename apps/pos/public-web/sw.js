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
 * Stratégie, volontairement banale :
 *   • navigation      → le cache d'abord, le réseau ensuite. Une caisse qui
 *     s'ouvre en 20 ms hors ligne vaut mieux qu'une caisse à jour en 3 s.
 *   • ressources bâties (/assets/…, .wasm) → le cache d'abord ; leur nom
 *     porte une empreinte, elles ne changent jamais sous le même nom.
 *   • tout le reste (l'API de synchronisation) → le réseau, jamais le cache.
 *     Servir une réponse de sync périmée serait pire que ne rien servir.
 */

const CACHE = 'kaissi-coque-v1'
const COQUE = ['./', './index.html']

self.addEventListener('install', (evenement) => {
  evenement.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(COQUE)),
  )
  // La nouvelle version prend la main sans attendre la fermeture de tous les
  // onglets : sur une tablette de caisse, l'onglet n'est jamais fermé.
  self.skipWaiting()
})

self.addEventListener('activate', (evenement) => {
  evenement.waitUntil(
    caches
      .keys()
      .then((noms) => Promise.all(noms.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (evenement) => {
  const requete = evenement.request
  if (requete.method !== 'GET') return

  const url = new URL(requete.url)
  if (url.origin !== self.location.origin) return // API de sync : réseau seul.

  if (requete.mode === 'navigate') {
    evenement.respondWith(
      caches
        .match('./index.html')
        .then((enCache) => enCache || fetch(requete))
        .catch(() => caches.match('./index.html')),
    )
    return
  }

  evenement.respondWith(
    caches.match(requete).then((enCache) => {
      if (enCache) return enCache
      return fetch(requete).then((reponse) => {
        // Seules les réponses complètes et valides entrent en cache : mettre
        // en cache une 404 ou une réponse partielle rendrait la panne
        // permanente.
        if (reponse.ok && reponse.type === 'basic') {
          const copie = reponse.clone()
          void caches.open(CACHE).then((cache) => cache.put(requete, copie))
        }
        return reponse
      })
    }),
  )
})
