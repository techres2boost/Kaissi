import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: { '@kaissi/domain': new URL('../../packages/domain/src/index.ts', import.meta.url).pathname },
  },
})
