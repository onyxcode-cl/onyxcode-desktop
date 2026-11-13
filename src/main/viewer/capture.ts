/**
 * Render OCULTO de un Word con el MISMO visor que ve la persona (`docx-preview` en `src/viewer`), para que la IA pueda mirar el aspecto del
 * documento aunque no esté ArtCraft. Mismo patrón y mismas defensas que `documents/pdf-raster.ts`: ventana sin mostrar, con la sesión del
 * visor (sin red, CSP propia), en caja (sandbox, sin nodeIntegration), sin navegación ni ventanas nuevas, destruida siempre y con tope de
 * tiempo. El documento se copia a una carpeta PRIVADA (bajo `userData`, fuera del alcance del agente) y se sirve con un token de la ranura de
 * captura (`tokens.ts`): propio de este render, de vida corta, revocado al terminar; no toca el token del panel de la persona. No cambia el
 * protocolo, la sesión ni la CSP del visor: solo usa `registerViewerPathValidator` y el esquema tal como están.
 */
import { BrowserWindow, nativeImage } from 'electron'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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

export interface SectionInfo {
  width: number
  height: number
  /** Alto de la hoja según el Word (px); 0 = no se sabe (se usa la proporción A4). */
  pageHeight: number
}
export interface Slot {
  section: number
  /** Desde dónde (px, dentro de la sección) y cuánto alto se captura. */
  offset: number
  height: number
}

/** Reparte las secciones en «páginas» de alto de hoja y cuenta cuántas hay EN TOTAL (las que pasan del tope no se capturan, pero se cuentan). */
export function planSlices(sections: SectionInfo[], maxPages: number, firstPage = 1): { slots: Slot[]; total: number } {
  const slots: Slot[] = []
  let total = 0
  sections.forEach((sec, i) => {
    if (!(sec.width > 50 && sec.height > 50)) return
    const page = sec.pageHeight > 200 ? sec.pageHeight : sec.width * 1.4142
    // Una cola de menos de ~24 px (el redondeo de la última hoja) no es una página.
    const count = Math.max(1, Math.ceil((sec.height - 24) / page))
    for (let k = 0; k < count; k++) {
      total++
      if (total >= firstPage && slots.length < maxPages)
        slots.push({ section: i, offset: k * page, height: Math.min(page, sec.height - k * page) })
    }
  })
  return { slots, total }
}

export interface CaptureResult {
  images: Buffer[]
  pages: number
}

/**
 * Captura una región esperando a que Chromium termine de PINTARLA: tras desplazar una hoja pesada, `capturePage` devuelve enseguida una imagen
 * vacía o en blanco (la ventana está oculta y el trama va por detrás). Se espera dos cuadros y se reintenta mientras salga vacía o lisa.
 */
async function captureSettled(wc: Electron.WebContents, region: Electron.Rectangle, tries = 6): Promise<Electron.NativeImage | null> {
  for (let i = 0; i < tries; i++) {
    await wc.executeJavaScript(
      'new Promise((ok) => { const t = setTimeout(ok, 250); requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(t); ok(true) })) })',
      true
    )
    await new Promise((r) => setTimeout(r, 120 + i * 120))
    const shot = await wc.capturePage(region)
    if (shot.isEmpty()) continue
    // Una región grande que comprime a casi nada es una hoja en blanco: todavía sin pintar.
    if (region.height > 300 && shot.toPNG().length < 1200) continue
    return shot
  }
  return null
}

interface CaptureCtx {
  win: BrowserWindow
  wc: Electron.WebContents
}

/** Espera a que el visor marque `data-capture-ready` (cuántas hojas/diapositivas pintó) o falle. */
async function waitReady(wc: Electron.WebContents): Promise<number> {
  const ready = (await wc.executeJavaScript(
    `new Promise((ok) => { const t = Date.now(); const f = () => { const v = document.documentElement.dataset.captureReady; v !== undefined ? ok(v) : Date.now() - t > ${READY_MS} ? ok('error') : setTimeout(f, 50) }; f() })`,
    true
  )) as string
  const n = Number(ready)
  return Number.isFinite(n) && n >= 1 ? n : 0
}

const toPng = (shot: Electron.NativeImage): Buffer =>
  (shot.getSize().width > OUT_WIDTH
    ? shot.resize({ width: OUT_WIDTH, quality: 'good' })
    : nativeImage.createFromBuffer(shot.toPNG())
  ).toPNG()

/**
 * Ventana OCULTA con el visor de la app en modo captura para un archivo ya validado: copia privada, token de la ranura de captura, ventana en
 * caja sin navegación, tope de tiempo y limpieza SIEMPRE (token revocado, ventana destruida, copia borrada).
 */
async function withCaptureWindow(
  kind: 'docx' | 'pptx',
  bytes: Buffer,
  timeoutMs: number,
  size: { width: number; height: number },
  body: (ctx: CaptureCtx) => Promise<CaptureResult | null>
): Promise<CaptureResult | null> {
  installViewerScheme()
  const base = await privateTmp()
  privateRoot = base
  registerValidatorOnce()
  const dir = await mkdtemp(join(base, CAPTURE_DIR_PREFIX))
  let token = ''
  let win: BrowserWindow | null = null
  let timer: NodeJS.Timeout | undefined
  try {
    const file = join(dir, `doc.${kind}`)
    await writeFile(file, bytes, { mode: 0o600 })
    token = issueCaptureToken({ path: realpathSync(file), kind })
    win = new BrowserWindow({
      show: false,
      ...size,
      // `frame: false` es NECESARIO: con marco, macOS recorta la ventana al alto de la pantalla y una hoja A4 sale cortada.
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
      await w.loadURL(`${VIEWER_SCHEME}://viewer/index.html#t=${token}&kind=${kind}&lang=es&theme=light&capture=1`)
      return body({ win: w, wc })
    })()
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), Math.min(TIMEOUT_MS, Math.max(1, timeoutMs)))
    })
    // Si vence el tiempo, la ventana se destruye en el `finally` y el trabajo en curso falla en silencio (no es una promesa suelta sin captura).
    work.catch(() => undefined)
    return await Promise.race([work, timeout])
  } finally {
    if (timer) clearTimeout(timer)
    if (token) revokeCaptureToken(token)
    if (win && !win.isDestroyed()) win.destroy()
    await rm(dir, { recursive: true, force: true })
  }
}

/** PNG de cada página (hasta `maxPages`) de un .docx ya validado. `null` si el visor no lo pudo pintar. */
export async function captureDocxPages(
  bytes: Buffer,
  maxPages = CAPTURE_MAX_PAGES,
  timeoutMs = TIMEOUT_MS,
  firstPage = 1
): Promise<CaptureResult | null> {
  return withCaptureWindow('docx', bytes, timeoutMs, { width: 1000, height: 1300 }, async ({ win: w, wc }) => {
    if ((await waitReady(wc)) < 1) return null
    // `docx-preview` solo corta hojas en los saltos de página EXPLÍCITOS: un Word de varias páginas llega como una sola sección alta.
    // Se trocea cada sección en «páginas» del alto de la hoja (el `min-height` que fija el propio Word) para que la IA vea todo.
    const sections = (await wc.executeJavaScript(
      `(() => Array.from(document.querySelectorAll('section.docx')).map((s) => { const r = s.getBoundingClientRect(); const mh = s.style.minHeight || ''; const v = parseFloat(mh) || 0; return { width: r.width, height: r.height, pageHeight: v ? (/pt$/.test(mh) ? (v * 96) / 72 : v) : 0 } }))()`,
      true
    )) as SectionInfo[]
    const { slots, total } = planSlices(sections, Math.max(1, Math.min(CAPTURE_MAX_PAGES, Math.floor(maxPages))), firstPage)
    if (slots.length === 0) return null
    const maxH = Math.max(...slots.map((x) => x.height))
    const maxW = Math.max(...sections.map((x) => x.width))
    w.setContentSize(Math.min(3000, Math.ceil(maxW) + 80), Math.min(4000, Math.ceil(maxH) + 160))
    await new Promise((r) => setTimeout(r, 150))
    const images: Buffer[] = []
    for (const slot of slots) {
      const pos = (await wc.executeJavaScript(
        `(() => { const s = document.querySelectorAll('section.docx')[${slot.section}]; const sc = document.querySelector('.docx-scroll'); const cr = sc.getBoundingClientRect(); const r = s.getBoundingClientRect(); sc.scrollTop += r.top + ${slot.offset} - cr.top; const r2 = s.getBoundingClientRect(); return { x: r2.left, y: r2.top + ${slot.offset}, width: r2.width } })()`,
        true
      )) as { x: number; y: number; width: number }
      const [cw, ch] = w.getContentSize()
      if (pos.y < 0 || pos.y + slot.height > ch || pos.x < 0 || pos.x + pos.width > cw) break
      const shot = await captureSettled(wc, {
        x: Math.round(pos.x),
        y: Math.round(pos.y),
        width: Math.round(pos.width),
        height: Math.round(slot.height)
      })
      if (!shot) break
      images.push(toPng(shot))
    }
    return images.length ? { images, pages: total } : null
  })
}

/**
 * PNG de cada diapositiva (hasta `maxPages`) de un .pptx ya validado, con la VISTA SIMPLIFICADA del visor de la app (no es un render fiel de
 * PowerPoint: sirve para ver textos, orden y cosas fuera de su sitio). Avanza con las flechas del propio visor.
 */
export async function captureDeckSlides(
  bytes: Buffer,
  maxPages = CAPTURE_MAX_PAGES,
  timeoutMs = TIMEOUT_MS
): Promise<CaptureResult | null> {
  return withCaptureWindow('pptx', bytes, timeoutMs, { width: 1200, height: 900 }, async ({ wc }) => {
    const total = await waitReady(wc)
    if (total < 1) return null
    const n = Math.min(total, Math.max(1, Math.floor(maxPages)))
    const images: Buffer[] = []
    for (let i = 0; i < n; i++) {
      const rect = (await wc.executeJavaScript(
        `(() => { const c = document.querySelector('.pptx-canvas-wrap'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height } })()`,
        true
      )) as { x: number; y: number; width: number; height: number } | null
      if (rect && rect.width > 100 && rect.height > 50) {
        const shot = await captureSettled(wc, {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        })
        if (shot) images.push(toPng(shot))
      }
      // Siguiente diapositiva con la tecla del propio visor; se espera a que el contador cambie.
      if (i < n - 1) {
        await wc.executeJavaScript(
          `new Promise((ok) => { const before = document.querySelector('.pptx-counter')?.textContent; window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); const t = Date.now(); const f = () => document.querySelector('.pptx-counter')?.textContent !== before || Date.now() - t > 2000 ? ok(true) : setTimeout(f, 30); f() })`,
          true
        )
      }
    }
    return images.length ? { images, pages: total } : null
  })
}
