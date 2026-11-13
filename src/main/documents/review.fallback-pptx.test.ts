/**
 * Respaldo sin ArtCraft (F8-B246): lo que sale de `renderBytes` cuando DeckCraft/GridCraft no están (pptxgenjs, exceljs) tiene que pasar por la
 * revisión de `documentos_crear` sin ✘ que el modelo no pueda corregir desde el spec.
 */
import { describe, expect, it, vi } from 'vitest'
import type { PptxSpec } from '@shared/chat-doc-spec'

vi.mock('../extras/artifact-window', () => ({ renderHtmlToPdf: vi.fn() }))
vi.mock('../office/craft/service', () => ({ craftService: () => ({ status: () => ({ state: 'missing', bins: {} }) }) }))
vi.mock('../office/craft/craft-problems', () => ({ recordCraftProblem: () => undefined }))

import { renderBytes } from './engine'
import { reviewDocument } from './review'

const bad = (r: Awaited<ReturnType<typeof reviewDocument>>): string =>
  r.items
    .filter((i) => !i.ok)
    .map((i) => i.text)
    .join(' | ')

describe('sin DeckCraft: el pptx del respaldo pasa la revisión', () => {
  const spec = {
    slides: [
      { title: 'Ventas por región', subtitle: 'Resumen del año 2026' },
      { title: 'Puntos', bullets: ['uno', 'dos'] },
      { title: 'Conclusiones', bullets: ['Aprobar el piloto este mes', 'Revisar resultados con el comité en diciembre'] }
    ]
  } as unknown as PptxSpec
  it('marcador de título en cada diapositiva y subtítulo presente', async () => {
    const bytes = await renderBytes({ kind: 'pptx', data: spec }, 'prueba')
    const r = await reviewDocument('pptx', bytes, spec)
    expect(bad(r)).toBe('')
  })
})
