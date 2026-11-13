/** PPTX proyectable: una imagen PNG 4K intacta por lámina, sin convertir el diseño a formas. */
import PptxGenJS from 'pptxgenjs'
import JSZip from 'jszip'
import { createReadStream, createWriteStream, type ReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { SLIDE_PNG_HEIGHT, SLIDE_PNG_WIDTH, SlidesHtmlError } from '@shared/slides-html'
import { MAX_SLIDES } from '@shared/chat-doc-spec'

export const MAX_SLIDES_PPTX_BYTES = 256 * 1024 * 1024
const PLACEHOLDER = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

export function assertSlidePng(image: Buffer, index: number): void {
  if (
    image.length < 24 ||
    !image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    image.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    throw new SlidesHtmlError(`La captura de la lámina ${index + 1} no es un PNG válido.`)
  }
  const width = image.readUInt32BE(16)
  const height = image.readUInt32BE(20)
  if (width !== SLIDE_PNG_WIDTH || height !== SLIDE_PNG_HEIGHT) {
    throw new SlidesHtmlError(
      `La captura de la lámina ${index + 1} mide ${width}×${height}; se requieren 3840×2160 píxeles. No se generó un PowerPoint de menor resolución.`
    )
  }
}

function assertCount(count: number): void {
  if (count < 1 || count > MAX_SLIDES) throw new SlidesHtmlError(`La presentación debe tener entre 1 y ${MAX_SLIDES} láminas.`)
}

function assertBudget(bytes: number): void {
  if (bytes > MAX_SLIDES_PPTX_BYTES)
    throw new SlidesHtmlError('El PowerPoint 4K supera 256 MiB. Divida la presentación en partes; no se bajó la resolución.')
}

async function template(count: number): Promise<JSZip> {
  assertCount(count)
  const pres = new PptxGenJS()
  pres.defineLayout({ name: 'LAZUNOX-SLIDES', width: 10, height: 5.625 })
  pres.layout = 'LAZUNOX-SLIDES'
  for (let i = 0; i < count; i++) {
    pres.addSlide().addImage({ data: `data:image/png;base64,${PLACEHOLDER}`, x: 0, y: 0, w: 10, h: 5.625 })
  }
  return JSZip.loadAsync((await pres.write({ outputType: 'nodebuffer' })) as Buffer)
}

function mediaNames(zip: JSZip): string[] {
  return Object.keys(zip.files)
    .filter((n) => /^ppt\/media\/.+\.png$/.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

/** Compatibilidad para consumidores de buffers/pruebas; el exportador real usa la variante a disco. */
export async function assembleSlidesPptx(images: Buffer[]): Promise<Buffer> {
  const zip = await template(images.length)
  const names = mediaNames(zip)
  let bytes = 0
  images.forEach((image, i) => {
    assertSlidePng(image, i)
    bytes += image.length
    assertBudget(bytes)
    zip.file(names[i], image)
  })
  const output = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' })
  assertBudget(output.length)
  return output
}

/** No junta los bitmaps: lee y escribe cada PNG en el ZIP con contrapresión, sin recomprimirlo. */
export async function writeSlidesPptx(images: string[], destination: string): Promise<void> {
  const zip = await template(images.length)
  const names = mediaNames(zip)
  let inputBytes = 0
  const streams: ReadStream[] = []
  try {
    for (const [i, path] of images.entries()) {
      inputBytes += (await stat(path)).size
      assertBudget(inputBytes)
      // Sólo un PNG temporal a la vez, también al comprobar el formato.
      assertSlidePng(await readFile(path), i)
      const stream = createReadStream(path)
      streams.push(stream)
      zip.file(names[i], stream)
    }
    let outputBytes = 0
    const budget = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        outputBytes += chunk.length
        try {
          assertBudget(outputBytes)
          callback(null, chunk)
        } catch (error) {
          callback(error as Error)
        }
      }
    })
    await pipeline(
      zip.generateNodeStream({ streamFiles: true, compression: 'STORE' }),
      budget,
      createWriteStream(destination, { flags: 'wx' }),
      { signal: AbortSignal.timeout(30_000) }
    )
  } finally {
    for (const stream of streams) stream.destroy()
  }
}
