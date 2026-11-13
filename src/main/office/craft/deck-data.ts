import type { PptxChartSpec, PptxSlideSpec } from '@shared/chat-doc-spec'

type Table = NonNullable<PptxSlideSpec['table']>

/** Solo valores completos: no se extraen cifras de una oración, fechas ni intervalos. */
export function numericCell(text: string): { value: number; unit: string } | undefined {
  const match = text
    .trim()
    .match(
      /^(?:(CLP|USD|EUR|\$|€)\s*)?([+−-]?\d[\d.,\s]*)(?:\s*(%|CLP|USD|EUR|millones?|miles?|M|personas?|familias?|oficinas?|unidades?))?$/i
    )
  if (!match) return
  let number = match[2].replace(/\s/g, '').replace('−', '-')
  if (number.includes(',') && number.includes('.')) {
    const decimal = number.lastIndexOf(',') > number.lastIndexOf('.') ? ',' : '.'
    number = number.replace(decimal === ',' ? /\./g : /,/g, '').replace(',', '.')
  } else if (/^[+\-]?\d{1,3}([.,]\d{3})+$/.test(number)) number = number.replace(/[.,]/g, '')
  else number = number.replace(',', '.')
  if (!/^[+\-]?\d+(?:\.\d+)?$/.test(number)) return
  const value = Number(number)
  if (!Number.isFinite(value)) return
  return { value, unit: [match[1] ?? '', match[3] ?? ''].join('|').toLowerCase() }
}

/** Evidencia de un mismo eje: períodos homogéneos o una dimensión declarada en la tabla.
 * «Concepto/Valor» no basta: moneda igual no vuelve comparables dos indicadores independientes.
 */
export function comparableCategories(columns: string[], categories: string[]): boolean {
  const normalized = categories.map((label) =>
    label
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
  )
  const periods = [
    /^\d{4}-\d{2}$/,
    /^\d{4}-\d{2}-\d{2}$/,
    /^\d{4}$/,
    /^(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?: \d{4})?$/,
    /^(?:t[1-4]|q[1-4]|trimestre [1-4])(?: \d{4})?$/
  ]
  if (periods.some((pattern) => normalized.every((label) => pattern.test(label)))) return true
  if (normalized.some((label) => periods.some((pattern) => pattern.test(label)))) return false
  const dimension = columns[0]
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
  if (
    !/^(clientes?|productos?|regiones?|zonas?|mes(?:es)?|anos?|trimestres?|paises?|sucursales?|canales?|categorias?|estado)\b/.test(
      dimension
    )
  )
    return false
  // Una dimensión declarada tampoco autoriza mezclar meses con trimestres o totales con filas parciales.
  if (
    normalized.some((label) =>
      /\b(total|subtotal|trimestre|trimestral|mensual|anual|ventas?|devoluciones?|costos?|presupuesto|ingresos?|gastos?)\b/.test(label)
    )
  )
    return false
  return true
}

/** Un campo numérico con la misma unidad Y una dimensión común reconocible. */
export function numericSeries(table: Table): PptxChartSpec | undefined {
  if (table.rows.length < 2 || table.rows.length > 12 || table.columns.length !== 2) return
  const cells = table.rows.map((row) => numericCell(row[1]))
  if (cells.some((cell) => !cell) || new Set(cells.map((cell) => cell!.unit)).size !== 1) return
  const categories = table.rows.map((row) => row[0])
  if (new Set(categories).size !== categories.length || categories.some((label) => !label.trim())) return
  if (/^(fecha|ano|año|id|c[oó]digo)\b/i.test(table.columns[1].trim())) return
  if (!comparableCategories(table.columns, categories)) return
  return { type: 'bar', categories, values: cells.map((cell) => cell!.value) }
}

/** Etiqueta real abreviada por palabras; nunca se sustituye por un índice. */
export function chartCategory(label: string, max = 24): string {
  if (label.length <= max) return label
  const prefix = label.slice(0, max - 1)
  const cut = prefix.lastIndexOf(' ')
  return (cut >= max / 2 ? prefix.slice(0, cut) : prefix).trimEnd() + '…'
}

/** Promueve los pares que ya escribe el modelo, sin pedir un vocabulario nuevo ni inventar datos. */
export function prepareSlide(slide: PptxSlideSpec, index: number, total: number): PptxSlideSpec {
  if (['free', 'cover', 'closing', 'section', 'quote', 'image'].includes(slide.layout ?? '')) return slide
  if (slide.table) return { ...slide, layout: 'table', chart: slide.chart ?? numericSeries(slide.table) }
  if (!slide.chart && !slide.kpis?.length && !slide.columns?.length && (slide.bullets?.length ?? 0) >= 2 && slide.bullets!.length <= 8) {
    const pairs = slide.bullets!.map((text) => text.match(/^(.+?)\s*(?::|=|[—–]|\s·\s)\s*(.+)$/))
    if (pairs.every((pair) => pair && numericCell(pair[2]))) {
      const table = { columns: ['Concepto', 'Valor'], rows: pairs.map((pair) => [pair![1].trim(), pair![2].trim()]) }
      const chart = numericSeries(table)
      if (chart) return { ...slide, layout: 'table', bullets: [], table, chart }
      if (table.rows.length <= 4)
        return { ...slide, layout: 'kpis', bullets: [], kpis: table.rows.map(([label, value]) => ({ label, value })) }
    }
  }
  if (
    index === total - 1 &&
    index > 0 &&
    slide.bullets?.length &&
    slide.bullets.length <= 3 &&
    !slide.chart &&
    !slide.kpis?.length &&
    !slide.columns?.length &&
    ((!slide.layout && /^(cierre|gracias|conclusi[oó]n|pr[oó]ximos pasos|revisar|aprobar|decisi[oó]n)\b/i.test(slide.title ?? '')) ||
      ((slide.layout === 'bullets' || slide.layout === 'stat') && /decisi[oó]n pendiente/i.test(slide.eyebrow ?? '')))
  )
    return { ...slide, layout: 'closing' }
  return slide
}
