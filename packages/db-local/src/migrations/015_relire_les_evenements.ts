/**
 * 015 — Relire le journal des commandes depuis le début, une fois.
 *
 * ── La panne ──────────────────────────────────────────────────────────────
 *
 * Après chaque push, le moteur écrivait comme curseur de lecture la TÊTE du
 * journal du restaurant. Le pull suivant partait d'après :
 *
 *  • nos propres événements, qui ne revenaient jamais numérotés — « Reçus »
 *    les marquait « en attente » pour toujours, alors que le back-office les
 *    avait ;
 *  • ceux qu'une AUTRE caisse avait poussés juste avant — que celle-ci ne
 *    voyait alors jamais, ni dans ses reçus ni sur ses tables.
 *
 * Le moteur est corrigé ; il reste à rattraper ce qui a été sauté. Remettre
 * le curseur à zéro fait relire tout le journal de l'établissement, par
 * pages, en arrière-plan. C'est sans risque : l'intégration est idempotente
 * (`INSERT OR IGNORE`), et elle ne fait que COMPLÉTER `server_seq` là où il
 * manquait. Aucune vente locale n'est touchée, l'outbox non plus.
 */
export const SQL_015 = `
UPDATE sync_state SET valeur = '0' WHERE cle = 'last_event_seq';
`
