/**
 * Interrupteurs de build du terminal.
 *
 * ── Pourquoi un drapeau plutôt qu'une suppression ──────────────────────────
 *
 * Le module d'impression (`@kaissi/printing`, le plugin Java, la file
 * persistante, les stations) est ÉCRIT, TESTÉ et CONSERVÉ. Il n'est
 * simplement pas allumé dans le MVP : un restaurant qui démarre n'a pas
 * encore d'imprimante réseau configurée, et une file qui accumule des
 * travaux impossibles à imprimer produit un badge rouge permanent — donc
 * un badge qu'on n'regarde plus.
 *
 * Tant que `IMPRESSION_ACTIVE` est faux :
 *   • rien n'entre dans la file d'impression ;
 *   • la boucle de drainage ne tourne pas ;
 *   • le ticket client et le bon de cuisine s'affichent À L'ÉCRAN ;
 *   • la cuisine lit ses commandes au back-office (`/<resto>/cuisine`).
 *
 * Pour la rallumer : `VITE_IMPRESSION=1 pnpm pos:build`. Rien d'autre.
 * Aucun code n'a été retiré, aucun test supprimé.
 */

/** L'impression ESC/POS est-elle allumée sur ce build ? */
export const IMPRESSION_ACTIVE = import.meta.env.VITE_IMPRESSION === '1'

/** Cible du build : APK Android (défaut) ou site statique. */
export const CIBLE_WEB = import.meta.env.VITE_CIBLE === 'web'

/**
 * Adresse du serveur de synchronisation, pré-remplie à l'appairage.
 *
 * Ce n'est PAS un `server.url` : le bundle ne charge rien depuis cette
 * adresse, il ne s'y synchronise qu'après mise en service, et la caisse
 * fonctionne entièrement sans elle. C'est un simple confort de saisie —
 * le gérant peut la corriger dans le formulaire.
 */
export const URL_SYNC_PAR_DEFAUT = import.meta.env.VITE_URL_SYNC ?? ''
