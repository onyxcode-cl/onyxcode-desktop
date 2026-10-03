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
import { t } from '@shared/i18n'
import { EventEmitter } from 'node:events'
import { Menu, WebContentsView, clipboard, shell, type WebContents } from 'electron'
import type { BrowserOwner, BrowserProduct, BrowserViewMode } from '@shared/ipc-browser'
import { getPrefs } from './store'
import { computeEmulation, emulationKey, mobileUserAgent, type ViewportEmulation } from './viewport'
import { checkUrl, schemeOf, subframeUrlAllowed } from './sites'
import { sessionFor, setExternalOpenBlockedListener } from './session'
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
  /** Vista pedida y última emulación aplicada (F8-B46): ver `viewport.ts`. */
  viewMode: BrowserViewMode
  emulation: ViewportEmulation | null
  /** Tamaño (px de la vista nativa) con que se calculó la emulación; `null` = aún sin colocar. */
  viewBox: { width: number; height: number } | null
  emulationKey: string
}

export const surfaceEvents = new EventEmitter()

const tabsById = new Map<string, TabRuntime>()

export function ownerKeyOf(owner: BrowserOwner): string {
  return owner.kind === 'code' ? `code:${owner.directory}` : `tasks:${owner.folder}`
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
    items.push({ label: t('merr.menu.back'), enabled: nav.canGoBack(), click: () => nav.goBack() })
    items.push({ label: t('merr.menu.forward'), enabled: nav.canGoForward(), click: () => nav.goForward() })
    items.push({ label: t('merr.menu.reload'), click: () => tab.wc.reload() })
    items.push({ type: 'separator' })
    if (params.isEditable) {
      items.push({ label: t('merr.menu.paste'), click: () => tab.wc.paste() })
    }
    if (params.selectionText) {
      items.push({ label: t('merr.menu.copy'), click: () => tab.wc.copy() })
    }
    if (params.linkURL) {
      items.push({ label: t('merr.menu.copyLink'), click: () => clipboard.writeText(params.linkURL) })
    }
    const topUrl = params.linkURL || tab.wc.getURL()
    if (/^https?:\/\//i.test(topUrl)) {
      items.push({ type: 'separator' })
      items.push({ label: t('merr.menu.openSystem'), click: () => void shell.openExternal(topUrl) })
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

/** Último aviso emitido por pestaña (esquema + instante): evita repetir el mismo esquema en <200 ms. */
const lastBlocked = new Map<string, { scheme: string; at: number }>()
const BLOCKED_DEDUPE_MS = 200

/**
 * Registra un bloqueo SIN volcar la dirección: si el esquema no es http(s) solo se escribe el esquema
 * (un `mailto:`/`tel:` lleva un correo o un teléfono). Emite `blocked` (deduplicado) para que
 * `service.ts` avise al usuario en el panel.
 */
function reportBlocked(tab: TabRuntime, url: string, label: string): void {
  const scheme = schemeOf(url)
  if (scheme === 'http:' || scheme === 'https:') console.warn(`[embedded-browser] navegación bloqueada (${label}): ${url.slice(0, 200)}`)
  else console.warn(`[embedded-browser] navegación bloqueada: ${scheme ?? 'esquema desconocido'} (${label})`)
  const now = Date.now()
  const prev = lastBlocked.get(tab.id)
  const key = scheme ?? ''
  if (prev && prev.scheme === key && now - prev.at < BLOCKED_DEDUPE_MS) return
  lastBlocked.set(tab.id, { scheme: key, at: now })
  surfaceEvents.emit('blocked', tab, scheme)
}

// `openExternal` (permiso que Chromium pide al navegar a un esquema externo): denegado en `session.ts`; aquí solo se registra y avisa.
let externalListenerInstalled = false
/** Se instala en el primer `createTab` (no al importar el módulo: el orden de evaluación del bundle rompe la inicialización). */
function ensureExternalOpenListener(): void {
  if (externalListenerInstalled) return
  externalListenerInstalled = true
  setExternalOpenBlockedListener((wc, url) => {
    const tab = tabByWebContents(wc)
    if (tab && !tab.destroyed) reportBlocked(tab, url, 'openExternal')
    else console.warn(`[embedded-browser] navegación bloqueada: ${schemeOf(url) ?? 'esquema desconocido'} (openExternal)`)
  })
}

function installBaselineNavigationGuard(tab: TabRuntime): void {
  // Primer nivel: solo http(s)/about:blank (`checkUrl`); subframes: `subframeUrlAllowed` (sin mailto:/tel:/file:…).
  const guard = (url: string, prevent: () => void, label: string, isMainFrame: boolean): void => {
    if (isMainFrame ? allowedTopLevelUrl(url) : subframeUrlAllowed(url)) return
    prevent()
    reportBlocked(tab, url, label)
  }
  // `details` viene fusionado con el `Event` (tiene `.url`, `.isMainFrame` y `.preventDefault()`).
  tab.wc.on('will-navigate', (details) => guard(details.url, () => details.preventDefault(), 'will-navigate', true))
  tab.wc.on('will-redirect', (details) => guard(details.url, () => details.preventDefault(), 'will-redirect', details.isMainFrame))
  tab.wc.on('will-frame-navigate', (details) =>
    guard(details.url, () => details.preventDefault(), 'will-frame-navigate', details.isMainFrame)
  )
  // Respaldo (B.8): si algo se coló y llegó a confirmarse, volver a un estado seguro. NUNCA dentro de
  // un evento de inicio de navegación: `stop()`/`goBack()`/`loadURL()` síncronos allí (Chromium emite
  // `DidStartNavigation` antes de los throttles) mataban el proceso principal con `mailto:`/`tel:` (F7-B1).
  tab.wc.on('did-navigate', (_e, url) => {
    if (allowedTopLevelUrl(url) || url.startsWith('chrome-error:')) return
    setImmediate(() => {
      if (tab.destroyed || tab.wc.isDestroyed()) return
      if (tab.wc.navigationHistory.canGoBack()) tab.wc.navigationHistory.goBack()
      else void tab.wc.loadURL('about:blank').catch(() => undefined)
    })
  })
  tab.wc.setWindowOpenHandler((details) => {
    // El destino real (ver A.5/B.2): nunca una ventana nativa nueva. Si hubo gesto del usuario
    // (target=_blank, clic con botón central…) abrimos una pestaña nueva de la misma superficie.
    if (!allowedTopLevelUrl(details.url)) reportBlocked(tab, details.url, 'window-open')
    else if (details.disposition !== 'other') {
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
  // La emulación se pierde si la navegación cambia de proceso de render: se reaplica (misma vista y tamaño).
  const reapply = (): void => applyViewport(tab, tab.viewMode, null, true)
  tab.wc.on('did-navigate', reapply)
  tab.wc.on('dom-ready', reapply)
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
    const already = tab.destroyed // `destroyTab` ya lo anunció
    tab.destroyed = true
    tabsById.delete(tab.id)
    lastBlocked.delete(tab.id)
    if (!already) surfaceEvents.emit('destroyed', tab)
  })
}

/** Aplica (o reaplica) la emulación de viewport y el user agent de la pestaña según su vista y el tamaño de su vista nativa. */
export function applyViewport(tab: TabRuntime, mode: BrowserViewMode, box: { width: number; height: number } | null, force = false): void {
  if (tab.destroyed || tab.wc.isDestroyed()) return
  const modeChanged = tab.viewMode !== mode
  tab.viewMode = mode
  if (box) tab.viewBox = box
  if (modeChanged) {
    try {
      tab.wc.setUserAgent(mode === 'mobile' ? mobileUserAgent(process.versions.chrome ?? '') : tab.wc.session.getUserAgent())
    } catch (err) {
      console.error('[embedded-browser] user agent de la vista:', err)
    }
  }
  const size = tab.viewBox
  if (!size || size.width <= 0 || size.height <= 0) return
  const emu = computeEmulation(mode, size.width, size.height)
  const key = emulationKey(mode, emu)
  tab.emulation = emu
  if (!force && !modeChanged && key === tab.emulationKey) return
  tab.emulationKey = key
  try {
    if (!emu) tab.wc.disableDeviceEmulation()
    else {
      tab.wc.enableDeviceEmulation({
        screenPosition: emu.screenPosition,
        screenSize: emu.viewSize,
        viewPosition: { x: 0, y: 0 },
        deviceScaleFactor: 0,
        viewSize: emu.viewSize,
        scale: emu.scale
      })
    }
  } catch (err) {
    console.error('[embedded-browser] emulación de viewport:', err)
  }
}

/** Crea una pestaña vacía (`about:blank`) para el owner. Lanza `TabLimitError` si excede el límite. */
export function createTab(owner: BrowserOwner, opts: { openedBy: 'user' | 'agent' }): TabRuntime {
  if (totalTabCount() >= MAX_TABS_TOTAL) throw new TabLimitError('Demasiadas pestañas abiertas en total (máx. 12)')
  if (tabsForOwner(owner).length >= MAX_TABS_PER_OWNER) throw new TabLimitError('Demasiadas pestañas abiertas (máx. 6)')

  ensureExternalOpenListener()
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
    suppressUserActiveUntil: 0,
    viewMode: 'desktop',
    emulation: null,
    viewBox: null,
    emulationKey: ''
  }
  tabsById.set(tab.id, tab)

  installContextMenu(tab)
  installShortcuts(tab)
  installBaselineNavigationGuard(tab)
  installLifecycle(tab)
  // Emitido ANTES de navegar: quien escuche 'created' (p.ej. la puerta de sitios de service.ts)
  // debe poder adjuntar sus propias guardas a `tab.wc` antes de la primera navegación real.
  applyViewport(tab, getPrefs().viewMode, null)
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
 * IMPORTANTE: `WebContentsView` no expone un `destroy()`/`close()` propio (Electron 44.4.5), pero su
 * `webContents` sí tiene `close()`, que es lo que libera la página y su proceso. Quien llama debe haber
 * quitado ya la vista de su `contentView` (`removeChildView`, `discardTab` en `service.ts`) ANTES.
 */
export function destroyTab(tab: TabRuntime): void {
  if (tab.destroyed) return
  tab.destroyed = true
  tabsById.delete(tab.id)
  lastBlocked.delete(tab.id)
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
  // `WebContentsView` no tiene `close()`, pero su `webContents` sí: sin esto la página seguía viva (JS, audio, red,
  // proceso renderer) hasta una recolección de basura que nunca llegaba mientras algo la referenciara.
  try {
    if (!tab.wc.isDestroyed()) tab.wc.close()
  } catch (err) {
    console.error('[embedded-browser] cierre de pestaña:', err)
  }
}
