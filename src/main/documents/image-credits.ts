/** Créditos de recursos comprobados por main. Nunca lee ni confía en JSON de procedencia escrito por el modelo. */
import JSZip from 'jszip'
import { MAX_DOCX_BLOCKS, MAX_SLIDES, type PptxSlideSpec } from '@shared/chat-doc-spec'
import type { ChatDocInput } from './engine'
import type { ReviewResult } from './review'
import { OutputPathError } from './output-path'
import { extractKnowledgeText } from '../projects/extract'
import { layoutOf } from '../office/craft/chat-deck'

/** `path` es la referencia exacta que usa el documento, ya resuelta y cotejada por hash por el servidor. */
export interface ImageCredit {
  path: string
  credit: string
}

function chunks(text: string, max: number): string[] {
  const out: string[] = []
  let rest = text
  while (rest.length > max) {
    const space = rest.lastIndexOf(' ', max)
    const end = space > max / 2 ? space : max
    out.push(rest.slice(0, end))
    rest = rest.slice(end).trimStart()
  }
  if (rest) out.push(rest)
  return out
}

// Los alias absolutos de PDF/WSL no deben revelar carpetas personales al compartir el documento.
function resourceName(path: string): string {
  return path.split(/[\\/]/).at(-1) || 'foto'
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** No modifica el input. Los créditos completos cuentan contra los mismos límites que el contenido del documento. */
export function attachImageCredits(
  input: ChatDocInput,
  assets: readonly ImageCredit[]
): { input: ChatDocInput; expectedCredits: string[] } {
  if (!assets.length || input.kind === 'xlsx') return { input, expectedCredits: [] }
  const unique = [...new Map(assets.map((asset) => [asset.path, asset])).values()]
  if (unique.some((asset) => !asset.credit.trim() || asset.credit.length > 12_000))
    throw new OutputPathError('size', 'El crédito de una imagen está vacío o es demasiado largo; elige otra imagen.')
  const expectedCredits: string[] = []
  if (input.kind === 'pptx') {
    const slides = [...input.data.slides]
    for (const asset of unique) {
      const uses = input.data.slides.flatMap((slide, index) => {
        if (slide.image?.path !== asset.path) return []
        if (!['cover', 'image'].includes(layoutOf(slide, index)))
          throw new OutputPathError('name', 'Una foto con crédito necesita una lámina cover o image para quedar insertada.')
        return [index + 1]
      })
      if (!uses.length) continue
      expectedCredits.push(asset.credit)
      const pieces = chunks(asset.credit, 300)
      for (let offset = 0; offset < pieces.length; offset += 3) {
        const title = `Créditos de imágenes · lámina${uses.length > 1 ? 's' : ''} ${uses.join(', ')}`
        const slide: PptxSlideSpec = {
          title,
          layout: 'free',
          background: '#FFFFFF',
          elements: [
            { type: 'text', x: 60, y: 56, w: 840, h: 60, text: title, size: 28, color: '#111111', bold: true },
            ...pieces.slice(offset, offset + 3).map((text, index) => ({
              type: 'text' as const,
              x: 60,
              y: 144 + index * 110,
              w: 840,
              h: 100,
              text,
              size: 18,
              color: '#222222'
            }))
          ]
        }
        slides.push(slide)
      }
    }
    if (slides.length > MAX_SLIDES)
      throw new OutputPathError('size', 'No caben los créditos de las fotos: reduce las láminas de contenido o la cantidad de fotos.')
    return { input: { ...input, data: { ...input.data, slides } }, expectedCredits }
  }
  if (input.kind === 'docx') {
    const images = input.data.blocks.filter((block) => block.type === 'image')
    const paragraphs = unique.flatMap((asset) => {
      const uses = images.flatMap((block, index) => (block.path === asset.path ? [index + 1] : []))
      if (!uses.length) return []
      expectedCredits.push(asset.credit)
      return chunks(`Imagen${uses.length > 1 ? 'es' : ''} ${uses.join(', ')} (${resourceName(asset.path)}). ${asset.credit}`, 4500).map(
        (text) => ({
          type: 'paragraph' as const,
          text
        })
      )
    })
    if (!paragraphs.length) return { input, expectedCredits }
    const blocks = [...input.data.blocks, { type: 'heading' as const, level: 1 as const, text: 'Créditos de imágenes' }, ...paragraphs]
    if (blocks.length > MAX_DOCX_BLOCKS)
      throw new OutputPathError('size', 'No caben los créditos de las fotos: reduce los bloques de contenido o la cantidad de fotos.')
    return { input: { ...input, data: { ...input.data, blocks } }, expectedCredits }
  }
  // El servidor ya filtró los recursos usados en src/url y conserva las referencias originales hasta después de este paso.
  const paragraphs = unique.map((asset, index) => {
    expectedCredits.push(asset.credit)
    return `<p style="display:block!important;visibility:visible!important;opacity:1!important;color:#111!important;font:11pt Arial!important;position:static!important;overflow:visible!important;height:auto!important;white-space:normal!important;overflow-wrap:anywhere!important">Recurso ${index + 1} (${escapeHtml(resourceName(asset.path))}). ${escapeHtml(asset.credit)}</p>`
  })
  const section = `<section style="display:block!important;visibility:visible!important;opacity:1!important;position:static!important;overflow:visible!important;height:auto!important;background:#fff!important;color:#111!important;break-inside:avoid"><h2 style="font:18pt Arial!important;color:#111!important">Créditos de imágenes</h2>${paragraphs.join('')}</section>`
  const html = /<\/body\s*>/i.test(input.html) ? input.html.replace(/<\/body\s*>/i, `${section}</body>`) : input.html + section
  return { input: { ...input, html }, expectedCredits }
}

function decodeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

// El render puede partir URLs en varias líneas/runs y Word aplica el marcado de énfasis de sus párrafos.
const comparable = (text: string): string => text.normalize('NFKC').replace(/[\s*\u00ad\u200b]/g, '')

/** Comprueba el contenido del archivo final, no el spec ni notas del orador. No sustituye la revisión visual del encuadre/legibilidad. */
export async function reviewImageCredits(
  kind: ChatDocInput['kind'],
  bytes: Buffer,
  expectedCredits: readonly string[]
): Promise<ReviewResult> {
  if (!expectedCredits.length) return { ok: true, items: [] }
  let text = ''
  try {
    if (kind === 'pdf') {
      const extracted = await extractKnowledgeText('documento.pdf', bytes)
      if (!extracted.ok || extracted.truncated) throw new Error('No se pudo leer todo el PDF')
      text = extracted.text
    } else if (kind === 'pptx' || kind === 'docx') {
      const zip = await JSZip.loadAsync(bytes)
      const names = Object.keys(zip.files).filter((name) =>
        kind === 'pptx' ? /^ppt\/slides\/slide\d+\.xml$/.test(name) : name === 'word/document.xml'
      )
      for (const name of names) {
        const source = await zip.file(name)!.async('string')
        if (kind === 'pptx' && /<p:sld\b[^>]*\bshow=["'](?:0|false)["']/.test(source)) continue
        const xml = source
          .replace(/<p:sp\b[^>]*>[\s\S]*?<\/p:sp>/g, (shape) => (/<p:cNvPr\b[^>]*\bhidden=["'](?:1|true)["']/.test(shape) ? '' : shape))
          .replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, (run) => (/<w:vanish\b/.test(run) ? '' : run))
        text += [...xml.matchAll(/<(?:w|a):t(?:\s[^>]*)?>([^<]*)<\/(?:w|a):t>/g)].map((match) => decodeXml(match[1])).join('')
      }
    }
  } catch {
    return {
      ok: false,
      items: [{ ok: false, text: 'Créditos de imágenes NO verificados: no se pudo leer el contenido del archivo final.' }]
    }
  }
  const actual = comparable(text)
  const missing = expectedCredits.filter((credit) => !actual.includes(comparable(credit))).length
  return {
    ok: missing === 0,
    items: [
      {
        ok: missing === 0,
        text: missing
          ? `Faltan ${missing} crédito(s) de imágenes en el contenido del archivo final.`
          : `Los ${expectedCredits.length} crédito(s) de imágenes están en el contenido del archivo final; revisa su legibilidad en las páginas.`
      }
    ]
  }
}
