/**
 * Negritas del Excel. SheetJS CE lee el relleno de cada celda pero NO su fuente (la negrita no llega en `cell.s`), así que se lee aparte:
 * `wb.Styles` dice qué estilos de celda usan una fuente en negrita y el XML de cada hoja dice qué estilo tiene cada celda.
 * Módulo PURO (solo texto y objetos de SheetJS): nunca ejecuta nada del libro.
 */
import type { WorkBook } from 'xlsx'

type FileLike = { content?: unknown } | undefined

/** Celdas en negrita por nombre de hoja; cada celda es `"fila,columna"` (0-based). */
export type BoldCells = Map<string, Set<string>>

function textOf(file: FileLike): string {
  const c = file?.content
  if (typeof c === 'string') return c
  if (c instanceof Uint8Array) return new TextDecoder().decode(c)
  return ''
}

function unescapeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag)
  return m ? m[1] : undefined
}

/** `"B3"` → `[fila 2, columna 1]` (0-based). */
function cellRef(ref: string): [number, number] | null {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)
  if (!m) return null
  let col = 0
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64)
  return [Number(m[2]) - 1, col - 1]
}

export function boldCellsOf(wb: WorkBook): BoldCells {
  const out: BoldCells = new Map()
  const files = (wb as unknown as { files?: Record<string, FileLike> }).files
  const styles = (wb as unknown as { Styles?: unknown }).Styles as { Fonts?: Array<{ bold?: unknown }>; CellXf?: Array<{ fontId?: number }> } | undefined
  if (!files || !styles?.Fonts || !styles.CellXf) return out
  const boldXf = new Set<number>()
  styles.CellXf.forEach((xf, i) => {
    const font = styles.Fonts?.[xf.fontId ?? 0]
    if (font && font.bold && String(font.bold) !== '0') boldXf.add(i)
  })
  if (boldXf.size === 0) return out

  const rels = new Map<string, string>()
  for (const m of textOf(files['xl/_rels/workbook.xml.rels']).matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id')
    const target = attr(m[0], 'Target')
    if (id && target) rels.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`)
  }
  for (const m of textOf(files['xl/workbook.xml']).matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], 'name')
    const rid = attr(m[0], 'r:id')
    const path = rid ? rels.get(rid) : undefined
    if (!name || !path) continue
    const xml = textOf(files[path])
    const cells = new Set<string>()
    for (const c of xml.matchAll(/<c\b[^>]*>/g)) {
      const s = attr(c[0], 's')
      if (s === undefined || !boldXf.has(Number(s))) continue
      const ref = cellRef(attr(c[0], 'r') ?? '')
      if (ref) cells.add(`${ref[0]},${ref[1]}`)
    }
    if (cells.size > 0) out.set(unescapeXml(name), cells)
  }
  return out
}
