import { describe, expect, it } from 'vitest'
import { parseViewerParams, docUrl } from './params'

const TOKEN = 'a'.repeat(64)

describe('parseViewerParams', () => {
  it('con los 4 campos válidos, los devuelve', () => {
    expect(parseViewerParams(`#t=${TOKEN}&kind=pdf&lang=es&theme=dark`)).toEqual({
      token: TOKEN,
      kind: 'pdf',
      lang: 'es',
      theme: 'dark'
    })
  })

  it('funciona sin el "#" inicial', () => {
    expect(parseViewerParams(`t=${TOKEN}&kind=docx&lang=en&theme=light`)).toEqual({
      token: TOKEN,
      kind: 'docx',
      lang: 'en',
      theme: 'light'
    })
  })

  it('token con largo o caracteres inválidos: null', () => {
    expect(parseViewerParams(`#t=corto&kind=pdf&lang=es&theme=dark`)).toBeNull()
    expect(parseViewerParams(`#t=${'g'.repeat(64)}&kind=pdf&lang=es&theme=dark`)).toBeNull()
  })

  it('kind desconocido: null', () => {
    expect(parseViewerParams(`#t=${TOKEN}&kind=exe&lang=es&theme=dark`)).toBeNull()
  })

  it('lang desconocido: null', () => {
    expect(parseViewerParams(`#t=${TOKEN}&kind=pdf&lang=fr&theme=dark`)).toBeNull()
  })

  it('theme desconocido: null', () => {
    expect(parseViewerParams(`#t=${TOKEN}&kind=pdf&lang=es&theme=auto`)).toBeNull()
  })

  it('falta algún campo: null', () => {
    expect(parseViewerParams(`#t=${TOKEN}&kind=pdf&lang=es`)).toBeNull()
    expect(parseViewerParams('')).toBeNull()
  })
})

describe('docUrl', () => {
  it('arma la ruta relativa del documento', () => {
    expect(docUrl(TOKEN)).toBe(`/doc/${TOKEN}`)
  })
})
