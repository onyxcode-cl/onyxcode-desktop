/** Créditos de recursos comprobados por main. Nunca lee ni confía en JSON de procedencia escrito por el modelo. */
import JSZip from 'jszip'
import { MAX_DOCX_TEXT_CHARS, MAX_SPEAKER_NOTES_CHARS, MAX_SLIDES, type PptxSlideSpec } from '@shared/chat-doc-spec'
import type { ChatDocInput } from './engine'
import type { ReviewResult } from './review'
import { OutputPathError } from './output-path'
import { extractKnowledgeText } from '../projects/extract'
import { layoutOf } from '../office/craft/chat-deck'
import { shortImageCredit } from './free-image-credit'
import { decodeHtmlText, htmlImageTags } from './html-images'

/** `path` es la referencia exacta que usa el documento, ya resuelta y cotejada por hash por el servidor. */
export interface ImageCredit {
  path: string
  credit: string
  attribution?: {
    fullCredit?: string
    author: string
    license: string
    provider: string
    source: string
    licenseUrl: string
    notices?: string
    transformations?: string[]
  }
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

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Campos provenientes de la ficha comprobada por main; nunca se interpreta el crédito libre como una licencia. */
export function imageCreditCaption(asset: ImageCredit): string {
  const a = asset.attribution
  if (!a) return asset.credit
  return shortImageCredit(a)
}

function hasCopiedCredit(text: string, asset: ImageCredit): boolean {
  return [imageCreditCaption(asset), asset.credit, asset.attribution?.fullCredit]
    .filter((value): value is string => !!value?.trim())
    .some((value) => comparable(text).includes(comparable(value)))
}

/** Replace an existing attribution in place, retaining the person's description before it. */
function mergeCaption(previous: string, asset: ImageCredit): string {
  const caption = imageCreditCaption(asset)
  if (!previous) return caption
  const marker = /(?:^|\s)(?:foto|fotografía)\s*[:：-]\s*/i.exec(previous)
  if (marker) return [previous.slice(0, marker.index).trim(), caption].filter(Boolean).join(' ')
  if (hasCopiedCredit(previous, asset)) return caption
  return [previous, caption].join(' · ')
}

const CAPTION_STYLE =
  'display:block!important;visibility:visible!important;opacity:1!important;color:#333!important;font:8pt Arial!important;line-height:1.15!important;position:static!important;overflow:visible!important;height:auto!important;margin:2pt 0 3pt!important;white-space:normal!important;overflow-wrap:anywhere!important;break-before:avoid!important;break-inside:avoid!important'

function captionHtml(asset: ImageCredit, text: string): string {
  const a = asset.attribution
  // Las URL proceden de main. Se vuelven a validar para no convertir metadatos en enlaces ejecutables.
  const link = (url: string, label: string): string => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return escapeHtml(label)
      return `<a href="${escapeHtml(parsed.href)}" style="color:inherit!important">${escapeHtml(label)}</a>`
    } catch {
      return escapeHtml(label)
    }
  }
  return `<small style="${CAPTION_STYLE}">${escapeHtml(text)}${a ? ` · ${link(a.source, 'Fuente')} · ${link(a.licenseUrl, 'Licencia')}` : ''}</small>`
}

/** No modifica el input. Los créditos se colocan junto a la foto y no crean una sección final por defecto. */
export function attachImageCredits(
  input: ChatDocInput,
  assets: readonly ImageCredit[]
): { input: ChatDocInput; expectedCredits: string[] } {
  if (!assets.length || input.kind === 'xlsx') return { input, expectedCredits: [] }
  const unique = [...new Map(assets.map((asset) => [asset.path, asset])).values()]
  if (unique.some((asset) => !asset.credit.trim() || asset.credit.length > 12_000 || imageCreditCaption(asset).length > 12_000))
    throw new OutputPathError('size', 'El crédito de una imagen está vacío o es demasiado largo; elige otra imagen.')
  const expectedCredits: string[] = []
  if (input.kind === 'pptx') {
    const slides = input.data.slides.map((slide) => ({ ...slide }))
    for (const asset of unique) {
      const caption = imageCreditCaption(asset)
      const uses = input.data.slides.flatMap((slide, index) => {
        if (slide.image?.path !== asset.path) return []
        if (!['cover', 'image'].includes(layoutOf(slide, index)))
          throw new OutputPathError('name', 'Una foto con crédito necesita una lámina cover o image para quedar insertada.')
        return [index]
      })
      if (!uses.length) continue
      expectedCredits.push(caption)
      const overflow: number[] = []
      for (const index of uses) {
        const slide = slides[index]
        const originalNote = slide.note ?? input.data.footer ?? ''
        const foot = mergeCaption(originalNote, asset)
        if (foot.length <= 240) slide.imageCredit = foot
        else overflow.push(index + 1)
        // El pie visible es breve; la ficha íntegra sigue disponible al presentar y en el JSON de procedencia.
        const notes = [slide.speaker_notes, asset.attribution?.fullCredit ?? asset.credit].filter(Boolean).join('\n\n')
        if (notes.length <= MAX_SPEAKER_NOTES_CHARS) slide.speaker_notes = notes
        else if (asset.attribution) {
          const links = `${asset.attribution.source}\n${asset.attribution.licenseUrl}`
          const withLinks = [slide.speaker_notes, links].filter(Boolean).join('\n\n')
          if (withLinks.length > MAX_SPEAKER_NOTES_CHARS)
            throw new OutputPathError('size', 'No caben los enlaces de atribución en las notas; acorta las notas de la lámina.')
          slide.speaker_notes = withLinks
        }
      }
      if (!overflow.length) continue
      const pieces = chunks(caption, 300)
      for (let offset = 0; offset < pieces.length; offset += 3) {
        const title = `Fotos · lámina${overflow.length > 1 ? 's' : ''} ${overflow.join(', ')}`
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
    const byPath = new Map(unique.map((asset) => [asset.path, asset]))
    const blocks = input.data.blocks.map((block) => {
      const asset = block.type === 'image' ? byPath.get(block.path) : undefined
      if (!asset || block.type !== 'image') return block
      const caption = imageCreditCaption(asset)
      if (!expectedCredits.includes(caption)) expectedCredits.push(caption)
      const text = mergeCaption(block.caption ?? '', asset)
      if (text.length > MAX_DOCX_TEXT_CHARS)
        throw new OutputPathError('size', 'No cabe el crédito bajo la foto; elige una imagen con una atribución más breve.')
      return { ...block, caption: text }
    })
    return { input: { ...input, data: { ...input.data, blocks } }, expectedCredits }
  }
  let html = input.html
  const fixed: string[] = []
  for (const asset of unique) {
    const caption = imageCreditCaption(asset)
    let matched = false
    for (const image of htmlImageTags(html).reverse()) {
      if (image.source !== asset.path) continue
      matched = true
      const tail = html.slice(image.end)
      const existingMatch = /^\s*<(figcaption|p|small)\b(?:"[^"]*"|'[^']*'|[^'">])*?>([\s\S]*?)<\/\1\s*>/i.exec(tail)
      const existing = decodeHtmlText((existingMatch?.[2] ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ''))
        .trim()
        .replace(/ · Fuente · Licencia$/, '')
      const creditStart = /(?:^|\s)(?:Foto|Fotografía)\s*[:：-]\s*/i.exec(existing)
      // Rebuild the adjacent attribution from verified fields. Boilerplate and stale copied
      // credits never enlarge the page; descriptions preceding “Foto:” remain intact.
      if (existingMatch && (creditStart || hasCopiedCredit(existing, asset))) {
        expectedCredits.push(caption)
        html = html.slice(0, image.end) + captionHtml(asset, mergeCaption(existing, asset)) + tail.slice(existingMatch[0].length)
      } else {
        expectedCredits.push(caption)
        html = html.slice(0, image.end) + captionHtml(asset, caption) + tail
      }
    }
    if (!matched) {
      // Fondos CSS: pie fijo en la misma página, sin agregar bloques al flujo ni hojas de créditos.
      expectedCredits.push(caption)
      fixed.push(captionHtml(asset, caption))
    }
  }
  if (fixed.length) {
    const footer = `<aside style="position:fixed!important;bottom:3mm!important;left:12mm!important;right:12mm!important;background:#fff!important;z-index:2147483647!important">${fixed.join('')}</aside>`
    html = /<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, `${footer}</body>`) : html + footer
  }
  return { input: { ...input, html }, expectedCredits: [...new Set(expectedCredits)] }
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
const comparable = (text: string): string =>
  text
    .normalize('NFKC')
    .toLocaleLowerCase('es')
    .replace(/[\s\p{P}\p{S}\u00ad\u200b]/gu, '')

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
  const missing = expectedCredits.filter((credit) => !actual.includes(comparable(credit)))
  return {
    ok: missing.length === 0,
    items: [
      {
        ok: missing.length === 0,
        text: missing.length
          ? `Faltan ${missing.length} crédito(s) de imágenes en el contenido del archivo final. Pon este texto visible bajo la foto correspondiente, en su misma página o lámina: ${missing.map((credit) => `«${credit}»`).join('; ')}.`
          : `Los ${expectedCredits.length} crédito(s) de imágenes están en el contenido del archivo final; revisa su legibilidad en las páginas.`
      }
    ]
  }
}
