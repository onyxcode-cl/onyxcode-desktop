import { describe, expect, it } from 'vitest'
import { parseLenient } from './json-lenient'

describe('parseLenient', () => {
  it('JSON válido: igual que JSON.parse', () => {
    expect(parseLenient('{"a":[1,2],"b":"x12"}')).toEqual({ a: [1, 2], b: 'x12' })
  })
  it('repara una comilla de más tras true/false/null/número (el fallo real de un PowerPoint)', () => {
    expect(parseLenient('{"a":{"bold":true"},"b":[1,2,3"]}')).toEqual({ a: { bold: true }, b: [1, 2, 3] })
    expect(parseLenient('{"size":18"}')).toEqual({ size: 18 })
    expect(parseLenient('[{"x":null"},{"y":false"}]')).toEqual([{ x: null }, { y: false }])
  })
  it('repara comas colgando', () => {
    expect(parseLenient('{"a":[1,2,],"b":{"c":1,}}')).toEqual({ a: [1, 2], b: { c: 1 } })
  })
  it('no toca el texto de las cadenas', () => {
    expect(parseLenient('{"t":"dijo \\"hola\\" y 12","n":3"}')).toEqual({ t: 'dijo "hola" y 12', n: 3 })
  })
  it('lo que no sabe reparar sigue fallando con el error original', () => {
    expect(() => parseLenient('{"a":')).toThrow()
    expect(() => parseLenient('hola')).toThrow()
  })
})
