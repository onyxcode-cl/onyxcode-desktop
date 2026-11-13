/**
 * Vista previa en imágenes de un documento ya creado (la herramienta `documentos_renderizar`): PowerPoint con DeckCraft y Word con
 * WordCraft, los mismos programas de ArtCraft que arman el archivo. Se ejecutan en main (fuera del sandbox) con el entorno mínimo de
 * `runCraft`, sobre una COPIA en una carpeta temporal nueva que se borra al terminar. Devuelve PNG ya acotados (páginas y bytes).
 * Excel (GridCraft → PDF) y PDF no tienen render a imagen en ArtCraft: pasan por el PDF y `rasterize` (pdf.js en una ventana oculta de la
 * app, igual en macOS y Windows). Sin programa o sin rasterizador devuelven `null` y la herramienta lo dice.
 */
import { constants } from 'node:fs'
import { mkdtemp, open, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CraftTimeoutError, runCraft } from '../office/craft/craft-run'
import { privateTmp } from '../office/craft/private-tmp'

export const MAX_PREVIEW_PAGES = 12
export const MAX_PREVIEW_BYTES = 6 * 1024 * 1024
export const PREVIEW_SCALE = '0.6'

/** Tope de tiempo de TODA la vista previa (los programas de ArtCraft no se quedan trabajando después de que el cerrojo se libera). */
export const PREVIEW_TOTAL_MS = 100_000

/** Lee un PNG/PDF que escribió un programa hijo: sin seguir enlaces (por si algo cambió el archivo por un enlace) y solo si es un archivo normal. */
async function readOutput(path: string): Promise<Buffer> {
  const fh = await open(path, constants.O_RDONLY | (typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0))
  try {
    if (!(await fh.stat()).isFile()) throw new Error('no es un archivo normal')
    return await fh.readFile()
  } finally {
    await fh.close()
  }
}

export interface PreviewTools {
  deckcraft: string | null
  wordcraft: string | null
  gridcraft?: string | null
}

/** PDF → PNG (en la app: `pdf-raster.ts`; se inyecta para poder probar sin Electron). */
export type Rasterize = (pdf: Buffer) => Promise<{ images: Buffer[]; pages: number } | null>

/** Render del Word con el visor de la app (sin ArtCraft): se inyecta desde `documents/index.ts` para poder probar sin Electron. */
export type CaptureDocx = (bytes: Buffer, timeoutMs: number, range?: PreviewRange) => Promise<{ images: Buffer[]; pages: number } | null>
/** Igual para las diapositivas: la vista simplificada del visor de la app. */
export type CaptureDeck = CaptureDocx

export interface PreviewRange {
  firstPage: number
  lastPage: number
}

export interface PreviewResult {
  images: Buffer[]
  /** Total del documento, solo si se conoce; nunca el número de imágenes como sustituto del total. */
  pages: number | null
  truncated: boolean
  status?: 'complete' | 'range' | 'limit' | 'error' | 'timeout'
  firstPage?: number
  nextPage?: number
  /** Las imágenes salen de la VISTA SIMPLIFICADA del visor de la app (no de ArtCraft): la herramienta se lo avisa a la IA. */
  viaViewer?: boolean
}

function capImages(images: Buffer[]): { images: Buffer[]; truncated: boolean } {
  const out: Buffer[] = []
  let total = 0
  for (const img of images.slice(0, MAX_PREVIEW_PAGES)) {
    if (total + img.length > MAX_PREVIEW_BYTES) return { images: out, truncated: true }
    total += img.length
    out.push(img)
  }
  return { images: out, truncated: images.length > out.length }
}

/** Renderiza `bytes` (un .pptx o un .docx) a PNG. `null` si ese tipo no se puede renderizar o no está el programa. */
export async function renderPreview(
  tipo: 'pptx' | 'docx' | 'xlsx' | 'pdf',
  bytes: Buffer,
  tools: PreviewTools,
  opts: {
    timeoutMs?: number
    totalMs?: number
    run?: typeof runCraft
    rasterize?: Rasterize
    captureDocx?: CaptureDocx
    captureDeck?: CaptureDeck
    range?: PreviewRange
  } = {}
): Promise<PreviewResult | null> {
  const run = opts.run ?? runCraft
  const firstPage = opts.range?.firstPage ?? 1
  const lastPage = opts.range?.lastPage ?? firstPage + MAX_PREVIEW_PAGES - 1
  if (
    !Number.isSafeInteger(firstPage) ||
    !Number.isSafeInteger(lastPage) ||
    firstPage < 1 ||
    lastPage >= Number.MAX_SAFE_INTEGER ||
    lastPage < firstPage ||
    lastPage - firstPage >= MAX_PREVIEW_PAGES
  )
    throw new Error('El intervalo debe contener entre 1 y 12 páginas, con números enteros positivos.')
  if (opts.range && tipo !== 'docx') throw new Error('El intervalo de páginas solo está disponible para Word.')
  const perRun = opts.timeoutMs ?? 90_000
  const deadline = Date.now() + (opts.totalMs ?? PREVIEW_TOTAL_MS)
  const left = (): number => deadline - Date.now()
  /** Cada programa recibe como máximo lo que queda del tiempo total: ninguno sigue después de vencido. */
  const timeoutMs = (): number => Math.max(1, Math.min(perRun, left()))
  const failed = (status: 'error' | 'timeout'): PreviewResult => ({
    images: [],
    pages: null,
    truncated: true,
    status,
    firstPage,
    nextPage: firstPage
  })
  // Sin WordCraft/DeckCraft (no hay ArtCraft, o en WSL): el mismo visor que ve la persona, en una ventana oculta.
  const viaViewer = async (): Promise<PreviewResult | null> => {
    // Respeta el tiempo total: sin al menos 5 s no se abre otra ventana (el cerrojo se libera al vencer y no debe quedar nada trabajando).
    const capture = tipo === 'pptx' ? opts.captureDeck : opts.captureDocx
    if (!capture) return null
    if (left() < 5_000) return failed('timeout')
    let r: Awaited<ReturnType<CaptureDocx>>
    try {
      r = await capture(bytes, left(), opts.range)
    } catch (err) {
      return failed(err instanceof Error && err.message === 'timeout' ? 'timeout' : 'error')
    }
    if (!r || r.images.length === 0) return null
    const capped = capImages(r.images)
    const nextPage = firstPage + capped.images.length
    const truncated = capped.truncated || firstPage > 1 || r.pages >= nextPage
    return {
      images: capped.images,
      pages: r.pages,
      truncated,
      viaViewer: true,
      firstPage,
      status:
        tipo === 'docx' && r.images.length < Math.min(lastPage, r.pages) - firstPage + 1
          ? 'error'
          : nextPage > r.pages
            ? 'complete'
            : opts.range
              ? 'range'
              : 'limit',
      ...(nextPage <= r.pages ? { nextPage } : {})
    }
  }
  if (tipo === 'pptx' && !tools.deckcraft) return viaViewer()
  if (tipo === 'pptx' && tools.deckcraft) {
    const dir = await mkdtemp(join(await privateTmp(), 'lazunox-preview-'))
    try {
      const src = join(dir, 'doc.pptx')
      const outDir = join(dir, 'paginas')
      await writeFile(src, bytes)
      try {
        await run(tools.deckcraft, ['render', src, '--all', '--scale', PREVIEW_SCALE, outDir], timeoutMs())
      } catch (err) {
        // DeckCraft falló: la vista simplificada del visor de la app antes de rendirse.
        const alt = await viaViewer().catch(() => null)
        if (alt) return alt
        throw err
      }
      const files = (await readdir(outDir).catch(() => [] as string[])).filter((f) => f.toLowerCase().endsWith('.png')).sort()
      if (files.length === 0) {
        // DeckCraft terminó sin dejar imágenes: la vista simplificada del visor antes de rendirse.
        const alt = await viaViewer().catch(() => null)
        if (alt) return alt
      }
      // DeckCraft renderiza todas las diapositivas: en memoria solo entran las primeras (el resto se cuenta, no se lee).
      const all: Buffer[] = []
      for (const f of files.slice(0, MAX_PREVIEW_PAGES)) all.push(await readOutput(join(outDir, f)))
      const capped = capImages(all)
      return { images: capped.images, pages: files.length, truncated: capped.truncated || files.length > capped.images.length }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
  if (tipo === 'docx' && !tools.wordcraft) return viaViewer()
  if (tipo === 'docx' && tools.wordcraft) {
    const dir = await mkdtemp(join(await privateTmp(), 'lazunox-preview-'))
    try {
      const src = join(dir, 'doc.docx')
      await writeFile(src, bytes)
      const all: Buffer[] = []
      let pages: number | null = null
      let status: NonNullable<PreviewResult['status']> = opts.range ? 'range' : 'limit'
      // Solo un error explícito de página inexistente confirma el final. Cualquier otro fallo conserva un total desconocido.
      for (let page = firstPage; page <= lastPage + 1; page++) {
        const out = join(dir, `p${page}.png`)
        if (left() <= 0) {
          status = 'timeout'
          break
        }
        try {
          await run(tools.wordcraft, ['render', src, out, '--page', String(page), '--scale', PREVIEW_SCALE], timeoutMs())
          const image = await readOutput(out)
          if (page <= lastPage) all.push(image)
        } catch (err) {
          const message = err instanceof Error ? err.message.trim() : ''
          const missing = message.match(/^(?:wordcraft-cli:\s*)?(?:bad parameters:\s*)?no page (\d+)\.?$/i)
          if (missing && Number(missing[1]) === page && all.length > 0) {
            pages = page - 1
            status = 'complete'
            break
          }
          status = err instanceof CraftTimeoutError || left() <= 0 ? 'timeout' : 'error'
          if (page === 1 && status === 'error') {
            const alt = await viaViewer().catch(() => null)
            if (alt) return alt
          }
          break
        }
      }
      const capped = capImages(all)
      const nextPage = firstPage + capped.images.length
      return {
        images: capped.images,
        pages,
        status,
        firstPage,
        truncated: capped.truncated || firstPage > 1 || status !== 'complete',
        ...(pages === null || nextPage <= pages ? { nextPage } : {})
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
  if (tipo === 'pdf' && opts.rasterize) {
    const r = await opts.rasterize(bytes)
    if (!r || r.images.length === 0) return null
    const capped = capImages(r.images)
    return { images: capped.images, pages: r.pages, truncated: capped.truncated || r.pages > capped.images.length }
  }
  if (tipo === 'xlsx' && tools.gridcraft && opts.rasterize) {
    const dir = await mkdtemp(join(await privateTmp(), 'lazunox-preview-'))
    try {
      const src = join(dir, 'libro.xlsx')
      await writeFile(src, bytes)
      const pdfPath = join(dir, 'libro.pdf')
      try {
        // Mismas órdenes que `gridToPdf` (chat-grid.ts), con el ejecutor inyectable.
        await run(
          tools.gridcraft,
          ['run', '--in', src, '--cmd', `file.exportPdf=${JSON.stringify({ path: pdfPath, sheets: 'all', fitToPage: true })}`, '--quiet'],
          timeoutMs()
        )
      } catch {
        return null
      }
      const r = await opts.rasterize(await readOutput(pdfPath))
      if (!r || r.images.length === 0) return null
      const capped = capImages(r.images)
      return { images: capped.images, pages: r.pages, truncated: capped.truncated || r.pages > capped.images.length }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
  return null
}
