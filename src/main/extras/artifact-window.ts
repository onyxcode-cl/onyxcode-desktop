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
import { basePdfOptions, htmlFontSizesPt, pdfPageCount, pdfPrintOptions, printWithoutOrphanPage } from './pdf-options'
import { t } from '@shared/i18n'
import { app, BrowserWindow, clipboard, dialog, Menu, net, session, type Session } from 'electron'
import { writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { APP_SLUG } from '@shared/brand'
import type { ArtifactPayload } from '@shared/ipc-extras'
import {
  hasHtmlSlides,
  SlidesHtmlError,
  MAX_ARTIFACT_HTML_BYTES,
  SLIDE_CSS_WIDTH,
  SLIDE_CSS_HEIGHT,
  VALIDATE_SLIDES_SCRIPT,
  WAIT_SLIDES_ASSETS_SCRIPT,
  SLIDES_PRINT_STYLE
} from '@shared/slides-html'
import { assertSlidePng, MAX_SLIDES_PPTX_BYTES } from './slides-deck-pptx'
import { extrasWindows } from './windows'
import { inlineRemoteImages } from './remote-images'
import { presentWindow } from '../e2e-headless'

const PARTITION = 'artifact'
const SCHEME = `${APP_SLUG}-artifact`
const MAX_HTML_BYTES = MAX_ARTIFACT_HTML_BYTES

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

const artifacts = new Map<string, ArtifactPayload & { noRemoteImages?: boolean }>()
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
    if (!ready && artifact.noRemoteImages) {
      // Documentos pedidos por un agente aislado (herramienta `documentos`): la APP no descarga nada en su nombre.
      ready = Promise.resolve(artifact.html)
      inlined.set(id, ready)
    }
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
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) throw new Error('El HTML de la vista previa supera 24 MiB.')
  const title = (payload.title ?? '').trim() || 'Vista previa'
  const id = randomUUID()
  artifacts.set(id, { title, html, noRemoteImages: hasHtmlSlides(html) })

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

/** Electron no conserva el mensaje de un throw de executeJavaScript: lo transportamos como datos. */
async function artifactScript<T>(wc: Electron.WebContents, script: string): Promise<T> {
  const result = (await wc.executeJavaScript(
    `(async () => { try { return { ok: true, value: await (${script}) }; } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; } })()`,
    true
  )) as { ok: true; value: T } | { ok: false; error: string }
  if (!result.ok) throw new SlidesHtmlError(result.error)
  return result.value
}

/** Tiempo máximo para cargar y maquetar el HTML antes de abandonar la conversión a PDF. */
const PDF_TIMEOUT_MS = 30_000

/**
 * Renderiza `html` a PDF con una ventana OCULTA que usa la MISMA sesión que los artifacts:
 * partición propia en memoria, esquema propio con CSP estricta (+ <meta>), sin red (webRequest
 * cancela http(s)/ws/file/ftp), permisos denegados y navegación bloqueada. Nada remoto se carga:
 * un `<img src="http://…">` queda roto en el PDF. Devuelve los bytes del PDF (A4, con fondos).
 */
/** Letra más chica declarada en el HTML (pt), o `null` si no declara ninguna. */
function smallestFontPt(html: string): number | null {
  const sizes = htmlFontSizesPt(html)
  return sizes.length ? Math.min(...sizes) : null
}

export async function renderHtmlToPdf(html: string, title = 'Documento', opts: { remoteImages?: boolean } = {}): Promise<Buffer> {
  const source = String(html ?? '')
  if (Buffer.byteLength(source, 'utf8') > MAX_HTML_BYTES) throw new Error('El HTML supera 24 MiB.')
  const id = randomUUID()
  artifacts.set(id, { title, html: source, ...(opts.remoteImages === false || hasHtmlSlides(source) ? { noRemoteImages: true } : {}) })

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
    if (hasHtmlSlides(source)) {
      wc.debugger.attach('1.3')
      await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { media: 'print' })
    }
    void win.loadURL(`${SCHEME}://${id}`).catch(() => undefined) // el fallo se informa por did-fail-load
    await Promise.race([loaded, timeout])
    let slideCount: number | undefined
    if (hasHtmlSlides(source)) {
      slideCount = await Promise.race([artifactScript<number>(wc, VALIDATE_SLIDES_SCRIPT), timeout])
      await wc.executeJavaScript(
        `(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(SLIDES_PRINT_STYLE)}; document.head.appendChild(s); document.querySelectorAll('.slide').item(${slideCount} - 1).setAttribute('data-lzx-last-slide', ''); })()`,
        true
      )
    }
    if (hasHtmlSlides(source)) {
      await Promise.race([artifactScript<boolean>(wc, WAIT_SLIDES_ASSETS_SCRIPT), timeout])
    } else {
      // Compatibilidad del PDF de documentos ordinarios (fuera del contrato de presentaciones).
      await Promise.race([
        wc.executeJavaScript('document.fonts ? document.fonts.ready.then(() => true) : true', true).catch(() => true),
        new Promise((resolve) => setTimeout(resolve, 3000))
      ])
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    // PDF etiquetado y con marcadores (experimental en Electron): si esa impresión falla, se reintenta sin ellos para no perder el PDF.
    const print = async (scale: number): Promise<Buffer> => {
      try {
        return await wc.printToPDF({ ...pdfPrintOptions(), ...(scale === 1 ? {} : { scale }) })
      } catch (e) {
        console.warn('[pdf] impresión con PDF etiquetado falló; se reintenta sin él:', e instanceof Error ? e.message : e)
        return await wc.printToPDF({ ...basePdfOptions, ...(scale === 1 ? {} : { scale }) })
      }
    }
    // Última página casi vacía: si una escala suave baja el número de páginas, se usa (ver `printWithoutOrphanPage`).
    const pdf = await Promise.race([hasHtmlSlides(source) ? print(1) : printWithoutOrphanPage(print, smallestFontPt(source)), timeout])
    if (slideCount !== undefined && pdfPageCount(pdf) !== slideCount)
      throw new SlidesHtmlError(
        `La presentación debe imprimir ${slideCount} láminas, pero produjo ${pdfPageCount(pdf)} páginas. Revise los saltos y el contenido fuera de .slide.`
      )
    return pdf
  } finally {
    if (timer) clearTimeout(timer)
    if (hasHtmlSlides(source) && !wc.isDestroyed() && wc.debugger.isAttached()) wc.debugger.detach()
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

/**
 * Captura secuencial: el consumidor escribe cada lámina antes de pedir la siguiente.
 * CDP fija la densidad ANTES de cargar: 960×540 CSS, DPR 4, independiente del monitor.
 * Nunca usa setZoomFactor ni agranda una captura pequeña.
 */
export async function captureSlidesAsPngs(
  html: string,
  title: string,
  onSlide: (png: Buffer, index: number) => Promise<void>
): Promise<number> {
  const source = String(html ?? '')
  if (Buffer.byteLength(source, 'utf8') > MAX_HTML_BYTES) throw new Error('El HTML supera 24 MiB.')
  const id = randomUUID()
  artifacts.set(id, { title, html: source, noRemoteImages: true })
  const win = new BrowserWindow({
    width: SLIDE_CSS_WIDTH,
    height: SLIDE_CSS_HEIGHT,
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
      devTools: false,
      backgroundThrottling: false
    }
  })
  extrasWindows.add(win)
  const wc = win.webContents
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  wc.on('will-navigate', (event) => event.preventDefault())
  wc.on('will-redirect', (event) => event.preventDefault())
  wc.on('will-attach-webview', (event) => event.preventDefault())
  win.setOpacity(0)
  win.setIgnoreMouseEvents(true)
  win.showInactive()
  let timer: NodeJS.Timeout | undefined
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('La exportación PowerPoint 4K superó el tiempo máximo de 30 segundos.')), PDF_TIMEOUT_MS)
    })
    const run = async (): Promise<number> => {
      wc.debugger.attach('1.3')
      await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
        width: SLIDE_CSS_WIDTH,
        height: SLIDE_CSS_HEIGHT,
        deviceScaleFactor: 4,
        mobile: false,
        screenWidth: SLIDE_CSS_WIDTH,
        screenHeight: SLIDE_CSS_HEIGHT
      })
      await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { media: 'print' })
      await win.loadURL(`${SCHEME}://${id}`)
      const count = (await artifactScript<number>(wc, VALIDATE_SLIDES_SCRIPT)) as number
      await artifactScript<boolean>(wc, WAIT_SLIDES_ASSETS_SCRIPT)
      await wc.executeJavaScript(
        `document.querySelectorAll('.slide').forEach(el => { el.dataset.lzxExportDisplay = getComputedStyle(el).display; })`,
        true
      )
      let bytes = 0
      for (let i = 0; i < count; i++) {
        // Oculta hermanos y controles fuera de las láminas, sin cambiar el layout interno.
        await wc.executeJavaScript(
          `(() => {
          const slides = [...document.querySelectorAll('.slide')];
          if (slides.length !== ${count}) throw new Error('Cambió el número de láminas durante la exportación.');
          document.documentElement.style.cssText += ';margin:0!important;padding:0!important;overflow:hidden!important';
          document.body.style.cssText += ';margin:0!important;padding:0!important;display:block!important;overflow:hidden!important';
          for (const el of document.body.querySelectorAll('*')) {
            if (!el.closest('.slide') && !el.querySelector('.slide')) el.style.setProperty('visibility','hidden','important');
          }
          slides.forEach((slide, index) => {
            if (index !== ${i}) slide.style.setProperty('display', 'none', 'important');
            else {
              slide.style.setProperty('display', slide.dataset.lzxExportDisplay || 'block', 'important');
              slide.style.setProperty('position','fixed','important');
              slide.style.setProperty('left','0','important'); slide.style.setProperty('top','0','important');
              slide.style.setProperty('margin','0','important'); slide.style.setProperty('transform','none','important');
              slide.style.setProperty('zoom','1','important');
            }
          });
        })()`,
          true
        )
        await artifactScript<boolean>(wc, WAIT_SLIDES_ASSETS_SCRIPT)
        await artifactScript<boolean>(
          wc,
          `(async () => {
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const bounds = document.querySelectorAll('.slide')[${i}].getBoundingClientRect();
          if (bounds.x !== 0 || bounds.y !== 0 || bounds.width !== 960 || bounds.height !== 540) throw new Error('La lámina ${i + 1} no ocupa el lienzo 960×540; revise transformaciones y contenedores.');
          return true;
        })()`
        )
        const capture = (await wc.debugger.sendCommand('Page.captureScreenshot', {
          format: 'png',
          fromSurface: true,
          captureBeyondViewport: false,
          clip: { x: 0, y: 0, width: SLIDE_CSS_WIDTH, height: SLIDE_CSS_HEIGHT, scale: 1 }
        })) as { data: string }
        const png = Buffer.from(capture.data, 'base64')
        assertSlidePng(png, i)
        bytes += png.length
        if (bytes > MAX_SLIDES_PPTX_BYTES)
          throw new Error('El PowerPoint 4K supera 256 MiB. Divida la presentación en partes; no se bajó la resolución.')
        await onSlide(png, i)
      }
      return count
    }
    return await Promise.race([run(), timeout])
  } finally {
    if (timer) clearTimeout(timer)
    if (!wc.isDestroyed() && wc.debugger.isAttached()) wc.debugger.detach()
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
export async function presentSlides(payload: ArtifactPayload): Promise<BrowserWindow> {
  const html = String(payload.html ?? '')
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) throw new Error('El HTML supera 24 MiB.')
  const title = (payload.title ?? '').trim() || 'Presentación'
  const id = randomUUID()
  artifacts.set(id, { title, html, noRemoteImages: hasHtmlSlides(html) })

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
  let timer: NodeJS.Timeout | undefined
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('La presentación superó el tiempo máximo de carga.')), PDF_TIMEOUT_MS)
    })
    const load = async (): Promise<void> => {
      wc.debugger.attach('1.3')
      await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { media: 'print' })
      await win.loadURL(`${SCHEME}://${id}`)
      await artifactScript<number>(wc, VALIDATE_SLIDES_SCRIPT)
      await artifactScript<boolean>(wc, WAIT_SLIDES_ASSETS_SCRIPT)
      await wc.executeJavaScript(fitScript, true)
      win.show()
      win.setFullScreen(true)
    }
    await Promise.race([load(), timeout])
    return win
  } catch (error) {
    if (!win.isDestroyed()) win.destroy()
    throw error
  } finally {
    if (timer) clearTimeout(timer)
  }
}
