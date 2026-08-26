import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    // Les tests d'intégration touchent une vraie base : pas de parallélisme,
    // sinon deux fichiers se marchent dessus sur les mêmes tables.
    fileParallelism: false,
    testTimeout: 30_000,
  },
})
