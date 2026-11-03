/**
 * Render OCULTO de un Word con el MISMO visor que ve la persona (`docx-preview` en `src/viewer`), para que la IA pueda mirar el aspecto del
 * documento aunque no esté ArtCraft. Mismo patrón y mismas defensas que `documents/pdf-raster.ts`: ventana sin mostrar, con la sesión del
 * visor (sin red, CSP propia), en caja (sandbox, sin nodeIntegration), sin navegación ni ventanas nuevas, destruida siempre y con tope de
 * tiempo. El documento se copia a una carpeta PRIVADA (bajo `userData`, fuera del alcance del agente) y se sirve con un token de la ranura de
 * captura (`tokens.ts`): propio de este render, de vida corta, revocado al terminar; no toca el token del panel de la persona. No cambia el
 * protocolo, la sesión ni la CSP del visor: solo usa `registerViewerPathValidator` y el esquema tal como están.
 */
import { BrowserWindow, nativeImage } from 'electron'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { join, sep } from 'node:path'
import { VIEWER_SCHEME } from '../security/app-protocol'
import { privateTmp } from '../office/craft/private-tmp'
import { installViewerScheme, registerViewerPathValidator } from './scheme'
import { viewerSession } from './session'
import { issueCaptureToken, revokeCaptureToken } from './tokens'

export const CAPTURE_MAX_PAGES = 12
const TIMEOUT_MS = 60_000
const READY_MS = 20_000
const OUT_WIDTH = 640
const CAPTURE_DIR_PREFIX = 'lazunox-capture-'

let validatorRegistered = false
let privateRoot = ''

/** Solo se sirven desde el visor los archivos de ESTAS carpetas de captura (la copia privada del render en curso). */
function registerValidatorOnce(): void {
  if (validatorRegistered) return
  validatorRegistered = true
  registerViewerPathValidator((p) => {
    const real = realpathSync(p)
    const root = privateRoot ? realpathSync(privateRoot) : ''
    if (!root || !real.startsWith(root + sep) || !real.slice(root.length + 1).startsWith(CAPTURE_DIR_PREFIX))
      throw new Error('fuera de las capturas')
    return real
  })
}

export interface CaptureResult {
  images: Buffer[]
  pages: number
}

/** PNG de cada página (hasta `maxPages`) de un .docx ya validado. `null` si el visor no lo pudo pintar. */
export async function captureDocxPages(bytes: Buffer, maxPages = CAPTURE_MAX_PAGES): Promise<CaptureResult | null> {
  installViewerScheme()
  const base = await privateTmp()
  privateRoot = base
  registerValidatorOnce()
  const dir = await mkdtemp(join(base, CAPTURE_DIR_PREFIX))
  let token = ''
  let win: BrowserWindow | null = null
  let timer: NodeJS.Timeout | undefined
  try {
    const file = join(dir, 'doc.docx')
    await writeFile(file, bytes, { mode: 0o600 })
    token = issueCaptureToken({ path: await realpath(file), kind: 'docx' })
    win = new BrowserWindow({
      show: false,
      width: 1000,
      height: 1300,
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
        devTools: false,
        backgroundThrottling: false
      }
    })
    const wc = win.webContents
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    wc.on('will-navigate', (e) => e.preventDefault())
    wc.on('will-attach-webview', (e) => e.preventDefault())
    const w = win
    const work = (async (): Promise<CaptureResult | null> => {
      await w.loadURL(`${VIEWER_SCHEME}://viewer/index.html#t=${token}&kind=docx&lang=es&theme=light&capture=1`)
      const ready = (await wc.executeJavaScript(
        `new Promise((ok) => { const t = Date.now(); const f = () => { const v = document.documentElement.dataset.captureReady; v !== undefined ? ok(v) : Date.now() - t > ${READY_MS} ? ok('error') : setTimeout(f, 50) }; f() })`,
        true
      )) as string
      const total = Number(ready)
      if (!Number.isFinite(total) || total < 1) return null
      const n = Math.min(total, Math.max(1, Math.floor(maxPages)))
      const images: Buffer[] = []
      for (let i = 0; i < n; i++) {
        const rect = (await wc.executeJavaScript(
          `(() => { const s = document.querySelectorAll('section.docx')[${i}]; s.scrollIntoView({ block: 'start' }); const r = s.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`,
          true
        )) as { x: number; y: number; width: number; height: number }
        if (!(rect.width > 50 && rect.height > 50)) continue
        const need = { w: Math.ceil(rect.x + rect.width) + 24, h: Math.ceil(rect.y + rect.height) + 24 }
        const [cw, ch] = w.getContentSize()
        if (need.w > cw || need.h > ch) {
          w.setContentSize(Math.max(cw, Math.min(need.w, 3000)), Math.max(ch, Math.min(need.h, 4000)))
          await new Promise((r) => setTimeout(r, 120))
        }
        await new Promise((r) => setTimeout(r, 60))
        const shot = await wc.capturePage({
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        })
        if (shot.isEmpty()) continue
        const size = shot.getSize()
        images.push(
          (size.width > OUT_WIDTH ? shot.resize({ width: OUT_WIDTH, quality: 'good' }) : nativeImage.createFromBuffer(shot.toPNG())).toPNG()
        )
      }
      return images.length ? { images, pages: total } : null
    })()
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)
    })
    return await Promise.race([work, timeout])
  } finally {
    if (timer) clearTimeout(timer)
    if (token) revokeCaptureToken(token)
    if (win && !win.isDestroyed()) win.destroy()
    await rm(dir, { recursive: true, force: true })
  }
}
