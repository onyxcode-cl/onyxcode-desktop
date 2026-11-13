import { describe, expect, it } from 'vitest'
import { htmlImageSources, mapHtmlImageSources } from './html-images'

describe('referencias img del HTML', () => {
  it('lee src real, comillas con >, atributos sin comillas y entidades sin tomar data-src', () => {
    const html = `<img data-src="decoy.jpg" alt="a > b" src="img/a&amp;b.jpg"><img src=img/c.jpg><IMG SRC='img/d&#46;jpg'>`
    expect(htmlImageSources(html)).toEqual(['img/a&b.jpg', 'img/c.jpg', 'img/d.jpg'])
    const mapped = mapHtmlImageSources(html, (source) => (source.startsWith('img/') ? 'data:image/png;base64,abc==' : source))
    expect(htmlImageSources(mapped)).toEqual(Array(3).fill('data:image/png;base64,abc=='))
    expect(mapped).toContain('data-src="decoy.jpg"')
    expect(mapped).toContain('alt="a > b"')
  })

  it('ignora comentarios, scripts, estilos y atributos de otra etiqueta', () => {
    const html = `<!-- <img src="comment.jpg"> --><script>const x='<img src="script.jpg">';</script><style>x{content:'<img src="style.jpg">'}</style><p title='<img src="attr.jpg">'>Texto</p><textarea><img src="textarea.jpg"></textarea><img src="real.jpg">`
    expect(htmlImageSources(html)).toEqual(['real.jpg'])
    const mapped = mapHtmlImageSources(html, () => 'replaced.jpg')
    expect(mapped).toContain('<img src="replaced.jpg">')
    expect(mapped).toContain('src="comment.jpg"')
    expect(mapped).toContain('src="script.jpg"')
  })

  it('usa solo primer src y escapa reemplazos sin crear atributos o etiquetas', () => {
    expect(htmlImageSources('<img src="first.jpg" src="second.jpg"><img src src="ignored.jpg">')).toEqual(['first.jpg'])
    const value = 'x" onerror="boom <img src=other>&'
    const mapped = mapHtmlImageSources('<img src=x.jpg>', () => value)
    expect(htmlImageSources(mapped)).toEqual([value])
    expect(mapped).toContain('&quot;')
    expect(mapped).not.toContain(' onerror="')
  })

  it('no lanza con entidades fuera de Unicode', () => {
    expect(htmlImageSources('<img src="&#999999999;.jpg">')).toEqual(['�.jpg'])
  })
})
