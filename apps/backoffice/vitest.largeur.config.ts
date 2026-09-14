/**
 * Configuration À PART pour les tests de largeur.
 *
 * Ils exigent un navigateur ; `vitest.config.ts` n'exige rien. Les mélanger
 * ferait dépendre `pnpm --filter @kaissi/backoffice test` — et donc toute la
 * suite — d'un Chromium installé, pour trois assertions de mise en page. Même
 * découpage que côté caisse, où `test:parcours` et `test:largeur` sont des
 * scripts distincts.
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  /*
   * Transformation JSX AUTOMATIQUE. Sans elle, esbuild produit des appels
   * `React.createElement` alors que rien n'importe React — les composants du
   * back-office n'en ont pas besoin, Next.js posant lui-même ce réglage.
   */
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['src/**/*.largeur.test.tsx'],
    environment: 'node',
    // Playwright démarre un navigateur : la seconde par défaut ne suffit pas.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      '@kaissi/domain': new URL('../../packages/domain/src/index.ts', import.meta.url).pathname,
    },
  },
})
