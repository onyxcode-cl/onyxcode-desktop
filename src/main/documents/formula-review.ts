/**
 * Revisor de fórmulas de Excel sobre el JSON del libro (`XlsxSpec`), ANTES de generar el archivo y sin motor de cálculo. Reglas (de las listas
 * públicas de auditoría de hojas, escritas aquí con código propio):
 *  - referencias rotas: `#REF!`, hoja que no existe, rango o celda fuera de los datos, fórmula que se cita a sí misma;
 *  - rangos corridos: un SUM/AVERAGE/… que se queda corto (no llega a la fila de arriba del total) o parte tarde (deja fuera una fila de datos);
 *  - totales que no cuadran: el `value` de una fila de total no coincide con la suma de los valores de arriba;
 *  - constantes pegadas dentro de una fórmula (`B2*1.19`): el supuesto debería vivir en una celda rotulada;
 *  - IFERROR/IFNA que tapan errores en vez de arreglarlos.
 * `error` = hay que corregirlo; `warning` = conviene revisarlo (puede ser intencional).
 */
import type { XlsxCell, XlsxFormulaCell, XlsxSheetSpec, XlsxSpec } from '@shared/chat-doc-spec'

export type FormulaRule = 'ref-rota' | 'rango-corrido' | 'total-descuadrado' | 'constante-pegada' | 'iferror-oculta'
export interface FormulaFinding {
  severity: 'error' | 'warning'
  rule: FormulaRule
  sheet: string
  cell: string
  message: string
}

const TOTAL_LABEL = /^\s*(total|subtotal|suma|promedio|total general)\s*:?\s*$/i
const AGGREGATES = new Set(['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'COUNTA'])
/** Números que no son un supuesto escondido: 0, 1, 2, 100 (porcentajes), 12 (meses), 24, 60, 365, 1000 y los enteros de hasta 10 (decimales de ROUND, índices). */
const HARMLESS_CONSTANTS = new Set([0, 1, 2, 12, 24, 60, 100, 365, 1000])

const isFormula = (c: XlsxCell | undefined): c is XlsxFormulaCell => typeof c === 'object' && c !== null && 'formula' in c

export function colLetters(n: number): string {
  let s = ''
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s
  return s
}
export function colNumber(letters: string): number {
  return [...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)
}
const refOf = (col: number, row: number): string => `${colLetters(col)}${row}`

/** Quita las cadenas entre comillas (para no leer números o hojas dentro de un texto). */
const stripStrings = (f: string): string => f.replace(/"(?:[^"]|"")*"/g, '""')

interface Ref {
  sheet: string | null
  c1: number
  r1: number
  c2: number
  r2: number
  text: string
}

/** Referencias A1 y rangos A1:B9 (con o sin hoja delante) de una fórmula. */
export function parseRefs(formula: string): Ref[] {
  const out: Ref[] = []
  const f = stripStrings(formula)
  const re = /(?:(?:'((?:[^']|'')+)'|([A-Za-z_][\w.]*))!)?\$?([A-Z]{1,3})\$?(\d{1,6})(?::\$?([A-Z]{1,3})\$?(\d{1,6}))?(?![\w(])/g
  for (const m of f.matchAll(re)) {
    const sheet = m[1] ? m[1].replace(/''/g, "'") : (m[2] ?? null)
    const c1 = colNumber(m[3])
    const r1 = Number(m[4])
    const c2 = m[5] ? colNumber(m[5]) : c1
    const r2 = m[6] ? Number(m[6]) : r1
    out.push({ sheet, c1: Math.min(c1, c2), r1: Math.min(r1, r2), c2: Math.max(c1, c2), r2: Math.max(r1, r2), text: m[0] })
  }
  return out
}

/** Números sueltos de una fórmula, sin contar los de las referencias ni los de las cadenas. */
export function literalNumbers(formula: string): number[] {
  const f = stripStrings(formula)
    .replace(/(?:'[^']+'|[A-Za-z_][\w.]*)!/g, ' ')
    .replace(/\$?[A-Z]{1,3}\$?\d{1,6}(?::\$?[A-Z]{1,3}\$?\d{1,6})?/g, ' ')
  return [...f.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)(?![\w.])/g)].map((m) => Number(m[1]))
}

function usedBounds(sheet: XlsxSheetSpec): { rows: number; cols: number } {
  return { rows: sheet.rows.length, cols: sheet.rows.reduce((n, r) => Math.max(n, r.length), 0) }
}

const valueOf = (c: XlsxCell | undefined): number | null => {
  const v = isFormula(c) ? c.value : c
  if (typeof v === 'number' && Number.isFinite(v)) return v
  return null
}
const hasContent = (c: XlsxCell | undefined): boolean => c !== null && c !== undefined && c !== ''

export function reviewFormulas(spec: XlsxSpec): FormulaFinding[] {
  const findings: FormulaFinding[] = []
  const sheets = new Map(spec.sheets.map((s) => [s.name.toLowerCase(), s]))
  for (const sheet of spec.sheets) {
    const add = (severity: FormulaFinding['severity'], rule: FormulaRule, cell: string, message: string): void => {
      findings.push({ severity, rule, sheet: sheet.name, cell, message })
    }
    sheet.rows.forEach((row, ri) => {
      row.forEach((cell, ci) => {
        if (!isFormula(cell)) return
        const here = refOf(ci + 1, ri + 1)
        const f = cell.formula.replace(/^=/, '')
        const plain = stripStrings(f)

        // 1. Referencias rotas
        if (/#REF!/i.test(plain)) add('error', 'ref-rota', here, `la fórmula contiene #REF! (${f.slice(0, 40)})`)
        for (const ref of parseRefs(f)) {
          const target = ref.sheet ? sheets.get(ref.sheet.toLowerCase()) : sheet
          if (!target) {
            add('error', 'ref-rota', here, `apunta a la hoja «${ref.sheet}», que no existe`)
            continue
          }
          const tb = usedBounds(target)
          if (ref.r1 > tb.rows || ref.c1 > tb.cols)
            add('error', 'ref-rota', here, `${ref.text} está fuera de los datos de la hoja «${target.name}»`)
          else if (ref.r2 > tb.rows || ref.c2 > tb.cols)
            add('error', 'ref-rota', here, `el rango ${ref.text} se pasa del final de los datos de «${target.name}» (${tb.rows} filas)`)
          else if (target === sheet && ref.r1 <= ri + 1 && ri + 1 <= ref.r2 && ref.c1 <= ci + 1 && ci + 1 <= ref.c2)
            add('error', 'ref-rota', here, `la fórmula se cita a sí misma (${ref.text}): referencia circular`)
        }

        // 2. Rangos corridos (SUM/AVERAGE/… en una columna, por encima de la fórmula)
        const call = /^([A-Z]+)\(\s*\$?([A-Z]{1,3})\$?(\d+):\$?([A-Z]{1,3})\$?(\d+)\s*\)$/.exec(plain.trim())
        if (call && AGGREGATES.has(call[1]) && call[2] === call[4]) {
          const col = colNumber(call[2]) - 1
          const r1 = Number(call[3])
          const r2 = Number(call[5])
          if (col === ci && r2 < ri + 1) {
            const below = sheet.rows.slice(r2, ri).filter((r) => hasContent(r[col]) && valueOf(r[col]) !== null)
            if (below.length)
              add(
                'error',
                'rango-corrido',
                here,
                `${call[1]}(${call[2]}${r1}:${call[2]}${r2}) termina en la fila ${r2} pero hay datos hasta la fila ${ri}: el rango quedó corto`
              )
            const above = sheet.rows[r1 - 2]?.[col]
            if (r1 > 2 && hasContent(above) && valueOf(above) !== null)
              add(
                'error',
                'rango-corrido',
                here,
                `${call[1]}(${call[2]}${r1}:${call[2]}${r2}) empieza en la fila ${r1} pero la fila ${r1 - 1} también tiene un dato: el rango parte tarde`
              )
          }

          // 3. Total que no cuadra: fila rotulada «Total» con una suma cuyo valor no es la suma de los números de arriba
          const labelled = row.some((c) => typeof c === 'string' && TOTAL_LABEL.test(c))
          if (labelled && call[1] === 'SUM' && col === ci && typeof cell.value === 'number') {
            let sum = 0
            let n = 0
            for (let r = r1 - 1; r < r2; r++) {
              const v = valueOf(sheet.rows[r]?.[col])
              if (v !== null) {
                sum += v
                n++
              }
            }
            if (n && Math.abs(sum - cell.value) > Math.max(0.5, Math.abs(sum) * 0.005))
              add(
                'error',
                'total-descuadrado',
                here,
                `el total dice ${cell.value} pero las filas ${r1} a ${r2} suman ${Math.round(sum * 100) / 100}`
              )
          }
        }

        // 4. Constantes pegadas dentro de la fórmula
        const hard = literalNumbers(f).filter((n) => !HARMLESS_CONSTANTS.has(n) && !(Number.isInteger(n) && n >= 0 && n <= 10))
        if (hard.length)
          add(
            'warning',
            'constante-pegada',
            here,
            `el número ${hard[0]} está escrito dentro de la fórmula (${f.slice(0, 40)}): ponlo en una celda rotulada y refiérete a ella`
          )

        // 5. IFERROR / IFNA que esconden errores
        const m = /\b(IFERROR|IFNA)\s*\(/i.exec(plain)
        if (m)
          add(
            'warning',
            'iferror-oculta',
            here,
            `${m[1].toUpperCase()} puede tapar un error real: arregla la causa (por ejemplo con IF(B2=0,…)) en vez de esconder el resultado`
          )
      })
    })
  }
  return findings
}
