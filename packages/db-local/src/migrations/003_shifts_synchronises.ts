/**
 * Migration locale 003 — remonter les services de caisse au back-office.
 *
 * Jusqu'ici, un shift ne quittait JAMAIS la tablette : l'écran « Journée »
 * du back-office affichait donc toujours « aucune caisse », même après une
 * prise de poste et une clôture en bonne et due forme. Le fond de caisse,
 * le montant compté et surtout l'ÉCART restaient invisibles au gérant — or
 * c'est précisément le chiffre pour lequel on tient une caisse.
 *
 * `pushed_at` marque ce que le serveur a accusé. Nul = à envoyer. La clôture
 * le remet à nul : le même shift repart, enrichi de son écart.
 *
 * ADDITIVE, comme l'exige le support N−2 : une tablette restée en version 2
 * ignore simplement cette colonne.
 */

export const SQL_003 = `
ALTER TABLE shifts ADD COLUMN pushed_at TEXT;

-- Les shifts déjà clos avant cette version partent eux aussi : le gérant
-- retrouve son historique au premier cycle, sans rien ressaisir.
CREATE INDEX shifts_a_pousser_idx ON shifts (opened_at) WHERE pushed_at IS NULL;
`
