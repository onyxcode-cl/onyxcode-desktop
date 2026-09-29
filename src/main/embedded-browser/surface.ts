/**
 * La pestaña del navegador integrado (Lote D, B.2 y D1 paso 5): un `WebContentsView` por pestaña,
 * con TODO el aislamiento de un contenido web arbitrario (primero de la app, A.5/A.6/B.2).
 *
 * Mecánica pura: crea la vista, aplica los `webPreferences`, instala las guardas SIEMPRE activas
 * (esquema de navegación, sin `<webview>`, sin ventanas nuevas nativas, menú contextual propio,
 * atajos reservados, choque, entrada humana) y publica los cambios por `surfaceEvents`. La
 * POLÍTICA (aprobación por sitio, atribución agente/usuario, concesiones) la decide `service.ts`,
 * que se suscribe a estos eventos y añade sus propias guardas de navegación sobre `tab.wc`.
 *
 * Límite: 6 pestañas por owner, 12 en total (protege memoria/CPU: un proceso por pestaña).
 */
import { EventEmitter } from 'node:events'
import { Menu, WebContentsView, clipboard, shell, type WebContents } from 'electron'
import type { BrowserOwner, BrowserProduct } from '@shared/ipc-browser'
import { checkUrl } from '../browser/sites'
import { sessionFor } from './session'
import { detachCdp } from './cdp'

export const MAX_TABS_PER_OWNER = 6
export const MAX_TABS_TOTAL = 12

/** Ventana `userActive` (B.6.3): cuánto cuenta como "entrada humana reciente". */
export const USER_ACTIVE_WINDOW_MS = 3_000
/** Cuánto tiempo se suprime `lastHumanInputAt` tras que NOSOTROS enviamos un `Input.*` por CDP
 * (D0 corrección 3: el evento `input-event` no distingue agente de humano; esta ventana sí). */
const AGENT_INPUT_SUPPRESS_MS = 700

export class TabLimitError extends Error {}

export interface TabRuntime {
  readonly id: string
  readonly owner: BrowserOwner
  readonly product: BrowserProduct
  readonly view: WebContentsView
  readonly wc: WebContents
  readonly createdAt: number
  openedBy: 'user' | 'agent'
  agentSelected: boolean
  title: string
  crashed: boolean
  destroyed: boolean
  lastHumanInputAt: number
  suppressUserActiveUntil: number
}

export const surfaceEvents = new EventEmitter()

const tabsById = new Map<string, TabRuntime>()

export function ownerKeyOf(owner: BrowserOwner): string {
  return owner.kind === 'code' ? `code:${owner.directory}` : `cowork:${owner.folder}`
}

export function tabById(id: string): TabRuntime | undefined {
  return tabsById.get(id)
}

export function tabByWebContents(wc: WebContents): TabRuntime | undefined {
  for (const t of tabsById.values()) if (t.wc === wc) return t
  return undefined
}

export function tabsForOwner(owner: BrowserOwner): TabRuntime[] {
  const key = ownerKeyOf(owner)
  return [...tabsById.values()].filter((t) => !t.destroyed && ownerKeyOf(t.owner) === key)
}

/** Todas las pestañas vivas, de cualquier owner (para limpiar todo al salir de la app). */
export function allTabs(): TabRuntime[] {
  return [...tabsById.values()].filter((t) => !t.destroyed)
}

export function totalTabCount(): number {
  let n = 0
  for (const t of tabsById.values()) if (!t.destroyed) n++
  return n
}

let seq = 0
function newTabId(): string {
  return `t${Date.now().toString(16)}${(seq++).toString(16).padStart(4, '0')}`
}

/** El agente acaba de enviar `Input.*` por CDP para esta pestaña: no cuenta como usuario real. */
export function markAgentInputWindow(tabId: string): void {
  const tab = tabsById.get(tabId)
  if (tab) tab.suppressUserActiveUntil = Date.now() + AGENT_INPUT_SUPPRESS_MS
}

export function isUserActive(tab: TabRuntime): boolean {
  return Date.now() - tab.lastHumanInputAt < USER_ACTIVE_WINDOW_MS
}

function allowedTopLevelUrl(url: string): boolean {
  return checkUrl(url)
}

/** Menú contextual propio: Atrás/Adelante/Recargar/Copiar/Pegar/Copiar enlace/Abrir en el sistema. Sin «Inspeccionar». */
function installContextMenu(tab: TabRuntime): void {
  tab.wc.on('context-menu', (_event, params) => {
    const items: Electron.MenuItemConstructorOptions[] = []
    const nav = tab.wc.navigationHistory
    items.push({ label: 'Atrás', enabled: nav.canGoBack(), click: () => nav.goBack() })
    items.push({ label: 'Adelante', enabled: nav.canGoForward(), click: () => nav.goForward() })
    items.push({ label: 'Recargar', click: () => tab.wc.reload() })
    items.push({ type: 'separator' })
    if (params.isEditable) {
      items.push({ label: 'Pegar', click: () => tab.wc.paste() })
    }
    if (params.selectionText) {
      items.push({ label: 'Copiar', click: () => tab.wc.copy() })
    }
    if (params.linkURL) {
      items.push({ label: 'Copiar enlace', click: () => clipboard.writeText(params.linkURL) })
    }
    const topUrl = params.linkURL || tab.wc.getURL()
    if (/^https?:\/\//i.test(topUrl)) {
      items.push({ type: 'separator' })
      items.push({ label: 'Abrir en el navegador del sistema', click: () => void shell.openExternal(topUrl) })
    }
    if (!items.length) return
    Menu.buildFromTemplate(items).popup()
  })
}

/** Atajos reservados (B.9): ⌘L/⌘T/⌘W/⌘R/⌘[/⌘] y ⌘1–4 → `browser:shortcut`, nunca llegan a la página. */
function installShortcuts(tab: TabRuntime): void {
  tab.wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const cmd = input.meta || input.control
    if (!cmd) return
    const key = input.key.toLowerCase()
    const map: Record<string, string> = {
      l: 'focusUrl',
      t: 'newTab',
      w: 'closeTab',
      r: 'reload',
      '[': 'back',
      ']': 'forward',
      '1': 'panel1',
      '2': 'panel2',
      '3': 'panel3',
      '4': 'panel4'
    }
    const shortcutKey = map[key]
    if (!shortcutKey) return
    event.preventDefault()
    surfaceEvents.emit('shortcut', tab, shortcutKey)
  })
}

function installBaselineNavigationGuard(tab: TabRuntime): void {
  const guard = (url: string, prevent: () => void, label: string): void => {
    if (allowedTopLevelUrl(url)) return
    prevent()
    console.warn(`[embedded-browser] navegación bloqueada (${label}): ${url.slice(0, 200)}`)
  }
  // `details` viene fusionado con el `Event` (tiene `.url`, `.isMainFrame` y `.preventDefault()`).
  tab.wc.on('will-navigate', (details) => guard(details.url, () => details.preventDefault(), 'will-navigate'))
  tab.wc.on('will-redirect', (details) => {
    if (!details.isMainFrame) return
    guard(details.url, () => details.preventDefault(), 'will-redirect')
  })
  tab.wc.on('will-frame-navigate', (details) => {
    if (!details.isMainFrame) return // los subframes (anuncios, embebidos) no navegan la página completa
    guard(details.url, () => details.preventDefault(), 'will-frame-navigate')
  })
  // Respaldo (B.8): si algo se coló, detener y volver a un estado seguro.
  tab.wc.on('did-start-navigation', (details) => {
    if (!details.isMainFrame || allowedTopLevelUrl(details.url)) return
    tab.wc.stop()
    if (tab.wc.navigationHistory.canGoBack()) tab.wc.navigationHistory.goBack()
    else void tab.wc.loadURL('about:blank')
  })
  tab.wc.setWindowOpenHandler((details) => {
    // El destino real (ver A.5/B.2): nunca una ventana nativa nueva. Si hubo gesto del usuario
    // (target=_blank, clic con botón central…) abrimos una pestaña nueva de la misma superficie.
    if (details.disposition !== 'other' && allowedTopLevelUrl(details.url)) {
      try {
        const created = createTab(tab.owner, { openedBy: 'user' })
        void created.wc.loadURL(details.url).catch((err) => console.error('[embedded-browser] pestaña nueva:', err))
      } catch (err) {
        console.error('[embedded-browser] no se pudo abrir la pestaña nueva:', err)
      }
    }
    return { action: 'deny' }
  })
}

function installLifecycle(tab: TabRuntime): void {
  tab.wc.on('page-title-updated', (_e, title) => {
    tab.title = title
    surfaceEvents.emit('updated', tab)
  })
  tab.wc.on('did-navigate', () => surfaceEvents.emit('updated', tab))
  tab.wc.on('did-navigate-in-page', () => surfaceEvents.emit('updated', tab))
  tab.wc.on('did-start-loading', () => surfaceEvents.emit('updated', tab))
  tab.wc.on('did-stop-loading', () => surfaceEvents.emit('updated', tab))
  tab.wc.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return
    tab.crashed = true
    console.warn(`[embedded-browser] proceso de la pestaña ${tab.id} terminó: ${details.reason}`)
    surfaceEvents.emit('crashed', tab)
  })
  tab.wc.on('input-event', () => {
    if (Date.now() < tab.suppressUserActiveUntil) return
    tab.lastHumanInputAt = Date.now()
    surfaceEvents.emit('inputEvent', tab)
  })
  tab.wc.once('destroyed', () => {
    tab.destroyed = true
    tabsById.delete(tab.id)
    surfaceEvents.emit('destroyed', tab)
  })
}

/** Crea una pestaña vacía (`about:blank`) para el owner. Lanza `TabLimitError` si excede el límite. */
export function createTab(owner: BrowserOwner, opts: { openedBy: 'user' | 'agent' }): TabRuntime {
  if (totalTabCount() >= MAX_TABS_TOTAL) throw new TabLimitError('Demasiadas pestañas abiertas en total (máx. 12)')
  if (tabsForOwner(owner).length >= MAX_TABS_PER_OWNER) throw new TabLimitError('Demasiadas pestañas abiertas (máx. 6)')

  const ses = sessionFor(owner.kind)
  const view = new WebContentsView({
    webPreferences: {
      session: ses,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      devTools: false,
      spellcheck: false,
      safeDialogs: true,
      navigateOnDragDrop: false,
      backgroundThrottling: false,
      focusOnNavigation: false,
      autoplayPolicy: 'document-user-activation-required',
      images: true,
      javascript: true
      // Sin `preload`: ver B.2 «Preload» — todo el control viene de main.
    }
  })
  view.setBackgroundColor('#ffffff')
  const wc = view.webContents
  wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
  wc.setBackgroundThrottling(false)

  const tab: TabRuntime = {
    id: newTabId(),
    owner,
    product: owner.kind,
    view,
    wc,
    createdAt: Date.now(),
    openedBy: opts.openedBy,
    agentSelected: false,
    title: '',
    crashed: false,
    destroyed: false,
    lastHumanInputAt: 0,
    suppressUserActiveUntil: 0
  }
  tabsById.set(tab.id, tab)

  installContextMenu(tab)
  installShortcuts(tab)
  installBaselineNavigationGuard(tab)
  installLifecycle(tab)
  // Emitido ANTES de navegar: quien escuche 'created' (p.ej. la puerta de sitios de service.ts)
  // debe poder adjuntar sus propias guardas a `tab.wc` antes de la primera navegación real.
  surfaceEvents.emit('created', tab)

  void wc.loadURL('about:blank').catch((err) => console.error('[embedded-browser] about:blank:', err))
  return tab
}

/** Navegación directa YA decidida (barra de URL del usuario, o el agente tras aprobación). */
export async function loadDirect(tab: TabRuntime, url: string): Promise<void> {
  if (!allowedTopLevelUrl(url)) throw new Error(`URL no permitida: ${url.slice(0, 200)}`)
  await tab.wc.loadURL(url)
}

/**
 * Cierra y limpia SIEMPRE debugger + estado (D0 corrección 5), incluso en rutas de error.
 *
 * IMPORTANTE: `WebContentsView` no expone un `destroy()`/`close()` propio (Electron 44.4.5):
 * quien llama a esto debe haber quitado ya la vista de su `contentView` (`removeChildView`,
 * en `service.ts`/`popout.ts`) ANTES o justo después; sin referencias ni vista en el árbol,
 * Electron libera el proceso de la pestaña por recolección de basura.
 */
export function destroyTab(tab: TabRuntime): void {
  if (tab.destroyed) return
  tab.destroyed = true
  tabsById.delete(tab.id)
  try {
    detachCdp(tab.wc)
  } catch (err) {
    console.error('[embedded-browser] detachCdp al cerrar:', err)
  }
  try {
    if (!tab.wc.isDestroyed()) tab.wc.stop()
  } catch (err) {
    console.error('[embedded-browser] detención de pestaña:', err)
  }
  surfaceEvents.emit('destroyed', tab)
}
