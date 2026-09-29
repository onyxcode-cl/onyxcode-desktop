import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Runner E2E (Electron real + OpenCode falso). El `vitest.config.ts` de la raíz solo incluye `src/**`,
// así que `npm test` nunca recoge esto. E2E_MODE=prod → carga por onyxcode://app (solo humo).
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    environment: 'node',
    include: ['e2e/specs/**/*.e2e.{ts,mjs}'],
    globalSetup: ['e2e/lib/global-setup.ts'],
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Un reintento: el arranque de Electron con Playwright es intermitente (ver docs/VERIFICACION.md). Los
    // tests que fallan a propósito usan `it.fails`, que no se ve afectado. Un fallo repetido sigue fallando.
    retry: 1
  }
})
