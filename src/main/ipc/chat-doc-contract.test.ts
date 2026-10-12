/**
 * Guardia anti-desalineación: el contenido de un documento de Chat pasa por DOS validaciones, la de `shared/chat-doc-spec.ts` (`isXlsxSpec`/
 * `isPptxSpec`, dentro de `chat-docs.ts`) y el esquema IPC estricto de `schemas.ts`. Si una acepta algo que la otra rechaza, el documento
 * se genera pero el panel no abre (ya pasó con `charts`: «Clave inesperada data.sheets[0].charts»). Cada caso se comprueba contra las dos.
 */
import { describe, expect, it } from 'vitest'
import { isPptxSpec, isXlsxSpec } from '@shared/chat-doc-spec'
import { IPC_SCHEMAS } from './schemas'

const common = { title: 'T', sessionId: 's1', lang: 'es' as const, theme: 'light' as const }
const ipcAccepts = (kind: 'xlsx' | 'pptx', data: unknown): boolean => {
  try {
    IPC_SCHEMAS['extras:chatDoc:open']({ ...common, kind, data } as never)
    return true
  } catch {
    return false
  }
}

const ROWS = [
  ['Mes', 'V', 'C'],
  ['x', 1, 2]
]
const XLSX: [string, unknown, boolean][] = [
  ['simple', { sheets: [{ name: 'A', rows: ROWS }] }, true],
  [
    'formatos y fórmulas',
    { sheets: [{ name: 'A', rows: [['a'], [{ formula: 'SUM(A1:A1)', value: 1 }]], columnFormats: ['currency', null] }] },
    true
  ],
  [
    'con gráfico',
    { sheets: [{ name: 'A', rows: ROWS, charts: [{ type: 'column', range: 'A1:C2', title: 'T', at: 'F2', width: 500, height: 300 }] }] },
    true
  ],
  [
    'varios gráficos',
    {
      sheets: [
        {
          name: 'A',
          rows: ROWS,
          charts: [
            { type: 'line', range: 'A1:B2' },
            { type: 'pie', range: 'A1:B2' }
          ]
        }
      ]
    },
    true
  ],
  ['gráfico de tipo inexistente', { sheets: [{ name: 'A', rows: ROWS, charts: [{ type: 'radar', range: 'A1:B2' }] }] }, false],
  ['rango no continuo', { sheets: [{ name: 'A', rows: ROWS, charts: [{ type: 'line', range: 'A1:A2,C1:C2' }] }] }, false],
  ['gráfico con campo extra', { sheets: [{ name: 'A', rows: ROWS, charts: [{ type: 'line', range: 'A1:B2', macro: 'x' }] }] }, false],
  [
    'más de 4 gráficos',
    { sheets: [{ name: 'A', rows: ROWS, charts: Array.from({ length: 5 }, () => ({ type: 'line', range: 'A1:B2' })) }] },
    false
  ]
]
const FREE = {
  palette: { bg: '#0E2A2F', text: '#F4F1EA', accent: '#F2B544', muted: '#9AA5A0', accent2: '#7FD1B9', panel: '#12383F', edge: '#1E4A52' },
  fonts: { title: 'Georgia', body: 'Arial' },
  footer: 'Pie',
  slides: [
    { title: 'Portada', bullets: ['Sub'], eyebrow: 'E', note: 'n', background: '#112233' },
    {
      layout: 'free',
      elements: [
        {
          type: 'text',
          x: 1,
          y: 2,
          w: 300,
          h: 80,
          text: 'Hola',
          size: 40,
          color: '#FFFFFF',
          bold: true,
          italic: true,
          align: 'center',
          font: 'Verdana',
          spacing: -1
        },
        {
          type: 'shape',
          shape: 'star5',
          x: 10,
          y: 20,
          w: 100,
          h: 100,
          fill: '#FF0000',
          fillTo: '#0000FF',
          angle: 90,
          opacity: 0.5,
          line: '#FFFFFF',
          lineWidth: 2,
          rotate: 10,
          text: 'x',
          size: 12,
          color: '#000000',
          bold: false,
          align: 'left',
          font: 'Tahoma'
        }
      ]
    }
  ]
}
const PPTX: [string, unknown, boolean][] = [
  ['simple', { slides: [{ title: 'x' }] }, true],
  ['tema y estilo', { theme: 'warm', style: 'editorial', slides: [{ title: 'x', bullets: ['a'] }] }, true],
  ['paleta, fuentes, fondo y lienzo libre', FREE, true],
  [
    'gráfico y kpis',
    {
      slides: [
        { title: 'g', layout: 'chart', chart: { type: 'bar', categories: ['a'], values: [1] } },
        {
          title: 'k',
          layout: 'kpis',
          kpis: [
            { label: 'a', value: '1' },
            { label: 'b', value: '2' }
          ]
        }
      ]
    },
    true
  ],
  ['color sin #', { palette: { bg: '0E2A2F', text: '#FFFFFF', accent: '#000000' }, slides: [{ title: 'x' }] }, false],
  ['fuente fuera de la lista', { fonts: { title: 'Comic Sans MS' }, slides: [{ title: 'x' }] }, false],
  ['forma desconocida', { slides: [{ layout: 'free', elements: [{ type: 'shape', shape: 'bomba', x: 0, y: 0, w: 1, h: 1 }] }] }, false],
  ['libre sin elementos', { slides: [{ layout: 'free' }] }, false],
  ['fondo inválido', { slides: [{ title: 'x', background: 'url(x)' }] }, false]
]

describe('contrato de documentos de Chat: validación compartida e IPC dicen lo mismo', () => {
  // Regla: lo que la validación compartida acepta, el esquema IPC TAMBIÉN (si no, el archivo se genera y el panel no abre). Lo contrario no
  // importa: el esquema IPC puede ser más laxo en algo que la validación compartida ya detiene antes.
  it.each(XLSX)('xlsx — %s', (_n, data, valid) => {
    expect(isXlsxSpec(data), 'isXlsxSpec').toBe(valid)
    if (valid) expect(ipcAccepts('xlsx', data), 'esquema IPC').toBe(true)
  })
  it.each(PPTX)('pptx — %s', (_n, data, valid) => {
    expect(isPptxSpec(data), 'isPptxSpec').toBe(valid)
    if (valid) expect(ipcAccepts('pptx', data), 'esquema IPC').toBe(true)
  })
})
