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
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { startWebServer, type WebServer } from './web-server'
import { WEB_OPEN_TIMEOUT_MS, withTimeout } from './web-timeout'
import { recordCraftProblem } from './craft-problems'

export interface WebRect {
  x: number
  y: number
  width: number
  height: number
}
export type WebViewEvent = { type: 'loaded' | 'error' | 'crashed' | 'escape' }

const consoleLines: string[] = []
const BLANK_COLOR_RATIO = 0.985
const DEFAULT_THEME_COLORS = new Set([
  'FFFFFF',
  '000000',
  'E7E6E6',
  '44546A',
  '4472C4',
  'ED7D31',
  'A5A5A5',
  'FFC000',
  '5B9BD5',
  '70AD47',
  '0563C1',
  '954F72'
])

function pptxDetails(bytes: Buffer): { slides: number; charts: number; customPalette: boolean | 'desconocida' } {
  try {
    const eocd = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
    if (eocd < 0) throw new Error('zip sin directorio central')
    const entries = bytes.readUInt16LE(eocd + 10)
    let cursor = bytes.readUInt32LE(eocd + 16)
    const files = new Map<string, Buffer>()
    for (let n = 0; n < entries; n++) {
      if (bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error('entrada zip no válida')
      const method = bytes.readUInt16LE(cursor + 10)
      const compressedSize = bytes.readUInt32LE(cursor + 20)
      const nameLength = bytes.readUInt16LE(cursor + 28)
      const extraLength = bytes.readUInt16LE(cursor + 30)
      const commentLength = bytes.readUInt16LE(cursor + 32)
      const localOffset = bytes.readUInt32LE(cursor + 42)
      const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
      if (/^ppt\/(?:slides\/slide\d+\.xml|charts\/chart\d+\.xml|theme\/theme\d+\.xml)$/.test(name)) {
        const localNameLength = bytes.readUInt16LE(localOffset + 26)
        const localExtraLength = bytes.readUInt16LE(localOffset + 28)
        const dataStart = localOffset + 30 + localNameLength + localExtraLength
        const compressed = bytes.subarray(dataStart, dataStart + compressedSize)
        files.set(name, method === 8 ? inflateRawSync(compressed) : Buffer.from(compressed))
      }
      cursor += 46 + nameLength + extraLength + commentLength
    }
    const colors = [...files.entries()]
      .filter(([name]) => name.includes('/theme/'))
      .flatMap(([, xml]) => [
        ...xml.toString('utf8').matchAll(/<a:(?:srgbClr val="([0-9A-Fa-f]{6})"|sysClr[^>]*lastClr="([0-9A-Fa-f]{6})")/g)
      ])
      .map((m) => (m[1] ?? m[2] ?? '').toUpperCase())
    return {
      slides: [...files.keys()].filter((name) => /\/slides\/slide\d+\.xml$/.test(name)).length,
      charts: [...files.keys()].filter((name) => /\/charts\/chart\d+\.xml$/.test(name)).length,
      customPalette: colors.length ? colors.some((color) => !DEFAULT_THEME_COLORS.has(color)) : 'desconocida'
    }
  } catch {
    return { slides: 0, charts: 0, customPalette: 'desconocida' }
  }
}

function saveBlankEvidence(ext: string, fileName: string, bytes: Buffer, screenshot: Buffer, width: number, height: number): void {
  try {
    const root = join(app.getPath('userData'), 'diagnostico', 'visor-en-blanco')
    mkdirSync(root, { recursive: true })
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const base = `captura-${id}`
    writeFileSync(join(root, `${base}.png`), screenshot)
    writeFileSync(join(root, `${base}.${ext}`), bytes)
    writeFileSync(join(root, `${base}.log`), consoleLines.slice(-50).join('\n'))
    const incidents = readdirSync(root)
      .filter((name) => name.endsWith('.png'))
      .map((name) => ({ name, time: statSync(join(root, name)).mtimeMs }))
      .sort((a, b) => b.time - a.time)
    for (const old of incidents.slice(3)) {
      const oldBase = old.name.slice(0, -4)
      rmSync(join(root, old.name), { force: true })
      rmSync(join(root, `${oldBase}.log`), { force: true })
      for (const extName of ['pptx', 'xlsx', 'docx', 'pdf']) rmSync(join(root, `${oldBase}.${extName}`), { force: true })
    }
    const detail = ext === 'pptx' ? pptxDetails(bytes) : null
    recordCraftProblem('vista web', new Error('La captura del panel siguió casi uniforme tras 4 s'), {
      programa: fileName.endsWith('.pptx') ? 'deckcraft' : fileName.endsWith('.xlsx') ? 'gridcraft' : 'wordcraft',
      evidencia: base,
      ancho: width,
      alto: height,
      bytes: bytes.length,
      ...(detail ? { laminas: detail.slides, graficos: detail.charts, paletaPropia: String(detail.customPalette) } : {}),
      consola: consoleLines.slice(-50).join(' | ').slice(-500)
    })
  } catch {
    // La captura diagnóstica es secundaria: no impide cambiar al visor de respaldo.
  }
}

/** Detecta capturas donde casi todos los píxeles comparten el mismo color. */
export function isNearlyBlankBitmap(bitmap: Uint8Array, width: number, height: number): boolean {
  if (width < 8 || height < 8 || bitmap.length < width * height * 4) return false
  const histogram = new Map<number, number>()
  const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / 20_000)))
  let sampled = 0
  let dominant = 0
  for (let y = Math.floor(stride / 2); y < height; y += stride) {
    for (let x = Math.floor(stride / 2); x < width; x += stride) {
      const i = (y * width + x) * 4
      const color = ((bitmap[i]! >> 4) << 8) | ((bitmap[i + 1]! >> 4) << 4) | (bitmap[i + 2]! >> 4)
      const count = (histogram.get(color) ?? 0) + 1
      histogram.set(color, count)
      dominant = Math.max(dominant, count)
      sampled++
    }
  }
  return sampled > 0 && dominant / sampled >= BLANK_COLOR_RATIO
}

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
let openGeneration = 0
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
  wc.on('render-process-gone', () => {
    if (state.view === view) emitter.emit('event', { type: 'crashed' } satisfies WebViewEvent)
  })
  wc.on('did-fail-load', (_e, _c, _d, _u, isMain) => {
    if (isMain && state.view === view) emitter.emit('event', { type: 'error' } satisfies WebViewEvent)
  })
  wc.on('console-message', (_event, _level, message) => {
    if (state.view !== view) return
    consoleLines.push(message.replace(/[\r\n\t]/g, ' ').slice(0, 500))
    if (consoleLines.length > 50) consoleLines.shift()
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
  const rect = state.rect
  const sized = !!view && !!win && !win.isDestroyed() && !!rect && rect.width > 0 && rect.height > 0
  // El panel comunica su medida y adjunta la vista durante la carga para que wasm dibuje.
  // También conservamos el tamaño si un overlay obliga a ocultarla temporalmente.
  if (sized) {
    const zoom = win.webContents.getZoomFactor() || 1
    view.setBounds({
      x: Math.round(rect.x * zoom),
      y: Math.round(rect.y * zoom),
      width: Math.round(rect.width * zoom),
      height: Math.round(rect.height * zoom)
    })
  }
  const show = sized && state.visible && state.active
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
    // El lienzo existe antes de que el motor acepte archivos (muestra su pantalla de inicio o un ejemplo): se mantiene la espera
    // mínima de la versión anterior y después se exige el lienzo con tamaño.
    await new Promise((ok) => setTimeout(ok, 700))
    const canvasReady = await new Promise((ok) => {
      let frame = 0
      const finish = (canvas) => { clearTimeout(timer); cancelAnimationFrame(frame); ok(canvas) }
      const timer = setTimeout(() => finish(null), ${Math.min(12_000, Math.max(1, Math.round(waitMs)))})
      const poll = () => {
        const canvas = document.querySelector('canvas')
        if (canvas && canvas.clientWidth > 0 && canvas.clientHeight > 0 && canvas.width > 0 && canvas.height > 0) return finish(canvas)
        frame = requestAnimationFrame(poll)
      }
      poll()
    })
    if (!canvasReady) return false
    const bytes = Uint8Array.from(atob(${JSON.stringify(base64)}), (c) => c.charCodeAt(0))
    const dt = new DataTransfer()
    dt.items.add(new File([bytes], ${JSON.stringify(fileName)}, { type: ${JSON.stringify(mime)} }))
    const o = { dataTransfer: dt, bubbles: true, cancelable: true, clientX: Math.round(innerWidth / 2), clientY: Math.round(innerHeight / 2) }
    for (const t of ['dragenter', 'dragover', 'drop']) canvasReady.dispatchEvent(new DragEvent(t, o))
    return true
  })()`
}

/**
 * Abre `bytes` en la versión web de `webDir`. Devuelve `true` si la captura muestra contenido tras entregar el archivo. Lanza si el
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
  // Cada apertura tiene sus recursos: destruir la anterior también cancela su carga y su script.
  const { hostWindow, rect, visible } = state
  closeWeb()
  Object.assign(state, { hostWindow, rect, visible })
  const generation = openGeneration
  const current = (): boolean => generation === openGeneration
  const server = await startWebServer(webDir)
  if (!current()) {
    await server.close().catch(() => undefined)
    return false
  }
  state.server = server
  state.serverDir = webDir
  const view = ensureView()
  state.active = true
  layout()
  try {
    consoleLines.length = 0
    await withTimeout(view.webContents.loadURL(`${server.origin}/?_r=${Date.now()}`), left(), 'carga')
    if (!current()) return false
    const script = dropScript(bytes.toString('base64'), fileName, MIME_BY_EXT[ext], Math.max(1, left() - 1000))
    const ok = (await withTimeout(view.webContents.executeJavaScript(script, false), left(), 'motor')) === true
    if (!current()) return false
    if (!ok) {
      emitter.emit('event', { type: 'error' } satisfies WebViewEvent)
      return false
    }
    // La entrega del archivo no confirma que DeckCraft/GridCraft/WordCraft lo haya dibujado.
    // Comprobar a 1,5 s y 4 s también cubre la carga diferida de WebAssembly/WebGPU.
    for (const delay of [1500, 2500]) {
      await new Promise((resolve) => setTimeout(resolve, delay))
      if (!current()) return false
      const shot = await withTimeout(view.webContents.capturePage(), 1000, 'captura')
      if (!current()) return false
      const bitmap = shot.toBitmap()
      if (!isNearlyBlankBitmap(bitmap, shot.getSize().width, shot.getSize().height)) {
        emitter.emit('event', { type: 'loaded' } satisfies WebViewEvent)
        return true
      }
      if (delay === 2500) {
        const size = shot.getSize()
        saveBlankEvidence(ext, fileName, bytes, shot.toPNG(), size.width, size.height)
      }
    }
    emitter.emit('event', { type: 'error' } satisfies WebViewEvent)
    return false
  } catch (e) {
    if (!current()) return false
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
  openGeneration++
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
