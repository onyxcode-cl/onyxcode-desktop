/** Exporta el archivo existente con su propio motor: conserva sus páginas, imágenes y pies sin reconstruir el contenido. */
import { constants } from 'node:fs'
import { lstat, mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import JSZip from 'jszip'
import { runCraft } from '../office/craft/craft-run'
import { privateTmp } from '../office/craft/private-tmp'
import { decodeHtmlText } from './html-images'

export const MAX_EXPORTED_PDF_BYTES = 50 * 1024 * 1024

export class PdfExportError extends Error {
  constructor(
    message: string,
    readonly code: 'no-craft' | 'invalid' = 'invalid'
  ) {
    super(message)
    this.name = 'PdfExportError'
  }
}

type ExportSource = { jpegUses: number; credits: string[]; slides?: number }
const comparable = (text: string): string =>
  text
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')

/** Solo XML visible y sus relaciones; nunca se infla todo el ZIP ni se lee contenido de las fotos. */
async function inspectSource(tipo: 'docx' | 'pptx', bytes: Buffer): Promise<ExportSource> {
  const zip = await JSZip.loadAsync(bytes)
  const names = Object.keys(zip.files)
  if (names.length > 5000) throw new PdfExportError('El documento tiene demasiados componentes para comprobar su exportación.')
  let remaining = 8 * 1024 * 1024
  const xml = async (name: string): Promise<string> => {
    const entry = zip.file(name)
    if (!entry) return ''
    const stream = entry.nodeStream()
    const chunks: Buffer[] = []
    await new Promise<void>((resolve, reject) => {
      stream
        .on('data', (chunk: Buffer) => {
          remaining -= chunk.length
          if (remaining < 0) {
            stream.pause()
            reject(new PdfExportError('El contenido del documento supera el límite de revisión de la exportación.'))
          } else chunks.push(chunk)
        })
        .on('error', reject)
        .on('end', resolve)
        .resume()
    })
    return Buffer.concat(chunks).toString('utf8')
  }
  const source: ExportSource = { jpegUses: 0, credits: [] }
  const visible = names.filter((name) =>
    tipo === 'docx' ? /^word\/(?:document|header\d+|footer\d+)\.xml$/.test(name) : /^ppt\/slides\/slide\d+\.xml$/.test(name)
  )
  if (!visible.length) throw new PdfExportError('No se encuentra el contenido del documento que se quiere exportar.')
  if (tipo === 'pptx') {
    source.slides = (await xml('ppt/presentation.xml')).match(/<p:sldId\b/g)?.length ?? 0
    if (!source.slides) throw new PdfExportError('La presentación no tiene láminas para exportar.')
  }
  for (const name of visible) {
    const content = await xml(name)
    const pos = name.lastIndexOf('/')
    const rels = await xml(`${name.slice(0, pos)}/_rels/${name.slice(pos + 1)}.rels`)
    const jpegIds = new Set<string>()
    const attr = (tag: string, key: string): string => new RegExp(`\\b${key}=["']([^"']*)["']`).exec(tag)?.[1] ?? ''
    for (const [tag] of rels.matchAll(/<Relationship\b[^>]*>/g))
      if (/\/image$/.test(attr(tag, 'Type')) && /\.jpe?g$/i.test(attr(tag, 'Target')) && attr(tag, 'TargetMode') !== 'External')
        jpegIds.add(attr(tag, 'Id'))
    for (const [tag] of content.matchAll(/<a:blip\b[^>]*>/g)) if (jpegIds.has(attr(tag, 'r:embed'))) source.jpegUses++
    for (const [paragraph] of content.matchAll(/<(?:w|a):p\b[^>]*>[\s\S]*?<\/(?:w|a):p>/g)) {
      const text = decodeHtmlText([...paragraph.matchAll(/<(?:w|a):t\b[^>]*>([\s\S]*?)<\/(?:w|a):t>/g)].map((m) => m[1]).join(''))
      const credit = /\bFoto\s*[:：]\s*.+/i.exec(text)?.[0]
      if (credit) source.credits.push(credit)
    }
  }
  return source
}

/** Los JPEG son las fotos preparadas por el servicio. PNG sólidos pueden volverse vectores; no se confunden con fotos perdidas. */
async function verifyExport(pdf: Buffer, source: ExportSource): Promise<void> {
  const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = getDocument({ data: new Uint8Array(pdf), useSystemFonts: false, disableFontFace: true, enableXfa: false, verbosity: 0 })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      (async () => {
        const doc = await task.promise
        if (doc.numPages < 1 || doc.numPages > 200) throw new PdfExportError('El PDF no tiene un número de páginas verificable (1–200).')
        if (source.slides !== undefined && source.slides !== doc.numPages)
          throw new PdfExportError(
            'La exportación perdió o añadió láminas. Conserva el original y vuelve a exportar; no entregues este PDF como completo.'
          )
        let images = 0
        const texts: string[] = []
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n)
          texts.push((await page.getTextContent()).items.map((item) => ('str' in item ? item.str : '')).join(' '))
          if (source.jpegUses) {
            const ops = await page.getOperatorList()
            for (const [i, op] of ops.fnArray.entries()) {
              if (op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject) images++
              else if (op === OPS.paintImageXObjectRepeat) images += (ops.argsArray[i]?.[3]?.length ?? 0) / 2
            }
          }
          page.cleanup()
        }
        if (images < source.jpegUses)
          throw new PdfExportError(
            'La exportación perdió fotos del original. Conserva el documento y vuelve a exportar; no entregues este PDF sin sus fotos.'
          )
        const text = comparable(texts.join(' '))
        if (source.credits.some((credit) => !text.includes(comparable(credit))))
          throw new PdfExportError(
            'La exportación perdió un crédito visible de las fotos. Conserva el original y vuelve a exportar; no entregues este PDF incompleto.'
          )
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new PdfExportError('Se agotó el tiempo para comprobar el PDF completo. Conserva el original y vuelve a exportar.')),
          10_000
        )
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
    await task.destroy().catch(() => undefined)
  }
}

export async function exportDocumentPdf(
  tipo: 'docx' | 'pptx',
  bytes: Buffer,
  tools: { wordcraft: string | null; deckcraft: string | null },
  opts: { run?: typeof runCraft; timeoutMs?: number } = {}
): Promise<Buffer> {
  const binary = tipo === 'docx' ? tools.wordcraft : tools.deckcraft
  if (!binary)
    throw new PdfExportError(
      'No está disponible el motor para exportar este documento a PDF conservando su diseño. Instala el diseñador de documentos desde Ajustes y vuelve a exportar el mismo archivo. No lo entregues reconstruido ni sin fotos.',
      'no-craft'
    )
  if (bytes.length > 25 * 1024 * 1024 || !bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])))
    throw new PdfExportError('El documento de origen no es válido o supera los 25 MB.')
  const dir = await mkdtemp(join(await privateTmp(), 'lazunox-export-pdf-'))
  try {
    const expected = await inspectSource(tipo, bytes)
    const source = join(dir, `documento.${tipo}`)
    const output = join(dir, 'documento.pdf')
    await writeFile(source, bytes, { mode: 0o600, flag: 'wx' })
    await (opts.run ?? runCraft)(binary, ['convert', source, output], opts.timeoutMs ?? 90_000)
    if (!(await lstat(output)).isFile()) throw new PdfExportError('La exportación no produjo un archivo PDF normal.')
    const fh = await open(output, constants.O_RDONLY | (typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0))
    let pdf: Buffer
    try {
      const stat = await fh.stat()
      if (!stat.isFile() || stat.size < 8 || stat.size > MAX_EXPORTED_PDF_BYTES)
        throw new PdfExportError('El PDF exportado está vacío o supera el límite de 50 MB.')
      // Lectura acotada incluso si el archivo cambiara después del stat.
      const chunks: Buffer[] = []
      let total = 0
      for (;;) {
        const chunk = Buffer.alloc(Math.min(64 * 1024, MAX_EXPORTED_PDF_BYTES + 1 - total))
        const { bytesRead } = await fh.read(chunk)
        if (!bytesRead) break
        total += bytesRead
        if (total > MAX_EXPORTED_PDF_BYTES) throw new PdfExportError('El PDF exportado supera el límite de 50 MB.')
        chunks.push(chunk.subarray(0, bytesRead))
      }
      pdf = Buffer.concat(chunks, total)
    } finally {
      await fh.close()
    }
    if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-')))
      throw new PdfExportError('El motor no produjo un PDF válido. Conserva el documento original y vuelve a exportarlo.')
    await verifyExport(pdf, expected)
    return pdf
  } catch (err) {
    if (err instanceof PdfExportError) throw err
    throw new PdfExportError(
      'No se pudo exportar el documento completo a PDF. Conserva el original y vuelve a llamar a exportar_pdf con la misma ruta; no lo reconstruyas ni omitas sus fotos o páginas.'
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
