import { OFFICE_MAX_SLIDES } from '@shared/attach-office'
import { t } from '@shared/i18n'
import { cleanLine, mdCell, mdTableLines, Out } from './markdown'
import { attr, child, childrenOf, findAllDeep, findDeep, parseXml, plainText, XmlError, type XNode } from './xml'
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

const SKIP_PLACEHOLDERS = new Set(['sldNum', 'dt', 'ftr', 'hdr'])
const TITLE_PLACEHOLDERS = new Set(['title', 'ctrTitle'])

/** Texto de un párrafo de DrawingML (`a:p`). */
function paraText(p: XNode): string {
  let s = ''
  for (const c of p.children) {
    if (c.name === 'a:r' || c.name === 'a:fld') {
      const tt = child(c, 'a:t')
      if (tt) s += plainText(tt)
    } else if (c.name === 'a:br') s += ' '
  }
  return cleanLine(s)
}

function textBodyLines(body: XNode | undefined): string[] {
  const lines: string[] = []
  for (const p of childrenOf(body, 'a:p')) {
    const text = paraText(p)
    if (!text) continue
    const lvl = parseInt(attr(child(p, 'a:pPr'), 'lvl') ?? '0', 10) || 0
    lines.push(`${'  '.repeat(Math.min(5, lvl))}- ${text}`)
  }
  return lines
}

interface SlideContent {
  title: string
  lines: string[]
  tables: string[][]
}

function walkShapes(tree: XNode, into: SlideContent, notes: boolean): void {
  for (const c of tree.children) {
    if (c.name === 'p:grpSp') {
      walkShapes(c, into, notes)
    } else if (c.name === 'p:sp') {
      const ph = child(child(child(c, 'p:nvSpPr'), 'p:nvPr'), 'p:ph')
      const phType = attr(ph, 'type')
      if (phType && SKIP_PLACEHOLDERS.has(phType)) continue
      // En la página de notas solo cuenta el cuerpo (el otro marcador es la miniatura de la diapositiva).
      if (notes && phType !== 'body') continue
      const body = child(c, 'p:txBody')
      if (!notes && phType && TITLE_PLACEHOLDERS.has(phType)) {
        const title = childrenOf(body, 'a:p').map(paraText).filter(Boolean).join(' ')
        if (title && !into.title) into.title = title
        continue
      }
      into.lines.push(...textBodyLines(body))
    } else if (c.name === 'p:graphicFrame') {
      for (const tbl of findAllDeep(c, 'a:tbl')) {
        const rows: string[][] = []
        for (const tr of childrenOf(tbl, 'a:tr')) {
          rows.push(
            childrenOf(tr, 'a:tc').map((tc) => mdCell(childrenOf(child(tc, 'a:txBody'), 'a:p').map(paraText).filter(Boolean).join(' ')))
          )
        }
        if (rows.length) into.tables.push(mdTableLines(rows))
      }
    }
  }
}

function readSlide(xml: string, notes: boolean): SlideContent {
  const root = parse(xml)
  const tree = findDeep(root, 'p:spTree')
  const content: SlideContent = { title: '', lines: [], tables: [] }
  if (tree) walkShapes(tree, content, notes)
  return content
}

function relsMap(xml: string | null): Map<string, { target: string; type: string }> {
  const map = new Map<string, { target: string; type: string }>()
  if (!xml) return map
  for (const r of findAllDeep(parse(xml), 'Relationship')) {
    const id = attr(r, 'Id')
    const target = attr(r, 'Target')
    if (id && target && attr(r, 'TargetMode') !== 'External') map.set(id, { target, type: attr(r, 'Type') ?? '' })
  }
  return map
}

/** Resuelve un `Target` relativo ("../notesSlides/n.xml") desde la carpeta de la parte que lo cita. */
function resolvePart(fromDir: string, target: string): string {
  const parts = (target.startsWith('/') ? target.slice(1) : `${fromDir}/${target}`).split('/')
  const stack: string[] = []
  for (const p of parts) {
    if (p === '..') stack.pop()
    else if (p && p !== '.') stack.push(p)
  }
  return stack.join('/')
}

async function slideOrder(zip: Zip): Promise<string[]> {
  const pres = await zip.text('ppt/presentation.xml')
  const rels = relsMap(await zip.text('ppt/_rels/presentation.xml.rels'))
  const ordered: string[] = []
  if (pres) {
    for (const s of findAllDeep(parse(pres), 'p:sldId')) {
      const rid = attr(s, 'r:id')
      const rel = rid ? rels.get(rid) : undefined
      if (rel) ordered.push(resolvePart('ppt', rel.target))
    }
  }
  if (ordered.length > 0) return ordered.filter((n) => zip.has(n))
  return zip
    .names()
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.replace(/\D+/g, ''), 10) - parseInt(b.replace(/\D+/g, ''), 10))
}

/** PowerPoint (.pptx / .pptm): diapositiva por diapositiva con título, texto, tablas y notas del orador. */
export async function extractPptx(zip: Zip): Promise<Extracted> {
  const slides = await slideOrder(zip)
  if (slides.length === 0) throw new ExtractError('corrupt')
  const out = new Out()
  const notes: string[] = []
  const shown = Math.min(slides.length, OFFICE_MAX_SLIDES)
  let written = 0
  for (let i = 0; i < shown; i++) {
    const path = slides[i]
    const xml = await zip.text(path)
    if (!xml) continue
    const slide = readSlide(xml, false)
    let speaker: string[] = []
    const dir = path.slice(0, path.lastIndexOf('/'))
    const relsPath = `${dir}/_rels/${path.slice(path.lastIndexOf('/') + 1)}.rels`
    const rels = relsMap(await zip.text(relsPath))
    for (const r of rels.values()) {
      if (/\/notesSlide$/.test(r.type)) {
        const nx = await zip.text(resolvePart(dir, r.target))
        if (nx) speaker = readSlide(nx, true).lines.map((l) => l.replace(/^\s*- /, ''))
      }
    }
    const heading = `## ${t('attach.office.slide', { n: i + 1 })}${slide.title ? `: ${slide.title}` : ''}`
    if (i > 0 && !out.add('')) break
    if (!out.add(heading)) break
    for (const l of slide.lines) if (!out.add(l)) break
    for (const tbl of slide.tables) {
      if (!out.add('')) break
      for (const l of tbl) if (!out.add(l)) break
    }
    if (speaker.length && !out.full) {
      out.add('')
      out.add(`${t('attach.office.speakerNotes')}: ${speaker.join(' ')}`)
    }
    if (out.full) break
    written = i + 1
  }
  if (!out.full) written = shown
  if (written < slides.length) notes.push(t('attach.office.note.slides', { shown: written, total: slides.length }))
  return { body: out.toString(), units: slides.length, notes, truncated: out.truncated }
}
