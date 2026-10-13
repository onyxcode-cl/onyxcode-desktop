/**
 * PRUEBA (rama `exp/craft-office-pruebas`): el bloque ```xlsx del Chat (`XlsxSpec`, el mismo que lee `render-xlsx.ts`) → libro de Excel
 * armado con `gridcraft-cli` (GridCraft, el «Excel» de ArtCraft). GridCraft escribe el .xlsx y calcula las fórmulas.
 * Si GridCraft no está o falla, `chat-docs.ts` cae al generador de siempre.
 *
 * El contenido es DATO: va como valor JSON de un comando en un archivo de guion (no por la línea de comandos, que tiene tope de largo)
 * y un texto literal que empieza con `=` se escribe como TEXTO (apóstrofe inicial), nunca como fórmula: solo `{formula}` lo es.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { XlsxCell, XlsxColumnFormat, XlsxSpec } from '@shared/chat-doc-spec'
import { runCraft } from './craft-run'

const HEADER_FILL = '#1F3A5F'
const BAND_FILL = '#F2F5FA'
const TOTAL_FILL = '#E3E9F4'
const LINE = '#D5DCE8'
const TOTAL_ROW_RE = /^\s*(total|subtotal|suma|promedio)\b/i
/** Códigos de formato de número (los mismos que usa el generador de siempre). */
const NUM_CODES: Record<XlsxColumnFormat, string> = { currency: '"$"#,##0', integer: '#,##0', decimal: '#,##0.00', percent: '0.00%' }

/** Letras de columna de Excel: 0 → A, 25 → Z, 26 → AA. */
export function colLetter(i: number): string {
  let n = i
  let s = ''
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

/** Nombre de hoja válido en Excel (sin `[]:*?/\`, máximo 31 caracteres, sin repetirse). */
export function sheetName(raw: string, taken: Set<string>, index: number): string {
  const base =
    raw
      .replace(/[[\]:*?/\\]/g, '-')
      .trim()
      .replace(/^'+|'+$/g, '')
      .slice(0, 31) || `Hoja${index + 1}`
  let name = base
  for (let k = 2; taken.has(name.toLowerCase()); k++) name = `${base.slice(0, 31 - String(k).length - 1)}-${k}`
  taken.add(name.toLowerCase())
  return name
}

function cellInput(c: XlsxCell): string | number | boolean | null {
  if (c === null) return null
  if (typeof c === 'number') return Number.isFinite(c) ? c : null
  if (typeof c === 'string') return /^['=]/.test(c) ? `'${c}` : c // texto literal: nunca fórmula
  return `=${c.formula.replace(/^=/, '')}`
}

/** Guion de GridCraft (un comando JSON por línea) para todo el libro. Asume `XlsxSpec` ya validado (`isXlsxSpec`). */
export function chatGridScript(spec: XlsxSpec): string {
  const lines: string[] = []
  const cmd = (command: string, params?: Record<string, unknown>): void => {
    lines.push(JSON.stringify(params ? { command, params } : { command }))
  }
  const taken = new Set<string>()
  const names = spec.sheets.map((s, i) => sheetName(s.name, taken, i))
  names.forEach((name, i) => {
    if (i === 0) cmd('sheet.rename', { name })
    else {
      cmd('home.insertSheet', { name })
      cmd('sheet.move', { sheet: name, to: i })
    }
  })
  spec.sheets.forEach((sheet, i) => {
    cmd('sheet.activate', { sheet: names[i] })
    const width = Math.max(1, ...sheet.rows.map((r) => r.length))
    const last = colLetter(width - 1)
    // En bloques de filas: un libro grande no se manda en una sola línea de guion.
    for (let at = 0; at < sheet.rows.length; at += 400) {
      const block = sheet.rows.slice(at, at + 400).map((r) => Array.from({ length: width }, (_, k) => cellInput(r[k] ?? null)))
      cmd('range.setValues', { range: `A${at + 1}`, values: block })
    }
    if (sheet.rows.length === 0) return
    const all = `A1:${last}${sheet.rows.length}`
    cmd('home.fontName', { range: all, name: 'Arial' })
    cmd('home.fontSize', { range: all, size: 11 })
    cmd('home.alignMiddle', { range: all })
    // Encabezado: fondo azul oscuro, texto blanco en negrita; los de columnas numéricas alineados a la derecha como sus datos.
    cmd('home.bold', { range: `A1:${last}1`, on: true })
    cmd('home.fillColor', { range: `A1:${last}1`, color: HEADER_FILL })
    cmd('home.fontColor', { range: `A1:${last}1`, color: '#FFFFFF' })
    cmd('home.rowHeight', { rows: '1:1', height: 24 })
    sheet.columnFormats?.forEach((f, k) => {
      if (f && k < width) cmd('home.alignRight', { range: `${colLetter(k)}1` })
    })
    if (sheet.rows.length > 1) {
      // Filas alternadas (una sola regla, sirve para cualquier largo) y líneas finas entre filas.
      cmd('home.conditionalFormat', {
        range: `A2:${last}${sheet.rows.length}`,
        rule: { type: 'expression', formula: 'MOD(ROW(),2)=1', style: { fill: { color: BAND_FILL } } }
      })
      cmd('home.borders', { range: `A1:${last}${sheet.rows.length}`, preset: 'insideHorizontal', style: 'thin', color: LINE })
      cmd('home.borders', { range: `A${sheet.rows.length}:${last}${sheet.rows.length}`, preset: 'bottom', style: 'thin', color: LINE })
      // Fila de totales: una que empieza con «Total/Subtotal/Suma/Promedio» → negrita, fondo propio y línea superior marcada.
      const lastRow = sheet.rows[sheet.rows.length - 1]
      const first = lastRow[0]
      if (typeof first === 'string' && TOTAL_ROW_RE.test(first)) {
        const r = sheet.rows.length
        cmd('home.bold', { range: `A${r}:${last}${r}`, on: true })
        cmd('home.fillColor', { range: `A${r}:${last}${r}`, color: TOTAL_FILL })
        cmd('home.borders', { range: `A${r}:${last}${r}`, preset: 'top', style: 'medium', color: HEADER_FILL })
      }
    }
    sheet.columnFormats?.forEach((f, k) => {
      if (f && k < width && sheet.rows.length > 1)
        cmd('home.numberFormat', { range: `${colLetter(k)}2:${colLetter(k)}${sheet.rows.length}`, code: NUM_CODES[f] })
    })
    cmd('home.autofitColumnWidth', { cols: `A:${last}` })
    // Gráficos nativos: sin `at`, a la derecha de los datos (dejando una columna libre), uno debajo de otro.
    sheet.charts?.forEach((ch, k) => {
      cmd('insert.chart', {
        range: ch.range,
        type: ch.type,
        ...(ch.title ? { title: ch.title } : {}),
        at: ch.at ?? `${colLetter(width + 1)}${2 + k * 20}`,
        width: ch.width ?? 520,
        height: ch.height ?? 300
      })
    })
    cmd('view.gridlines', { on: false })
    if (sheet.rows.length > 1) cmd('view.freezeTopRow')
  })
  cmd('sheet.activate', { sheet: names[0] })
  return lines.join('\n') + '\n'
}

/** Arma el .xlsx con GridCraft y devuelve sus bytes. Lanza si el programa falla (quien llama cae al generador de siempre). */
export async function renderChatGrid(binary: string, spec: XlsxSpec, timeoutMs = 60_000): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'lazunox-chatgrid-'))
  try {
    const script = join(dir, 'libro.jsonl')
    const out = join(dir, 'libro.xlsx')
    await writeFile(script, chatGridScript(spec), { mode: 0o600 })
    await runCraft(binary, ['run', '--script', script, '--out', out, '--quiet'], timeoutMs)
    return await readFile(out)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * .xlsx → PDF con GridCraft para la vista previa del panel (todas las hojas, cada una ajustada a una página, con sus gráficos).
 * Devuelve la ruta del PDF o `null` si falla (quien llama cae al visor de siempre).
 */
export async function gridToPdf(binary: string, xlsxPath: string, outPdf: string, timeoutMs = 60_000): Promise<string | null> {
  try {
    await runCraft(
      binary,
      ['run', '--in', xlsxPath, '--cmd', `file.exportPdf=${JSON.stringify({ path: outPdf, sheets: 'all', fitToPage: true })}`, '--quiet'],
      timeoutMs
    )
    return outPdf
  } catch (e) {
    console.warn('[craft] gridToPdf falló:', e instanceof Error ? e.message : e)
    return null
  }
}
