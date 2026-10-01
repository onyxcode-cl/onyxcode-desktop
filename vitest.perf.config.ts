import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Medición manual (npm run perf:startup): arranque y memoria con la app construida (./out, E2E_MODE=prod). NO forma parte de
// `npm run verify`; los umbrales sugeridos están en docs/VERIFICACION.md.
export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared'), '@renderer': resolve(__dirname, 'src/renderer/src') } },
  test: {
    environment: 'node',
    include: ['e2e/perf/**/*.perf.ts'],
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 30 * 60_000,
    hookTimeout: 120_000,
    retry: 0
  }
})
