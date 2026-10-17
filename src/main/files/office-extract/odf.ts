import { OFFICE_MAX_SLIDES } from '@shared/attach-office'
import { t } from '@shared/i18n'
import { cleanLine, mdCell, mdTableLines, Out } from './markdown'
import { attr, child, childrenOf, findAllDeep, findDeep, parseXml, XmlError, type XNode } from './xml'
import { ExtractError, type Zip } from './zip'
import type { Extracted } from './types'

function parse(xml: string): XNode {
  try {
    return parseXml(xml)
  } catch (e) {
    if (e instanceof XmlError) throw new ExtractError('corrupt')
    throw e
  }
}

/** ODF cifrado: el manifiesto lleva `encryption-data` y `content.xml` no se puede leer. */
async function assertNotEncrypted(zip: Zip): Promise<void> {
  const manifest = await zip.text('META-INF/manifest.xml')
  if (manifest && /encryption-data/.test(manifest)) throw new ExtractError('encrypted')
}

interface Ctx {
  notes: string[]
}

function inlineText(node: XNode, ctx: Ctx): string {
  let s = ''
  for (const c of node.children) {
    switch (c.name) {
      case '#text':
        s += c.text ?? ''
        break
      case 'text:s':
        s += ' '.repeat(Math.min(20, parseInt(attr(c, 'c') ?? '1', 10) || 1))
        break
      case 'text:tab':
      case 'text:line-break':
        s += ' '
        break
      case 'text:note': {
        const body = child(c, 'text:note-body')
        const text = body ? cleanLine(blocks(body, ctx).join(' ')) : ''
        if (text) {
          ctx.notes.push(text)
          s += `[^${ctx.notes.length}]`
        }
        break
      }
      case 'office:annotation':
      case 'text:note-citation':
        break
      default:
        s += inlineText(c, ctx)
    }
  }
  return s
}

function listLines(list: XNode, ctx: Ctx, depth: number): string[] {
  const out: string[] = []
  for (const item of childrenOf(list, 'text:list-item')) {
    for (const c of item.children) {
      if (c.name === 'text:p' || c.name === 'text:h') {
        const text = cleanLine(inlineText(c, ctx))
        if (text) out.push(`${'  '.repeat(Math.min(6, depth))}- ${text}`)
      } else if (c.name === 'text:list') out.push(...listLines(c, ctx, depth + 1))
    }
  }
  return out
}

function tableLines(tbl: XNode, ctx: Ctx): string[] {
  const rows: string[][] = []
  for (const tr of findAllDeep(tbl, 'table:table-row')) {
    const cells = childrenOf(tr, 'table:table-cell').map((tc) => mdCell(blocks(tc, ctx).join(' ')))
    if (cells.length) rows.push(cells)
    if (rows.length >= 2000) break
  }
  return mdTableLines(rows)
}

/** Bloques de un contenedor ODF (cuerpo, celda, nota): párrafos, títulos, listas y tablas ya en Markdown. */
function blocks(container: XNode, ctx: Ctx): string[] {
  const out: string[] = []
  for (const c of container.children) {
    if (c.name === 'text:h') {
      const text = cleanLine(inlineText(c, ctx))
      const lvl = Math.min(6, Math.max(1, parseInt(attr(c, 'text:outline-level') ?? '1', 10) || 1))
      if (text) out.push(`${'#'.repeat(lvl)} ${text}`)
    } else if (c.name === 'text:p') {
      const text = cleanLine(inlineText(c, ctx))
      if (text) out.push(text)
    } else if (c.name === 'text:list') {
      out.push(...listLines(c, ctx, 0))
    } else if (c.name === 'table:table') {
      out.push(tableLines(c, ctx).join('\n'))
    } else if (c.name === 'text:section' || c.name === 'text:tracked-changes') {
      if (c.name === 'text:section') out.push(...blocks(c, ctx))
    }
  }
  return out
}

async function pageCount(zip: Zip): Promise<number | null> {
  const meta = await zip.text('meta.xml')
  const m = meta ? /page-count="(\d+)"/.exec(meta) : null
  return m ? parseInt(m[1], 10) || null : null
}

/** OpenDocument Texto (.odt). */
export async function extractOdt(zip: Zip): Promise<Extracted> {
  await assertNotEncrypted(zip)
  const xml = await zip.text('content.xml')
  if (!xml) throw new ExtractError('corrupt')
  const textBody = findDeep(parse(xml), 'office:text')
  if (!textBody) throw new ExtractError('corrupt')
  const ctx: Ctx = { notes: [] }
  const out = new Out()
  for (const b of blocks(textBody, ctx)) {
    const isList = /^\s*- /.test(b)
    const prev = out.lines[out.lines.length - 1]
    if (prev !== undefined && prev !== '' && !(isList && /^\s*- /.test(prev)) && !out.add('')) break
    if (!out.add(b)) break
  }
  if (!out.full && ctx.notes.length) {
    out.add('')
    out.add(`## ${t('attach.office.footnotes')}`)
    ctx.notes.forEach((n, i) => out.add(`[^${i + 1}]: ${n}`))
  }
  return { body: out.toString(), units: await pageCount(zip), notes: [], truncated: out.truncated }
}

/** OpenDocument Presentación (.odp): página por página con título, texto, tablas y notas del orador. */
export async function extractOdp(zip: Zip): Promise<Extracted> {
  await assertNotEncrypted(zip)
  const xml = await zip.text('content.xml')
  if (!xml) throw new ExtractError('corrupt')
  const pres = findDeep(parse(xml), 'office:presentation')
  const pages = childrenOf(pres, 'draw:page')
  if (!pres || pages.length === 0) throw new ExtractError('corrupt')
  const ctx: Ctx = { notes: [] }
  const out = new Out()
  const notes: string[] = []
  const shown = Math.min(pages.length, OFFICE_MAX_SLIDES)
  let written = 0
  for (let i = 0; i < shown; i++) {
    const page = pages[i]
    let title = ''
    const lines: string[] = []
    const tables: string[][] = []
    for (const frame of findAllDeep(page, 'draw:frame')) {
      if (frame.name !== 'draw:frame') continue
      const cls = attr(frame, 'presentation:class')
      const box = child(frame, 'draw:text-box')
      if (box) {
        const bl = blocks(box, ctx)
        if (cls === 'title' && !title) title = cleanLine(bl.join(' ').replace(/^#+ /, ''))
        else if (cls !== 'notes') lines.push(...bl.map((l) => (/^\s*- |^#/.test(l) ? l : `- ${l}`)))
      }
      const tbl = child(frame, 'table:table')
      if (tbl) tables.push(tableLines(tbl, ctx))
    }
    const speaker = findDeep(child(page, 'presentation:notes'), 'draw:text-box')
    const speakerText = speaker ? blocks(speaker, ctx).join(' ') : ''
    if (i > 0 && !out.add('')) break
    if (!out.add(`## ${t('attach.office.slide', { n: i + 1 })}${title ? `: ${title}` : ''}`)) break
    for (const l of lines) if (!out.add(l)) break
    for (const tbl of tables) {
      if (!out.add('')) break
      for (const l of tbl) if (!out.add(l)) break
    }
    if (speakerText && !out.full) {
      out.add('')
      out.add(`${t('attach.office.speakerNotes')}: ${speakerText}`)
    }
    if (out.full) break
    written = i + 1
  }
  if (!out.full) written = shown
  if (written < pages.length) notes.push(t('attach.office.note.slides', { shown: written, total: pages.length }))
  return { body: out.toString(), units: pages.length, notes, truncated: out.truncated }
}
