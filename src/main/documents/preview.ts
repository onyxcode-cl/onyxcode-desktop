/**
 * Vista previa en imágenes de un documento ya creado (la herramienta `documentos_renderizar`): PowerPoint con DeckCraft y Word con
 * WordCraft, los mismos programas de ArtCraft que arman el archivo. Se ejecutan en main (fuera del sandbox) con el entorno mínimo de
 * `runCraft`, sobre una COPIA en una carpeta temporal nueva que se borra al terminar. Devuelve PNG ya acotados (páginas y bytes).
 * Excel y PDF no tienen render a imagen en ArtCraft: devuelven `null` y la herramienta lo dice.
 */
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCraft } from '../office/craft/craft-run'

export const MAX_PREVIEW_PAGES = 12
export const MAX_PREVIEW_BYTES = 6 * 1024 * 1024
export const PREVIEW_SCALE = '0.6'

export interface PreviewTools {
  deckcraft: string | null
  wordcraft: string | null
}

export interface PreviewResult {
  images: Buffer[]
  /** Páginas o diapositivas que se pudieron renderizar (puede haber más que `images` si se aplicó un tope). */
  pages: number
  truncated: boolean
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
  opts: { timeoutMs?: number; run?: typeof runCraft } = {}
): Promise<PreviewResult | null> {
  const run = opts.run ?? runCraft
  const timeoutMs = opts.timeoutMs ?? 90_000
  if (tipo === 'pptx' && tools.deckcraft) {
    const dir = await mkdtemp(join(tmpdir(), 'lazunox-preview-'))
    try {
      const src = join(dir, 'doc.pptx')
      const outDir = join(dir, 'paginas')
      await writeFile(src, bytes)
      await run(tools.deckcraft, ['render', src, '--all', '--scale', PREVIEW_SCALE, outDir], timeoutMs)
      const files = (await readdir(outDir)).filter((f) => f.toLowerCase().endsWith('.png')).sort()
      const all = await Promise.all(files.map((f) => readFile(join(outDir, f))))
      const capped = capImages(all)
      return { images: capped.images, pages: all.length, truncated: capped.truncated }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
  if (tipo === 'docx' && tools.wordcraft) {
    const dir = await mkdtemp(join(tmpdir(), 'lazunox-preview-'))
    try {
      const src = join(dir, 'doc.docx')
      await writeFile(src, bytes)
      const all: Buffer[] = []
      // WordCraft renderiza una página por llamada y falla al pasarse del final: se pide hasta que falle o se llegue al tope.
      for (let page = 1; page <= MAX_PREVIEW_PAGES + 1; page++) {
        const out = join(dir, `p${page}.png`)
        try {
          await run(tools.wordcraft, ['render', src, out, '--page', String(page), '--scale', PREVIEW_SCALE], timeoutMs)
          all.push(await readFile(out))
        } catch {
          if (page === 1) throw new Error('No se pudo renderizar la primera página.')
          break
        }
      }
      const capped = capImages(all)
      return { images: capped.images, pages: all.length, truncated: capped.truncated || all.length > MAX_PREVIEW_PAGES }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
  return null
}
