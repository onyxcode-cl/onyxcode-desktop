/**
 * Viewport emulado del navegador integrado (F8-B46): las páginas se ven SIEMPRE en su versión de escritorio salvo
 * que el usuario pida «Móvil». Un panel estrecho (p. ej. 600 px) activaría los breakpoints responsive de la página
 * (`@media (max-width: …)`), así que en escritorio se emula un viewport de `DESKTOP_VIEWPORT_WIDTH` px de ancho y se
 * escala para que quepa en el panel (`webContents.enableDeviceEmulation` con `viewSize` + `scale`; no usa CDP
 * `Emulation.*`, que sigue fuera de `ALLOWED_CDP`).
 *
 * Coordenadas: con `scale ≠ 1`, `DOM.*` (cuadrantes, `getNodeForLocation`) habla en píxeles CSS, pero
 * `Input.dispatchMouseEvent` espera píxeles de la vista (= CSS × scale). `cdp.ts` multiplica x/y por `scale`.
 */
import type { BrowserViewMode } from '@shared/ipc-browser'

/** Ancho CSS del viewport de escritorio emulado. */
export const DESKTOP_VIEWPORT_WIDTH = 1280
/** Ancho CSS del viewport móvil emulado (teléfono estándar). */
export const MOBILE_VIEWPORT_WIDTH = 390

export interface ViewportEmulation {
  /** `desktop` | `mobile` de `screenPosition` de Electron. */
  screenPosition: 'desktop' | 'mobile'
  /** Tamaño del viewport emulado en píxeles CSS. */
  viewSize: { width: number; height: number }
  /** Factor aplicado para que `viewSize` quepa en la vista nativa (≤ 1). */
  scale: number
}

/**
 * Emulación para una vista nativa de `width`×`height` píxeles. `null` = sin emulación (escritorio con panel ancho:
 * el viewport real ya es de escritorio).
 */
export function computeEmulation(mode: BrowserViewMode, width: number, height: number): ViewportEmulation | null {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  if (mode === 'mobile') {
    const scale = Math.min(1, w / MOBILE_VIEWPORT_WIDTH)
    return { screenPosition: 'mobile', viewSize: { width: MOBILE_VIEWPORT_WIDTH, height: Math.round(h / scale) }, scale }
  }
  if (w >= DESKTOP_VIEWPORT_WIDTH) return null
  const scale = w / DESKTOP_VIEWPORT_WIDTH
  return { screenPosition: 'desktop', viewSize: { width: DESKTOP_VIEWPORT_WIDTH, height: Math.round(h / scale) }, scale }
}

/** Misma emulación → mismo texto (evita reaplicar en cada `setBounds` idéntico). */
export function emulationKey(mode: BrowserViewMode, e: ViewportEmulation | null): string {
  return e ? `${mode}:${e.screenPosition}:${e.viewSize.width}x${e.viewSize.height}@${e.scale.toFixed(5)}` : `${mode}:none`
}

/** Escala de entrada (CSS → vista) de una emulación; 1 sin emulación. */
export function inputScaleOf(e: ViewportEmulation | null): number {
  return e && Number.isFinite(e.scale) && e.scale > 0 ? e.scale : 1
}

/** Escala los puntos de ratón/táctil de un comando `Input.*` de CSS a vista. No toca otros comandos. */
export function scaleInputParams(method: string, params: object, scale: number): object {
  if (scale === 1) return params
  if (method !== 'Input.dispatchMouseEvent' && method !== 'Input.dispatchTouchEvent' && method !== 'Input.dispatchDragEvent') return params
  const p = params as Record<string, unknown>
  const out: Record<string, unknown> = { ...p }
  if (typeof p.x === 'number') out.x = p.x * scale
  if (typeof p.y === 'number') out.y = p.y * scale
  if (Array.isArray(p.touchPoints)) {
    out.touchPoints = p.touchPoints.map((tp) => {
      const t = tp as Record<string, unknown>
      return { ...t, x: typeof t.x === 'number' ? t.x * scale : t.x, y: typeof t.y === 'number' ? t.y * scale : t.y }
    })
  }
  return out
}

/** UA móvil coherente con el motor (Chromium de Android). */
export function mobileUserAgent(chromeVersion: string): string {
  const major = chromeVersion.split('.')[0] || '130'
  return `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Mobile Safari/537.36`
}
