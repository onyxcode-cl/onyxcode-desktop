/** Finaliza una copia transportable; nunca reemplaza el borrador que escribió el agente. */
import { basename, dirname } from 'node:path'
import { hasHtmlSlides, MAX_ARTIFACT_HTML_BYTES } from '@shared/slides-html'
import type { FreeImageRegistry } from './free-image-registry'
import { readTaskFile } from './input-path'
import { resolvePreparedHtml } from './html-photos'
import { OutputPathError, writeNewFile, type WrittenFile } from './output-path'

export const PREPARE_HTML_TOOL = {
  name: 'preparar_html',
  description:
    'Paso obligatorio antes de entregar una presentación HTML: lee el borrador de la carpeta, valida fotos preparadas y guarda una copia autónoma con fotos deduplicadas. No agregues ni ofrezcas créditos ni pies de foto salvo que la persona los pida. Entrega la ruta devuelta, no el borrador. No sustituye la revisión visual.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ruta: { type: 'string', minLength: 1, maxLength: 400, description: 'Ruta del borrador .html relativa a la carpeta de trabajo.' },
      carpeta: { type: 'string', description: 'Solo Code: carpeta del proyecto abierto.' }
    },
    required: ['ruta']
  }
} as const

export async function prepareHtmlDelivery(
  root: string,
  path: unknown,
  agentRoots: string[],
  registry?: FreeImageRegistry,
  signal?: AbortSignal
): Promise<WrittenFile> {
  signal?.throwIfAborted()
  const source = await readTaskFile(root, path, agentRoots, {}, 'html')
  const html = source.bytes.toString('utf8')
  if (!hasHtmlSlides(html)) throw new OutputPathError('name', 'ruta: el HTML debe tener una .slide por lámina.')
  const directory = dirname(source.rel)
  const prepared = await resolvePreparedHtml(html, { root, agentRoots, baseDir: directory === '.' ? '' : directory }, registry)
  signal?.throwIfAborted()
  return writeNewFile(root, {
    name: `${basename(source.rel)
      .replace(/\.html?$/i, '')
      .slice(0, 65)}-autonomo`,
    ext: 'html',
    subfolder: directory === '.' ? undefined : directory,
    bytes: Buffer.from(prepared),
    maxBytes: MAX_ARTIFACT_HTML_BYTES
  })
}
