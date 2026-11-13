/** Adaptador del banco: los mismos validadores, lector de imágenes y armadores que la app, sin Electron. */
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isPptxSpec, isDocxSpec } from '../../src/shared/chat-doc-spec'
import { renderChatDeck } from '../../src/main/office/craft/chat-deck'
import { renderChatDocx } from '../../src/main/office/craft/chat-word'
import { prepareImages } from '../../src/main/documents/image-files'

interface Options {
  deckcraft?: string
  wordcraft?: string
  python?: string
  chromium?: string
  pdfScript: string
}
export async function renderDesignFile(format: string, source: string, output: string, options: Options): Promise<void> {
  const raw = await readFile(source, 'utf8')
  if (format === 'pdf') {
    if (!options.python) throw new Error('PDF requiere --python')
    const refs = [...raw.matchAll(/\bsrc\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]).filter((p) => !p.startsWith('data:'))
    const prepared = await prepareImages(dirname(source), [...new Set(refs)])
    const dir = await mkdtemp(join(tmpdir(), 'lazunox-design-pdf-'))
    try {
      let html = raw
      for (const [name, image] of prepared.images) {
        const data = `data:${image.mime};base64,${(await readFile(image.file)).toString('base64')}`
        html = html.replaceAll(`src="${name}"`, `src="${data}"`).replaceAll(`src='${name}'`, `src='${data}'`)
      }
      const local = join(dir, 'source.html')
      await writeFile(local, html)
      await promisify(execFile)(options.python, [options.pdfScript, local, output], {
        timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, ...(options.chromium ? { LAZUNOX_CHROMIUM: options.chromium } : {}) }
      })
    } finally {
      await prepared.cleanup()
      await rm(dir, { recursive: true, force: true })
    }
    return
  }
  const spec: unknown = JSON.parse(raw)
  if (format === 'pptx' && isPptxSpec(spec)) {
    if (!options.deckcraft) throw new Error('PPTX requiere --deckcraft')
    const refs = spec.slides.flatMap((s) => (s.image ? [s.image.path] : []))
    const prepared = await prepareImages(dirname(source), [...new Set(refs)])
    try {
      await writeFile(output, await renderChatDeck(options.deckcraft, spec, 90_000, undefined, prepared.images), { flag: 'wx' })
    } finally {
      await prepared.cleanup()
    }
  } else if (format === 'docx' && isDocxSpec(spec)) {
    if (!options.wordcraft) throw new Error('DOCX requiere --wordcraft')
    const refs = spec.blocks.flatMap((b) => (b.type === 'image' ? [b.path] : []))
    const prepared = await prepareImages(dirname(source), [...new Set(refs)])
    try {
      await writeFile(output, await renderChatDocx(options.wordcraft, spec, 90_000, prepared.images), { flag: 'wx' })
    } finally {
      await prepared.cleanup()
    }
  } else throw new Error('La especificación no cumple el esquema de ' + format)
}
