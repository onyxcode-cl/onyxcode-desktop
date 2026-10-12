/**
 * Ventana de artifacts: renderiza HTML generado por el modelo en un BrowserWindow aislado.
 *
 * Capas de aislamiento:
 * - Sesión propia en memoria (`partition: 'artifact'`, sin `persist:`): no comparte cookies,
 *   storage ni caché con la app.
 * - Sin preload, `sandbox`, `contextIsolation`, sin `nodeIntegration`.
 * - Se sirve desde un esquema propio con cabecera CSP estricta (y además un <meta> CSP
 *   inyectado): sólo scripts/estilos inline, imágenes/fuentes data:/blob:, sin red. Las imágenes de internet de bancos permitidos las
 *   descarga la APP y las incrusta como data: antes de servir el HTML (`remote-images.ts`); la ventana sigue sin red.
 * - webRequest cancela cualquier petición http(s)/ws/file desde esa sesión; permisos denegados;
 *   navegación y ventanas nuevas bloqueadas.
 */
import { t } from '@shared/i18n'
import { app, BrowserWindow, clipboard, dialog, Menu, net, session, type Session } from 'electron'
import { writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { APP_SLUG } from '@shared/brand'
import type { ArtifactPayload } from '@shared/ipc-extras'
import { MAX_SLIDES } from '@shared/chat-doc-spec'
import { extrasWindows } from './windows'
import { inlineRemoteImages } from './remote-images'
import { presentWindow } from '../e2e-headless'

const PARTITION = 'artifact'
const SCHEME = `${APP_SLUG}-artifact`
const MAX_HTML_BYTES = 5 * 1024 * 1024

/** Nombre de archivo sugerido a partir de un título: sin separadores de ruta ni caracteres de control. */
export function safeDocumentName(name: string, fallback: string): string {
  const clean = name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim()
  return clean || fallback
}

export const ARTIFACT_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'"
].join('; ')

const artifacts = new Map<string, ArtifactPayload>()
/** HTML con las imágenes de internet ya incrustadas, por documento. */
const inlined = new Map<string, Promise<string>>()
let configuredSession: Session | null = null

function artifactSession(): Session {
  if (configuredSession) return configuredSession
  const ses = session.fromPartition(PARTITION, { cache: false })

  ses.protocol.handle(SCHEME, async (request) => {
    const id = request.url.slice(`${SCHEME}://`.length).replace(/[/?#].*$/, '')
    const artifact = artifacts.get(id)
    if (!artifact) return new Response('Vista previa no encontrada', { status: 404 })
    // La ventana no tiene red: las imágenes de internet (bancos de imágenes permitidos) las descarga la APP y se incrustan como data:
    // (ventana, modo presentación, PDF y PowerPoint pasan todos por aquí). Una sola vez por documento.
    let ready = inlined.get(id)
    if (!ready) {
      ready = inlineRemoteImages(artifact.html, { fetchImpl: (u, i) => net.fetch(u, i) })
        .then((r) => {
          if (r.inlined > 0 || r.blocked.length > 0)
            console.info(`[artifact] imágenes de internet: ${r.inlined} incrustadas, ${r.blocked.length} bloqueadas`)
          return r.html
        })
        .catch(() => artifact.html)
      inlined.set(id, ready)
    }
    return new Response(withCspMeta(await ready, artifact.title), {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': ARTIFACT_CSP,
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store'
      }
    })
  })

  ses.webRequest.onBeforeRequest((details, callback) => {
    const blocked = /^(https?|wss?|file|ftp):/i.test(details.url)
    callback({ cancel: blocked })
  })
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  ses.on('will-download', (event) => event.preventDefault())

  configuredSession = ses
  return ses
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)
}

/** Antepone el <meta> CSP (el parser lo sube al <head> como primer elemento). */
function withCspMeta(html: string, title: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`
  const hasDoc = /<html[\s>]/i.test(html) || /<!doctype/i.test(html)
  if (hasDoc) {
    const doctype = html.match(/^\s*<!doctype[^>]*>/i)?.[0] ?? ''
    return `${doctype || '<!doctype html>'}${meta}${html.slice(doctype.length)}`
  }
  // Fragmento: envolverlo en un documento mínimo.
  return `<!doctype html><html lang="es"><head>${meta}<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head><body>${html}</body></html>`
}

export function openArtifact(payload: ArtifactPayload): BrowserWindow {
  const html = String(payload.html ?? '')
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) throw new Error('El HTML de la vista previa supera 5 MB.')
  const title = (payload.title ?? '').trim() || 'Vista previa'
  const id = randomUUID()
  artifacts.set(id, { title, html })

  const win = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 360,
    minHeight: 240,
    title,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      session: artifactSession(),
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
  extrasWindows.add(win)
  const wc = win.webContents

  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  wc.on('will-navigate', (event, url) => {
    if (url !== wc.getURL()) event.preventDefault()
  })
  wc.on('will-redirect', (event) => event.preventDefault())
  wc.on('will-attach-webview', (event) => event.preventDefault())
  // Mantener el título elegido aunque el HTML tenga su propio <title>.
  win.on('page-title-updated', (event) => event.preventDefault())
  win.once('ready-to-show', () => presentWindow(win))
  win.on('closed', () => {
    artifacts.delete(id)
    inlined.delete(id)
  })

  wc.on('context-menu', () => {
    const artifact = artifacts.get(id)
    Menu.buildFromTemplate([
      { label: t('merr.menu.reload'), click: () => wc.reload() },
      { type: 'separator' },
      { label: t('merr.menu.copyHtml'), click: () => artifact && clipboard.writeText(artifact.html) },
      {
        label: t('merr.menu.saveHtml'),
        click: () => {
          if (!artifact) return
          void (async () => {
            const safe = safeDocumentName(title, 'vista-previa')
            const res = await dialog.showSaveDialog(win, {
              title: t('merr.dialog.savePreview'),
              defaultPath: `${safe}.html`,
              filters: [{ name: 'HTML', extensions: ['html', 'htm'] }]
            })
            if (!res.canceled && res.filePath) await writeFile(res.filePath, artifact.html, 'utf8')
          })().catch((err: unknown) => dialog.showErrorBox(t('merr.dialog.saveFailed'), String(err)))
        }
      },
      ...(app.isPackaged
        ? []
        : [{ type: 'separator' as const }, { label: t('merr.menu.inspect'), click: () => wc.openDevTools({ mode: 'detach' }) }])
    ]).popup({ window: win })
  })

  void win.loadURL(`${SCHEME}://${id}`)
  return win
}

/** Tiempo máximo para cargar y maquetar el HTML antes de abandonar la conversión a PDF. */
const PDF_TIMEOUT_MS = 30_000

/**
 * Renderiza `html` a PDF con una ventana OCULTA que usa la MISMA sesión que los artifacts:
 * partición propia en memoria, esquema propio con CSP estricta (+ <meta>), sin red (webRequest
 * cancela http(s)/ws/file/ftp), permisos denegados y navegación bloqueada. Nada remoto se carga:
 * un `<img src="http://…">` queda roto en el PDF. Devuelve los bytes del PDF (A4, con fondos).
 */
export async function renderHtmlToPdf(html: string, title = 'Documento'): Promise<Buffer> {
  const source = String(html ?? '')
  if (Buffer.byteLength(source, 'utf8') > MAX_HTML_BYTES) throw new Error('El HTML supera 5 MB.')
  const id = randomUUID()
  artifacts.set(id, { title, html: source })

  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    show: false,
    frame: false,
    skipTaskbar: true,
    focusable: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      session: artifactSession(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
      devTools: false
    }
  })
  extrasWindows.add(win)
  const wc = win.webContents
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  wc.on('will-navigate', (event) => event.preventDefault())
  wc.on('will-redirect', (event) => event.preventDefault())
  wc.on('will-attach-webview', (event) => event.preventDefault())

  let timer: NodeJS.Timeout | undefined
  try {
    const loaded = new Promise<void>((resolve, reject) => {
      wc.once('did-finish-load', () => resolve())
      wc.once('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
        if (isMainFrame) reject(new Error(t('merr.files.htmlLoadFailed', { detail: String(desc || code) })))
      })
      wc.once('render-process-gone', () => reject(new Error(t('merr.files.rendererGone'))))
    })
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(t('merr.files.pdfTimeout'))), PDF_TIMEOUT_MS)
    })
    void win.loadURL(`${SCHEME}://${id}`).catch(() => undefined) // el fallo se informa por did-fail-load
    await Promise.race([loaded, timeout])
    // Deja que terminen de decodificarse las imágenes data: y las fuentes antes de imprimir.
    await Promise.race([
      wc.executeJavaScript('document.fonts ? document.fonts.ready.then(() => true) : true', true).catch(() => true),
      new Promise((resolve) => setTimeout(resolve, 3000))
    ])
    await new Promise((resolve) => setTimeout(resolve, 250))
    return await Promise.race([wc.printToPDF({ printBackground: true, pageSize: 'A4', preferCSSPageSize: true }), timeout])
  } finally {
    if (timer) clearTimeout(timer)
    artifacts.delete(id)
    inlined.delete(id)
    if (!win.isDestroyed()) win.destroy()
  }
}

/**
 * `html` (p.ej. un bloque ```html del chat) → PDF con diálogo "Guardar como": el destino lo elige
 * SIEMPRE el usuario, nunca el agente (mismo patrón que `exportMarkdown`/`saveHtml`, arriba).
 * `null` si el usuario cancela el diálogo.
 */
export async function downloadHtmlAsPdf(payload: ArtifactPayload, win: BrowserWindow | null): Promise<string | null> {
  const pdf = await renderHtmlToPdf(payload.html, payload.title || 'Documento')
  if (!pdf.subarray(0, 4).equals(Buffer.from('%PDF'))) throw new Error(t('merr.files.pdfInvalid'))
  const safe = safeDocumentName(payload.title || 'documento', 'documento')
  const options: Electron.SaveDialogOptions = {
    title: t('merr.dialog.savePdf'),
    defaultPath: join(app.getPath('downloads'), `${safe}.pdf`),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  }
  const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (res.canceled || !res.filePath) return null
  await writeFile(res.filePath, pdf)
  return res.filePath
}

/** Ancho/alto (CSS px) de una diapositiva — el mismo contrato que ya se le pide al agente para
 * `​```slides` (ver chat.md/config.ts): `.slide { width: 960px; height: 540px; ... }`. La ventana nace
 * exactamente a este tamaño, SIN zoom — se probó `setZoomFactor(2)` para capturar más nítido y
 * produjo diapositivas deformadas (bug real, encontrado con el dueño probándolo: el zoom se aplicaba
 * DESPUÉS de que la página ya había maquetado con el tamaño sin zoom, así que el contenido medido en
 * JS — p.ej. un gráfico — quedaba calculado para un tamaño y pintado en otro). Más simple y sin ese
 * riesgo: tamaño 1:1 con el contrato, la nitidez la pone sola la densidad de píxeles de la pantalla
 * (automática, no hace falta pedirla) — mismo criterio que ya usa `renderHtmlToPdf`, que tampoco hace
 * ningún truco de zoom. */
const SLIDE_W = 960
const SLIDE_H = 540

/**
 * `html` de un deck (`​```slides`) → una imagen PNG por diapositiva, en el orden del documento.
 * Misma ventana oculta/sandboxeada/CSP que `renderHtmlToPdf` (se duplica su bloque de creación a
 * propósito, para no arriesgar ese camino que ya funciona). Aísla una diapositiva por vez ocultando
 * el resto (`display:none`) en vez de scrollear: no depende de que la altura de cada `<section>`
 * calce exacto en píxeles (un `padding` sin `box-sizing:border-box` en el HTML del agente rompería el
 * scroll por offset fijo). Si el HTML no sigue el contrato `.slide` (0 encontradas), captura la
 * página entera como una sola "diapositiva" — nunca falla por eso, degrada con gracia (mismo criterio
 * que el resto de las vistas previas, F8-B132).
 */
export async function captureSlidesAsPngs(html: string, title = 'Presentación'): Promise<Buffer[]> {
  const source = String(html ?? '')
  if (Buffer.byteLength(source, 'utf8') > MAX_HTML_BYTES) throw new Error('El HTML supera 5 MB.')
  const id = randomUUID()
  artifacts.set(id, { title, html: source })

  const win = new BrowserWindow({
    width: SLIDE_W,
    height: SLIDE_H,
    show: false,
    frame: false,
    skipTaskbar: true,
    focusable: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      session: artifactSession(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
      devTools: false
    }
  })
  extrasWindows.add(win)
  const wc = win.webContents
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  wc.on('will-navigate', (event) => event.preventDefault())
  wc.on('will-redirect', (event) => event.preventDefault())
  wc.on('will-attach-webview', (event) => event.preventDefault())
  // `capturePage()` (a diferencia de `printToPDF()`) necesita que la ventana esté REALMENTE
  // compositada: con `show:false` sin más, Chromium nunca llega a pintar un frame de verdad (lo
  // salta para ahorrar recursos en ventanas invisibles) y la captura queda esperando para siempre —
  // bug real, encontrado con el dueño probándolo en la app, no en el XML/estructura. Mismo truco que
  // ya usa el modo E2E sin pantalla (`e2e-headless.ts`'s `presentWindow`): opacidad 0 + sin eventos de
  // mouse + `showInactive()` — nunca se ve, pero el compositor SÍ la trata como una ventana real. A
  // propósito NO nace fuera de pantalla (se probó `x`/`y` muy negativos y las capturas salían borrosas
  // — otro bug real: lejos de cualquier pantalla de verdad, Electron no sabe qué densidad de píxeles
  // usar y cae a 1x en vez de la del monitor Retina). `showInactive()` con posición normal + opacidad
  // 0 ya alcanza para que nunca se vea, sin perder la densidad real de la pantalla.
  win.setOpacity(0)
  win.setIgnoreMouseEvents(true)
  win.showInactive()

  let timer: NodeJS.Timeout | undefined
  try {
    const loaded = new Promise<void>((resolve, reject) => {
      wc.once('did-finish-load', () => resolve())
      wc.once('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
        if (isMainFrame) reject(new Error(t('merr.files.htmlLoadFailed', { detail: String(desc || code) })))
      })
      wc.once('render-process-gone', () => reject(new Error(t('merr.files.rendererGone'))))
    })
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(t('merr.files.pdfTimeout'))), PDF_TIMEOUT_MS)
    })
    void win.loadURL(`${SCHEME}://${id}`).catch(() => undefined) // el fallo se informa por did-fail-load
    await Promise.race([loaded, timeout])
    // Deja que terminen de decodificarse las imágenes data: y las fuentes antes de capturar.
    await Promise.race([
      wc.executeJavaScript('document.fonts ? document.fonts.ready.then(() => true) : true', true).catch(() => true),
      new Promise((resolve) => setTimeout(resolve, 3000))
    ])
    await new Promise((resolve) => setTimeout(resolve, 250))

    const slideCount: number = await wc.executeJavaScript('document.querySelectorAll(".slide").length', true).catch(() => 0)
    const count = Math.min(Math.max(slideCount, 1), MAX_SLIDES)

    const images: Buffer[] = []
    for (let i = 0; i < count; i++) {
      if (slideCount > 0) {
        await wc.executeJavaScript(
          `document.querySelectorAll(".slide").forEach((el, idx) => { el.style.display = idx === ${i} ? "" : "none" })`,
          true
        )
      }
      await new Promise((resolve) => setTimeout(resolve, 150))
      const image = await Promise.race([wc.capturePage(), timeout])
      images.push(image.toPNG())
    }
    return images
  } finally {
    if (timer) clearTimeout(timer)
    artifacts.delete(id)
    inlined.delete(id)
    if (!win.isDestroyed()) win.destroy()
  }
}

/**
 * "Presentar" un deck `​```slides` DENTRO de Lazunox, de verdad: una ventana PROPIA (no la principal),
 * sin marco, en pantalla completa del sistema operativo, que muestra UNA diapositiva por vez
 * (nunca una página larga para scrollear) escalada para llenar la pantalla — nada de la app
 * alrededor. Se probó reusar el panel de la ventana principal (poniéndola en pantalla completa) y no
 * servía: el sidebar y los controles del visor de PDF seguían ahí adentro, no hay forma de que una
 * ventana que es "la app entera" se vea alguna vez como una presentación de verdad. Acá no hace falta
 * ocultar nada: es otra ventana, que solo tiene el HTML. Misma sesión/CSP aislada que `openArtifact`.
 * Flecha derecha/espacio/clic avanza, flecha izquierda retrocede — como una presentación de verdad.
 * Escape (o salir de pantalla completa a mano, con los controles del propio sistema) la cierra.
 */
export function presentSlides(payload: ArtifactPayload): BrowserWindow {
  const html = String(payload.html ?? '')
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) throw new Error('El HTML supera 5 MB.')
  const title = (payload.title ?? '').trim() || 'Presentación'
  const id = randomUUID()
  artifacts.set(id, { title, html })

  const win = new BrowserWindow({
    show: false,
    frame: false,
    backgroundColor: '#000000',
    webPreferences: {
      session: artifactSession(),
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
  extrasWindows.add(win)
  const wc = win.webContents
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  wc.on('will-navigate', (event, url) => {
    if (url !== wc.getURL()) event.preventDefault()
  })
  wc.on('will-redirect', (event) => event.preventDefault())
  wc.on('will-attach-webview', (event) => event.preventDefault())
  win.on('page-title-updated', (event) => event.preventDefault())
  win.on('closed', () => {
    artifacts.delete(id)
    inlined.delete(id)
  })
  // Si la persona sale de pantalla completa con los controles propios del sistema (no con Escape),
  // cerrar igual: esta ventana no tiene ningún sentido fuera de pantalla completa (sin marco, sin
  // controles propios).
  win.on('leave-full-screen', () => {
    if (!win.isDestroyed()) win.close()
  })
  wc.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape' && !win.isDestroyed()) win.close()
  })

  // Escala cada diapositiva (`zoom` SOLO en la `.slide`, nunca en `body`) para que llene la pantalla
  // real manteniendo proporción — con barras negras si la pantalla no es exactamente 16:9. `body`
  // queda SIN zoom, a tamaño real de viewport (`100vw`/`100vh`), y centra con flexbox a la
  // diapositiva (zoomeada) adentro — mezclar `zoom` con el `vw`/`vh`/centrado del propio `body` es lo
  // que lo descuadraba antes (el `body` nunca llegaba a medir el ancho completo de la pantalla, así
  // que no había nada que centrar). Recalcula si la pantalla cambia (p.ej. al terminar la animación
  // de pantalla completa, que puede disparar un resize). Muestra UNA diapositiva por vez (oculta el
  // resto con `display:none`, mismo truco que `captureSlidesAsPngs`), con flecha derecha/espacio/clic
  // para avanzar e izquierda para retroceder — como una presentación de verdad, no una página larga
  // para scrollear hacia abajo.
  const fitScript = `(function() {
    var slides = document.querySelectorAll('.slide')
    var i = 0
    document.documentElement.style.cssText = 'margin:0;height:100%;background:#000'
    document.body.style.cssText = 'margin:0;min-height:100vh;width:100vw;display:flex;align-items:center;justify-content:center;background:#000;box-sizing:border-box'
    function show(idx) {
      if (!slides.length) return
      i = Math.max(0, Math.min(idx, slides.length - 1))
      slides.forEach(function (el, n) { el.style.display = n === i ? '' : 'none' })
    }
    function fit() {
      var s = Math.min(window.innerWidth / 960, window.innerHeight / 540)
      slides.forEach(function (el) { el.style.zoom = String(s) })
    }
    fit()
    show(0)
    window.addEventListener('resize', fit)
    document.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { show(i + 1); e.preventDefault() }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { show(i - 1); e.preventDefault() }
    })
    document.addEventListener('click', function () { show(i + 1) })
  })()`
  wc.once('did-finish-load', () => {
    void wc.executeJavaScript(fitScript, true).catch(() => undefined)
    win.show()
    win.setFullScreen(true)
  })

  void win.loadURL(`${SCHEME}://${id}`)
  return win
}
