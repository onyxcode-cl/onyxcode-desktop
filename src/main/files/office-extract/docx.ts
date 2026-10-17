import { t } from '@shared/i18n'
import { cleanLine, mdCell, mdTableLines, Out } from './markdown'
import { attr, child, childrenOf, findDeep, parseXml, plainText, XmlError, type XNode } from './xml'
import { ExtractError, type Zip } from './zip'
import type { Extracted } from './types'

const MAX_TABLE_ROWS = 2000

function parse(xml: string): XNode {
  try {
    return parseXml(xml)
  } catch (e) {
    if (e instanceof XmlError) throw new ExtractError('corrupt')
    throw e
  }
}

/** ids de estilo → nombre del estilo (en `styles.xml` los integrados se guardan en inglés: «heading 1», «Title»). */
function styleNames(styles: XNode | null): Map<string, string> {
  const map = new Map<string, string>()
  if (!styles) return map
  const root = findDeep(styles, 'w:styles')
  for (const s of childrenOf(root, 'w:style')) {
    const id = attr(s, 'w:styleId')
    const name = attr(child(s, 'w:name'), 'w:val')
    if (id && name) map.set(id, name.toLowerCase())
  }
  return map
}

interface Ctx {
  styles: Map<string, string>
  footnotes: Map<string, string>
  /** Notas al pie / finales referenciadas, en orden de aparición. */
  noteOrder: string[]
  textboxes: string[]
}

function headingLevel(p: XNode, ctx: Ctx): number {
  const pPr = child(p, 'w:pPr')
  const styleId = attr(child(pPr, 'w:pStyle'), 'w:val')
  const name = styleId ? (ctx.styles.get(styleId) ?? styleId.toLowerCase()) : ''
  if (name === 'title') return 1
  if (name === 'subtitle') return 2
  const m = /^(?:heading|titulo|título|ttulo)\s*(\d)$/.exec(name)
  if (m) return Math.min(6, Math.max(1, parseInt(m[1], 10)))
  const outline = attr(child(pPr, 'w:outlineLvl'), 'w:val')
  if (outline !== undefined && /^[0-8]$/.test(outline)) return Math.min(6, parseInt(outline, 10) + 1)
  return 0
}

/** Texto en línea de un párrafo: runs, vínculos (solo su texto), cambios aceptados, cuadros de texto aparte. */
function inline(node: XNode, ctx: Ctx): string {
  let s = ''
  for (const c of node.children) {
    switch (c.name) {
      case 'w:r':
        s += inline(c, ctx)
        break
      case 'w:t':
        s += plainText(c)
        break
      case 'w:tab':
        s += ' '
        break
      case 'w:br':
      case 'w:cr':
        s += ' '
        break
      case 'w:noBreakHyphen':
        s += '-'
        break
      case 'w:footnoteReference':
      case 'w:endnoteReference': {
        const id = attr(c, 'w:id')
        if (id && ctx.footnotes.has(id)) {
          if (!ctx.noteOrder.includes(id)) ctx.noteOrder.push(id)
          s += `[^${ctx.noteOrder.indexOf(id) + 1}]`
        }
        break
      }
      case 'w:del':
      case 'w:delText':
      case 'w:instrText':
      case 'w:pPr':
      case 'w:rPr':
        break
      case 'mc:AlternateContent': {
        const choice = child(c, 'mc:Choice') ?? child(c, 'mc:Fallback')
        if (choice) s += inline(choice, ctx)
        break
      }
      case 'w:txbxContent':
        for (const p of blocks(c, ctx)) if (p.trim()) ctx.textboxes.push(p)
        break
      default:
        if (c.children.length) s += inline(c, ctx)
    }
  }
  return s
}

function paragraphLine(p: XNode, ctx: Ctx): string {
  const text = cleanLine(inline(p, ctx))
  if (!text) return ''
  const level = headingLevel(p, ctx)
  if (level > 0) return `${'#'.repeat(level)} ${text}`
  const numPr = child(child(p, 'w:pPr'), 'w:numPr')
  if (numPr && attr(child(numPr, 'w:numId'), 'w:val') !== '0') {
    const lvl = Math.min(6, parseInt(attr(child(numPr, 'w:ilvl'), 'w:val') ?? '0', 10) || 0)
    return `${'  '.repeat(lvl)}- ${text}`
  }
  return text
}

function tableLines(tbl: XNode, ctx: Ctx): string[] {
  const rows: string[][] = []
  for (const tr of childrenOf(tbl, 'w:tr')) {
    if (rows.length >= MAX_TABLE_ROWS) break
    const cells: string[] = []
    for (const tc of childrenOf(tr, 'w:tc')) {
      const parts = blocks(tc, ctx).filter((x) => x.trim())
      cells.push(mdCell(parts.join(' ')))
    }
    if (cells.length) rows.push(cells)
  }
  return mdTableLines(rows)
}

/** Bloques de un contenedor (cuerpo, celda, cuadro de texto): cada elemento es un párrafo o una tabla ya en Markdown. */
function blocks(container: XNode, ctx: Ctx): string[] {
  const out: string[] = []
  for (const c of container.children) {
    if (c.name === 'w:p') {
      const line = paragraphLine(c, ctx)
      out.push(line)
    } else if (c.name === 'w:tbl') {
      out.push(tableLines(c, ctx).join('\n'))
    } else if (c.name === 'w:sdt') {
      const content = child(c, 'w:sdtContent')
      if (content) out.push(...blocks(content, ctx))
    } else if (c.name === 'w:ins' || c.name === 'w:customXml') {
      out.push(...blocks(c, ctx))
    }
  }
  return out
}

async function notesMap(zip: Zip, part: string, tag: string): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const xml = await zip.text(part)
  if (!xml) return map
  const root = parse(xml)
  for (const n of findAllShallow(root, tag)) {
    const type = attr(n, 'w:type')
    if (type === 'separator' || type === 'continuationSeparator' || type === 'continuationNotice') continue
    const id = attr(n, 'w:id')
    if (!id) continue
    const lines = blocks(n, { styles: new Map(), footnotes: new Map(), noteOrder: [], textboxes: [] })
      .map((l) => cleanLine(l))
      .filter(Boolean)
    if (lines.length) map.set(id, lines.join(' '))
  }
  return map
}

function findAllShallow(root: XNode, tag: string): XNode[] {
  const wrapper = tag === 'w:footnote' ? 'w:footnotes' : 'w:endnotes'
  return childrenOf(findDeep(root, wrapper), tag)
}

/** Word (.docx / .docm): títulos, párrafos, listas, tablas en Markdown, cuadros de texto y notas al pie. Nunca toca macros. */
export async function extractDocx(zip: Zip): Promise<Extracted> {
  const docXml = await zip.text('word/document.xml')
  if (!docXml) throw new ExtractError('corrupt')
  const doc = parse(docXml)
  const body = findDeep(doc, 'w:body')
  if (!body) throw new ExtractError('corrupt')

  const stylesXml = await zip.text('word/styles.xml')
  const footnotes = await notesMap(zip, 'word/footnotes.xml', 'w:footnote')
  for (const [k, v] of await notesMap(zip, 'word/endnotes.xml', 'w:endnote')) footnotes.set(k, v)
  const ctx: Ctx = {
    styles: styleNames(stylesXml ? parse(stylesXml) : null),
    footnotes,
    noteOrder: [],
    textboxes: []
  }

  const out = new Out()
  for (const b of blocks(body, ctx)) {
    if (!b) continue
    // Línea en blanco entre párrafos para que el Markdown separe bloques; las listas consecutivas van juntas.
    const isList = /^\s*- /.test(b)
    const prev = out.lines[out.lines.length - 1]
    if (prev !== undefined && prev !== '' && !(isList && /^\s*- /.test(prev)) && !out.add('')) break
    if (!out.add(b)) break
  }
  if (!out.full && ctx.textboxes.length) {
    out.add('')
    out.add(`## ${t('attach.office.textboxes')}`)
    for (const tb of ctx.textboxes) if (!out.add(`- ${cleanLine(tb)}`)) break
  }
  if (!out.full && ctx.noteOrder.length) {
    out.add('')
    out.add(`## ${t('attach.office.footnotes')}`)
    ctx.noteOrder.forEach((id, i) => {
      out.add(`[^${i + 1}]: ${ctx.footnotes.get(id) ?? ''}`)
    })
  }

  let pages: number | null = null
  const app = await zip.text('docProps/app.xml')
  if (app) {
    const m = /<Pages>\s*(\d+)\s*<\/Pages>/.exec(app)
    if (m) pages = parseInt(m[1], 10) || null
  }
  return { body: out.toString(), units: pages, notes: [], truncated: out.truncated }
}
