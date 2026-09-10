/**
 * Migration locale 010 — autoriser LA purge, et elle seule.
 *
 * ── La panne ──────────────────────────────────────────────────────────────
 *
 * Changer une caisse d'établissement échouait, toujours, sur :
 *
 *     Échec de « DELETE FROM order_events »
 *     — order_events est en insertion seule : aucune suppression
 *
 * Le garde-fou de la RÈGLE 6 (migration 001) faisait exactement son travail.
 * C'est la remise à zéro qui avait oublié qu'il existait :
 * `reinitialiserPourAutreEtablissement()` vide neuf tables d'activité, et
 * `order_events` en fait partie — c'est même la plus importante, puisque
 * `orders` et `order_items` n'en sont que des projections. Les tests
 * unitaires ne l'avaient pas vu : ils vidaient des tables VIDES, et un
 * déclencheur `BEFORE DELETE` ne se déclenche sur aucune ligne.
 *
 * ── Pourquoi une exception, et pourquoi celle-ci ──────────────────────────
 *
 * La RÈGLE 6 dit qu'une annulation n'efface jamais rien : une correction est
 * un NOUVEL événement. Elle protège l'HISTOIRE d'une commande contre une
 * réécriture — et cela ne change pas d'un iota.
 *
 * Une bascule d'établissement n'est pas une correction. C'est la mise au
 * rebut d'une COPIE DE TRAVAIL entière, après avoir prouvé qu'il ne reste
 * rien à envoyer : l'appelant refuse tant que l'outbox n'est pas vide, et
 * l'original reste sur le serveur, immuable, où il est la source de vérité.
 * Garder ces événements ferait pire que bien — ils portent le
 * `restaurant_id` de l'ancien établissement, et la projection les ferait
 * réapparaître dans le chiffre du nouveau.
 *
 * ── La forme de l'exception : nommée, transactionnelle, refermée ──────────
 *
 * Pas de `DROP TRIGGER` le temps de l'opération : un plantage entre le DROP
 * et le CREATE laisserait la table SANS protection, et plus rien ne le
 * dirait. Le déclencheur reste en place et consulte un drapeau explicite,
 * `sync_state.purge_etablissement`, posé et retiré DANS la transaction de
 * purge. Un échec annule tout, drapeau compris : la table ne peut pas rester
 * ouverte à la suppression.
 *
 * Autrement dit, la suppression n'est jamais permise « par défaut » — elle
 * l'est pendant les quelques millisecondes où quelqu'un l'a demandée par son
 * nom.
 */
export const SQL_010 = `
DROP TRIGGER order_events_pas_delete;

CREATE TRIGGER order_events_pas_delete
BEFORE DELETE ON order_events
WHEN (SELECT valeur FROM sync_state WHERE cle = 'purge_etablissement') IS NULL
BEGIN
  SELECT RAISE(ABORT, 'order_events est en insertion seule : aucune suppression');
END;
`
