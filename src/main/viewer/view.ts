/**
 * Ciclo de vida de la `WebContentsView` del visor (Fase 0 del plan del visor). Mismo patrón que
 * `embedded-browser/service.ts` (`attachView`/`layoutView`), simplificado: solo hay UNA vista de
 * visor a la vez (no una por pestaña). La vista vive adentro de la ventana de Tareas, en el hueco
 * que mide `useViewerViewport` (renderer) y manda por `tasks:viewer:attach`.
 */
import { app, BrowserWindow, WebContentsView } from 'electron'
import { EventEmitter } from 'node:events'
import { viewerSession } from './session'

export interface ViewerRect {
  x: number
  y: number
  width: number
  height: number
}

export type ViewerEventType = 'escape' | 'crashed' | 'loaded' | 'error'

const emitter = new EventEmitter()

interface State {
  view: WebContentsView | null
  hostWindow: BrowserWindow | null
  attachedTo: BrowserWindow | null
  rect: ViewerRect | null
  visible: boolean
}

const state: State = { view: null, hostWindow: null, attachedTo: null, rect: null, visible: false }

/**
 * Crea la vista la primera vez que hace falta (perezoso). El renderer suele llamar a `attach()`
 * (con el hueco medido) ANTES de que el primer documento termine de generarse y llegue a `openDoc()`
 * — en ese momento `layout()` no hace nada porque todavía no hay vista que mostrar. Por eso, recién
 * creada, se vuelve a aplicar el último hueco/visibilidad que ya se haya recibido: sin esto, el
 * primer documento de la sesión quedaba cargado pero nunca attacheado a la ventana (invisible) hasta
 * que algún resize volvía a disparar `attach()` por casualidad.
 */
function ensureView(): WebContentsView {
  if (state.view) return state.view
  const view = new WebContentsView({
    webPreferences: {
      session: viewerSession(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  })
  const wc = view.webContents
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  wc.on('will-navigate', (event) => event.preventDefault())
  wc.on('will-redirect', (event) => event.preventDefault())
  wc.on('will-attach-webview', (event) => event.preventDefault())
  wc.on('render-process-gone', () => emitter.emit('event', { type: 'crashed' satisfies ViewerEventType }))
  wc.on('did-finish-load', () => emitter.emit('event', { type: 'loaded' satisfies ViewerEventType }))
  wc.on('did-fail-load', (_e, _code, _desc, _url, isMainFrame) => {
    if (isMainFrame) emitter.emit('event', { type: 'error' satisfies ViewerEventType })
  })
  wc.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown') return
    if (input.key === 'Escape') emitter.emit('event', { type: 'escape' satisfies ViewerEventType })
  })
  state.view = view
  layout()
  return view
}

function layout(): void {
  const win = state.hostWindow
  const view = state.view
  const shouldShow = !!view && !!win && !win.isDestroyed() && state.visible && !!state.rect
  if (!shouldShow) {
    if (view && state.attachedTo && !state.attachedTo.isDestroyed()) state.attachedTo.contentView.removeChildView(view)
    state.attachedTo = null
    return
  }
  const hostWin = win as BrowserWindow
  const v = view as WebContentsView
  if (state.attachedTo !== hostWin) {
    if (state.attachedTo && !state.attachedTo.isDestroyed()) state.attachedTo.contentView.removeChildView(v)
    hostWin.contentView.addChildView(v)
    state.attachedTo = hostWin
  }
  const rect = state.rect as ViewerRect
  const zoom = hostWin.webContents.getZoomFactor() || 1
  v.setBounds({
    x: Math.round(rect.x * zoom),
    y: Math.round(rect.y * zoom),
    width: Math.round(rect.width * zoom),
    height: Math.round(rect.height * zoom)
  })
}

let navSeq = 0

/**
 * Carga (o recarga) la URL del documento actual en la vista. Dos documentos seguidos solo difieren
 * en el fragmento (`#t=<token>&...`) — y una navegación a la MISMA ruta con SOLO el fragmento
 * distinto es, para Chromium, navegación "del mismo documento" (como un ancla): no vuelve a cargar
 * la página, así que `App.tsx` nunca re-lee los params nuevos y se queda mostrando el documento
 * viejo. Se le agrega un parámetro de consulta que cambia siempre, ANTES del fragmento, para forzar
 * una recarga real cada vez (una diferencia de ruta/query sí fuerza navegación, a diferencia del hash).
 */
export function openDoc(url: string): void {
  const hashIndex = url.indexOf('#')
  const base = hashIndex === -1 ? url : url.slice(0, hashIndex)
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex)
  const sep = base.includes('?') ? '&' : '?'
  void ensureView().webContents.loadURL(`${base}${sep}_r=${++navSeq}${hash}`)
}

/** Sincroniza el hueco/visibilidad con el host, como `embedded-browser`'s `attachView`. */
export function attach(hostWindow: BrowserWindow, rect: ViewerRect, visible: boolean): void {
  state.hostWindow = hostWindow
  state.rect = rect
  state.visible = visible
  layout()
}

/** Oculta la vista sin destruirla (el panel se cerró, pero el documento sigue "abierto"). */
export function detach(): void {
  state.visible = false
  layout()
}

/** Destruye la vista por completo (al cerrar el documento). Libera memoria. */
export function closeView(): void {
  const view = state.view
  if (view) {
    if (state.attachedTo && !state.attachedTo.isDestroyed()) state.attachedTo.contentView.removeChildView(view)
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }
  state.view = null
  state.hostWindow = null
  state.attachedTo = null
  state.rect = null
  state.visible = false
}

/** Avisos del visor (escape, caída del proceso, carga terminada, error de carga). */
export function onViewerEvent(cb: (event: { type: ViewerEventType }) => void): () => void {
  emitter.on('event', cb)
  return () => emitter.off('event', cb)
}
