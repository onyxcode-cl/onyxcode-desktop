import { describe, expect, it } from 'vitest'
import { htmlProblem, visibleText } from '../../../e2e/fake-telegram/server.mjs'
import { agoParts, chunkAnswer, inlineHtml, plainFileText, previewBlock } from './format'

/** Clave de mentira armada en tiempo de ejecución. */
const fakeKey = (): string => ['sk', 'proj', 'A1b2C3d4E5f6G7h8I9j0K1l2'].join('-')

const valid = (chunks: string[]): void => {
  for (const c of chunks) {
    expect(htmlProblem(c), c.slice(0, 120)).toBeNull()
    expect(visibleText(c).length).toBeLessThanOrEqual(4096)
    expect(c.length).toBeLessThanOrEqual(3800)
  }
}

describe('inlineHtml', () => {
  it('convierte negrita, código y títulos y escapa el resto', () => {
    expect(inlineHtml('Hola **mundo** y `x < y`')).toBe('Hola <b>mundo</b> y <code>x &lt; y</code>')
    expect(inlineHtml('# Título & más')).toBe('<b>Título &amp; más</b>')
    expect(inlineHtml('a <script>alert(1)</script> & b')).toBe('a &lt;script&gt;alert(1)&lt;/script&gt; &amp; b')
  })
  it('la negrita no cruza un trozo de código: las etiquetas nunca quedan cruzadas', () => {
    const html = inlineHtml('**a `b**` c')
    expect(htmlProblem(html)).toBeNull()
    expect(htmlProblem(inlineHtml('`a **b` c**'))).toBeNull()
  })
})

describe('chunkAnswer: partición con HTML válido', () => {
  it('un texto corto es un solo trozo', () => {
    expect(chunkAnswer('Listo, terminé.')).toEqual(['Listo, terminé.'])
    expect(chunkAnswer('   ')).toEqual([])
  })

  it('un texto largo con párrafos se parte por líneas y cada trozo es válido', () => {
    const para = (i: number): string => `Párrafo ${i}: ${'palabra '.repeat(40)}con **negrita** y \`código\` & <etiquetas>.`
    const text = Array.from({ length: 120 }, (_, i) => para(i)).join('\n\n')
    const chunks = chunkAnswer(text)
    expect(chunks.length).toBeGreaterThan(2)
    valid(chunks)
    // No se pierde nada: todos los párrafos aparecen.
    const all = chunks.map(visibleText).join('\n')
    for (let i = 0; i < 120; i += 17) expect(all).toContain(`Párrafo ${i}:`)
  })

  it('un bloque de código que cruza varios trozos se cierra y se reabre en cada uno', () => {
    const code = Array.from({ length: 400 }, (_, i) => `const linea${i} = "<div>&</div>" // ${'x'.repeat(30)}`).join('\n')
    const chunks = chunkAnswer('Antes\n```ts\n' + code + '\n```\nDespués')
    expect(chunks.length).toBeGreaterThan(2)
    valid(chunks)
    for (const c of chunks.slice(0, -1)) {
      const opens = (c.match(/<pre>/g) ?? []).length
      const closes = (c.match(/<\/pre>/g) ?? []).length
      expect(opens).toBe(closes)
    }
    expect(chunks.at(-1)).toContain('Después')
  })

  it('una sola línea larguísima (sin saltos) se parte a la fuerza y sigue siendo válida', () => {
    const chunks = chunkAnswer('&'.repeat(20000))
    valid(chunks)
    expect(chunks.length).toBeGreaterThan(3)
    expect(chunks.map(visibleText).join('').length).toBe(20000)
  })

  it('el tapado ocurre ANTES de partir: una clave en el límite entre dos trozos no queda a la vista', () => {
    const key = fakeKey()
    for (const pad of [3700, 3750, 3790, 3799, 3800, 3801]) {
      const text = 'a'.repeat(pad) + ' ' + key + ' ' + 'b'.repeat(500)
      const joined = chunkAnswer(text).join('')
      expect(joined).not.toContain(key)
      expect(joined).not.toContain(key.slice(0, 14))
    }
  })

  it('caracteres de control y direccionales se quitan', () => {
    const out = chunkAnswer('hola\u0000‮mundo')
    expect(out[0]).toBe('holamundo')
  })
})

describe('recortes', () => {
  it('previewBlock deja inicio y final, escapa y avisa de lo omitido', () => {
    const raw = `INICIO ${'<x>'.repeat(2000)} FINAL`
    const pv = previewBlock(raw, 300, (n) => `[omitidos ${n}]`)
    expect(pv.trimmed).toBe(true)
    expect(pv.html).toContain('INICIO')
    expect(pv.html).toContain('FINAL')
    expect(pv.html).toContain('[omitidos')
    expect(pv.html).not.toContain('<x>')
  })
  it('plainFileText tapa claves', () => {
    expect(plainFileText(`token ${fakeKey()}`)).not.toContain(fakeKey())
  })
  it('agoParts', () => {
    expect(agoParts(10_000, 9_000).unit).toBe('now')
    expect(agoParts(400_000, 100_000)).toEqual({ unit: 'min', n: 5 })
    expect(agoParts(10_000_000, 1_000_000)).toEqual({ unit: 'hour', n: 2 })
    expect(agoParts(900_000_000, 1_000_000).unit).toBe('day')
  })
})
