#!/usr/bin/env node
/**
 * Génère la paire de clés VAPID des notifications — UNE FOIS, par
 * l'exploitant, jamais par le client.
 *
 * ── Pourquoi cette commande existe, alors qu'on veut zéro terminal client ──
 *
 * Le client ne la lance jamais : elle se range à côté de DATABASE_URL, dans
 * la configuration de l'hébergeur, et vaut pour TOUS les restaurants. Une
 * paire de clés VAPID identifie l'ÉMETTEUR (Kaissi) auprès des services de
 * notification des navigateurs — pas un restaurant, pas un employé.
 *
 * ── Ce qui se passe si on les régénère ────────────────────────────────────
 *
 * Tous les abonnements existants deviennent invalides : les services de
 * notification refusent une charge signée par une autre clé que celle avec
 * laquelle l'abonnement a été créé. Chaque navigateur doit alors réactiver
 * ses alertes. À ne faire que si la clé privée a fuité.
 */

import webpush from 'web-push'

const { publicKey, privateKey } = webpush.generateVAPIDKeys()

console.log(
  [
    '',
    '  Paire de clés VAPID générée. À poser dans la configuration de',
    '  l’hébergeur (Railway → Variables), PAS dans le dépôt :',
    '',
    `      VAPID_PUBLIC_KEY=${publicKey}`,
    `      VAPID_PRIVATE_KEY=${privateKey}`,
    '      VAPID_SUBJECT=mailto:contact@res2boost.com',
    '',
    '  La MÊME clé publique doit aussi être posée sur le back-office',
    '  (Vercel → Environment Variables → VAPID_PUBLIC_KEY) : c’est elle que',
    '  le navigateur présente au moment de s’abonner.',
    '',
    '  ⚠ La clé privée ne sort JAMAIS du service de synchronisation. Elle',
    '    permet d’envoyer des notifications au nom de Kaissi.',
    '',
  ].join('\n'),
)
