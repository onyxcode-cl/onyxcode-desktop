import { describe, expect, it } from 'vitest'
import { pairChangedRuns, wordRanges, wrapRanges } from './diff-words'

const L = (kinds: string[]): Array<{ kind: string; text: string }> => kinds.map((kind) => ({ kind, text: '' }))

describe('pairChangedRuns', () => {
  it('empareja cada bloque del→add por índice hasta el más corto', () => {
    expect(pairChangedRuns(L(['del', 'del', 'add', 'add']))).toEqual([
      { del: 0, add: 2 },
      { del: 1, add: 3 }
    ])
    expect(pairChangedRuns(L(['del', 'del', 'del', 'add', 'add']))).toEqual([
      { del: 0, add: 3 },
      { del: 1, add: 4 }
    ])
  })
  it('sin bloque add contiguo no empareja; un ctx en medio separa los bloques', () => {
    expect(pairChangedRuns(L(['del', 'ctx', 'add']))).toEqual([])
    expect(pairChangedRuns(L(['add', 'del']))).toEqual([])
    expect(pairChangedRuns(L(['del', 'ctx', 'del', 'add', 'add']))).toEqual([{ del: 2, add: 3 }])
  })
  it('varios bloques seguidos y tope de 200 pares', () => {
    const kinds = ['del', 'add', 'del', 'add', 'del', 'add']
    expect(pairChangedRuns(L(kinds))).toEqual([
      { del: 0, add: 1 },
      { del: 2, add: 3 },
      { del: 4, add: 5 }
    ])
    const big = [...Array<string>(300).fill('del'), ...Array<string>(300).fill('add')]
    expect(pairChangedRuns(L(big)).length).toBe(200)
  })
})

describe('wordRanges', () => {
  it('marca las palabras añadidas', () => {
    const a = 'import { redondear } from X'
    const b = 'import { IVA, redondear } from X'
    const ranges = wordRanges(a, b)
    expect(b.slice(ranges[0]!.start, ranges[0]!.end)).toBe('IVA, ')
  })
  it('marca las palabras quitadas en la dirección contraria', () => {
    const a = 'import { redondear } from X'
    const b = 'import { IVA, redondear } from X'
    const ranges = wordRanges(b, a)
    // en `a` (b como referencia) no hay nada quitado: sin rangos
    expect(ranges).toEqual([])
  })
  it('devuelve [] con líneas idénticas o vacías', () => {
    expect(wordRanges('hola', 'hola')).toEqual([])
    expect(wordRanges('', '')).toEqual([])
    expect(wordRanges('', 'nueva línea entera')).toEqual([]) // 100 % cambiado
  })
  it('devuelve [] si la línea supera 400 caracteres', () => {
    expect(wordRanges('a', 'a'.repeat(401))).toEqual([])
    expect(wordRanges('x'.repeat(401), 'x')).toEqual([])
  })
  it('devuelve [] si cambia más del 60 % de la línea', () => {
    expect(wordRanges('abc', 'xyz')).toEqual([])
  })
  it('varios tramos añadidos', () => {
    const ranges = wordRanges('a b c', 'a X b Y c')
    expect(ranges.map((r) => 'a X b Y c'.slice(r.start, r.end))).toEqual(['X ', 'Y '])
  })
})

describe('wrapRanges', () => {
  it('sin rangos devuelve el HTML igual', () => {
    expect(wrapRanges('<span>hola</span>', [])).toBe('<span>hola</span>')
  })
  it('envuelve un rango de texto plano', () => {
    expect(wrapRanges('abcde', [{ start: 1, end: 4 }])).toBe('a<span data-w="">bcd</span>e')
  })
  it('envuelve respetando entidades (cada entidad cuenta un carácter)', () => {
    // texto "a<b&c" con < y & escapados; el rango [1,4) = "<b&"
    expect(wrapRanges('a&lt;b&amp;c', [{ start: 1, end: 4 }])).toBe('a<span data-w="">&lt;b&amp;</span>c')
  })
  it('cierra y reabre en los límites de etiqueta anidada', () => {
    const html = '<span class="hljs-type">IVA</span>, redondear'
    const out = wrapRanges(html, [{ start: 0, end: 5 }])
    expect(out).toBe('<span class="hljs-type"><span data-w="">IVA</span></span><span data-w="">, </span>redondear')
  })
  it('un rango dentro de una etiqueta no rompe el anidado', () => {
    const html = '<span class="k">const</span>'
    const out = wrapRanges(html, [{ start: 1, end: 4 }])
    // el realce se cierra antes de </span> y se reabre dentro, sin cruzar la etiqueta
    expect(out).toBe('<span class="k">c<span data-w="">ons</span>t</span>')
  })
  it('rango que llega hasta el final', () => {
    expect(wrapRanges('abc', [{ start: 1, end: 3 }])).toBe('a<span data-w="">bc</span>')
  })
})
