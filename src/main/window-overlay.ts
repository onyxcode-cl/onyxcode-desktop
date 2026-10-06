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

export const themeOf = (t: ThemeSource): OverlayTheme => ({ dark: t.shouldUseDarkColors, highContrast: !!t.shouldUseHighContrastColors })

/** Aplica los colores del tema al overlay. Devuelve si hizo algo (solo win32 y ventana viva). Nunca lanza. */
export function syncTitleBarOverlay(win: OverlayWindowLike | null, theme: ThemeSource, platform: string = process.platform): boolean {
  if (!win || !hasWindowControlsOverlay(platform)) return false
  try {
    if (win.isDestroyed()) return false
    win.setTitleBarOverlay(overlayFor(themeOf(theme)))
    return true
  } catch {
    return false
  }
}
