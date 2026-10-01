/**
 * Overlay de control ("la IA está controlando tu Mac"), al estilo de otros clientes de referencia:
 *
 * - **overlay**: ventana transparente, sin marco, que atraviesa los clics, siempre encima (nivel
 *   `screen-saver`), en todos los escritorios y protegida contra capturas (`setContentProtection`),
 *   que cubre la PANTALLA PRINCIPAL (la misma que controla el agente). Dibuja el borde luminoso, la
 *   marca de destino, la onda de cada clic, la etiqueta de la acción y el destello de las capturas
 *   (`src/renderer/overlay/index.html`).
 * - **píldora**: ventanita flotante arriba al centro con el estado, el paso actual y el botón
 *   Detener (`src/renderer/overlay/pill.html`). Arrastrable; no roba el foco al mostrarse.
 *
 * Ciclo de vida: se muestra con la primera acción (`computer:action`) o con `computer:session
 * {active:true}`; se oculta tras IDLE_MS sin acciones (si no hay sesión explícita), con
 * `computer:session {active:false}`, al detener (Cmd+Shift+Escape / Detener) o cuando se para el
 * servidor de acceso completo.
 *
 * Coordenadas: las acciones llegan en puntos de pantalla (origen arriba-izquierda de la pantalla
 * principal), que es el mismo sistema que los DIP de Electron: basta restar el origen del display
 * principal (0,0) y el escalado Retina lo resuelve Chromium (1 px CSS = 1 punto).
 */
import { BrowserWindow, screen, type Rectangle } from 'electron'
import type { AccessRequest, ComputerActionEvent, ComputerOverlayMessage } from '@shared/ipc-tasks'
import { extrasWindows, isLangStale, loadLocalizedPage, preloadPath } from '../extras/windows'
import { registerWindowRole } from '../ipc/guard'
import { motionDurationMs } from './service'

const IDLE_MS = 8_000
/** Con sesión explícita: red de seguridad si el renderer nunca manda `active: false`. */
const SESSION_SAFETY_MS = 10 * 60_000
const FADE_MS = 380
const PILL_W = 500
const PILL_H = 84
/** Tamaño de la píldora agrandada con la tarjeta "Plan y permisos" / `request_access`. */
const REQUEST_W = 500
const REQUEST_H = 460
/** Pausa del helper entre llegar al origen de un arrastre y empezar a arrastrar (aprox.). */
const DRAG_PAUSE_MS = 210
/** Herramientas que mueven el cursor hasta (x, y) antes de actuar. */
const MOVING_TOOLS = new Set(['left_click', 'right_click', 'double_click', 'mouse_move', 'scroll', 'drag'])

export interface ComputerOverlayOptions {
  /** Sin animación del cursor: la etiqueta salta directamente al destino. */
  instant?: boolean
  /**
   * Ocultar (opacidad 0) overlay y píldora durante cada captura. No hace falta en macOS 14+:
   * `setContentProtection(true)` ya los excluye de `screencapture` (verificado). Activable con
   * `ONYXCODE_OVERLAY_HIDE_ON_CAPTURE=1` por si otra versión de macOS no lo respetara.
   */
  hideOnCapture?: boolean
}

type Page = 'index.html' | 'pill.html'

function loadOverlayPage(win: BrowserWindow, page: Page): Promise<void> {
  return loadLocalizedPage(win, `overlay/${page}`)
}

function inside(r: Rectangle, x: number, y: number, margin: number): boolean {
  return x >= r.x - margin && x <= r.x + r.width + margin && y >= r.y - margin && y <= r.y + r.height + margin
}

export class ComputerOverlay {
  private overlay: BrowserWindow | null = null
  private pill: BrowserWindow | null = null
  private readonly queues = new WeakMap<BrowserWindow, ComputerOverlayMessage[]>()
  private visible = false
  private session = false
  private sessionLabel: string | undefined
  private pending = 0
  private lastEventAt = 0
  private idleTimer: NodeJS.Timeout | null = null
  private hideTimer: NodeJS.Timeout | null = null
  private pillRestoreTimer: NodeJS.Timeout | null = null
  private pillMoved = false
  /** Tarjeta `request_access` pendiente (para replegar/desplegar la píldora según el foco de la app). */
  private pendingRequest: AccessRequest | null = null
  private requestFloating = false
  private disposed = false

  constructor(private readonly opts: ComputerOverlayOptions = {}) {}

  // ───────────────────────────── API pública ─────────────────────────────

  /** Evento del canal lateral del MCP (`ComputerService` 'action'). */
  handleAction(ev: ComputerActionEvent): void {
    if (this.disposed) return
    this.lastEventAt = Date.now()
    if (ev.phase === 'start') this.pending++
    else if (ev.phase === 'end') this.pending = Math.max(0, this.pending - 1)
    // Las capturas automáticas no bastan para (re)abrir el overlay si ya se ocultó.
    if (!this.visible && ev.tool === 'screenshot' && ev.auto) return
    this.show()

    const d = screen.getPrimaryDisplay().bounds
    const c = screen.getCursorScreenPoint()
    const cursor = { x: c.x - d.x, y: c.y - d.y }
    const action: ComputerActionEvent = { ...ev }
    let atCursor = false
    if (typeof ev.x === 'number' && typeof ev.y === 'number') {
      action.x = ev.x - d.x
      action.y = ev.y - d.y
    } else {
      action.x = cursor.x
      action.y = cursor.y
      atCursor = true
    }
    if (typeof ev.fromX === 'number' && typeof ev.fromY === 'number') {
      action.fromX = ev.fromX - d.x
      action.fromY = ev.fromY - d.y
    }

    let moveMs = 0
    if (ev.phase === 'start' && !atCursor && !this.opts.instant && MOVING_TOOLS.has(ev.tool)) {
      const dist = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(bx - ax, by - ay)
      if (ev.tool === 'drag' && action.fromX !== undefined && action.fromY !== undefined) {
        moveMs =
          motionDurationMs(dist(cursor.x, cursor.y, action.fromX, action.fromY)) +
          DRAG_PAUSE_MS +
          motionDurationMs(dist(action.fromX, action.fromY, action.x!, action.y!))
      } else {
        moveMs = motionDurationMs(dist(cursor.x, cursor.y, action.x!, action.y!))
      }
    }

    const msg: ComputerOverlayMessage = { type: 'action', action, cursor, moveMs, atCursor }
    // Lote C: las herramientas `app_*` controlan por Accessibility API (sin ratón real ni
    // coordenadas de pantalla): no hay nada que animar en el overlay a pantalla completa, solo la
    // etiqueta de texto de la píldora (`describeStep`).
    if (!ev.tool.startsWith('app_')) this.post(this.overlay, msg)
    this.post(this.pill, msg)
    if (ev.phase === 'start' && !atCursor) this.avoidPill(ev)
    if (ev.phase === 'end') this.schedulePillRestore(350)
    if (ev.tool === 'screenshot' && ev.phase === 'end') this.setCaptureOpacity(1)
    this.scheduleIdle()
  }

  /**
   * Tarjeta `request_access` pendiente (herramienta MCP): la sesión se PAUSA sin límite de tiempo
   * (borde ámbar "Esperando tu permiso" en el overlay). La píldora solo se agranda para mostrar el
   * plan/apps (selector de nivel por app + Aprobar/Denegar, sin robar el foco) cuando la ventana
   * principal NO está al frente (`floating`): si el usuario está mirando la app, la tarjeta de la app
   * es la única y la píldora no la duplica. `setRequestFloating` la despliega/pliega al cambiar el foco.
   */
  showAccessRequest(req: AccessRequest, floating = true): void {
    if (this.disposed) return
    this.show(this.sessionLabel)
    this.pendingRequest = req
    this.post(this.overlay, { type: 'waiting', request: req })
    this.setRequestFloating(floating)
    if (this.idleTimer) clearTimeout(this.idleTimer) // no ocultar por inactividad mientras se espera
  }

  /** Despliega (o pliega) la tarjeta en la píldora flotante sin resolver la petición pendiente. */
  setRequestFloating(floating: boolean): void {
    if (this.disposed) return
    this.requestFloating = floating
    const req = this.pendingRequest
    if (!req) return
    if (floating) {
      this.resizePillForRequest(true)
      this.post(this.pill, { type: 'waiting', request: req })
      // Ajusta el alto de la ventana al de la tarjeta cuando ya se pintó (evita una zona transparente vacía).
      for (const ms of [120, 500]) setTimeout(() => void this.fitPillToRequest(), ms)
    } else {
      this.post(this.pill, { type: 'waitingCleared' })
      this.resizePillForRequest(false)
    }
  }

  /** Se resolvió (o se canceló) la tarjeta pendiente. */
  clearAccessRequest(): void {
    if (this.disposed) return
    this.pendingRequest = null
    this.requestFloating = false
    this.resizePillForRequest(false)
    this.post(this.overlay, { type: 'waitingCleared' })
    this.post(this.pill, { type: 'waitingCleared' })
    this.scheduleIdle()
  }

  /** Ajusta el alto de la ventana de la píldora al de la tarjeta "Plan y permisos" (con sitio para la sombra). */
  private async fitPillToRequest(): Promise<void> {
    const pill = this.pill
    if (!pill || pill.isDestroyed() || !this.pendingRequest || !this.requestFloating) return
    try {
      const natural: unknown = await pill.webContents.executeJavaScript(
        "(() => { const r = document.querySelector('.request'); return r && !r.hidden ? r.scrollHeight + 2 : 0 })()"
      )
      if (typeof natural !== 'number' || natural <= 0) return
      const b = pill.getBounds()
      const wa = screen.getDisplayMatching(b).workArea
      const h = Math.min(Math.ceil(natural) + 10 + 24, wa.height - 24) // 10 px de margen superior + 24 de sombra
      if (Math.abs(b.height - h) > 2) pill.setBounds({ x: b.x, y: b.y, width: REQUEST_W, height: h })
    } catch {
      // ventana destruida mientras se medía
    }
  }

  /** Agranda/reduce la píldora para mostrar (u ocultar) la tarjeta "Plan y permisos". */
  private resizePillForRequest(active: boolean): void {
    const pill = this.pill
    if (!pill || pill.isDestroyed()) return
    const b = pill.getBounds()
    const h = active ? REQUEST_H : PILL_H
    // Mantiene el borde superior fijo (crece hacia abajo); respeta si el usuario la arrastró.
    pill.setBounds({ x: b.x, y: b.y, width: active ? REQUEST_W : PILL_W, height: h })
  }

  /** `computer:session` desde el renderer. */
  setSession(active: boolean, label?: string): void {
    if (this.disposed) return
    this.session = active
    if (active) {
      this.sessionLabel = label?.slice(0, 160)
      this.show(this.sessionLabel)
      this.scheduleIdle()
    } else {
      this.sessionLabel = undefined
      this.pending = 0
      this.hide(900)
    }
  }

  /** Kill-switch pulsado: la píldora muestra "Control detenido" y todo se desvanece. */
  stopped(): void {
    if (this.disposed) return
    this.session = false
    this.pending = 0
    if (!this.visible) return
    this.post(this.overlay, { type: 'stopped' })
    this.post(this.pill, { type: 'stopped' })
    this.hide(1600)
  }

  /** El servidor de acceso completo se paró / falló. */
  serverGone(): void {
    this.session = false
    this.pending = 0
    if (this.visible) this.hide(0)
  }

  /** `ComputerService.captureGuard`: se llama antes de cada captura. */
  async beforeCapture(): Promise<void> {
    if (!this.opts.hideOnCapture || !this.visible) return
    this.setCaptureOpacity(0)
    // Un par de frames para que el compositor aplique la opacidad.
    await new Promise((r) => setTimeout(r, 60))
  }

  dispose(): void {
    this.disposed = true
    this.clearTimers()
    for (const w of [this.overlay, this.pill]) if (w && !w.isDestroyed()) w.destroy()
    this.overlay = null
    this.pill = null
  }

  // ───────────────────────────── visibilidad ─────────────────────────────

  private show(label?: string): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
    const overlay = this.ensureOverlay()
    const pill = this.ensurePill()
    const display = screen.getPrimaryDisplay()
    if (!this.visible) {
      overlay.setBounds(display.bounds)
      if (!this.pillMoved) this.placePill(pill)
      this.visible = true
      overlay.setOpacity(1)
      pill.setOpacity(1)
      pill.setIgnoreMouseEvents(false)
      // showInactive: jamás robar el foco a la app que el agente está usando.
      overlay.showInactive()
      pill.showInactive()
      this.post(overlay, { type: 'show', label: label ?? this.sessionLabel })
      this.post(pill, { type: 'show', label: label ?? this.sessionLabel })
    } else if (label !== undefined) {
      this.post(pill, { type: 'show', label })
    }
  }

  private hide(delayMs: number): void {
    if (this.hideTimer) clearTimeout(this.hideTimer)
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null
      if (!this.visible) return
      this.post(this.overlay, { type: 'hide' })
      this.post(this.pill, { type: 'hide' })
      this.hideTimer = setTimeout(() => {
        this.hideTimer = null
        this.visible = false
        for (const w of [this.overlay, this.pill]) if (w && !w.isDestroyed()) w.hide()
      }, FADE_MS)
    }, delayMs)
  }

  private scheduleIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    const limit = this.session ? SESSION_SAFETY_MS : IDLE_MS
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      // Acción larga en curso (p.ej. escribir un texto largo o `wait`): seguir esperando.
      if (this.pending > 0 && Date.now() - this.lastEventAt < 60_000) return this.scheduleIdle()
      this.pending = 0
      this.session = false
      this.hide(0)
    }, limit)
  }

  private clearTimers(): void {
    for (const t of [this.idleTimer, this.hideTimer, this.pillRestoreTimer]) if (t) clearTimeout(t)
    this.idleTimer = this.hideTimer = this.pillRestoreTimer = null
  }

  private setCaptureOpacity(o: number): void {
    if (!this.opts.hideOnCapture) return
    for (const w of [this.overlay, this.pill]) if (w && !w.isDestroyed()) w.setOpacity(o)
  }

  /**
   * La píldora es invisible en las capturas (protección de contenido): si el agente apunta debajo
   * de ella, se vuelve transparente a los clics y casi invisible hasta que termine la acción.
   */
  private avoidPill(ev: ComputerActionEvent): void {
    const pill = this.pill
    if (!pill || pill.isDestroyed()) return
    const b = pill.getBounds()
    const hit = (x?: number, y?: number): boolean => typeof x === 'number' && typeof y === 'number' && inside(b, x, y, 16)
    if (!hit(ev.x, ev.y) && !hit(ev.fromX, ev.fromY)) return
    if (this.pillRestoreTimer) {
      clearTimeout(this.pillRestoreTimer)
      this.pillRestoreTimer = null
    }
    pill.setIgnoreMouseEvents(true)
    pill.setOpacity(0.12)
    // Por si nunca llega el `end`.
    this.schedulePillRestore(8_000)
  }

  private schedulePillRestore(ms: number): void {
    const pill = this.pill
    if (!pill || pill.isDestroyed() || pill.getOpacity() === 1) return
    if (this.pillRestoreTimer) clearTimeout(this.pillRestoreTimer)
    this.pillRestoreTimer = setTimeout(() => {
      this.pillRestoreTimer = null
      if (pill.isDestroyed()) return
      pill.setIgnoreMouseEvents(false)
      pill.setOpacity(1)
    }, ms)
  }

  private placePill(pill: BrowserWindow): void {
    const wa = screen.getPrimaryDisplay().workArea
    pill.setBounds({
      x: Math.round(wa.x + (wa.width - PILL_W) / 2),
      y: Math.round(wa.y + 4),
      width: PILL_W,
      height: PILL_H
    })
  }

  // ───────────────────────────── ventanas ─────────────────────────────

  private post(win: BrowserWindow | null, msg: ComputerOverlayMessage): void {
    if (!win || win.isDestroyed()) return
    const q = this.queues.get(win)
    if (q) q.push(msg)
    else win.webContents.send('computer:overlay', msg)
  }

  private prepare(win: BrowserWindow, page: Page): void {
    extrasWindows.add(win)
    registerWindowRole(win.webContents, page === 'pill.html' ? 'pill' : 'overlay')
    const isMac = process.platform === 'darwin'
    win.setAlwaysOnTop(true, 'screen-saver', page === 'pill.html' ? 1 : 0)
    if (isMac) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    // Excluida de `screencapture`: el agente nunca ve el overlay ni la píldora.
    win.setContentProtection(true)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    // Mensajes en cola hasta que la página cargue.
    this.queues.set(win, [])
    win.webContents.once('did-finish-load', () => {
      const q = this.queues.get(win) ?? []
      this.queues.delete(win)
      for (const m of q) if (!win.isDestroyed()) win.webContents.send('computer:overlay', m)
    })
    void loadOverlayPage(win, page).catch((err) => console.error(`[computer] overlay ${page}:`, err))
  }

  private webPreferences(page: Page): Electron.WebPreferences {
    return {
      // Preload mínimo: el overlay solo escucha; la píldora además puede pedir `computer:stop`.
      preload: preloadPath(page === 'pill.html' ? 'pill' : 'overlay'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  }

  /** Ventana ya creada y vigente; si se cargó con otro idioma y no se ve, se descarta para recrearla. */
  private reusable(win: BrowserWindow | null): win is BrowserWindow {
    if (!win || win.isDestroyed()) return false
    if (this.visible || !isLangStale(win)) return true
    win.destroy()
    return false
  }

  private ensureOverlay(): BrowserWindow {
    if (this.reusable(this.overlay)) return this.overlay!
    const isMac = process.platform === 'darwin'
    const win = new BrowserWindow({
      ...screen.getPrimaryDisplay().bounds,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      enableLargerThanScreen: true,
      roundedCorners: false,
      ...(isMac ? { type: 'panel' as const } : {}),
      webPreferences: this.webPreferences('index.html')
    })
    // Atraviesa todos los clics (también los sintéticos del agente).
    win.setIgnoreMouseEvents(true, { forward: true })
    win.on('closed', () => {
      if (this.overlay === win) this.overlay = null
    })
    this.prepare(win, 'index.html')
    this.overlay = win
    return win
  }

  private ensurePill(): BrowserWindow {
    if (this.reusable(this.pill)) return this.pill!
    const win = new BrowserWindow({
      width: PILL_W,
      height: PILL_H,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      acceptFirstMouse: true,
      // Sin `type: 'panel'`: en macOS 26+ un NSPanel pequeño y transparente pinta un fondo opaco
      // detrás de la web (verificado con screencapture); una ventana normal queda transparente.
      webPreferences: this.webPreferences('pill.html')
    })
    // Solo movimientos del usuario (arrastre): desde entonces se respeta su posición.
    win.on('will-move', () => {
      this.pillMoved = true
    })
    win.on('closed', () => {
      if (this.pill === win) this.pill = null
    })
    this.prepare(win, 'pill.html')
    this.pill = win
    return win
  }
}
