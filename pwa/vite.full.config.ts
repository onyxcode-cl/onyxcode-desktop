// Compilación de la PWA COMPLETA del celular (F8-B56): la misma interfaz React de `src/renderer/src` con los shims de
// `window.api` y `fetch` sobre el puente. Sale en `pwa/dist/app/` (el arranque ligero de `pwa/vite.config.ts` va en
// `pwa/dist/` y la carga DESPUÉS de autenticar, leyendo `app/entry.json`). Sin service worker ni manifest, y SIN script en
// línea (CSP `script-src 'self'`).
//
// Pesos: sin xterm (terminal fuera de alcance en el celular), highlight.js limitado a ~15 lenguajes y Tareas/Rutinas/Ajustes
// en trozos que se bajan al entrar en esas pantallas (`src/renderer/remote/lazy`).
import { fileURLToPath } from 'node:url'
import { resolve, relative, sep } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const repo = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const src = resolve(repo, 'src/renderer/src')
const remote = resolve(repo, 'src/renderer/remote')

/**
 * Importaciones que se sustituyen SOLO en este bundle (clave: archivo importador, relativo a la raíz del repo → importación →
 * archivo de `src/renderer/remote`). Tareas, Rutinas y Ajustes pasan a `import()`; el inglés se baja solo si hace falta; el
 * asistente de primer arranque no corre en el celular (el Mac ya está configurado y esos pasos usan diálogos nativos).
 */
const SWAPS: Record<string, Record<string, string>> = {
  'src/renderer/src/features/tasks/index.ts': {
    './impl/TasksWorkspace': 'lazy/TasksWorkspace.tsx',
    './impl/TasksSidebar': 'lazy/TasksSidebar.tsx'
  },
  'src/renderer/src/features/routines/index.ts': { './impl/RoutinesView': 'lazy/RoutinesView.tsx' },
  'src/renderer/src/features/settings/index.ts': { './impl/SettingsView': 'lazy/SettingsView.tsx' },
  'src/shared/i18n/index.ts': { './en': 'shims/en-lazy.ts' },
  'src/renderer/src/app/App.tsx': { '../features/onboarding': 'shims/no-onboarding.ts' }
}

function swaps(): Plugin {
  return {
    name: 'onyx-remote-swaps',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer) return null
      const rel = relative(repo, importer.split('?')[0] as string)
        .split(sep)
        .join('/')
      const target = SWAPS[rel]?.[source]
      return target ? resolve(remote, target) : null
    }
  }
}

/** `app/entry.json`: nombre (con hash) del JS de entrada y su CSS, para que el arranque ligero los cargue. */
function entryManifest(): Plugin {
  return {
    name: 'onyx-entry-manifest',
    generateBundle(_o, bundle) {
      for (const [file, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk' || !chunk.isEntry) continue
        const css = [...((chunk as { viteMetadata?: { importedCss?: Set<string> } }).viteMetadata?.importedCss ?? [])]
        this.emitFile({ type: 'asset', fileName: 'entry.json', source: JSON.stringify({ v: 1, js: file, css }) })
      }
    }
  }
}

export default defineConfig({
  root: repo,
  base: './',
  publicDir: false,
  plugins: [swaps(), react(), tailwindcss(), entryManifest()],
  resolve: {
    alias: [
      { find: '@renderer', replacement: src },
      { find: '@shared', replacement: resolve(repo, 'src/shared') },
      { find: /^@xterm\/xterm\/css\/xterm\.css$/, replacement: resolve(remote, 'shims/empty.css') },
      { find: /^@xterm\/xterm$/, replacement: resolve(remote, 'shims/xterm.ts') },
      { find: /^@xterm\/addon-fit$/, replacement: resolve(remote, 'shims/xterm-fit.ts') },
      { find: /^highlight\.js\/lib\/common$/, replacement: resolve(remote, 'shims/hljs-lite.ts') },
      { find: /^lowlight$/, replacement: resolve(remote, 'shims/lowlight-lite.ts') }
    ]
  },
  build: {
    outDir: resolve(repo, 'pwa/dist/app'),
    emptyOutDir: true,
    target: ['es2020', 'safari15', 'chrome90'],
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
    sourcemap: false,
    minify: 'esbuild',
    reportCompressedSize: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: { main: resolve(remote, 'main.tsx') },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  }
})
