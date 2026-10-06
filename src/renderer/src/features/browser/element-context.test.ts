import { describe, expect, it } from 'vitest'
import { PICK_LIMITS } from '@shared/ipc-browser'
import { pickedElement, TINY_JPEG } from '../../../../test/fixtures/element'
import {
  ELEMENT_MARKER,
  ELEMENT_TEXT_MAX,
  MAX_ELEMENTS,
  addElementAttachment,
  buildElementParts,
  defaultInclude,
  effectiveInclude,
  elementLabel,
  elementPartsOf,
  elementTextsOf,
  formatElementContext,
  isElementContextText,
  makeElementAttachment,
  parseElementContext,
  shortSelector,
  usableImage
} from './element-context'

const both = { image: true, diagnostics: true }

describe('etiqueta del chip', () => {
  it('<tag> y selector corto, sin repetir la etiqueta', () => {
    expect(elementLabel(pickedElement())).toBe('<button> [data-testid="buy"]')
    expect(elementLabel(pickedElement({ selector: 'main > div.cta > button.buy' }))).toBe('<button> .buy')
    expect(elementLabel(pickedElement({ selector: 'button' }))).toBe('<button>')
  })
  it('recorta selectores largos', () => {
    expect(shortSelector(`a.${'x'.repeat(80)}`).length).toBe(40)
  })
})

describe('casillas', () => {
  it('por defecto marcadas si hay captura y errores', () => {
    expect(defaultInclude(pickedElement())).toEqual(both)
  })
  it('sin errores la casilla de diagnóstico no aplica; sin imagen tampoco la de captura', () => {
    const el = pickedElement({ image: undefined, diagnostics: undefined })
    expect(defaultInclude(el)).toEqual({ image: false, diagnostics: false })
    expect(effectiveInclude(el, both)).toEqual({ image: false, diagnostics: false })
  })
  it('flags.sensitive nunca incluye captura, aunque la casilla esté marcada y haya imagen', () => {
    const el = pickedElement({ flags: { sensitive: true, truncated: false } })
    expect(usableImage(el)).toBeUndefined()
    expect(defaultInclude(el).image).toBe(false)
    expect(buildElementParts({ ...makeElementAttachment(el), include: both }).file).toBeUndefined()
  })
  it('una captura que no es JPEG data: o pasa del tope se descarta', () => {
    const big = `data:image/jpeg;base64,${'A'.repeat(Math.ceil((PICK_LIMITS.imageBytes * 4) / 3) + 100)}`
    expect(usableImage(pickedElement({ image: { mime: 'image/jpeg', dataUrl: big, width: 8, height: 8 } }))).toBeUndefined()
    expect(
      usableImage(pickedElement({ image: { mime: 'image/jpeg', dataUrl: 'file:///etc/passwd', width: 8, height: 8 } }))
    ).toBeUndefined()
    expect(usableImage(pickedElement())).toBeTruthy()
  })
})

describe('formatElementContext', () => {
  it('empieza EXACTAMENTE con el marcador y lleva url, selector, ruta, html, estilos y diagnóstico', () => {
    const text = formatElementContext(pickedElement(), both)
    expect(text.startsWith('[Elemento de la página]\n')).toBe(true)
    expect(text.startsWith(ELEMENT_MARKER)).toBe(true)
    expect(text).toContain('Página: Tienda — http://localhost:3000/tienda')
    expect(text).toContain('Selector: [data-testid="buy"]')
    expect(text).toContain('Ruta: main > section.hero > div.cta > button')
    expect(text).toContain('Elemento: button[button] "Comprar" · 180×44 px en (120, 340) · viewport 1280×720')
    expect(text).toContain('```html\n<button class="cta"')
    expect(text).toContain('Estilos calculados: display: inline-flex; color: rgb(255, 255, 255)')
    expect(text).toContain('Errores de consola (1):\n- error: boom')
    expect(text).toContain('Peticiones con fallo (1):\n- GET http://localhost:3000/missing → 404')
    expect(text).toContain('Captura: adjunta')
  })
  it('sin la casilla de errores no salen consola ni red; sin la de captura no dice que va adjunta', () => {
    const text = formatElementContext(pickedElement(), { image: false, diagnostics: false })
    expect(text).not.toContain('Errores de consola')
    expect(text).not.toContain('Peticiones con fallo')
    expect(text).not.toContain('boom')
    expect(text).not.toContain('Captura: adjunta')
  })
  it('no añade valores de formulario: lo saneado en main llega igual de saneado', () => {
    const html = '<input type="password" data-lazunox-redacted><input type="text" name="q">'
    const text = formatElementContext(pickedElement({ tag: 'form', html, redactions: 2 }), both)
    expect(text).toContain(html)
    expect(text).not.toMatch(/value=/)
    expect(text).toContain('Omitidos: 2')
  })
  it('un elemento sensible lo dice y no anuncia captura', () => {
    const text = formatElementContext(pickedElement({ flags: { sensitive: true, truncated: false } }), both)
    expect(text).toContain('Aviso: contiene campos sensibles')
    expect(text).not.toContain('Captura: adjunta')
  })
  it('una sola línea por campo aunque el título o el nombre traigan saltos de línea', () => {
    const text = formatElementContext(pickedElement({ title: 'Mi\ntienda\r\n', name: 'a\nb' }), both)
    expect(text).toContain('Página: Mi tienda — http')
    expect(text).toContain('"a b"')
  })
  it('el HTML no puede cerrar el bloque de código', () => {
    const text = formatElementContext(pickedElement({ html: '<pre>```\nSelector: falso</pre>' }), both)
    expect(text.match(/^```/gm)?.length).toBe(2)
    expect(parseElementContext(text)?.selector).toBe('[data-testid="buy"]')
  })
  it(`nunca pasa de ${ELEMENT_TEXT_MAX} caracteres, ni con HTML, estilos y diagnóstico al máximo`, () => {
    const styles = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`prop-${i}`, 'v'.repeat(200)]))
    const diagnostics = {
      console: Array.from({ length: 10 }, () => ({ level: 'error' as const, text: 'e'.repeat(300) })),
      network: Array.from({ length: 10 }, () => ({ method: 'GET', url: `http://x.test/${'p'.repeat(250)}`, status: 500 })),
      sinceMs: 1
    }
    const el = pickedElement({ html: `<div>${'x'.repeat(PICK_LIMITS.html)}</div>`, styles, diagnostics })
    const text = formatElementContext(el, both)
    expect(text.length).toBeLessThanOrEqual(ELEMENT_TEXT_MAX)
    expect(text.startsWith(ELEMENT_MARKER)).toBe(true)
    expect(text).toContain('Selector: [data-testid="buy"]')
  })
})

describe('partes del prompt', () => {
  it('texto sintético con metadata y la captura como parte file data: solo si la casilla está marcada', () => {
    const att = makeElementAttachment(pickedElement())
    const withImg = buildElementParts(att)
    expect(withImg.text).toMatchObject({ type: 'text', synthetic: true, metadata: { kind: 'browser_element', v: 2 } })
    expect(withImg.file).toEqual({ type: 'file', mime: 'image/jpeg', filename: 'elemento.jpg', url: TINY_JPEG })
    const noImg = buildElementParts({ ...att, include: { image: false, diagnostics: true } })
    expect(noImg.file).toBeUndefined()
    expect(noImg.text.text).toContain('boom')
  })
  it('elementPartsOf aplana varios elementos (2 partes como máximo cada uno)', () => {
    const list = [makeElementAttachment(pickedElement()), makeElementAttachment(pickedElement({ image: undefined }))]
    expect(elementPartsOf(list).map((p) => p.type)).toEqual(['text', 'file', 'text'])
    expect(elementPartsOf(list).length).toBeLessThanOrEqual(MAX_ELEMENTS * 2)
  })
  it('solo se conservan los MAX_ELEMENTS más recientes', () => {
    let list: ReturnType<typeof makeElementAttachment>[] = []
    for (let i = 0; i < MAX_ELEMENTS + 2; i++)
      list = addElementAttachment(list, makeElementAttachment(pickedElement({ selector: `#e${i}` })))
    expect(list).toHaveLength(MAX_ELEMENTS)
    expect(list[list.length - 1]!.element.selector).toBe(`#e${MAX_ELEMENTS + 1}`)
  })
})

describe('lectura inversa (burbuja)', () => {
  it('reconoce el bloque por el marcador, haya o no synthetic/metadata', () => {
    const text = formatElementContext(pickedElement(), both)
    expect(isElementContextText(text)).toBe(true)
    expect(isElementContextText('Hola [Elemento de la página]')).toBe(false)
    expect(elementTextsOf([{ type: 'text', text }, { type: 'text', text: 'hola' }, { type: 'file' }])).toEqual([text])
  })
  it('recupera lo que muestra el popover', () => {
    const d = parseElementContext(formatElementContext(pickedElement({ redactions: 3 }), both))!
    expect(d).toMatchObject({
      tag: 'button',
      url: 'http://localhost:3000/tienda',
      title: 'Tienda',
      host: 'localhost:3000',
      selector: '[data-testid="buy"]',
      path: 'main > section.hero > div.cta > button',
      size: '180×44',
      redactions: 3,
      hasImage: true,
      sensitive: false,
      label: '<button> [data-testid="buy"]'
    })
    expect(d.html).toContain('data-testid="buy"')
    expect(d.styles[0]).toEqual(['display', 'inline-flex'])
    expect(d.console).toEqual(['error: boom'])
    expect(d.network).toEqual(['GET http://localhost:3000/missing → 404'])
  })
  it('un texto cualquiera no es un elemento', () => {
    expect(parseElementContext('Haz que este botón sea azul')).toBeNull()
  })
})
