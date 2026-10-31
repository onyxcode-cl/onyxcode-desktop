/** Overlay de la barra de título de Windows: se vuelve a pintar cuando cambia el tema (incluido 'system'). Plataforma inyectable. */
import { hasWindowControlsOverlay, overlayFor, type OverlayTheme } from '@shared/window-chrome'

export interface OverlayWindowLike {
  isDestroyed(): boolean
  setTitleBarOverlay(options: { color: string; symbolColor: string; height: number }): void
}

export interface ThemeSource {
  shouldUseDarkColors: boolean
  shouldUseHighContrastColors?: boolean
}

/** `glass`: la ventana es de vidrio (fondo transparente con Mica/Acrylic); entonces los controles van sin fondo propio. */
export const themeOf = (t: ThemeSource, glass = false): OverlayTheme => ({
  dark: t.shouldUseDarkColors,
  highContrast: !!t.shouldUseHighContrastColors,
  ...(glass ? { glass: true } : {})
})

/**
 * Aplica los colores del tema (y del vidrio) al overlay. Se llama al cambiar el tema y al cambiar «Barra lateral».
 * Devuelve si hizo algo (solo win32 y ventana viva). Nunca lanza.
 */
export function syncTitleBarOverlay(
  win: OverlayWindowLike | null,
  theme: ThemeSource,
  platform: string = process.platform,
  glass = false
): boolean {
  if (!win || !hasWindowControlsOverlay(platform)) return false
  try {
    if (win.isDestroyed()) return false
    win.setTitleBarOverlay(overlayFor(themeOf(theme, glass)))
    return true
  } catch {
    return false
  }
}
