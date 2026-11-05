import { describe, expect, it } from 'vitest'
import { basePdfOptions, pdfPrintOptions } from './pdf-options'

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
