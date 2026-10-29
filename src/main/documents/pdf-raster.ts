/**
 * PDF → PNG en el proceso principal, para la vista previa de Excel y PDF de la herramienta `documentos`. Usa una ventana OCULTA con la
 * sesión aislada del visor (sin red, permisos denegados) que carga `raster.html` (pdf.js). Sin Python ni programas externos: igual en
 * macOS y en Windows. El PDF viaja en base64 por `executeJavaScript` (tope 20 MB) y vuelven los PNG; la ventana se destruye siempre.
 */
import { BrowserWindow } from 'electron'
import { VIEWER_SCHEME } from '../security/app-protocol'
import { viewerSession } from '../viewer/session'
import { MAX_PREVIEW_PAGES } from './preview'

export const MAX_RASTER_PDF_BYTES = 20 * 1024 * 1024
const MAX_SIDE = 1100
const TIMEOUT_MS = 60_000

export async function rasterizePdf(pdf: Buffer, maxPages = MAX_PREVIEW_PAGES): Promise<{ images: Buffer[]; pages: number } | null> {
  if (pdf.length === 0 || pdf.length > MAX_RASTER_PDF_BYTES) return null
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 700,
    frame: false,
    skipTaskbar: true,
    focusable: false,
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
      devTools: false
    }
  })
  const wc = win.webContents
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  wc.on('will-navigate', (e) => e.preventDefault())
  wc.on('will-attach-webview', (e) => e.preventDefault())
  let timer: NodeJS.Timeout | undefined
  try {
    const work = (async () => {
      await win.loadURL(`${VIEWER_SCHEME}://viewer/raster.html`)
      await wc.executeJavaScript(
        'new Promise((ok, fail) => { const t = Date.now(); const w = () => document.documentElement.dataset.ready ? ok(true) : Date.now() - t > 15000 ? fail(new Error("no listo")) : setTimeout(w, 50); w() })',
        true
      )
      const res = (await wc.executeJavaScript(
        `window.lzxRaster(${JSON.stringify(pdf.toString('base64'))}, ${Math.floor(maxPages)}, ${MAX_SIDE})`,
        true
      )) as { pages: number; images: string[] }
      return { pages: res.pages, images: res.images.filter(Boolean).map((b) => Buffer.from(b, 'base64')) }
    })()
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)
    })
    return await Promise.race([work, timeout])
  } finally {
    if (timer) clearTimeout(timer)
    if (!win.isDestroyed()) win.destroy()
  }
}
