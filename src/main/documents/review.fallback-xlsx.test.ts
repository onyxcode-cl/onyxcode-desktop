/**
 * Respaldo sin ArtCraft (F8-B246): lo que sale de `renderBytes` cuando DeckCraft/GridCraft no están (pptxgenjs, exceljs) tiene que pasar por la
 * revisión de `documentos_crear` sin ✘ que el modelo no pueda corregir desde el spec.
 */
import { describe, expect, it, vi } from 'vitest'
import type { XlsxSpec } from '@shared/chat-doc-spec'

vi.mock('../extras/artifact-window', () => ({ renderHtmlToPdf: vi.fn() }))
vi.mock('../office/craft/service', () => ({ craftService: () => ({ status: () => ({ state: 'missing', bins: {} }) }) }))
vi.mock('../office/craft/craft-problems', () => ({ recordCraftProblem: () => undefined }))

import { renderBytes } from './engine'
import JSZip from 'jszip'
import { reviewDocument, reviewSummary } from './review'

describe('sin GridCraft: el valor de una fórmula no se da por calculado', () => {
  it('exceljs guarda el valor que puso el modelo: la revisión no lo marca ✔', async () => {
    const spec = {
      sheets: [
        {
          name: 'Resumen',
          rows: [
            ['Región', 'Monto'],
            ['Norte', 100],
            ['Sur', 765],
            ['Total', { formula: 'SUM(B2:B3)', value: 800 }]
          ]
        }
      ]
    } as unknown as XlsxSpec
    const bytes = await renderBytes({ kind: 'xlsx', data: spec }, 'prueba')
    const r = await reviewDocument('xlsx', bytes)
    const note = r.items.find((i) => i.note)
    expect(note?.text).toContain('NO se recalculó')
    expect(r.items.some((i) => /tienen su valor calculado/.test(i.text))).toBe(false)
    expect(r.ok).toBe(true) // aviso, no ✘: no empuja a recrear el archivo
    const summary = await reviewSummary('xlsx', bytes)
    expect(summary).toContain('ℹ')
    // el mismo libro con la marca de GridCraft sí cuenta como calculado
    const zip = await JSZip.loadAsync(bytes)
    zip.file('docProps/app.xml', '<Properties><Application>GridCraft</Application></Properties>')
    const grid = await reviewDocument('xlsx', await zip.generateAsync({ type: 'nodebuffer' }))
    expect(grid.items.some((i) => /calculado por GridCraft/.test(i.text))).toBe(true)
  })
})
