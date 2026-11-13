/**
 * PRUEBA (rama `exp/craft-office-pruebas`): el bloque ```docx del Chat (`DocxSpec`, el MISMO esquema JSON de la skill `docx` de Tareas, sin
 * imágenes) → documento de Word armado con `wordcraft-cli` (WordCraft). Es el port a TypeScript de `build_word_craft.py`; el contenido es
 * DATO (va como valor JSON de cada comando, por stdin del MCP local) y los números de las tablas se formatean es-CL.
 */
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DocxSpec } from '@shared/chat-doc-spec'
import type { ImageMap } from '../../documents/image-files'
import { craftBatch, runCraft } from './craft-run'
import { prepareWordReport, WORD_REPORT } from './word-report-layout'

const ACCENT = '1F3864'
const TH_FG = 'FFFFFF'
const ZEBRA = 'F2F4F8'
const TOTAL = 'E7E9EE'
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*)/
const NUM_RE = /^[\s$€£]*[-+(]?\s*[$€£]?\s*\d[\d.,\s]*%?\)?\s*(CLP|UF|USD|EUR|UTM)?\s*$/

/** «12 de octubre de 2026». */
export function fechaEs(d: Date = new Date()): string {
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`
}

/** Formato es-CL: 1.234,5 (enteros sin decimales; con decimales fijos si se piden; decimales de un número fraccionario: 2 por defecto). */
export function fmtNum(v: number, decimals?: number): string {
  const frac = Number.isInteger(v) ? (decimals ?? 0) : (decimals ?? 2)
  const [int, dec] = Math.abs(v).toFixed(frac).split('.')
  const body = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (dec ? `,${dec}` : '')
  return (v < 0 ? '-' : '') + body
}

const looksNumeric = (s: string): boolean => NUM_RE.test(s) && /\d/.test(s)

/**
 * Comandos de WordCraft (`id={json}` para `--cmd`), agrupados por bloque del documento (el encabezado/pie/título es el primer grupo).
 * Asume `DocxSpec` ya validado (`isDocxSpec`). La agrupación permite partir un documento grande en varias ejecuciones sin cortar un bloque.
 */
export function chatDocxCommands(spec: DocxSpec, images?: ImageMap): string[][] {
  spec = prepareWordReport(spec)
  const groups: string[][] = [[]]
  const lines = (): string[] => groups[groups.length - 1]
  const cmd = (command: string, params?: Record<string, unknown>): void => {
    lines().push(params ? `${command}=${JSON.stringify(params)}` : command)
  }
  /**
   * Texto con **negrita** y *cursiva*. Devuelve los comandos que apagan el formato del ÚLTIMO tramo: hay que emitirlos DESPUÉS de
   * `text.newParagraph`, porque si se apagan antes, el párrafo siguiente hereda la marca de párrafo en negrita y todo el resto sale en negrita.
   */
  const inline = (t: string): Array<[string, Record<string, unknown>]> => {
    const segs = t.split(INLINE).filter(Boolean)
    let tail: Array<[string, Record<string, unknown>]> = []
    segs.forEach((seg, i) => {
      const last = i === segs.length - 1
      const off = (command: string): void => {
        if (last) tail = [[command, { value: false }]]
        else cmd(command, { value: false })
      }
      if (seg.startsWith('**') && seg.endsWith('**') && seg.length > 4) {
        cmd('format.bold', { value: true })
        cmd('text.insert', { text: seg.slice(2, -2) })
        off('format.bold')
      } else if (seg.startsWith('*') && seg.endsWith('*') && seg.length > 2) {
        cmd('format.italic', { value: true })
        cmd('text.insert', { text: seg.slice(1, -1) })
        off('format.italic')
      } else cmd('text.insert', { text: seg })
    })
    return tail
  }
  const par = (t: string, style?: string, align?: string, size?: number, caption = false): void => {
    if (style) cmd('para.style', { style })
    cmd('para.set', { props: { keepNext: style === 'Title' || style === 'Subtitle', keepLines: caption, widowControl: true } })
    cmd('format.size', { size: size ?? (style === 'Title' ? WORD_REPORT.title_size : style === 'Subtitle' ? 14 : WORD_REPORT.size) })
    if (style === 'Title') cmd('format.bold', { value: true })
    // El pie ocupa el mínimo legible y no se divide entre páginas: la foto ya lo une con keepNext.
    cmd('para.lineSpacing', { value: caption ? 1 : WORD_REPORT.line_spacing })
    cmd('para.spacing', { before: 0, after: caption ? 3 : WORD_REPORT.space_after_pt })
    cmd('para.align', { value: align ?? 'left' })
    const tail = inline(t)
    cmd('text.newParagraph')
    for (const [c, p] of tail) cmd(c, p)
    if (style === 'Title') cmd('format.bold', { value: false })
  }

  cmd('design.themeFonts', { heading: 'Arial', body: 'Arial' })
  cmd('layout.size', { name: 'Letter' })
  const margin = (WORD_REPORT.margin_cm * 72) / 2.54
  cmd('layout.margins', { top: margin, bottom: margin, left: margin, right: margin })
  // Encabezado y pie: cada comando deja el cursor DENTRO de él (el cuerpo se ve atenuado); `insert.closeHeader` vuelve al cuerpo.
  if (spec.header) {
    cmd('insert.header', { text: spec.header })
    cmd('insert.closeHeader')
  }
  if (spec.footer || (spec.page_numbers ?? true)) {
    cmd('insert.footer', { text: '' })
    cmd('format.size', { size: 9 })
    cmd('format.color', { color: '595959' })
    cmd('para.align', { value: 'center' })
    if (spec.footer) cmd('text.insert', { text: spec.footer })
    if (spec.page_numbers ?? true) {
      cmd('text.insert', { text: spec.footer ? '   |   Página ' : 'Página ' })
      cmd('insert.field', { instr: 'PAGE', result: '1' })
      cmd('text.insert', { text: ' de ' })
      cmd('insert.field', { instr: 'NUMPAGES', result: '1' })
    }
    cmd('insert.closeHeader')
    cmd('format.color', { color: 'auto' })
  }
  const meta = [spec.author, spec.date === 'hoy' ? fechaEs() : spec.date].filter((x): x is string => !!x)
  if (spec.cover && spec.title) {
    // Portada solo en informes largos; conserva la primera página sin encabezado ni pie.
    if (spec.header || spec.footer || (spec.page_numbers ?? true)) cmd('layout.differentFirstPage')
    const cover = (t: string, style: string, before: number, after: number): void => {
      cmd('para.style', { style })
      cmd('format.size', { size: style === 'Title' ? WORD_REPORT.title_size : style === 'Subtitle' ? 14 : WORD_REPORT.size })
      cmd('para.align', { value: 'left' })
      cmd('para.spacing', { before, after })
      cmd('para.borders', { kind: 'none' })
      const tail = inline(t)
      cmd('text.newParagraph')
      for (const [c, p] of tail) cmd(c, p)
    }
    cover(spec.title, 'Title', WORD_REPORT.cover_before_pt, 12)
    if (spec.subtitle) cover(spec.subtitle, 'Subtitle', 0, 18)
    if (meta.length) cover(meta.join(' · '), 'Normal', 24, 0)
    cmd('text.pageBreak')
    cmd('para.style', { style: 'Normal' })
    cmd('para.borders', { kind: 'none' })
    cmd('para.spacing', { before: 0, after: 8 })
  } else {
    if (spec.title) par(spec.title, 'Title', 'center')
    if (spec.subtitle) par(spec.subtitle, 'Subtitle', 'center')
    if (meta.length) par(meta.join(' · '), 'Normal', 'center')
  }
  if (spec.toc) {
    cmd('references.toc', { levels: 3, title: 'Contenido' })
    cmd('caret.docEnd')
  }
  cmd('para.style', { style: 'Normal' })

  let numberedSeen = false
  for (const b of spec.blocks) {
    groups.push([])
    switch (b.type) {
      case 'heading':
        cmd(`para.heading${b.level}`)
        cmd('para.lineSpacing', { value: WORD_REPORT.line_spacing })
        cmd('format.size', { size: WORD_REPORT.heading_sizes[b.level - 1] })
        cmd('format.bold', { value: true })
        cmd('para.set', { props: { keepNext: true, keepLines: true, spaceBefore: 16, spaceAfter: 6 } })
        cmd('para.align', { value: 'left' })
        cmd('text.insert', { text: b.text })
        cmd('text.newParagraph')
        cmd('format.bold', { value: false })
        cmd('para.style', { style: 'Normal' })
        break
      case 'paragraph':
        par(b.text, 'Normal', b.align)
        break
      case 'bullets':
      case 'numbered': {
        cmd('format.size', { size: WORD_REPORT.size })
        cmd('para.spacing', { before: 0, after: WORD_REPORT.space_after_pt })
        cmd('para.lineSpacing', { value: WORD_REPORT.line_spacing })
        const flat = b.items.flat()
        if (b.type === 'numbered') cmd('para.numbering', { kind: 'numbered' })
        else cmd('para.bullets')
        cmd('para.set', { props: { keepNext: false, keepLines: false, widowControl: true } })
        flat.forEach((it, k) => {
          const tail = inline(it)
          // Cada bloque numerado reinicia en 1 (solo se puede con el cursor ya dentro de la lista).
          if (b.type === 'numbered' && k === 0 && numberedSeen) cmd('para.restartNumbering')
          cmd('text.newParagraph')
          for (const [c, p] of tail) cmd(c, p)
        })
        if (b.type === 'numbered') {
          numberedSeen = true
          cmd('para.numbering', { off: true })
        } else cmd('para.bullets', { off: true })
        cmd('para.style', { style: 'Normal' })
        break
      }
      case 'table': {
        const n = b.columns.length
        const cells: string[][] = [
          b.columns,
          ...b.rows.map((r) => r.map((v) => (v === null ? '' : typeof v === 'number' ? fmtNum(v, b.decimals) : v)))
        ]
        cmd('insert.table', { rows: cells.length, cols: n })
        cmd('table.cellMargins', { top: 3, bottom: 3, left: 6, right: 6 }) // aire en cada celda: el texto no pega con la línea
        cmd('table.borders', { kind: 'all', width: 0.5, color: 'BFC4CC' })
        cells.forEach((row, r) => {
          const total = !!b.total_row && r === cells.length - 1
          row.forEach((v, k) => {
            cmd('format.size', { size: WORD_REPORT.size - 1 })
            cmd('para.lineSpacing', { value: 1.1 })
            if (r === 0) {
              cmd('table.shading', { color: ACCENT })
              cmd('format.bold', { value: true })
              cmd('format.color', { color: TH_FG })
              const w = b.widths_cm?.[k]
              if (typeof w === 'number' && w >= 1 && w <= 40) cmd('table.columnWidth', { width: Math.round(w * 28.35 * 10) / 10 })
            } else if (total) {
              cmd('table.shading', { color: TOTAL })
              cmd('format.bold', { value: true })
            } else if ((b.zebra ?? true) && r % 2 === 0) cmd('table.shading', { color: ZEBRA })
            const al = b.align?.[k] ?? (r > 0 && looksNumeric(v) ? 'right' : 'left')
            cmd('para.align', { value: al })
            cmd('text.insert', { text: v })
            // Solo se une el encabezado: una tabla de pocas filas también puede tener celdas largas y ocupar varias páginas.
            const keepNext =
              (r === 0 && cells.length > 1) || !!(b.caption && r === cells.length - 1) || !!(b.total_row && r === cells.length - 2)
            cmd('para.set', { props: { keepLines: true, keepNext } })
            if (k === 0) cmd('table.properties', { allowBreak: false }) // «no dividir fila entre páginas» (cantSplit) de ESTA fila
            // La fila de encabezado se repite en cada página y el penúltimo renglón se queda con el total (no queda solo en la página siguiente).
            if (r === 0 && k === 0) cmd('table.repeatHeader')
            if (r === 0) {
              cmd('format.bold', { value: false })
              cmd('format.color', { color: 'auto' })
            } else if (total) cmd('format.bold', { value: false })
            if (!(r === cells.length - 1 && k === n - 1)) cmd('text.tab')
          })
        })
        cmd('caret.docEnd')
        cmd('para.style', { style: 'Normal' })
        if (b.caption) {
          cmd('format.italic', { value: true })
          par(b.caption, 'Normal', 'center')
          cmd('format.italic', { value: false })
        }
        break
      }
      case 'image': {
        // Solo con una copia ya validada (`images`, camino con carpeta de tarea); sin ella el bloque se omite: nunca se usa la ruta del modelo.
        const img = images?.get(b.path)
        if (!img) break
        // Ancho en puntos (1 cm = 28,35 pt), 12 cm por defecto; WordCraft conserva la proporción. Nunca más ancho que la página útil (16 cm).
        const width = Math.round(Math.min(b.width_cm ?? 12, 16) * 28.35 * 10) / 10
        cmd('para.style', { style: 'Normal' })
        cmd('para.set', { props: { keepNext: !!b.caption, keepLines: false, widowControl: false } })
        cmd('para.spacing', { before: 0, after: WORD_REPORT.space_after_pt })
        cmd('para.lineSpacing', { value: 1 })
        cmd('para.align', { value: 'center' })
        cmd('insert.picture', { path: img.file, width, alt: b.alt ?? b.caption ?? '' })
        // Tras insertar, la imagen queda SELECCIONADA: un `text.newParagraph` sin más la reemplaza y desaparece. Se lleva el cursor al final.
        cmd('caret.docEnd')
        cmd('text.newParagraph')
        cmd('para.style', { style: 'Normal' })
        if (b.caption) {
          cmd('format.italic', { value: true })
          par(b.caption, 'Normal', 'center', 9, true)
          cmd('format.italic', { value: false })
        }
        break
      }
      case 'page_break':
        cmd('text.pageBreak')
        break
    }
  }
  // El índice trae sus entradas y los números de página calculados por WordCraft (sin esto sale solo el título y Word pide actualizar campos).
  if (spec.toc) {
    groups.push([])
    cmd('references.updateToc')
  }
  // Todos los bloques terminan en un párrafo vacío. También tras fotos y créditos puede desbordar a una hoja en blanco.
  // Solo cambia ese párrafo de cola, nunca el último texto/imagen. Los saltos explícitos conservan su semántica.
  const last = spec.blocks[spec.blocks.length - 1]
  if (last && last.type !== 'page_break') {
    groups.push([])
    cmd('caret.docEnd')
    cmd('para.set', { props: { keepNext: false, keepLines: false, widowControl: false } })
    cmd('para.spacing', { before: 0, after: 0 })
    cmd('para.lineSpacing', { value: 1 })
    cmd('format.size', { size: 1 })
  }
  return groups.filter((g) => g.length > 0)
}

/** Tope aproximado de comandos por tanda para acotar el trabajo y la respuesta del motor; el contenido viaja por stdin. */
const CHUNK_BYTES = 150_000

/** Une grupos contiguos en tandas de hasta `CHUNK_BYTES` sin partir ningún grupo. */
export function chunkGroups(groups: string[][], limit = CHUNK_BYTES): string[][] {
  const chunks: string[][] = []
  let cur: string[] = []
  let size = 0
  for (const g of groups) {
    const gs = g.reduce((n, c) => n + c.length + 8, 0)
    if (cur.length > 0 && size + gs > limit) {
      chunks.push(cur)
      cur = []
      size = 0
    }
    cur.push(...g)
    size += gs
  }
  if (cur.length > 0) chunks.push(cur)
  return chunks
}

/**
 * Arma el .docx con WordCraft y devuelve sus bytes. Los comandos viajan por stdin, en tandas acotadas por bloque:
 * cada una abre el archivo anterior, escribe al final y lo guarda. Lanza si el programa falla (quien llama cae al camino de siempre).
 */
export async function renderChatDocx(binary: string, spec: DocxSpec, timeoutMs = 60_000, images?: ImageMap): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'lazunox-chatdoc-'))
  try {
    const out = join(dir, 'doc.docx')
    const chunks = chunkGroups(chatDocxCommands(spec, images))
    for (let i = 0; i < chunks.length; i++) {
      const commands: string[] = []
      if (i > 0) {
        const prev = join(dir, `entrada-${i}.docx`)
        await copyFile(out, prev)
        commands.push(`file.open=${JSON.stringify({ path: prev })}`, 'caret.docEnd', 'para.style={"style":"Normal"}')
      }
      commands.push(...chunks[i], `file.saveAs=${JSON.stringify({ path: out })}`)
      await runCraft(binary, ['mcp'], timeoutMs, craftBatch(commands))
    }
    return await readFile(out)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** .docx → PDF con WordCraft (vista previa de respaldo si no está la versión web). `null` si falla. */
export async function docxToPdf(binary: string, docxPath: string, outPdf: string, timeoutMs = 60_000): Promise<string | null> {
  try {
    await runCraft(binary, ['convert', docxPath, outPdf], timeoutMs)
    return outPdf
  } catch (e) {
    console.warn('[craft] docxToPdf falló:', e instanceof Error ? e.message : e)
    return null
  }
}
