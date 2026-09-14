/**
 * Le port TCP d'une imprimante ESC/POS en réseau.
 *
 * ── Pourquoi un fichier à part, et pas dans `actions.ts` ──────────────────
 *
 * Un module « use server » ne peut exporter QUE des fonctions async : Next.js
 * transforme chacun de ses exports en point d'entrée appelable depuis le
 * navigateur, et une constante n'en est pas un. La garde
 * `src/serveur/use-server.test.ts` l'a dit avant Next.js — la valeur vivait
 * d'abord à côté des actions, exactement comme `TYPES_PAIEMENT` avant elle.
 *
 * 9100 est le port « RAW / JetDirect », celui qu'écoutent les imprimantes
 * thermiques réseau dans l'immense majorité des cas. C'est aussi le défaut
 * posé par le schéma (`printer_port integer not null default 9100`, migration
 * Postgres 0003 et migration locale 001) : le répéter ici serait deux vérités
 * à tenir d'accord, alors on le nomme une fois, du côté qui l'affiche.
 */

export const PORT_PAR_DEFAUT = 9100
