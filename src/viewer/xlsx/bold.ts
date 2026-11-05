/**
 * Negritas del Excel. SheetJS CE lee el relleno de cada celda pero NO su fuente (la negrita no llega en `cell.s`), así que se lee aparte:
 * qué estilos de celda (`cellXfs` → `fontId` → `<b/>`) usan una fuente en negrita, y qué celdas de cada hoja usan esos estilos o traen
 * texto enriquecido (`<r><rPr><b/>`) todo en negrita, tanto en `sharedStrings.xml` como en cadenas dentro de la propia hoja.
 *
 * Como en Excel, una celda que ya existe en la hoja sin atributo `s` usa el estilo 0: la negrita puesta a una columna o a una fila entera
 * solo vale para las celdas que no existen todavía, así que no se «hereda» a las que sí están.
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
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Valor de un atributo; acepta que el nombre lleve prefijo de espacio de nombres (`r:id`, `x:id`…) cuando se pide sin él. */
function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)(?:[\\w.-]+:)?${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag)
  return m ? (m[1] ?? m[2]) : undefined
}

/** `"B3"` → `[fila 2, columna 1]` (0-based). */
function cellRef(ref: string): [number, number] | null {
  const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(ref.trim())
  if (!m) return null
  let col = 0
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64)
  return [Number(m[2]) - 1, col - 1]
}

/** Un `<b/>`, `<b val="1"/>` o `<b val="true"/>` dentro de un trozo de propiedades de fuente (y no `<b val="0"/>`/`false`). */
export function hasBoldTag(xml: string): boolean {
  const m = /<(?:\w+:)?b(?=[\s/>])([^>]*)>/.exec(xml)
  if (!m) return false
  const v = attr(m[1], 'val')
  return v === undefined || !/^(0|false)$/i.test(v)
}

/**
 * `true` si el texto enriquecido es todo en negrita (cada trozo con texto trae `<b/>`). Si solo una parte lo está no se marca la celda
 * entera: se vería más gruesa de lo que es.
 */
function allRunsBold(si: string): boolean {
  const runs = [...si.matchAll(/<(?:\w+:)?r\b[^>]*>([\s\S]*?)<\/(?:\w+:)?r>/g)]
  if (runs.length === 0) return false
  let any = false
  for (const r of runs) {
    const text = [...r[1].matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((t) => t[1]).join('')
    if (text === '') continue
    any = true
    const props = /<(?:\w+:)?rPr\b[^>]*>([\s\S]*?)<\/(?:\w+:)?rPr>/.exec(r[1])
    if (!props || !hasBoldTag(props[1])) return false
  }
  return any
}

/** Índices de `sharedStrings.xml` cuyo texto enriquecido es todo en negrita. */
function boldSharedStrings(xml: string): Set<number> {
  const out = new Set<number>()
  let i = 0
  for (const m of xml.matchAll(/<(?:\w+:)?si\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?si>)/g)) {
    if (m[1] && allRunsBold(m[1])) out.add(i)
    i++
  }
  return out
}

/** Índices de `cellXfs` cuya fuente (`fontId` → `<fonts>`) está en negrita, leídos del propio `styles.xml`. */
function boldCellXfs(stylesXml: string): Set<number> {
  const out = new Set<number>()
  const fontsBlock = /<(?:\w+:)?fonts\b[^>]*>([\s\S]*?)<\/(?:\w+:)?fonts>/.exec(stylesXml)?.[1] ?? ''
  const fonts = [...fontsBlock.matchAll(/<(?:\w+:)?font\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?font>)/g)].map((m) => hasBoldTag(m[1] ?? ''))
  const xfsBlock = /<(?:\w+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:\w+:)?cellXfs>/.exec(stylesXml)?.[1] ?? ''
  let i = 0
  for (const m of xfsBlock.matchAll(/<(?:\w+:)?xf\b[^>]*>/g)) {
    if (fonts[Number(attr(m[0], 'fontId') ?? 0)]) out.add(i)
    i++
  }
  return out
}

/** Ruta (dentro del .xlsx) de cada hoja por nombre, siguiendo `workbook.xml` → `workbook.xml.rels`. */
function sheetPaths(files: Record<string, FileLike>): Map<string, string> {
  const rels = new Map<string, string>()
  for (const m of textOf(files['xl/_rels/workbook.xml.rels']).matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id')
    const target = attr(m[0], 'Target')
    if (id && target) rels.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`)
  }
  const out = new Map<string, string>()
  for (const m of textOf(files['xl/workbook.xml']).matchAll(/<(?:\w+:)?sheet\b[^>]*>/g)) {
    const name = attr(m[0], 'name')
    const rid = attr(m[0], 'id')
    const path = rid ? rels.get(rid) : undefined
    if (name && path) out.set(unescapeXml(name), path)
  }
  return out
}

export function boldCellsOf(wb: WorkBook): BoldCells {
  const out: BoldCells = new Map()
  const files = (wb as unknown as { files?: Record<string, FileLike> }).files
  if (!files) return out
  const boldXf = boldCellXfs(textOf(files['xl/styles.xml']))
  const boldStrings = boldSharedStrings(textOf(files['xl/sharedStrings.xml']))
  if (boldXf.size === 0 && boldStrings.size === 0) return out

  for (const [name, path] of sheetPaths(files)) {
    const xml = textOf(files[path])
    const cells = new Set<string>()
    for (const c of xml.matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const ref = cellRef(attr(c[1], 'r') ?? '')
      if (!ref) continue
      const s = attr(c[1], 's')
      let bold = s !== undefined && boldXf.has(Number(s))
      if (!bold && c[2]) {
        const body = c[2]
        if (attr(c[1], 't') === 's') {
          const v = /<(?:\w+:)?v>\s*(\d+)\s*<\/(?:\w+:)?v>/.exec(body)
          bold = !!v && boldStrings.has(Number(v[1]))
        } else if (attr(c[1], 't') === 'inlineStr') bold = allRunsBold(body)
      }
      if (bold) cells.add(`${ref[0]},${ref[1]}`)
    }
    if (cells.size > 0) out.set(name, cells)
  }
  return out
}
