import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Configuración de tests separada de electron-vite (los alias replican electron.vite.config.ts).
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    // El runner de Windows de GitHub es lento y con 2 procesos varias pruebas pasaban de los 5 s (pids, manager.winpaths…): en CI se dan 30 s.
    // En local sigue el tope normal, para que una prueba que de verdad se cuelga se note.
    // En local se limitan los procesos de prueba: por defecto vitest usa casi todos los núcleos (cada uno con su jsdom, ~300 MB) y en un
    // Mac de 16 GB, con varias suites a la vez, eso agota la memoria y el equipo se pega (2026-10-17: carga 60, 128 GB escritos a swap).
    // Para una suite completa a toda velocidad, usar el VPS o `VITEST_MAX_WORKERS=8`.
    maxWorkers: process.env.CI ? undefined : Number(process.env.VITEST_MAX_WORKERS ?? 3),
    testTimeout: process.env.CI ? 30_000 : 5_000,
    hookTimeout: process.env.CI ? 30_000 : 10_000
  }
})
