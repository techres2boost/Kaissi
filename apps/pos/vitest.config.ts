import { defineConfig } from 'vitest/config'

/**
 * Les tests UNITAIRES du POS.
 *
 * Le COMPORTEMENT de l'application est éprouvé autrement, et mieux :
 * `test:parcours` rejoue une journée de service entière dans un vrai
 * navigateur, `test:mise-en-service` la première mise en service. Restent
 * deux familles qu'aucun navigateur ne peut attraper :
 *
 *   • `scripts/` — ce qui entoure la CONSTRUCTION. Le script qui traduit
 *     « Unsupported class file major version 69 » en « JDK 25 » n'a aucune
 *     raison d'attendre qu'un poste tombe dessus pour être vérifié ;
 *   • `src/palette.test.ts` — les CONTRASTES de la charte. Un navigateur
 *     affiche parfaitement une couleur illisible : c'est même la définition
 *     du défaut. Il faut les mesurer.
 */
export default defineConfig({
  test: {
    include: ['scripts/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
})
