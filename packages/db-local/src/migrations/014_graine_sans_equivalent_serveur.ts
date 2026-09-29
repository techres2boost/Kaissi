/**
 * 014 — Répare les réductions et les clients de la graine locale.
 *
 * ── La panne ──────────────────────────────────────────────────────────────
 *
 * La graine fabriquait l'identifiant de ses trois réductions avec un suffixe
 * de TROIS chiffres : `01930000-0000-7000-8000-00000000960`, trente-cinq
 * caractères. SQLite, qui stocke du texte, l'acceptait. PostgreSQL, non :
 * une vente remisée avec « Happy hour » faisait échouer la projection
 * (« invalid input syntax for type uuid »), le push répondait 500, et plus
 * aucune vente ne remontait. Le serveur arbitre désormais ces références ;
 * cette migration retire la cause.
 *
 * Seconde conséquence, visible celle-là : sur une caisse EN SERVICE, les
 * réductions de la graine restaient à côté de celles du back-office — chaque
 * bouton apparaissait deux fois. Même chose pour les trois clients de
 * démonstration, qui n'existent nulle part côté serveur.
 *
 * ── Ce qu'elle fait, selon l'état de la caisse ────────────────────────────
 *
 *  • EN SERVICE (un `device_id` attribué par le serveur) : on retire les
 *    réductions et clients de la graine. Le catalogue reçu contient les
 *    vrais ; la graine n'a plus rien à y faire.
 *  • JAMAIS MISE EN SERVICE : on garde la démonstration, et on CORRIGE les
 *    trois identifiants. La mise en service les retirera le moment venu
 *    (`retirerGraineSansEquivalentServeur`).
 *
 * Aucune clé étrangère locale ne pointe `discounts` ni `customers` : les
 * commandes RECOPIENT le libellé et le nom. Un ticket déjà émis ne perd rien.
 * Les ÉVÉNEMENTS déjà écrits gardent l'ancien identifiant — ils sont
 * immuables — et c'est l'arbitrage du serveur qui les accepte.
 */
const DEMO_DEVICE = '01930000-0000-7000-8000-000000000003'
const EN_SERVICE = `EXISTS (
  SELECT 1 FROM sync_state
   WHERE cle = 'device_id' AND valeur IS NOT NULL AND valeur <> ''
     AND valeur <> '${DEMO_DEVICE}'
)`
const id = (suffixe: string) => `'01930000-0000-7000-8000-00000000${suffixe}'`

export const SQL_014 = `
DELETE FROM discounts
 WHERE id IN (${['960', '961', '962', '0960', '0961', '0962'].map(id).join(', ')})
   AND ${EN_SERVICE};

DELETE FROM customers
 WHERE id IN (${['0801', '0802', '0803'].map(id).join(', ')})
   AND ${EN_SERVICE};

UPDATE discounts SET id = ${id('0960')} WHERE id = ${id('960')};
UPDATE discounts SET id = ${id('0961')} WHERE id = ${id('961')};
UPDATE discounts SET id = ${id('0962')} WHERE id = ${id('962')};
`
