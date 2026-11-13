import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import JSZip from 'jszip'
import { JSDOM } from 'jsdom'

export const METRIC_VERSION = 'visual-structure-v1'
const xml = (s) => new JSDOM(s, { contentType: 'text/xml' }).window.document
const nodes = (root, name) => [...root.getElementsByTagNameNS('*', name)]
const first = (root, name) => nodes(root, name)[0]
const attr = (el, name, fallback = '') => el?.getAttribute(name) ?? el?.getAttribute('w:' + name) ?? fallback
const number = (el, name, fallback = 0) => Number(attr(el, name, String(fallback)))
const round = (v) => Math.round(v * 10000) / 10000
const counts = (values) => values.reduce((out, x) => (x ? ((out[x] = (out[x] ?? 0) + 1), out) : out), {})
const fontName = (s) =>
  s
    .trim()
    .replace(/^[A-Z]{6}\+/, '')
    .toLowerCase()
const hashless = (s) => (/^[0-9a-f]{6}$/i.test(s ?? '') ? s.toUpperCase() : null)
const canonical = (page) =>
  page
    .map((b) => `${b.kind}:${[b.x, b.y, b.w, b.h].map((v) => Math.round(v * 40)).join(',')}`)
    .sort()
    .join('|')

async function entry(zip, name) {
  return zip.file(name) ? zip.file(name).async('string') : ''
}

/** No text or word count enters a fingerprint: changing words alone must not count as redesign. */
export async function pptxFingerprint(bytes) {
  const zip = await JSZip.loadAsync(bytes)
  const presentation = xml(await entry(zip, 'ppt/presentation.xml'))
  const size = first(presentation, 'sldSz')
  const width = number(size, 'cx', 12192000),
    height = number(size, 'cy', 6858000)
  const rels = xml(await entry(zip, 'ppt/_rels/presentation.xml.rels'))
  const targets = new Map(nodes(rels, 'Relationship').map((r) => [attr(r, 'Id'), attr(r, 'Target')]))
  const files = nodes(presentation, 'sldId')
    .map((id) => targets.get(attr(id, 'r:id')))
    .filter(Boolean)
    .map((path) => (path.startsWith('/') ? path.slice(1) : 'ppt/' + path))
  if (!files.length) throw new Error('PPTX sin secuencia de láminas')
  const theme = xml((await entry(zip, 'ppt/theme/theme1.xml')) || '<theme/>')
  const schemes = Object.fromEntries(
    [...(first(theme, 'clrScheme')?.children ?? [])].map((el) => [
      el.localName,
      attr(first(el, 'srgbClr'), 'val') || attr(first(el, 'sysClr'), 'lastClr')
    ])
  )
  const major = attr(first(first(theme, 'majorFont') ?? theme, 'latin'), 'typeface', 'Arial')
  const minor = attr(first(first(theme, 'minorFont') ?? theme, 'latin'), 'typeface', 'Arial')
  const aliases = { tx1: 'dk1', tx2: 'dk2', bg1: 'lt1', bg2: 'lt2' }
  const colors = [],
    fonts = [],
    pages = []
  for (const name of files) {
    const doc = xml(await entry(zip, name))
    colors.push(...nodes(doc, 'srgbClr').map((e) => hashless(attr(e, 'val'))))
    colors.push(...nodes(doc, 'schemeClr').map((e) => hashless(schemes[aliases[attr(e, 'val')] ?? attr(e, 'val')])))
    const page = []
    function walk(root, transform = { x: 0, y: 0, sx: 1, sy: 1 }) {
      for (const el of root?.children ?? []) {
        if (el.localName === 'grpSp') {
          const xf = first(el, 'xfrm'),
            off = first(xf ?? el, 'off'),
            ext = first(xf ?? el, 'ext')
          const childOff = first(xf ?? el, 'chOff'),
            childExt = first(xf ?? el, 'chExt')
          const sx = number(ext, 'cx', 1) / (number(childExt, 'cx', 1) || 1)
          const sy = number(ext, 'cy', 1) / (number(childExt, 'cy', 1) || 1)
          walk(el, {
            x: transform.x + transform.sx * (number(off, 'x') - number(childOff, 'x') * sx),
            y: transform.y + transform.sy * (number(off, 'y') - number(childOff, 'y') * sy),
            sx: transform.sx * sx,
            sy: transform.sy * sy
          })
          continue
        }
        if (!['sp', 'pic', 'graphicFrame', 'cxnSp'].includes(el.localName)) continue
        const xf = first(el, 'xfrm'),
          off = first(xf ?? el, 'off'),
          ext = first(xf ?? el, 'ext')
        if (!off || !ext) continue // Master placeholders without local geometry: reported in coverage below.
        const kind =
          el.localName === 'pic'
            ? 'image'
            : first(el, 'tbl')
              ? 'table'
              : first(el, 'chart')
                ? 'chart'
                : nodes(el, 't').length
                  ? 'text'
                  : 'shape'
        page.push({
          kind,
          x: round((transform.x + number(off, 'x') * transform.sx) / width),
          y: round((transform.y + number(off, 'y') * transform.sy) / height),
          w: round((number(ext, 'cx') * transform.sx) / width),
          h: round((number(ext, 'cy') * transform.sy) / height)
        })
        if (kind === 'text' || kind === 'table') {
          const explicit = nodes(el, 'latin')
            .map((e) => attr(e, 'typeface'))
            .filter(Boolean)
          fonts.push(
            ...(explicit.length ? explicit : [attr(first(el, 'ph'), 'type') === 'title' ? major : minor]).map((f) =>
              fontName(f === '+mj-lt' ? major : f === '+mn-lt' ? minor : f)
            )
          )
        }
      }
    }
    walk(first(doc, 'spTree'))
    pages.push(page)
  }
  return {
    format: 'pptx',
    source: 'final-ooxml',
    palette: counts(colors),
    fonts: counts(fonts),
    pages,
    sequence: pages.map(canonical),
    coverage: 'Geometría explícita de objetos y grupos; no calcula posiciones heredadas del patrón ni recortes o sombras.'
  }
}

export async function docxFingerprint(bytes) {
  const zip = await JSZip.loadAsync(bytes)
  const doc = xml(await entry(zip, 'word/document.xml'))
  const styleText = await entry(zip, 'word/styles.xml')
  const styles = xml(styleText || '<styles/>')
  const pageSize = first(doc, 'pgSz'),
    margins = first(doc, 'pgMar')
  const width = number(pageSize, 'w', 12240),
    height = number(pageSize, 'h', 15840)
  const usable = width - number(margins, 'left', 1440) - number(margins, 'right', 1440)
  const colors = [],
    fonts = [],
    blocks = []
  const styleById = new Map(nodes(styles, 'style').map((s) => [attr(s, 'styleId'), s]))
  const defaults = first(styles, 'docDefaults')
  function styleChain(el) {
    const out = [el],
      visited = new Set()
    let id = attr(first(el, 'pStyle'), 'val') || attr(first(el, 'tblStyle'), 'val') || 'Normal'
    while (id && !visited.has(id)) {
      visited.add(id)
      const style = styleById.get(id)
      if (!style) break
      out.push(style)
      id = attr(first(style, 'basedOn'), 'val')
    }
    if (defaults) out.push(defaults)
    return out
  }
  const property = (chain, tag) => chain.map((el) => first(el, tag)).find(Boolean)
  let y = 0
  const body = first(doc, 'body')
  for (const el of body?.children ?? []) {
    if (!['p', 'tbl'].includes(el.localName)) continue
    const chain = styleChain(el)
    const color = property(chain, 'color'),
      shading = property(chain, 'shd'),
      font = property(chain, 'rFonts')
    colors.push(hashless(attr(color, 'val')), hashless(attr(shading, 'fill')))
    // Cell/run overrides belong to the actual document, even if its style has another default.
    colors.push(...nodes(el, 'color').map((e) => hashless(attr(e, 'val'))), ...nodes(el, 'shd').map((e) => hashless(attr(e, 'fill'))))
    fonts.push(fontName(attr(font, 'ascii') || attr(font, 'hAnsi') || 'unknown'))
    fonts.push(
      ...nodes(el, 'rFonts')
        .map((e) => fontName(attr(e, 'ascii') || attr(e, 'hAnsi')))
        .filter(Boolean)
    )
    const spacing = property(chain, 'spacing'),
      indent = property(chain, 'ind'),
      size = number(property(chain, 'sz'), 'val', 22)
    const rows = el.localName === 'tbl' ? nodes(el, 'tr').length : 1
    const kind =
      el.localName === 'tbl'
        ? 'table'
        : first(el, 'drawing')
          ? 'image'
          : first(el, 'numPr')
            ? 'list'
            : /heading|title/i.test(attr(first(el, 'pStyle'), 'val'))
              ? 'heading'
              : 'paragraph'
    const tableWidth = first(el, 'tblW')
    const w =
      kind === 'table' && attr(tableWidth, 'type') === 'dxa'
        ? number(tableWidth, 'w', usable)
        : usable - number(indent, 'left') - number(indent, 'right')
    // Flow proxy, independent of the words and line wrapping; NOT rendered pagination.
    const h = number(spacing, 'before') + number(spacing, 'after') + Math.max(240, size * 10) * rows
    blocks.push({
      kind,
      x: round((number(margins, 'left', 1440) + number(indent, 'left')) / width),
      y: round(y / height),
      w: round(w / width),
      h: round(h / height)
    })
    y += h
  }
  return {
    format: 'docx',
    source: 'final-ooxml-flow',
    palette: counts(colors),
    fonts: counts(fonts),
    pages: [blocks],
    sequence: blocks.map(canonicalBlock),
    coverage:
      'Flujo semántico, tamaños, anchos y espacios declarados; NO son coordenadas paginadas de Word. Requiere revisión Office para cortes y saltos.'
  }
}
function canonicalBlock(block) {
  return canonical([block])
}

/** Poppler preserves page coordinates and fonts; text itself is deliberately discarded. */
export function pdfLayoutFingerprint(text) {
  const doc = xml(text),
    pages = [],
    fonts = [],
    colors = []
  for (const page of nodes(doc, 'page')) {
    const width = number(page, 'width'),
      height = number(page, 'height')
    if (!(width > 0 && height > 0)) throw new Error('PDF XML sin tamaño de página')
    const specs = new Map(nodes(page, 'fontspec').map((f) => [attr(f, 'id'), f]))
    const blocks = []
    for (const el of [...nodes(page, 'text'), ...nodes(page, 'image')]) {
      const f = specs.get(attr(el, 'font'))
      if (f) {
        fonts.push(fontName(attr(f, 'family')))
        colors.push(hashless(attr(f, 'color').replace('#', '')))
      }
      blocks.push({
        kind: el.localName === 'image' ? 'image' : 'text',
        x: round(number(el, 'left') / width),
        y: round(number(el, 'top') / height),
        w: round(number(el, 'width') / width),
        h: round(number(el, 'height') / height)
      })
    }
    pages.push(blocks)
  }
  if (!pages.length) throw new Error('No hay páginas en el XML de Poppler')
  return {
    format: 'pdf',
    source: 'final-pdf-poppler',
    palette: counts(colors),
    fonts: counts(fonts),
    pages,
    sequence: pages.map(canonical),
    coverage:
      'Texto de Poppler (la ejecución usa -i, sin extraer imágenes); la paleta no incluye fondos ni figuras vectoriales. Los anchos de texto dependen de la tipografía y del contenido.'
  }
}

export async function fingerprint(file, format, { pdftohtml = 'pdftohtml' } = {}) {
  if (format === 'pptx') return pptxFingerprint(await readFile(file))
  if (format === 'docx') return docxFingerprint(await readFile(file))
  if (format === 'pdf-layout') return { ...pdfLayoutFingerprint(await readFile(file, 'utf8')), source: 'synthetic-pdf-layout-fixture' }
  if (format === 'pdf') {
    const result = spawnSync(pdftohtml, ['-xml', '-hidden', '-i', '-stdout', file], {
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 32 * 1024 * 1024
    })
    if (result.error || result.status !== 0)
      throw new Error('Se requiere pdftohtml (Poppler) para medir el PDF: ' + (result.error?.message ?? result.stderr?.slice(0, 200)))
    return pdfLayoutFingerprint(result.stdout)
  }
  throw new Error(`Formato no medible: ${format}`)
}

function weightedJaccard(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  if (!keys.size) return null
  const totalA = Object.values(a).reduce((n, x) => n + x, 0) || 1,
    totalB = Object.values(b).reduce((n, x) => n + x, 0) || 1
  let intersection = 0,
    union = 0
  for (const key of keys) {
    const x = (a[key] ?? 0) / totalA,
      y = (b[key] ?? 0) / totalB
    intersection += Math.min(x, y)
    union += Math.max(x, y)
  }
  return union ? intersection / union : null
}
function pageSimilarity(a, b) {
  if (!a.length && !b.length) return null
  const remaining = new Set(b.map((_, i) => i))
  let sum = 0
  for (const x of a) {
    let best = -1,
      score = 0
    for (const i of remaining) {
      const y = b[i]
      const value =
        x.kind === y.kind
          ? Math.max(0, 1 - (Math.abs(x.x - y.x) + Math.abs(x.y - y.y) + Math.abs(x.w - y.w) + Math.abs(x.h - y.h)) / 0.8)
          : 0
      if (value > score) {
        best = i
        score = value
      }
    }
    if (best !== -1) {
      remaining.delete(best)
      sum += score
    }
  }
  return sum / Math.max(a.length, b.length)
}
function lcs(a, b) {
  let previous = Array(b.length + 1).fill(0)
  for (const x of a) {
    const row = [0]
    for (let j = 0; j < b.length; j++) row.push(x === b[j] ? previous[j] + 1 : Math.max(previous[j + 1], row[j]))
    previous = row
  }
  return previous[b.length] / Math.max(a.length, b.length, 1)
}
export function compare(a, b) {
  if (a.format !== b.format) throw new Error('Solo se comparan documentos del mismo formato')
  const n = Math.max(a.pages.length, b.pages.length)
  const geometry = n
    ? Array.from({ length: n }, (_, i) => {
        const x = a.pages[i] ?? [],
          y = b.pages[i] ?? []
        // Symmetric nearest-object matching avoids order-of-XML bias.
        return ((pageSimilarity(x, y) ?? 0) + (pageSimilarity(y, x) ?? 0)) / 2
      }).reduce((x, y) => x + y, 0) / n
    : null
  const parts = {
    palette: weightedJaccard(a.palette, b.palette),
    fonts: weightedJaccard(a.fonts, b.fonts),
    geometry,
    sequence: lcs(a.sequence, b.sequence)
  }
  const weights = { palette: 0.2, fonts: 0.15, geometry: 0.45, sequence: 0.2 }
  const present = Object.keys(parts).filter((k) => parts[k] !== null)
  return { ...parts, score: present.reduce((n, k) => n + parts[k] * weights[k], 0) / present.reduce((n, k) => n + weights[k], 0) }
}

export function summarize(documents, threshold = 0.88) {
  const pairs = [],
    byFormat = {}
  for (let i = 0; i < documents.length; i++)
    for (let j = i + 1; j < documents.length; j++) {
      const a = documents[i],
        b = documents[j]
      if (a.topic === b.topic || a.fingerprint.format !== b.fingerprint.format) continue
      const similarity = compare(a.fingerprint, b.fingerprint)
      pairs.push({ a: a.id, b: b.id, format: a.fingerprint.format, ...similarity, nearDuplicate: similarity.score >= threshold })
    }
  for (const format of ['pptx', 'docx', 'pdf']) {
    const group = pairs.filter((p) => p.format === format)
    byFormat[format] = {
      pairs: group.length,
      nearDuplicates: group.filter((p) => p.nearDuplicate).length,
      fraction: group.length ? group.filter((p) => p.nearDuplicate).length / group.length : null
    }
  }
  return {
    metricVersion: METRIC_VERSION,
    threshold,
    calibration: 'Umbral provisional; congelar tras calibración humana ANTES de comparar control y candidato.',
    byFormat,
    pairs
  }
}
