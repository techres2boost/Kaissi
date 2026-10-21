/**
 * Le rapport de clôture (« ticket Z ») d'un service de caisse.
 *
 * Un seul endroit le construit, pour deux usages : la CLÔTURE, qui l'affiche
 * (et l'imprime quand l'impression est allumée), et « Périodes de travail »,
 * qui le rouvre le lendemain — quand le patron demande pourquoi il manquait
 * vingt dinars. Les deux doivent montrer le même papier.
 *
 * Tout est lu LOCALEMENT : un Z doit sortir à 23 h même si la ligne est
 * tombée à 22 h. Et rien n'est recalculé — le résumé vient de
 * `resumerShift`, le détail de `detaillerZ`, qui additionnent ce que les
 * tickets ont déjà décidé.
 *
 * ⚠ Ce n'est pas un Z fiscal homologué (voir `DetailZ`).
 */

import {
  detaillerZ,
  formaterDateHeure,
  millimes,
  resumerShift,
  type EnteteEtablissement,
  type Shift,
  type TicketShift,
} from '@kaissi/domain'
import { rendreTicketShift } from '@kaissi/printing'
import type { ContexteApplication } from './demarrage.js'

export async function construireRapportZ(
  app: ContexteApplication,
  shift: Shift,
  options: { readonly etablissement: EnteteEtablissement; readonly employe: string | null },
): Promise<{ ticket: TicketShift; charge: Uint8Array }> {
  const [encaissements, mouvements, totaux, remboursements, detail] = await Promise.all([
    app.caisse.encaissementsDe(shift.id),
    app.caisse.mouvementsDe(shift.id),
    app.caisse.totauxDe(shift.id),
    app.caisse.remboursementsDe(shift.id),
    app.caisse.detailZDe(shift.id),
  ])
  const ticket: TicketShift = {
    type: 'shift',
    etablissement: options.etablissement,
    employe: options.employe,
    ouvertA: formaterDateHeure(shift.ouvertA),
    closA: shift.closA ? formaterDateHeure(shift.closA) : null,
    resume: resumerShift({
      shift,
      encaissements,
      mouvements,
      nombreCommandes: totaux.nombreCommandes,
      chiffreAffairesMillimes: millimes(totaux.chiffreAffairesMillimes),
      remboursements,
    }),
    detail: detaillerZ(detail),
  }
  return { ticket, charge: rendreTicketShift(ticket) }
}
