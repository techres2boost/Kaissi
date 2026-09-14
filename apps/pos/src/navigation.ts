/**
 * Les écrans de la caisse.
 *
 * Extrait de `Application.tsx` le jour où le tiroir de navigation est né : le
 * tiroir a besoin de savoir quel écran est courant pour le marquer, et
 * l'importer depuis la coque aurait fait un cycle.
 */

export type Vue =
  | { nom: 'salle' }
  | { nom: 'commande'; orderId: string }
  | { nom: 'paiement'; orderId: string }
  | { nom: 'cloture' }
  | { nom: 'diagnostic' }
  | { nom: 'sync' }
  | { nom: 'recus' }
  | { nom: 'periodes' }
