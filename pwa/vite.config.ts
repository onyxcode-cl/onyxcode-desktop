// Compilación de la PWA del control remoto: un solo JS + un CSS en `pwa/dist`, sin service worker ni manifest (se sirve por
// HTTP en una IP local, que no es contexto seguro). `modulePreload: false` evita el script en línea que prohíbe la CSP.
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root,
  base: './',
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: ['es2020', 'safari14', 'chrome87'],
    modulePreload: false,
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    sourcemap: false,
    reportCompressedSize: true
  }
})
