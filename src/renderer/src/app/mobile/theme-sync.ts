import { writeThemePref, isThemePref } from '@shared/remote/theme-pref'

/** Lo mínimo de `document` que se usa (permite probarlo con un doble). */
export interface ThemeDoc {
  documentElement: { dataset: Record<string, string | undefined> }
  querySelectorAll(sel: string): ArrayLike<{ setAttribute(n: string, v: string): void; removeAttribute(n: string): void }>
}

/**
 * Deja el tema resuelto (`data-theme` de <html>, que sigue al ajuste del Mac) recordado en el celular y los `theme-color` con el
 * fondo real de la app, sin el `media` que los ataba al tema del sistema del celular. Devuelve `false` si aún no hay tema.
 */
export function syncThemeColor(doc: ThemeDoc, getBg: () => string, storage?: Pick<Storage, 'setItem'> | null): boolean {
  const theme = doc.documentElement.dataset.theme
  if (!isThemePref(theme)) return false
  writeThemePref(storage, theme)
  const bg = getBg().trim()
  if (bg) {
    for (const m of Array.from(doc.querySelectorAll('meta[name="theme-color"]'))) {
      m.setAttribute('content', bg)
      m.removeAttribute('media')
    }
  }
  return true
}

/** Observa `data-theme` de <html> y mantiene `syncThemeColor`. Solo para la superficie móvil. Devuelve la baja. */
export function watchThemeSync(): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => undefined
  const store = (): Storage | null => {
    try {
      return localStorage
    } catch {
      return null
    }
  }
  const run = (): void => {
    syncThemeColor(document as unknown as ThemeDoc, () => getComputedStyle(document.documentElement).getPropertyValue('--bg'), store())
  }
  run()
  const mo = new MutationObserver(run)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => mo.disconnect()
}
