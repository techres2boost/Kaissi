import { defineConfig } from 'vitest/config'

/**
 * Les tests UNITAIRES du POS — c'est-à-dire ses scripts de construction.
 *
 * L'application elle-même est éprouvée autrement, et mieux : `test:parcours`
 * rejoue une journée de service entière dans un vrai navigateur. Ce qui
 * manquait, ce sont les scripts qui entourent la construction — celui qui
 * traduit « Unsupported class file major version 69 » en « JDK 25 » n'a
 * aucune raison d'attendre qu'un poste tombe dessus pour être vérifié.
 */
export default defineConfig({
  test: {
    include: ['scripts/**/*.test.ts'],
    environment: 'node',
  },
})
