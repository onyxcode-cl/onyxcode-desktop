/** Valor declarado (`value`) contra el calculado por el programa: el archivo manda, y el modelo debe usar ese número en su resumen. */
import { describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import type { XlsxSpec } from '@shared/chat-doc-spec'

vi.mock('../extras/artifact-window', () => ({ renderHtmlToPdf: vi.fn() }))
vi.mock('../office/craft/service', () => ({ craftService: () => ({ status: () => ({ state: 'missing', bins: {} }) }) }))
vi.mock('../office/craft/craft-problems', () => ({ recordCraftProblem: () => undefined }))

import { renderBytes } from './engine'
import { reviewDocument } from './review'

const spec = {
  sheets: [
    {
      name: 'Resumen',
      rows: [
        ['Región', 'Monto'],
        ['Norte', 100],
        ['Sur', 765],
        ['Resultado', { formula: 'SUM(B2:B3)', value: 800 }]
      ]
    }
  ]
} as unknown as XlsxSpec

async function asGridCraft(realValue: string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(await renderBytes({ kind: 'xlsx', data: spec }, 'prueba'))
  zip.file('docProps/app.xml', '<Properties><Application>GridCraft</Application></Properties>')
  const sheet = (await zip.file('xl/worksheets/sheet1.xml')!.async('string')).replace(/(<f>SUM\(B2:B3\)<\/f><v>)[^<]*(<\/v>)/, `$1${realValue}$2`)
  zip.file('xl/worksheets/sheet1.xml', sheet)
  return zip.generateAsync({ type: 'nodebuffer' })
}

describe('valores declarados vs calculados', () => {
  it('coinciden: ✔', async () => {
    const r = await reviewDocument('xlsx', await asGridCraft('800'), spec)
    expect(r.items.find((i) => /valores declarados/i.test(i.text))?.ok).toBe(true)
  })
  it('difieren más de 1 %: ✘ con el valor real', async () => {
    const r = await reviewDocument('xlsx', await asGridCraft('865'), spec)
    const bad = r.items.find((i) => !i.ok)
    expect(bad?.text).toMatch(/declaraste 800, la fórmula da 865/)
    expect(r.ok).toBe(false)
  })
  it('difieren menos de 1 %: solo aviso', async () => {
    const r = await reviewDocument('xlsx', await asGridCraft('803'), spec)
    expect(r.ok).toBe(true)
    expect(r.items.some((i) => i.note && /menor al 1 %/.test(i.text))).toBe(true)
  })
  it('sin la marca de GridCraft no se compara (el valor del archivo es el declarado)', async () => {
    const r = await reviewDocument('xlsx', await renderBytes({ kind: 'xlsx', data: spec }, 'prueba'), spec)
    expect(r.items.some((i) => /declarados/i.test(i.text))).toBe(false)
  })
})
