/**
 * 019 — `(device_id, seq_device)` n'est plus UNIQUE en local (Postgres 0049).
 *
 * Côté serveur, cette unicité empêchait une caisse réinitialisée de remonter
 * ses ventes. Côté LOCAL, elle fait pire, et en silence : les événements
 * tirés par `/sync/pull` entrent par `INSERT OR IGNORE`. Un ancien événement
 * du serveur qui porte un `seq_device` déjà pris par un nouvel événement
 * local est donc simplement JETÉ — une commande d'hier s'affiche alors
 * amputée, sans que rien ne le dise.
 *
 * C'est exactement ce qui attend une caisse dont la base a été vidée : son
 * curseur repart de zéro, elle retire tout l'historique de l'établissement,
 * et ses propres `seq_device` 1, 2, 3… sont déjà occupés par ce qu'elle
 * avait émis dans sa vie précédente.
 *
 * L'identité d'un événement est `event_id`, clé primaire : elle suffit, et
 * c'est elle qui rend `INSERT OR IGNORE` correct. L'index reste, sans
 * unicité, pour les lectures par appareil.
 */
export const SQL_019 = `
DROP INDEX IF EXISTS order_events_appareil_seq_idx;
CREATE INDEX order_events_appareil_seq_idx ON order_events (device_id, seq_device);
`
