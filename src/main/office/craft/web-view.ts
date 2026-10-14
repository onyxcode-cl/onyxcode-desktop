/**
 * PRUEBA (rama `exp/craft-office-pruebas`): vista del panel de documentos de Chat con la versión WEB del programa Craft (GridCraft para
 * Excel, DeckCraft para PowerPoint, WordCraft para Word): el MISMO motor y la MISMA pantalla que el programa de escritorio, así que el
 * documento se ve y se comporta igual (hojas, fórmulas, gráficos, diseño). Mismo patrón que `viewer/view.ts` pero con su propia sesión.
 *
 * Aislamiento: partición propia EN MEMORIA; `webRequest` cancela TODO lo que no sea el servidor local de este programa; permisos
 * denegados; descargas bloqueadas; sin Node, sin preload, navegación y ventanas nuevas bloqueadas; el archivo se entrega al motor desde
 * el proceso principal simulando que la persona lo suelta en el lienzo. La app original no se toca: lo que se descarga sigue siendo el
 * archivo real, que cada quien abre en el programa que prefiera.
 */
import { app, BrowserWindow, session, WebContentsView, type Session } from 'electron'
import { EventEmitter } from 'node:events'
import { startWebServer, type WebServer } from './web-server'
import { WEB_OPEN_TIMEOUT_MS, withTimeout } from './web-timeout'

export interface WebRect {
  x: number
  y: number
  width: number
  height: number
}
export type WebViewEvent = { type: 'loaded' | 'error' | 'crashed' | 'escape' }

export const MAX_WEB_FILE_BYTES = 25 * 1024 * 1024
const MIME_BY_EXT: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf'
}

const emitter = new EventEmitter()
interface State {
  view: WebContentsView | null
  server: WebServer | null
  serverDir: string | null
  hostWindow: BrowserWindow | null
  attachedTo: BrowserWindow | null
  rect: WebRect | null
  visible: boolean
  active: boolean
}
const state: State = {
  view: null,
  server: null,
  serverDir: null,
  hostWindow: null,
  attachedTo: null,
  rect: null,
  visible: false,
  active: false
}

let configured: Session | null = null
function webSession(): Session {
  if (configured) return configured
  const ses = session.fromPartition('craft-web', { cache: false })
  ses.webRequest.onBeforeRequest((details, callback) => {
    const origin = state.server?.origin
    callback({ cancel: !origin || !(details.url === origin || details.url.startsWith(origin + '/')) })
  })
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  ses.on('will-download', (event) => event.preventDefault())
  configured = ses
  return ses
}

function ensureView(): WebContentsView {
  if (state.view) return state.view
  const view = new WebContentsView({
    webPreferences: {
      session: webSession(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
      backgroundThrottling: false,
      devTools: !app.isPackaged
    }
  })
  const wc = view.webContents
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  wc.on('will-navigate', (event) => event.preventDefault())
  wc.on('will-redirect', (event) => event.preventDefault())
  wc.on('will-attach-webview', (event) => event.preventDefault())
  wc.on('render-process-gone', () => emitter.emit('event', { type: 'crashed' } satisfies WebViewEvent))
  wc.on('did-fail-load', (_e, _c, _d, _u, isMain) => {
    if (isMain) emitter.emit('event', { type: 'error' } satisfies WebViewEvent)
  })
  wc.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') emitter.emit('event', { type: 'escape' } satisfies WebViewEvent)
  })
  state.view = view
  layout()
  return view
}

function layout(): void {
  const win = state.hostWindow
  const view = state.view
  const show = !!view && !!win && !win.isDestroyed() && state.visible && state.active && !!state.rect
  if (!show) {
    if (view && state.attachedTo && !state.attachedTo.isDestroyed()) state.attachedTo.contentView.removeChildView(view)
    state.attachedTo = null
    return
  }
  const host = win as BrowserWindow
  const v = view as WebContentsView
  if (state.attachedTo !== host) {
    if (state.attachedTo && !state.attachedTo.isDestroyed()) state.attachedTo.contentView.removeChildView(v)
    host.contentView.addChildView(v)
    state.attachedTo = host
  }
  const rect = state.rect as WebRect
  const zoom = host.webContents.getZoomFactor() || 1
  v.setBounds({
    x: Math.round(rect.x * zoom),
    y: Math.round(rect.y * zoom),
    width: Math.round(rect.width * zoom),
    height: Math.round(rect.height * zoom)
  })
}

/** Script que espera a que el motor esté listo y le «suelta» el archivo en el lienzo, como si la persona lo arrastrara. */
export function dropScript(base64: string, fileName: string, mime: string, waitMs: number = WEB_OPEN_TIMEOUT_MS - 3000): string {
  return `(async () => {
    // Si el motor wasm nunca arranca, se rinde (devuelve false) en vez de esperar para siempre.
    const ready = await new Promise((ok) => {
      if (window.wasmBindings) return ok(true)
      const timer = setTimeout(() => ok(false), ${Math.max(1, Math.round(waitMs))})
      addEventListener('TrunkApplicationStarted', () => { clearTimeout(timer); ok(true) }, { once: true })
    })
    if (!ready) return false
    await new Promise((ok) => setTimeout(ok, 700))
    const canvas = document.querySelector('canvas')
    if (!canvas) return false
    const bytes = Uint8Array.from(atob(${JSON.stringify(base64)}), (c) => c.charCodeAt(0))
    const dt = new DataTransfer()
    dt.items.add(new File([bytes], ${JSON.stringify(fileName)}, { type: ${JSON.stringify(mime)} }))
    const o = { dataTransfer: dt, bubbles: true, cancelable: true, clientX: Math.round(innerWidth / 2), clientY: Math.round(innerHeight / 2) }
    for (const t of ['dragenter', 'dragover', 'drop']) canvas.dispatchEvent(new DragEvent(t, o))
    return true
  })()`
}

/**
 * Abre `bytes` (un .xlsx/.pptx/.docx) en la versión web de `webDir`. Devuelve `true` si el motor recibió el archivo. Lanza si el
 * archivo es demasiado grande o la versión web no arranca (quien llama cae al visor de siempre).
 */
export async function openWebDoc(
  webDir: string,
  ext: 'xlsx' | 'pptx' | 'docx' | 'pdf',
  fileName: string,
  bytes: Buffer,
  timeoutMs: number = WEB_OPEN_TIMEOUT_MS
): Promise<boolean> {
  if (bytes.length > MAX_WEB_FILE_BYTES) throw new Error('Archivo demasiado grande para la vista web')
  const started = Date.now()
  const left = (): number => Math.max(1, timeoutMs - (Date.now() - started))
  if (!state.server || state.serverDir !== webDir) {
    await state.server?.close().catch(() => undefined)
    state.server = await startWebServer(webDir)
    state.serverDir = webDir
  }
  const view = ensureView()
  state.active = true
  layout()
  try {
    await withTimeout(view.webContents.loadURL(`${state.server.origin}/?_r=${Date.now()}`), left(), 'carga')
    const script = dropScript(bytes.toString('base64'), fileName, MIME_BY_EXT[ext], Math.max(1, left() - 1000))
    const ok = (await withTimeout(view.webContents.executeJavaScript(script, false), left(), 'motor')) === true
    emitter.emit('event', { type: ok ? 'loaded' : 'error' } satisfies WebViewEvent)
    return ok
  } catch (e) {
    // El motor no respondió: se avisa a la ventana y se propaga para que quien llama registre el fallo y use el visor de siempre.
    emitter.emit('event', { type: 'error' } satisfies WebViewEvent)
    throw e
  }
}

export function attachWeb(hostWindow: BrowserWindow, rect: WebRect, visible: boolean): void {
  state.hostWindow = hostWindow
  state.rect = rect
  state.visible = visible
  layout()
}

/** ¿La vista web es la que está mostrando el documento actual? (si no, el panel usa el visor de siempre). */
export function isWebActive(): boolean {
  return state.active
}

/** Deja de ser la vista activa (otro documento va por el visor de siempre) y la oculta sin destruirla. */
export function deactivateWeb(): void {
  state.active = false
  layout()
}

export function closeWeb(): void {
  const view = state.view
  if (view) {
    if (state.attachedTo && !state.attachedTo.isDestroyed()) state.attachedTo.contentView.removeChildView(view)
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }
  const server = state.server
  state.view = null
  state.server = null
  state.serverDir = null
  state.hostWindow = null
  state.attachedTo = null
  state.rect = null
  state.visible = false
  state.active = false
  void server?.close().catch(() => undefined)
}

/** Captura de lo que muestra la vista (para pruebas y miniaturas); `null` si no hay vista. */
export async function capturePreview(): Promise<Buffer | null> {
  const view = state.view
  if (!view || view.webContents.isDestroyed()) return null
  return (await view.webContents.capturePage()).toPNG()
}

export function onWebEvent(cb: (event: WebViewEvent) => void): () => void {
  emitter.on('event', cb)
  return () => emitter.off('event', cb)
}
