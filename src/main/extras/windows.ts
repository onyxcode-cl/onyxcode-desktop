import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { getLang, type Lang } from '@shared/i18n'
import { rendererPageUrl } from '../security/app-protocol'

/** Ventanas creadas por extras (quick entry, artifacts): nunca son la "ventana principal". */
export const extrasWindows = new WeakSet<BrowserWindow>()

export interface MainWindowDeps {
  /** Devuelve la ventana principal si existe. Por defecto: la primera que no sea de extras. */
  getMainWindow?: () => BrowserWindow | null
  /** Crea la ventana principal (se usa si no hay ninguna abierta). */
  createMainWindow: () => BrowserWindow
}

export function findMainWindow(deps: MainWindowDeps): BrowserWindow | null {
  const fromDeps = deps.getMainWindow?.()
  if (fromDeps && !fromDeps.isDestroyed()) return fromDeps
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && !extrasWindows.has(w)) ?? null
}

/** Muestra y enfoca la ventana principal (creándola si hace falta). `fresh` = recién creada. */
export function showMainWindow(deps: MainWindowDeps): { win: BrowserWindow; fresh: boolean } {
  let win = findMainWindow(deps)
  let fresh = false
  if (!win) {
    win = deps.createMainWindow()
    fresh = true
  }
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  if (process.platform === 'darwin') app.focus({ steal: true })
  win.focus()
  return { win, fresh }
}

/**
 * Preload de cada tipo de ventana (bundle de main vive en out/main). `index` = API completa de la
 * ventana principal; `quick`/`overlay`/`pill` = solo lo que esa ventana necesita.
 */
export type PreloadName = 'index' | 'quick' | 'overlay' | 'pill' | 'assist' | 'browser-host'
export function preloadPath(name: PreloadName = 'index'): string {
  return join(__dirname, `../preload/${name}.js`)
}

/**
 * Carga una página del renderer multi-página: dev server de Vite sin empaquetar, esquema propio
 * `onyxcode://app/…` en producción (nunca `file://`). `page` = ruta relativa a out/renderer.
 */
export function loadRendererPage(win: BrowserWindow, page: string): Promise<void> {
  return win.loadURL(rendererPageUrl(page))
}

/** Idioma con el que se cargó cada ventana secundaria (Quick Entry, overlay, píldora, assist). */
const pageLang = new WeakMap<BrowserWindow, Lang>()

/** `overlay/pill.html#x` → `overlay/pill.html?lang=en#x`. */
export function withLang(page: string, lang: Lang = getLang()): string {
  const i = page.indexOf('#')
  const path = i === -1 ? page : page.slice(0, i)
  const hash = i === -1 ? '' : page.slice(i)
  return `${path}${path.includes('?') ? '&' : '?'}lang=${lang}${hash}`
}

/**
 * Carga una página de una ventana secundaria con el idioma activo en la URL (`?lang=`). Esas ventanas
 * tienen un preload mínimo y propio que NO se toca: la página lee el idioma de su propia URL.
 */
export function loadLocalizedPage(win: BrowserWindow, page: string): Promise<void> {
  pageLang.set(win, getLang())
  return loadRendererPage(win, withLang(page))
}

/** true si la ventana se cargó con otro idioma que el activo (hay que recrearla cuando no se vea). */
export function isLangStale(win: BrowserWindow): boolean {
  return pageLang.get(win) !== getLang()
}
