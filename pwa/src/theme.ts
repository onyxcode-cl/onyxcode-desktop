import { isThemePref, readThemePref } from '../../src/shared/remote/theme-pref'

export { hostCss } from '../../src/shared/remote/host-css'

const BG = { light: '#f7f8fb', dark: '#11131a' } as const

/**
 * Hace que la capa ligera use el tema de la interfaz completa (el del ajuste del Mac, que la app recuerda en `onyx.theme`):
 * lo aplica a <html> y al anfitrión del shadow root, y lo mantiene al día cuando la app cambia `data-theme`.
 * Sin valor recordado se queda el tema del sistema del celular (`prefers-color-scheme`).
 */
export function followTheme(host: HTMLElement): void {
  const doc = document.documentElement
  let stored = null
  try {
    stored = readThemePref(localStorage)
  } catch {
    /* sin almacenamiento */
  }
  if (stored && !doc.dataset.theme) doc.dataset.theme = stored
  const apply = (): void => {
    const v = doc.dataset.theme
    if (!isThemePref(v)) {
      delete host.dataset.theme
      return
    }
    host.dataset.theme = v
    for (const m of Array.from(document.querySelectorAll('meta[name="theme-color"]'))) {
      m.setAttribute('content', BG[v])
      m.removeAttribute('media')
    }
  }
  apply()
  if (typeof MutationObserver !== 'undefined')
    new MutationObserver(apply).observe(doc, { attributes: true, attributeFilter: ['data-theme'] })
}
