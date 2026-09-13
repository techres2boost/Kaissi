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

/**
 * Adresse du BACK-OFFICE — pour le bouton du bandeau, et rien d'autre.
 *
 * ── La nuance qui sépare ce bouton d'une TWA ──────────────────────────────
 *
 * Il ouvre le NAVIGATEUR DU SYSTÈME sur cette page. Rien de ce qui s'affiche
 * alors n'est l'application Kaissi : la caisse continue de tourner derrière,
 * avec son code empaqueté, et elle s'ouvrira demain sans réseau exactement
 * comme aujourd'hui.
 *
 * Une TWA ferait venir le CODE DE L'APPLICATION depuis cette adresse. C'est
 * cela qui est disqualifiant — pas le fait qu'une URL figure dans le bundle.
 * La garde du mode avion applique la même distinction : elle admet l'hôte
 * DÉCLARÉ ici, et refuse tous les autres.
 *
 * Vide = pas de bouton. Un bouton qui ouvre une page blanche est pire que
 * pas de bouton.
 */
export const URL_BACKOFFICE = import.meta.env.VITE_URL_BACKOFFICE ?? ''

/**
 * Empreinte du build en cours d'exécution.
 *
 * Affichée dans l'écran Diagnostic. Sans elle, « ma correction est-elle en
 * ligne ? » ne se répond qu'en cherchant un texte au hasard dans l'écran —
 * et on finit par déboguer du code qui n'est pas celui qui tourne.
 */
export const BUILD_COMMIT = import.meta.env.VITE_BUILD_COMMIT ?? ''
export const BUILD_DATE = import.meta.env.VITE_BUILD_DATE ?? ''
