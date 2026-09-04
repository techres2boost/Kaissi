/**
 * Migration locale 006 — qui a FERMÉ la caisse.
 *
 * `employee_id` désigne celui qui a PRIS le poste. Mais un caissier ouvre à
 * midi et un serveur compte la caisse le soir : le nom qui compte devant un
 * écart est celui de la personne qui a COMPTÉ, pas celle qui est partie
 * depuis quatre heures.
 *
 * La colonne est renseignée à la clôture, avec l'employé alors en poste sur
 * le terminal, et remonte au serveur (migration Postgres 0027).
 *
 * ADDITIVE : une tablette restée en version 5 ignore la colonne. Ses
 * clôtures partiront sans, et le back-office affichera « — », ce qui est la
 * vérité plutôt qu'un nom inventé.
 */

export const SQL_006 = `
ALTER TABLE shifts ADD COLUMN closed_by TEXT;
`
