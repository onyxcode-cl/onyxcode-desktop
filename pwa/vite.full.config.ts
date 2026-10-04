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
import type { OutputChunk } from 'rollup'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { SWAPS } from '../src/renderer/remote/swaps'
import { i18nSplit, readCoreKeys } from '../src/renderer/remote/i18n-split'

const repo = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const src = resolve(repo, 'src/renderer/src')
const remote = resolve(repo, 'src/renderer/remote')

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

/**
 * `app/entry.json` (v2): nombre (con hash) del JS de entrada y su CSS (`js`, `css`, como en la v1), más lo que el arranque ligero
 * puede PRECARGAR durante el apretón de manos: `preload` (la entrada, sus imports estáticos transitivos y el trozo `boot-*` con los
 * suyos) y `bootCss` (el CSS de ese trozo). Todo son archivos de `app/` con huella; el cargador los valida contra sus patrones.
 */
function entryManifest(): Plugin {
  return {
    name: 'onyx-entry-manifest',
    generateBundle(_o, bundle) {
      type Meta = { viteMetadata?: { importedCss?: Set<string> } }
      const chunkOf = (f: string): OutputChunk | undefined => {
        const c = bundle[f]
        return c && c.type === 'chunk' ? c : undefined
      }
      const closure = (start: string, js: Set<string>, css: Set<string>): void => {
        if (js.has(start)) return
        const c = chunkOf(start)
        if (!c) return
        js.add(start)
        for (const f of (c as unknown as Meta).viteMetadata?.importedCss ?? []) css.add(f)
        for (const i of c.imports) closure(i, js, css)
      }
      for (const [file, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk' || !chunk.isEntry) continue
        const css = [...((chunk as unknown as Meta).viteMetadata?.importedCss ?? [])]
        const preloadJs = new Set<string>()
        const preloadCss = new Set<string>()
        closure(file, preloadJs, preloadCss)
        const boot = chunk.dynamicImports.find((f) => /^assets\/boot-/.test(f))
        const bootJs = new Set<string>()
        const bootCss = new Set<string>()
        if (boot) closure(boot, bootJs, bootCss)
        const preload = [...new Set([...preloadJs, ...bootJs])]
        const bootOnlyCss = [...bootCss].filter((f) => !css.includes(f))
        this.emitFile({
          type: 'asset',
          fileName: 'entry.json',
          source: JSON.stringify({ v: 2, js: file, css, preload, bootCss: bootOnlyCss })
        })
      }
    }
  }
}

export default defineConfig({
  root: repo,
  base: './',
  publicDir: false,
  plugins: [
    // Diccionario `es` partido: en `main` solo las claves del arranque; el resto, en un trozo que bajan las pantallas perezosas.
    i18nSplit({
      esDir: resolve(repo, 'src/shared/i18n/es'),
      coreKeys: readCoreKeys(resolve(remote, 'i18n-core-keys.json'))
    }),
    swaps(),
    react(),
    tailwindcss(),
    entryManifest()
  ],
  resolve: {
    alias: [
      { find: '@renderer', replacement: src },
      { find: '@shared', replacement: resolve(repo, 'src/shared') },
      { find: /^@xterm\/xterm\/css\/xterm\.css$/, replacement: resolve(remote, 'shims/empty.css') },
      { find: /^@xterm\/xterm$/, replacement: resolve(remote, 'shims/xterm.ts') },
      { find: /^@xterm\/addon-fit$/, replacement: resolve(remote, 'shims/xterm-fit.ts') },
      // `highlight.js/lib/common` (solo lo importa DiffView) se sustituye vía SWAPS por shims/hljs-deferred.ts (carga perezosa).
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
