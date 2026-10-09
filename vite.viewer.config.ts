/**
 * Compilación de la vista aislada del visor de documentos (Fase 0 del plan del visor):
 * un bundle propio en `out/viewer/`, servido por `src/main/viewer/scheme.ts`
 * (`lazunox-viewer://viewer/…`), NUNCA por el esquema del renderer principal. `modulePreload:
 * false` evita el script en línea que la CSP de esa vista prohíbe (sin `'unsafe-inline'` en
 * `script-src`), igual que en `pwa/vite.config.ts`.
 */
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(__dirname, 'src/viewer'),
  base: './',
  publicDir: false,
  plugins: [react()],
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') }
  },
  build: {
    outDir: resolve(__dirname, 'out/viewer'),
    emptyOutDir: true,
    modulePreload: false,
    sourcemap: false
  }
})
