/**
 * Barra de título integrada de la ventana principal, por plataforma (puro, sin Electron: lo importan main y renderer).
 * - macOS: `hiddenInset` con semáforos (sin cambios).
 * - Windows: `hidden` + `titleBarOverlay` (botones nativos de minimizar/maximizar/cerrar pintados sobre nuestra barra de 48 px).
 * - Linux y demás: marco estándar (sin cambios).
 */
import { BRAND_COLORS } from './brand'

/** Alto de la barra de título (px), igual en macOS y Windows. */
export const TITLEBAR_HEIGHT = 48
/** Ancho que ocupan los controles de ventana de Windows a la derecha (px) cuando la API de overlay no lo informa. */
export const WIN_CONTROLS_FALLBACK_WIDTH = 138
/** Colores del texto/iconos de los controles (tokens `--fg` de globals.css). */
const FG_LIGHT = '#131722'
const FG_DARK = '#e7e9f0'

export interface OverlayTheme {
  dark: boolean
  /** Alto contraste del sistema (forced-colors): se usan blanco/negro puros. */
  highContrast?: boolean
}

export interface TitleBarOverlay {
  color: string
  symbolColor: string
  height: number
}

/** Colores del overlay: fondo = `--bg` del tema (la barra es del área principal), símbolos = `--fg`. */
export function overlayFor(theme: OverlayTheme): TitleBarOverlay {
  if (theme.highContrast) {
    return theme.dark
      ? { color: '#000000', symbolColor: '#ffffff', height: TITLEBAR_HEIGHT }
      : { color: '#ffffff', symbolColor: '#000000', height: TITLEBAR_HEIGHT }
  }
  return theme.dark
    ? { color: BRAND_COLORS.bgDark, symbolColor: FG_DARK, height: TITLEBAR_HEIGHT }
    : { color: BRAND_COLORS.bgLight, symbolColor: FG_LIGHT, height: TITLEBAR_HEIGHT }
}

export interface TitleBarOptions {
  titleBarStyle: 'hiddenInset' | 'hidden' | 'default'
  trafficLightPosition?: { x: number; y: number }
  titleBarOverlay?: TitleBarOverlay
}

/** Opciones de barra de título de `new BrowserWindow` para la plataforma. macOS y Linux: idénticas a las de antes. */
export function titleBarOptions(platform: string, theme: OverlayTheme): TitleBarOptions {
  if (platform === 'win32') return { titleBarStyle: 'hidden', titleBarOverlay: overlayFor(theme) }
  return {
    titleBarStyle: platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 }
  }
}

/** ¿La plataforma pinta controles de ventana propios sobre nuestra barra (solo Windows)? */
export const hasWindowControlsOverlay = (platform: string): boolean => platform === 'win32'

/** Rectángulo del área de título que informa `navigator.windowControlsOverlay.getTitlebarAreaRect()`. */
export interface TitlebarAreaRect {
  x: number
  width: number
}

/**
 * Reserva derecha (px) para que nada quede bajo los controles de ventana. Solo en win32; con la API de overlay se calcula
 * de su rectángulo (0 en pantalla completa, donde el overlay se oculta) y, sin ella, vale el ancho de reserva por defecto.
 */
export function controlsInsetRight(platform: string, area: TitlebarAreaRect | null, viewportWidth: number, visible = true): number {
  if (!hasWindowControlsOverlay(platform)) return 0
  if (!area) return WIN_CONTROLS_FALLBACK_WIDTH
  if (!visible) return 0
  return Math.max(0, Math.round(viewportWidth - (area.x + area.width)))
}
