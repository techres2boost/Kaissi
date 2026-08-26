import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    /*
     * Argon2id coûte volontairement du temps CPU (~350 ms par hachage). Quand
     * Turborepo lance les quatre suites du monorepo en parallèle, les tests de
     * PIN se retrouvent en concurrence pour le processeur et dépassent le
     * délai par défaut de 5 s — un échec qui ne dit rien sur le code.
     * Le délai est donc dimensionné pour la charge, pas pour la machine à vide.
     */
    testTimeout: 30_000,
  },
})
