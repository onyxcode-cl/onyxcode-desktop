/**
 * `highlight.js/lib/common` para `DiffView` en la PWA del celular: el resaltador (núcleo + ~15 lenguajes, ~25 KB gzip) se baja
 * con `import()` en vez de ir en el arranque. Mientras no está cargado, `getLanguage` devuelve `undefined` (el diff se ve sin
 * colorear) y de paso pide la carga; `boot.tsx` también la pide en un rato ocioso y el panel de Cambios la espera antes de
 * pintarse (`lazy/ChangesPanel.tsx`), así que en la práctica ya está lista cuando se ve un diff.
 */
import type { HLJSApi } from 'highlight.js'

let real: HLJSApi | null = null
let loading: Promise<void> | null = null

export function loadHljs(): Promise<void> {
  loading ??= import('./hljs-lite')
    .then((m) => {
      real = m.default
    })
    .catch(() => {
      loading = null
    })
  return loading
}

const hljs = {
  getLanguage(name: string): ReturnType<HLJSApi['getLanguage']> {
    if (!real) {
      void loadHljs()
      return undefined
    }
    return real.getLanguage(name)
  },
  highlight(code: string, opts: { language: string; ignoreIllegals?: boolean }): { value: string } {
    if (!real) throw new Error('highlight.js aún no está cargado')
    return real.highlight(code, opts)
  }
}

export default hljs
