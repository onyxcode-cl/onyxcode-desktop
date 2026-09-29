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
    setupFiles: ['src/test/setup.ts']
  }
})
