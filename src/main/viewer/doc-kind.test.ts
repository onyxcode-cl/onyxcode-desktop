import { describe, expect, it } from 'vitest'
import { MAX_BYTES, sniffDocKind } from './doc-kind'

const PDF_HEADER = new TextEncoder().encode('%PDF-1.4\n%âãÏÓ\n')
const ZIP_HEADER = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00])
const ZEROS = new Uint8Array(16)

describe('sniffDocKind', () => {
  it('detecta PDF cuando la extensión y los bytes %PDF- concuerdan', () => {
    expect(sniffDocKind('x.pdf', PDF_HEADER)).toBe('pdf')
  })

  it('rechaza un .pdf cuyo contenido no empieza con %PDF-', () => {
    expect(sniffDocKind('x.pdf', ZEROS)).toBeNull()
    expect(sniffDocKind('x.pdf', ZIP_HEADER)).toBeNull()
  })

  it('detecta DOCX, XLSX y PPTX con firma ZIP', () => {
    expect(sniffDocKind('x.docx', ZIP_HEADER)).toBe('docx')
    expect(sniffDocKind('x.xlsx', ZIP_HEADER)).toBe('xlsx')
    expect(sniffDocKind('x.pptx', ZIP_HEADER)).toBe('pptx')
  })

  it('rechaza un .docx que no es ZIP (extensión falsa o corrupto)', () => {
    expect(sniffDocKind('x.docx', PDF_HEADER)).toBeNull()
    expect(sniffDocKind('x.docx', ZEROS)).toBeNull()
  })

  it('devuelve null para extensiones no reconocidas, sin importar el contenido', () => {
    expect(sniffDocKind('x.txt', PDF_HEADER)).toBeNull()
    expect(sniffDocKind('x.txt', ZIP_HEADER)).toBeNull()
  })

  it('es insensible a mayúsculas en la extensión', () => {
    expect(sniffDocKind('x.PDF', PDF_HEADER)).toBe('pdf')
    expect(sniffDocKind('x.Docx', ZIP_HEADER)).toBe('docx')
  })

  it('no lanza con un header más corto que la firma mágica', () => {
    const short = Uint8Array.from([0x25, 0x50])
    expect(() => sniffDocKind('x.pdf', short)).not.toThrow()
    expect(sniffDocKind('x.pdf', short)).toBeNull()
    expect(sniffDocKind('x.pdf', new Uint8Array(0))).toBeNull()
  })
})

describe('MAX_BYTES', () => {
  it('fija los topes por tipo según el plan del visor', () => {
    expect(MAX_BYTES.pdf).toBe(100 * 1024 * 1024)
    expect(MAX_BYTES.pptx).toBe(100 * 1024 * 1024)
    expect(MAX_BYTES.docx).toBe(25 * 1024 * 1024)
    expect(MAX_BYTES.xlsx).toBe(25 * 1024 * 1024)
  })
})
