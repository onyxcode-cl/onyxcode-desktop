import type { DocxSpec } from '@shared/chat-doc-spec'
import template from '../../../../resources/opencode/skills/docx/templates/report.json'

export const WORD_REPORT = template

/** Misma política que _report_layout.py; sin alterar el contenido recibido. */
export function prepareWordReport(input: DocxSpec): DocxSpec {
  const spec = structuredClone(input)
  let units = 0
  let sections = 0
  let previous = 0
  const counters = [0, 0, 0]
  for (const b of spec.blocks) {
    if (b.type === 'heading') {
      const level = Math.min(b.level, previous + 1) as 1 | 2 | 3
      const text = b.text.replace(/^\s*\d{1,3}(?:\.\d+)*[.)]?\s+/, '').trim()
      if (!text) throw new Error('heading.text: escriba un título no vacío')
      counters[level - 1]++
      counters.fill(0, level)
      b.level = level
      b.text = `${counters.slice(0, level).join('.')} ${text}`
      previous = level
      if (level === 1) sections++
    } else if (b.type === 'table') {
      units += b.rows.length * template.table_row_units
      b.widths_cm = reportColumnWidths(b.columns, b.rows, b.widths_cm)
    }
    if ('text' in b) units += b.text.trim().split(/\s+/).filter(Boolean).length
    if (b.type === 'bullets' || b.type === 'numbered') units += b.items.flat().join(' ').trim().split(/\s+/).filter(Boolean).length
  }
  spec.cover = !!(spec.cover && spec.title && units >= template.long_units)
  spec.toc = !!((spec.toc ?? true) && units >= template.toc_units && sections >= template.toc_sections)
  return spec
}

export function reportColumnWidths(columns: string[], rows: Array<Array<string | number | null>>, requested?: number[]): number[] {
  const auto = columns.map((_, c) =>
    Math.sqrt(Math.max(8, Math.min(60, Math.max(...[columns, ...rows].map((r) => String(r[c] ?? '').length)))))
  )
  const total = auto.reduce((a, b) => a + b, 0)
  const weights = auto.map((w, c) => requested?.[c] ?? (template.usable_width_cm * w) / total)
  return weights.map((w) => (template.usable_width_cm * w) / weights.reduce((a, b) => a + b, 0))
}
