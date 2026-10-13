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
    testTimeout: process.env.CI ? 30_000 : 5_000,
    hookTimeout: process.env.CI ? 30_000 : 10_000
  }
})
