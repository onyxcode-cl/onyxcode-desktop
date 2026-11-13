/** PPTX importado → PDF del motor Office → imágenes completas → el mismo presentador HTML.
 * Nunca proyecta el visor estructural de respaldo ni recorta silenciosamente las láminas.
 * El llamador valida el ámbito de la ruta; aquí se copia el archivo a un temporal privado.
 */
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { t } from '@shared/i18n'
import { MAX_SLIDES } from '@shared/chat-doc-spec'
import { OFFICE_MAX_BYTES } from '@shared/attach-office'
import { MAX_ARTIFACT_HTML_BYTES } from '@shared/slides-html'
import { openZip } from '../files/office-extract/zip'
import { child, childrenOf, parseXml } from '../files/office-extract/xml'
import { craftBinary } from '../documents/engine'
import { readTaskFile } from '../documents/input-path'
import { rasterizePdf } from '../documents/pdf-raster'
import { deckToPdf } from '../office/craft/chat-deck'
import { privateTmp } from '../office/craft/private-tmp'
import { presentSlides } from '../extras/artifact-window'
import { MAX_BYTES, sniffDocKind } from './doc-kind'

export const MAX_PRESENTATION_SLIDES = MAX_SLIDES

export async function pptxSlideCount(bytes: Buffer): Promise<number> {
  if (sniffDocKind('input.pptx', bytes) !== 'pptx' || bytes.length > MAX_BYTES.pptx) throw new Error(t('viewer.pptx.invalid'))
  try {
    const zip = await openZip(bytes)
    const xml = await zip.text('ppt/presentation.xml')
    if (!xml) throw new Error('missing presentation')
    const count = childrenOf(child(child(parseXml(xml), 'p:presentation'), 'p:sldIdLst'), 'p:sldId').length
    if (!count) throw new Error('empty presentation')
    if (count > MAX_PRESENTATION_SLIDES) throw new Error(t('viewer.pptx.limit', { n: MAX_PRESENTATION_SLIDES }))
    return count
  } catch (e) {
    if (e instanceof Error && e.message === t('viewer.pptx.limit', { n: MAX_PRESENTATION_SLIDES })) throw e
    throw new Error(t('viewer.pptx.invalid'))
  }
}

/** Bytes elegidos/arrastrados por la persona; el nombre nunca decide una ruta. */
export async function importPptxAttachment(root: string, name: string, base64: string): Promise<string> {
  if (!/\.pptx$/i.test(name) || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length > Math.ceil(OFFICE_MAX_BYTES / 3) * 4)
    throw new Error(t('viewer.pptx.invalid'))
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.length > OFFICE_MAX_BYTES) throw new Error(t('viewer.pptx.invalid'))
  await pptxSlideCount(bytes)
  const dir = join(root, 'adjuntos')
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const path = join(dir, `${createHash('sha256').update(bytes).digest('hex')}.pptx`)
  await writeFile(path, bytes, { mode: 0o600 })
  return path
}

export function renderedPptxHtml(images: Buffer[], pages: number, expected: number): string {
  if (pages !== expected || images.length !== expected) throw new Error(t('viewer.pptx.incomplete', { expected, actual: images.length }))
  let total = 512
  const slides: string[] = []
  for (const [index, image] of images.entries()) {
    if (!image.length) throw new Error(t('viewer.pptx.slideFailed', { n: index + 1 }))
    total += Math.ceil(image.length / 3) * 4 + 100
    if (total > MAX_ARTIFACT_HTML_BYTES) throw new Error(t('viewer.pptx.weight'))
    slides.push(`<section class="slide"><img alt="${index + 1}" src="data:image/png;base64,${image.toString('base64')}"></section>`)
  }
  const html = `<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;background:#000}.slide{width:960px;height:540px;margin:0;padding:0;background:#000}.slide img{width:100%;height:100%;object-fit:contain}</style></head><body>${slides.join('')}</body></html>`
  if (Buffer.byteLength(html) > MAX_ARTIFACT_HTML_BYTES) throw new Error(t('viewer.pptx.weight'))
  return html
}

export async function presentPptxFile(path: string, authorize: (path: string) => string): Promise<void> {
  const real = authorize(path)
  if (!/\.pptx$/i.test(real)) throw new Error(t('viewer.pptx.invalid'))
  // Mismo descriptor para tamaño/lectura, sin enlaces y con identidad estable; tope Office de 25 MiB.
  const inputFile = await readTaskFile(dirname(real), basename(real))
  // Si un padre se sustituyó antes del recorrido, su canonical debe seguir autorizada.
  if (authorize(inputFile.abs) !== inputFile.abs || authorize(path) !== inputFile.abs) throw new Error(t('viewer.pptx.invalid'))
  const bytes = inputFile.bytes
  const count = await pptxSlideCount(bytes)
  const binary = craftBinary('deckcraft')
  if (!binary) throw new Error(t('viewer.pptx.noEngine'))
  const dir = await mkdtemp(join(await privateTmp(), 'present-pptx-'))
  try {
    const input = join(dir, 'input.pptx')
    const output = join(dir, 'output.pdf')
    await writeFile(input, bytes, { mode: 0o600 })
    if (!(await deckToPdf(binary, input, output))) throw new Error(t('viewer.pptx.renderFailed'))
    const rendered = await rasterizePdf(await readFile(output), count, 3840).catch((error: unknown) => {
      if (error instanceof Error && error.message.includes('presentation image budget exceeded')) throw new Error(t('viewer.pptx.weight'))
      throw new Error(t('viewer.pptx.renderFailed'))
    })
    if (!rendered) throw new Error(t('viewer.pptx.renderFailed'))
    const html = renderedPptxHtml(rendered.images, rendered.pages, count)
    await presentSlides({ title: basename(path), html })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
