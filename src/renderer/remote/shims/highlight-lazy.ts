/**
 * Versión PWA de `components/highlight-plugins.ts`: `rehype-highlight` (highlight.js + lowlight, ~27 KB gzip) se baja con
 * `import()` la primera vez que algún `Markdown` necesita resaltar, o antes si el arranque lo precarga en un rato ocioso.
 * Se importa el especificador `rehype-highlight` tal cual para que los alias de `pwa/vite.full.config.ts` (lowlight y
 * highlight.js reducidos) se apliquen también en el trozo nuevo. Mientras no está, `Markdown` pinta el código sin colorear.
 */
import { useEffect, useSyncExternalStore } from 'react'
import type { Options } from 'react-markdown'

type PluggableList = NonNullable<Options['rehypePlugins']>

let plugins: PluggableList | null = null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

export function preloadHighlight(): Promise<void> {
  loading ??= import('rehype-highlight')
    .then((m) => {
      plugins = [[m.default, { detect: false, ignoreMissing: true }]]
      for (const l of [...listeners]) l()
    })
    .catch(() => {
      loading = null // sin red o trozo caído: se reintenta la próxima vez; el código queda sin colorear
    })
  return loading
}

const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
const snapshot = (): PluggableList | null => plugins

export function useHighlightPlugins(enabled: boolean): PluggableList | null {
  const loaded = useSyncExternalStore(subscribe, snapshot, snapshot)
  useEffect(() => {
    if (enabled && !loaded) void preloadHighlight()
  }, [enabled, loaded])
  return enabled ? loaded : null
}
