import { describe, expect, it } from 'vitest'
import { sanitizeNote, sanitizeTypeText } from './type-text-sanitize'

// Las etiquetas se arman con `tag()` para no escribir marcas de protocolo literales en este archivo.
const tag = (name: string, close = true, attrs = ''): string => `<${close ? '/' : ''}${name}${attrs}>`

describe('sanitizeTypeText', () => {
  it('quita etiquetas de protocolo sueltas al final', () => {
    expect(sanitizeTypeText(`Hola mundo${tag('parameter')}`)).toEqual({ text: 'Hola mundo', removed: ['</parameter>'] })
    expect(sanitizeTypeText(`Hola${tag('parameter')}\n${tag('invoke')}\n${tag('function_calls')}`)).toEqual({
      text: 'Hola',
      removed: ['</parameter>', '</invoke>', '</function_calls>']
    })
    expect(sanitizeTypeText('texto <|im_end|>').text).toBe('texto')
    expect(sanitizeTypeText('texto</s>').text).toBe('texto')
    expect(sanitizeTypeText(`texto\n${tag('tool_call')} `).text).toBe('texto')
    expect(sanitizeTypeText(`texto${tag('antml:parameter')}`).text).toBe('texto')
    expect(sanitizeTypeText(`texto${tag('parameter', true).toUpperCase()}`).text).toBe('texto')
    expect(sanitizeTypeText('texto<|endoftext|><|im_end|>').removed).toEqual(['<|endoftext|>', '<|im_end|>'])
  })

  it('también quita una apertura suelta con atributos al final', () => {
    expect(sanitizeTypeText(`listo${tag('parameter', false, ' name="text"')}`)).toEqual({
      text: 'listo',
      removed: ['<parameter name="text">']
    })
  })

  it('sin etiquetas al final devuelve el texto idéntico, con sus espacios y saltos finales', () => {
    for (const t of [
      'Hola',
      'Hola\n',
      'Hola  ',
      'a < b y c > d',
      '2 < 3',
      'usa <b>negrita</b> aquí',
      '<div>x</div>',
      'fin </s> medio y más'
    ]) {
      expect(sanitizeTypeText(t)).toEqual({ text: t, removed: [] })
    }
  })

  it('no toca etiquetas en medio del texto', () => {
    const t = `antes ${tag('parameter')} después`
    expect(sanitizeTypeText(t).text).toBe(t)
  })

  it('un cierre con su apertura en el propio texto es contenido legítimo', () => {
    const xml = `${tag('parameter', false, ' name="a"')}1${tag('parameter')}`
    expect(sanitizeTypeText(xml)).toEqual({ text: xml, removed: [] })
    const html = 'Ejemplo: <invoke name="x">hola</invoke>'
    expect(sanitizeTypeText(html).removed).toEqual([])
  })

  it('etiquetas HTML y de formato comunes no se consideran de protocolo', () => {
    for (const t of ['<p>hola</p>', 'x</div>', 'x</span>', 'x</code>', '<br>', 'x</body></html>', 'x<script></script>']) {
      expect(sanitizeTypeText(t).text).toBe(t)
    }
  })

  it('si el texto entero son etiquetas, no se toca', () => {
    expect(sanitizeTypeText(tag('parameter'))).toEqual({ text: tag('parameter'), removed: [] })
    expect(sanitizeTypeText('<|im_end|>')).toEqual({ text: '<|im_end|>', removed: [] })
  })

  it('texto en otros idiomas y con símbolos se conserva', () => {
    for (const t of ['日本語のテキスト', 'Привет, мир!', 'a|b|c', '<|', '|>', '[INSTALAR]', 'x [/b] y']) {
      expect(sanitizeTypeText(t).text).toBe(t)
    }
  })

  it('un texto con mil etiquetas seguidas termina (tope) y no cuelga', () => {
    const t = 'x' + tag('parameter').repeat(1000)
    const r = sanitizeTypeText(t)
    expect(r.removed.length).toBeLessThanOrEqual(32)
  })
})

describe('sanitizeNote', () => {
  it('vacía si no se quitó nada; nombra lo quitado si sí', () => {
    expect(sanitizeNote([])).toBe('')
    expect(sanitizeNote(['</parameter>'])).toContain('una etiqueta de protocolo')
    expect(sanitizeNote(['</parameter>'])).toContain('</parameter>')
    const many = sanitizeNote(['a', 'b', 'c', 'd'])
    expect(many).toContain('4 etiquetas')
    expect(many).toContain('…')
  })
})
