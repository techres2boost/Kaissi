/**
 * 017 — « Prêt » couvre des ENVOIS (Postgres 0046).
 *
 * La cuisine dit « prêt » jusqu'à un envoi précis, repéré par son rang
 * serveur. Un ajout envoyé APRÈS rend la commande de nouveau à préparer —
 * et le badge « Prêt » de la salle doit s'éteindre aussi : c'est la caisse
 * qui comparerait sinon un plateau servi à une table qui attend encore deux
 * plats.
 *
 * La comparaison se fait sur le journal LOCAL (`order_events.server_seq`) :
 * un envoi pas encore remonté n'a pas de rang, et il n'est donc couvert par
 * aucun « prêt ». C'est exact — la cuisine ne l'a pas encore vu.
 *
 * Additive : un serveur antérieur n'envoie pas la colonne, elle reste nulle,
 * et nul garde l'ancien sens (« prêt » couvre tout).
 */
export const SQL_017 = `
ALTER TABLE kitchen_ready ADD COLUMN sent_seq INTEGER;
`
