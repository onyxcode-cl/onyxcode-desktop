import { describe, expect, it } from 'vitest'
import { basePdfOptions, pdfPageCount, pdfPrintOptions, printWithoutOrphanPage } from './pdf-options'

describe('opciones de impresión del PDF', () => {
  it('por defecto: A4, fondos, tamaño de página del CSS, PDF etiquetado y con marcadores', () => {
    expect(pdfPrintOptions({})).toEqual({ ...basePdfOptions, generateTaggedPDF: true, generateDocumentOutline: true })
  })
  it('LAZUNOX_PDF_TAGGED=0 apaga las dos opciones experimentales', () => {
    const o = pdfPrintOptions({ LAZUNOX_PDF_TAGGED: '0' })
    expect(o).toEqual({ ...basePdfOptions })
    expect('generateTaggedPDF' in o).toBe(false)
  })
  it('cualquier otro valor las deja encendidas', () => {
    expect(pdfPrintOptions({ LAZUNOX_PDF_TAGGED: '1' }).generateTaggedPDF).toBe(true)
  })
})

const fakePdf = (n: number): Buffer => Buffer.from(`%PDF-1.4\n29 0 obj\n<</Type /Pages\n/Count ${n}\n/Kids [2 0 R]>>\nendobj\n`)

describe('última página casi vacía', () => {
  it('no achica hasta dejar la letra más chica bajo 9 px', async () => {
    const calls: number[] = []
    await printWithoutOrphanPage(async (sc) => (calls.push(sc), fakePdf(2)), 7.0)
    expect(calls).toEqual([1])
    const c2: number[] = []
    await printWithoutOrphanPage(async (sc) => (c2.push(sc), fakePdf(2)), 10)
    expect(c2).toEqual([1, 0.95, 0.92, 0.9])
  })
  it('cuenta las páginas del nodo /Pages', () => {
    expect(pdfPageCount(fakePdf(4))).toBe(4)
    expect(pdfPageCount(Buffer.from('no es pdf'))).toBe(0)
  })
  it('usa la primera escala que baja el número de páginas', async () => {
    const calls: number[] = []
    const out = await printWithoutOrphanPage(async (sc) => {
      calls.push(sc)
      return fakePdf(sc === 0.92 ? 1 : 2)
    })
    expect(pdfPageCount(out)).toBe(1)
    expect(calls).toEqual([1, 0.95, 0.92])
  })
  it('si ninguna escala baja las páginas, deja el original (sin achicar en vano)', async () => {
    const calls: number[] = []
    const out = await printWithoutOrphanPage(async (sc) => {
      calls.push(sc)
      return fakePdf(2)
    })
    expect(pdfPageCount(out)).toBe(2)
    expect(calls).toEqual([1, 0.95, 0.92, 0.9])
  })
  it('1 página o 3 o más no se tocan', async () => {
    for (const n of [1, 3, 13]) {
      const calls: number[] = []
      await printWithoutOrphanPage(async (sc) => (calls.push(sc), fakePdf(n)))
      expect(calls).toEqual([1])
    }
  })
  it('si la impresión achicada falla, devuelve el original', async () => {
    const out = await printWithoutOrphanPage(async (sc) => {
      if (sc !== 1) throw new Error('boom')
      return fakePdf(2)
    })
    expect(pdfPageCount(out)).toBe(2)
  })
})
