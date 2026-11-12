import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { DocxSpec } from '@shared/chat-doc-spec'
import { prepareWordReport, reportColumnWidths, WORD_REPORT } from './word-report-layout'

describe('plantilla de informes', () => {
  it('respeta la exclusión de índice y conserva la portada de informes largos', () => {
    const spec: DocxSpec = { title: 'Informe', cover: true, toc: false, blocks: [{ type: 'paragraph', text: 'palabra '.repeat(2000) }] }
    expect(prepareWordReport(spec)).toMatchObject({ cover: true, toc: false })
    expect(WORD_REPORT).toMatchObject({ font: 'Arial', size: 11, margin_cm: 2.5 })
  })

  it('conserva los anchos parciales admitidos por el Chat y completa las demás columnas', () => {
    for (const widths of [[], [3], [30, 10, 5]]) {
      const result = reportColumnWidths(['Acción', 'Monto'], [['Revisión', 100]], widths)
      expect(result).toHaveLength(2)
      expect(result.every((w) => w > 0)).toBe(true)
      expect(result.reduce((a, b) => a + b, 0)).toBeCloseTo(16.59)
    }
  })

  const python = process.env.LAZUNOX_PYTHON
  it.skipIf(!python)('Python y Chat producen la misma jerarquía y las mismas decisiones en los umbrales', () => {
    const cases: DocxSpec[] = [0, 1199, 1200, 1790, 1800, 2000].map((words) => ({
      title: 'Informe',
      cover: true,
      toc: true,
      blocks: [
        { type: 'heading', level: 3, text: '9.2 Resumen' },
        { type: 'heading', level: 1, text: '2027 Proyección' },
        { type: 'heading', level: 1, text: 'Segundo' },
        { type: 'heading', level: 1, text: 'Tercero' },
        { type: 'heading', level: 1, text: 'Cuarto' },
        { type: 'paragraph', text: 'palabra '.repeat(words) }
      ]
    }))
    const py = spawnSync(
      python!,
      [
        '-c',
        'import sys,json; sys.path.insert(0,sys.argv[1]); from _report_layout import prepare; print(json.dumps([prepare(s) for s in json.load(sys.stdin)]))',
        resolve('resources/opencode/skills/docx/scripts')
      ],
      {
        input: JSON.stringify(cases),
        encoding: 'utf8',
        timeout: 30_000
      }
    )
    expect(py.status, py.stderr).toBe(0)
    expect(JSON.parse(py.stdout)).toEqual(cases.map(prepareWordReport))
  })
})
