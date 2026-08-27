import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    // Les tests d'intégration touchent une vraie base : pas de parallélisme,
    // sinon deux fichiers se marchent dessus sur les mêmes tables.
    fileParallelism: false,
    // Un seul message clair quand la base manque, au lieu de 35 échecs
    // identiques dont la cause réelle est noyée à la fin de la sortie.
    globalSetup: ['./test/preflight.ts'],
    testTimeout: 30_000,
  },
})
