import { describe, expect, it } from 'vitest'
import { pageImageName, pdfRoute } from './attach-adapt'

describe('pdfRoute', () => {
  it('manda el PDF directo si el modelo lo acepta (aunque también vea imágenes)', () => {
    expect(pdfRoute({ text: true, image: true, pdf: true })).toBe('direct')
  })
  it('manda páginas como imágenes si no acepta PDF pero sí imágenes', () => {
    expect(pdfRoute({ text: true, image: true, pdf: false })).toBe('images')
  })
  it('manda texto si solo lee texto', () => {
    expect(pdfRoute({ text: true, image: false, pdf: false })).toBe('text')
  })
  it('sin datos del modelo no transforma nada', () => {
    expect(pdfRoute(undefined)).toBeNull()
    expect(pdfRoute(null)).toBeNull()
  })
})

describe('pageImageName', () => {
  it('quita la extensión .pdf y numera la página', () => {
    expect(pageImageName('Informe.PDF', 3)).toBe('Informe-p3.jpg')
    expect(pageImageName('.pdf', 1)).toBe('documento-p1.jpg')
  })
})
