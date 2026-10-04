import type { Options } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'

type PluggableList = NonNullable<Options['rehypePlugins']>

/**
 * Plugin de resaltado de sintaxis de `Markdown`. En el escritorio es estático (síncrono, archivo local). La PWA del celular
 * sustituye ESTE módulo (`SWAPS` de `pwa/vite.full.config.ts`) por `remote/shims/highlight-lazy.ts`, que baja highlight.js
 * solo cuando hace falta (~27 KB gzip menos en el arranque). Las dos versiones exportan lo mismo.
 */
// F7-B45: `detect:false` (solo se resaltan los bloques con lenguaje declarado; la autodetección probaba TODOS los
// lenguajes en cada bloque y era lo más caro) y `ignoreMissing`.
const PLUGINS: PluggableList = [[rehypeHighlight, { detect: false, ignoreMissing: true }]]

/** Plugins de resaltado si `enabled` y ya están disponibles; si no, `null`. */
export function useHighlightPlugins(enabled: boolean): PluggableList | null {
  return enabled ? PLUGINS : null
}

/** Pide la carga del resaltado (en el escritorio ya está; no hace nada). */
export function preloadHighlight(): Promise<void> {
  return Promise.resolve()
}
