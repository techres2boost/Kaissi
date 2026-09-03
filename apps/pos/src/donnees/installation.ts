/**
 * Identité d'INSTALLATION du terminal.
 *
 * ── Ce que c'est, et ce que ce n'est pas ──────────────────────────────────
 *
 * Ce n'est pas une quatrième identité : les trois du produit — utilisateur,
 * appareil, employé — restent inchangées. C'est une simple étiquette locale
 * qui répond à une seule question, celle que le serveur ne savait pas poser :
 * « est-ce le même terminal que la dernière fois ? »
 *
 * Sans elle, chaque mise en service créait un appareil NEUF. Une tablette,
 * cinq appareils, cinq préfixes de tickets — et surtout : les événements
 * encore en attente dans l'outbox portaient l'ancien `device_id` et étaient
 * refusés pour toujours en « appareil_etranger ». Des ventes perdues pour le
 * back-office, sans que rien à l'écran ne le dise.
 *
 * Elle est tirée UNE fois, au premier appairage, et conservée dans la base
 * locale. Elle survit donc à un redémarrage, à une déconnexion, à un
 * changement de compte gérant. Elle ne survit pas à une désinstallation de
 * l'application — et c'est correct : une réinstallation EST un terminal neuf,
 * puisque l'outbox et l'historique local sont partis avec elle.
 *
 * Elle ne contient aucun identifiant matériel, aucun numéro de série : rien
 * qui suive l'appareil hors de Kaissi.
 */

import { uuidV7 } from '@kaissi/domain'
import type { DepotEtat } from '@kaissi/db-local'

/**
 * Rend l'identifiant d'installation, en le créant au premier appel.
 *
 * Volontairement « lire puis écrire » sans verrou : le POS est mono-onglet
 * sur tablette, et l'écriture est idempotente au sens qui compte — deux
 * appels concurrents produiraient au pire un identifiant écrasé une fois,
 * avant tout appairage, donc sans aucun appareil rattaché.
 */
export async function identifiantInstallation(etat: DepotEtat): Promise<string> {
  const connu = await etat.lire('installation_id')
  if (connu) return connu
  const neuf = uuidV7()
  await etat.ecrire('installation_id', neuf)
  return neuf
}
