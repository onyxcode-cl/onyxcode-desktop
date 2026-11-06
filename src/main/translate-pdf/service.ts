/**
 * Traducir un PDF sin cambiar su diseño (F8-B200): la parte de main. Extrae los textos y vuelve a escribirlos sobre el MISMO PDF con
 * `resources/opencode/skills/pdf/scripts/translate_pdf.py` (PyMuPDF, en el Python incluido en la app). La traducción la hace el
 * renderer con el modelo elegido; main no habla con ningún modelo ni con la red.
 *
 * Seguridad: el PDF llega como bytes (nunca una ruta del renderer); se guarda en una carpeta propia por trabajo
 * (`userData/translate-jobs/<id>/`, id aleatorio validado), Python corre sin red conocida ni variables del usuario, con tope de
 * tiempo y de salida, y el resultado solo sale por «Abrir» (archivo de esa carpeta) o «Guardar como…» (diálogo nativo).
 */
import { app, dialog, shell, type BrowserWindow } from 'electron'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  PDF_JOB_ID_RE,
  TRANSLATE_PDF_MAX_BYTES,
  TRANSLATE_PDF_MAX_CHARS,
  TRANSLATE_PAGE_IMAGE_MAX_BYTES,
  TRANSLATE_CLEAN_HTML_MAX,
  cleanName,
  TRANSLATE_PDF_MAX_SEGMENTS,
  translatedName,
  type PdfApplyReport,
  type PdfApplyRequest,
  type PdfApplyResult,
  type PdfCleanRequest,
  type PdfCleanResult,
  type PdfExtractRequest,
  type PdfExtractResult,
  type PdfFailReason,
  type PdfPageClass,
  type PdfPageImageResult,
  type PdfSegment,
  type TranslateKind
} from '@shared/translate-pdf'
import { renderHtmlToPdf } from '../extras/artifact-window'
import { bundledPythonEnv } from '../tasks/python-runtime'
import { unpacked } from '../util/asar'

const JOB_TTL_MS = 24 * 60 * 60 * 1000
const RUN_TIMEOUT_MS = 4 * 60 * 1000
/** PDF `p<página>-<n>`, Word `d<parte>-<n>`, Excel `s<n>` (cadena compartida) o `i|c|g|d<parte>-<n>` (texto en línea, comentario, gráfico, cuadro). */
const SEGMENT_ID_RE = /^(?:[pd]\d{1,5}-\d{1,5}|s\d{1,6}|[icgd]\d{1,4}-\d{1,6})$/
const MAX_TRANSLATION_CHARS = 20_000

export interface RunResult {
  code: number
  stdout: string
  stderr: string
  timedOut: boolean
}

export interface ServiceDeps {
  jobsDir: () => string
  python: () => string | null
  script: (kind: TranslateKind) => string
  run: (python: string, args: string[], cwd: string) => Promise<RunResult>
  now: () => number
  /** Imprime un HTML a PDF (el motor de documentos de la app; sin red). */
  renderHtml: (html: string, title: string) => Promise<Buffer>
}

function defaultScript(kind: TranslateKind = 'pdf'): string {
  const [skill, file] =
    kind === 'docx' ? ['docx', 'translate_docx.py'] : kind === 'xlsx' ? ['xlsx', 'translate_xlsx.py'] : ['pdf', 'translate_pdf.py']
  return unpacked(join(app.getAppPath(), 'resources', 'opencode', 'skills', skill, 'scripts', file))
}

export function runPythonReal(python: string, args: string[], cwd: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const sysRoot = process.env.SystemRoot ?? 'C:\\Windows'
    const env: Record<string, string> =
      process.platform === 'win32'
        ? // Windows: python.exe necesita SystemRoot; TEMP/USERPROFILE dentro de la carpeta del trabajo.
          {
            PATH: `${sysRoot}\\System32;${sysRoot}`,
            SystemRoot: sysRoot,
            USERPROFILE: cwd,
            TEMP: cwd,
            TMP: cwd,
            HOME: cwd,
            ...bundledPythonEnv()
          }
        : {
            PATH: '/usr/bin:/bin',
            HOME: cwd, // PyMuPDF no necesita nada del usuario; que no encuentre su carpeta personal
            LANG: 'en_US.UTF-8',
            ...bundledPythonEnv()
          }
    execFile(python, args, { cwd, env, timeout: RUN_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { code?: number | string; killed?: boolean }) | null
      resolve({
        code: e ? (typeof e.code === 'number' ? e.code : 1) : 0,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
        timedOut: !!e?.killed
      })
    })
  })
}

const realDeps: ServiceDeps = {
  jobsDir: () => join(app.getPath('userData'), 'translate-jobs'),
  python: () => bundledPythonEnv().LAZUNOX_PYTHON ?? null,
  script: defaultScript,
  run: runPythonReal,
  now: () => Date.now(),
  renderHtml: (html, title) => renderHtmlToPdf(html, title, { remoteImages: false })
}

interface JobMeta {
  name: string
  createdAt: number
  kind?: TranslateKind
  outName?: string
  /** Versión limpia (PDF nuevo desde HTML), si se creó. */
  cleanOutName?: string
}

export class PdfTranslateService {
  constructor(private readonly d: ServiceDeps = realDeps) {}

  private jobDir(jobId: string): string | null {
    return PDF_JOB_ID_RE.test(jobId) ? join(this.d.jobsDir(), jobId) : null
  }

  private async meta(dir: string): Promise<JobMeta | null> {
    try {
      return JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as JobMeta
    } catch {
      return null
    }
  }

  /** Borra los trabajos de más de 24 h (y cualquier carpeta con nombre ajeno al formato). */
  async cleanup(): Promise<void> {
    const root = this.d.jobsDir()
    let names: string[]
    try {
      names = await readdir(root)
    } catch {
      return
    }
    for (const n of names) {
      const dir = join(root, n)
      const m = PDF_JOB_ID_RE.test(n) ? await this.meta(dir) : null
      if (!m || this.d.now() - m.createdAt > JOB_TTL_MS) await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async extract(req: PdfExtractRequest): Promise<PdfExtractResult> {
    const python = this.d.python()
    const kind: TranslateKind = req.kind === 'docx' || req.kind === 'xlsx' ? req.kind : 'pdf'
    if (!python || !existsSync(this.d.script(kind))) return { ok: false, reason: 'noPython' }
    const buf = Buffer.from(req.base64, 'base64')
    // %PDF- o, para Word y Excel, un zip («PK\x03\x04»): lo demás ni se guarda.
    const magic =
      kind !== 'pdf' ? buf.subarray(0, 4).toString('latin1') === 'PK\u0003\u0004' : buf.subarray(0, 5).toString('latin1') === '%PDF-'
    if (buf.length === 0 || !magic) return { ok: false, reason: 'unreadable' }
    if (buf.length > TRANSLATE_PDF_MAX_BYTES) return { ok: false, reason: 'tooBig' }
    await this.cleanup()
    const jobId = randomBytes(8).toString('hex')
    const dir = join(this.d.jobsDir(), jobId)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const fail = async (reason: PdfFailReason): Promise<PdfExtractResult> => {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
      return { ok: false, reason }
    }
    await writeFile(join(dir, `input.${kind}`), buf, { mode: 0o600 })
    await writeFile(join(dir, 'meta.json'), JSON.stringify({ name: req.name, createdAt: this.d.now(), kind } satisfies JobMeta), {
      mode: 0o600
    })
    const r = await this.d.run(python, [this.d.script(kind), 'extraer', `input.${kind}`, '-o', 'segmentos.json'], dir)
    if (r.timedOut) return fail('timeout')
    // 2 = sin texto: en un PDF es «parece escaneado»; en un Excel, «el libro no tiene texto».
    if (r.code === 2) return fail(kind === 'xlsx' ? 'noText' : 'scanned')
    if (r.code !== 0)
      return fail(
        /contraseña/i.test(r.stderr) ? 'encrypted' : /no se pudo abrir|mupdf|damaged|dañad/i.test(r.stderr) ? 'unreadable' : 'failed'
      )
    let parsed: { paginas?: number; segmentos?: Partial<PdfSegment>[]; clases?: Record<string, string> }
    try {
      parsed = JSON.parse(await readFile(join(dir, 'segmentos.json'), 'utf8')) as typeof parsed
    } catch {
      return fail('failed')
    }
    // Excel no tiene páginas (el script no escribe `pagina` ni `paginas`): todo va en la «página» 1 y se descartan los campos
    // que solo sirven de pista (`celdas`, `parte`).
    const raw = (parsed.segmentos ?? []) as PdfSegment[]
    const segments = (kind === 'xlsx' ? raw.map((s) => ({ id: s.id, pagina: 1, texto: s.texto })) : raw).filter(
      (s) => SEGMENT_ID_RE.test(s.id) && typeof s.texto === 'string' && Number.isInteger(s.pagina)
    )
    const chars = segments.reduce((n, s) => n + s.texto.length, 0)
    if (segments.length === 0) return fail(kind === 'xlsx' ? 'noText' : 'scanned')
    if (segments.length > TRANSLATE_PDF_MAX_SEGMENTS || chars > TRANSLATE_PDF_MAX_CHARS) return fail('tooLong')
    const pages = Number.isInteger(parsed.paginas) ? (parsed.paginas as number) : Math.max(...segments.map((s) => s.pagina))
    const withText = new Set(segments.map((s) => s.pagina))
    const pagesWithoutText = Array.from({ length: pages }, (_, i) => i + 1).filter((p) => !withText.has(p))
    const pageClasses: Record<number, PdfPageClass> = {}
    for (const [k, v] of Object.entries(parsed.clases ?? {})) {
      const n = Number(k)
      if (Number.isInteger(n) && n >= 1 && n <= pages && (v === 'digital' || v === 'escaneada_ocr' || v === 'escaneada_sin_texto'))
        pageClasses[n] = v
    }
    return { ok: true, jobId, pages, segments, pagesWithoutText, ...(Object.keys(pageClasses).length ? { pageClasses } : {}) }
  }

  /** Dibuja una página como PNG para que el modelo la vea (hojas escaneadas). Solo PDF; nada sale de la carpeta del trabajo. */
  async pageImage(jobId: string, page: number): Promise<PdfPageImageResult> {
    const python = this.d.python()
    const dir = this.jobDir(jobId)
    if (!python || !dir || !Number.isInteger(page) || page < 1) return { ok: false }
    const meta = await this.meta(dir)
    if (!meta || (meta.kind ?? 'pdf') !== 'pdf') return { ok: false }
    const file = `pagina-${page}.png`
    await rm(join(dir, file), { force: true })
    const r = await this.d.run(python, [this.d.script('pdf'), 'imagen', 'input.pdf', '--pagina', String(page), '-o', file], dir)
    if (r.code !== 0 || r.timedOut) return { ok: false }
    try {
      const path = join(dir, file)
      if ((await stat(path)).size > TRANSLATE_PAGE_IMAGE_MAX_BYTES) return { ok: false }
      return { ok: true, mime: 'image/png', base64: (await readFile(path)).toString('base64') }
    } catch {
      return { ok: false }
    }
  }

  async apply(req: PdfApplyRequest): Promise<PdfApplyResult> {
    const python = this.d.python()
    const dir = this.jobDir(req.jobId)
    if (!python || !dir) return { ok: false, reason: 'failed' }
    const meta = await this.meta(dir)
    if (!meta) return { ok: false, reason: 'failed' }
    const clean: Record<string, string> = {}
    for (const [k, v] of Object.entries(req.translations)) {
      if (SEGMENT_ID_RE.test(k) && typeof v === 'string' && v.trim() && v.length <= MAX_TRANSLATION_CHARS) clean[k] = v
    }
    if (Object.keys(clean).length === 0) return { ok: false, reason: 'failed' }
    await writeFile(join(dir, 'traduccion.json'), JSON.stringify(clean), { mode: 0o600 })
    const kind: TranslateKind = meta.kind === 'docx' || meta.kind === 'xlsx' ? meta.kind : 'pdf'
    await rm(join(dir, `salida.${kind}`), { force: true })
    const r = await this.d.run(
      python,
      [this.d.script(kind), 'aplicar', `input.${kind}`, '-t', 'traduccion.json', '-o', `salida.${kind}`, '--informe', 'informe.json'],
      dir
    )
    if (r.timedOut) return { ok: false, reason: 'timeout' }
    // 3 = algún texto no cabe aunque se redujo la letra: el PDF se genera igual y se avisa.
    if (r.code !== 0 && r.code !== 3) return { ok: false, reason: 'failed' }
    try {
      await stat(join(dir, `salida.${kind}`))
      const inf = JSON.parse(await readFile(join(dir, 'informe.json'), 'utf8')) as {
        traducidos?: number
        sin_traduccion?: string[]
        letra_reducida?: unknown[]
        no_cabe?: string[]
        enlaces_quitados?: unknown[] | number
        formato_perdido?: number
        formato_simplificado?: string[]
        posible_recorte?: string[]
      }
      const report: PdfApplyReport = {
        translated: inf.traducidos ?? 0,
        untranslated: inf.sin_traduccion?.length ?? 0,
        shrunk: inf.letra_reducida?.length ?? 0,
        overflow: (inf.no_cabe ?? []).filter((id) => SEGMENT_ID_RE.test(id)),
        // Excel: `formato_simplificado` (ids) y `posible_recorte` (celdas); el de Word/PDF trae `formato_perdido`.
        formatLost: inf.formato_perdido ?? inf.formato_simplificado?.length ?? 0,
        ...(kind === 'xlsx' ? { cutOff: inf.posible_recorte?.length ?? 0 } : {}),
        linksDropped: Array.isArray(inf.enlaces_quitados) ? inf.enlaces_quitados.length : (inf.enlaces_quitados ?? 0)
      }
      const outName = translatedName(meta.name, req.target, kind)
      await copyFile(join(dir, `salida.${kind}`), join(dir, outName))
      await writeFile(join(dir, 'meta.json'), JSON.stringify({ ...meta, outName } satisfies JobMeta), { mode: 0o600 })
      return { ok: true, report, outName }
    } catch {
      return { ok: false, reason: 'failed' }
    }
  }

  /** Versión LIMPIA: imprime a PDF el HTML que armó el renderer (ya saneado allí) y lo guarda junto al trabajo. */
  async clean(req: PdfCleanRequest): Promise<PdfCleanResult> {
    const dir = this.jobDir(req.jobId)
    if (!dir) return { ok: false, reason: 'failed' }
    const meta = await this.meta(dir)
    if (!meta || (meta.kind ?? 'pdf') !== 'pdf') return { ok: false, reason: 'failed' }
    if (typeof req.html !== 'string' || !req.html.trim() || req.html.length > TRANSLATE_CLEAN_HTML_MAX)
      return { ok: false, reason: 'tooLong' }
    try {
      const bytes = await this.d.renderHtml(req.html, meta.name.replace(/\.pdf$/i, ''))
      if (bytes.length < 100 || bytes.subarray(0, 5).toString('latin1') !== '%PDF-') return { ok: false, reason: 'failed' }
      // el nombre lleva el idioma del archivo fiel: «x (es).pdf» → «x (es, limpio).pdf»
      const base = meta.outName ?? cleanName(meta.name, 'en')
      const name = base.replace(/\)\.pdf$/i, ', limpio).pdf')
      await writeFile(join(dir, name), bytes, { mode: 0o600 })
      await writeFile(join(dir, 'meta.json'), JSON.stringify({ ...meta, cleanOutName: name } satisfies JobMeta), { mode: 0o600 })
      return { ok: true, outName: name }
    } catch {
      return { ok: false, reason: 'failed' }
    }
  }

  private async outFile(jobId: string, clean = false): Promise<{ path: string; name: string } | null> {
    const dir = this.jobDir(jobId)
    if (!dir) return null
    const m = await this.meta(dir)
    const name = clean ? m?.cleanOutName : m?.outName
    if (!name) return null
    const path = join(dir, name)
    return existsSync(path) ? { path, name } : null
  }

  /** «Guardar como…»: diálogo nativo y copia del PDF traducido. */
  async save(jobId: string, parent: BrowserWindow | null, clean = false): Promise<{ saved: boolean }> {
    const f = await this.outFile(jobId, clean)
    if (!f) return { saved: false }
    const lower = f.name.toLowerCase()
    const ext = lower.endsWith('.docx') ? 'docx' : lower.endsWith('.xlsx') ? 'xlsx' : 'pdf'
    const options = {
      defaultPath: join(app.getPath('downloads'), f.name),
      filters: [{ name: ext === 'docx' ? 'Word' : ext === 'xlsx' ? 'Excel' : 'PDF', extensions: [ext] }]
    }
    const res = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
    if (res.canceled || !res.filePath) return { saved: false }
    await copyFile(f.path, res.filePath)
    return { saved: true }
  }

  /** Abre el PDF traducido con el visor del sistema (Vista Previa). */
  async open(jobId: string, clean = false): Promise<{ opened: boolean }> {
    const f = await this.outFile(jobId, clean)
    if (!f) return { opened: false }
    return { opened: (await shell.openPath(f.path)) === '' }
  }

  async discard(jobId: string): Promise<void> {
    const dir = this.jobDir(jobId)
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

let instance: PdfTranslateService | null = null
export function pdfTranslateService(): PdfTranslateService {
  instance ??= new PdfTranslateService()
  return instance
}
