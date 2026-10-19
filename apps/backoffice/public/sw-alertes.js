/*
 * Service worker des alertes — il ne sert QUE les notifications.
 *
 * Il ne met RIEN en cache, et c'est délibéré : le back-office est une
 * application serveur, il n'a pas à fonctionner hors ligne (c'est la caisse
 * qui porte cette exigence, et elle est empaquetée dans son APK). Un cache
 * ici ne ferait que servir une page périmée après un déploiement — la panne
 * la plus difficile à diagnostiquer qui soit, parce qu'elle ne ressemble
 * pas à une panne.
 *
 * Une notification push ne peut PAS être reçue sans service worker : c'est
 * lui que le navigateur réveille quand l'onglet est fermé. C'est toute la
 * raison de ce fichier.
 */

// Prend la main immédiatement, sans attendre la fermeture des onglets : un
// gérant qui vient d'activer les alertes doit les recevoir tout de suite.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (evenement) => evenement.waitUntil(self.clients.claim()))

self.addEventListener('push', (evenement) => {
  let charge
  try {
    charge = evenement.data ? evenement.data.json() : {}
  } catch {
    // Charge illisible : on affiche quand même quelque chose. Une
    // notification muette vaut mieux qu'un silence — le gérant ouvrira
    // l'écran Stock, qui fait foi.
    charge = {}
  }

  const titre = charge.titre || 'Kaissi'
  evenement.waitUntil(
    self.registration.showNotification(titre, {
      body: charge.corps || 'Ouvrez Kaissi pour voir le détail.',
      // `tag` : une nouvelle alerte de stock REMPLACE la précédente au lieu
      // de s'empiler — dix notifications non lues ne se lisent pas, elles se
      // balaient, et on balaie alors aussi la vraie. Les arrivées en
      // préparation (0047) portent leur propre tag, PAR COMMANDE : deux
      // tables arrivées ensemble sont deux plateaux à préparer.
      tag: charge.tag || 'kaissi-stock',
      renotify: true,
      // Une commande à préparer insiste jusqu'à ce qu'on la touche.
      requireInteraction: typeof charge.tag === 'string' && charge.tag.startsWith('kaissi-preparation'),
      data: { url: charge.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (evenement) => {
  evenement.notification.close()
  const cible = (evenement.notification.data && evenement.notification.data.url) || '/'
  evenement.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((fenetres) => {
      // Si le back-office est déjà ouvert, on RÉUTILISE l'onglet plutôt que
      // d'en ouvrir un onzième. Sur un poste de gérant, la pile d'onglets
      // Kaissi identiques est un vrai désagrément.
      for (const fenetre of fenetres) {
        if (fenetre.url.includes(cible) && 'focus' in fenetre) return fenetre.focus()
      }
      return self.clients.openWindow(cible)
    }),
  )
})
