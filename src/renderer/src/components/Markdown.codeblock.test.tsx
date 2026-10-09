/**
 * Un bloque ```html "renderable" (documento completo, no un fragmento de código a leer) se oculta
 * por defecto en el chat — igual que Claude no muestra el código fuente de un artifact — y queda un
 * botón para desplegarlo. Un bloque de código normal (JS, Python, un <div> suelto…) se sigue viendo
 * siempre, como antes.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { isFenceOpen, isSameDoc, Markdown } from './Markdown'

const HTML_DOC = '```html\n<!doctype html><html><body><h1>hola</h1></body></html>\n```'
const HTML_FRAGMENT = '```html\n<div>un fragmento</div>\n```'
const SLIDES_DOC = '```slides\n<!doctype html><html><body><section class="slide"><h1>Intro</h1></section></body></html>\n```'
const JS_CODE = '```js\nconst x = 1\n```'
// Sin la valla de cierre: CommonMark la extiende hasta el final de lo recibido hasta ahora — el
// caso real de mientras el modelo todavía está escribiendo el documento.
const HTML_DOC_SIN_CERRAR = '```html\n<!doctype html><html><body><h1>hola</h1>'

describe('CodeBlock: colapso de bloques html "renderable"', () => {
  it('un documento HTML completo (renderable) arranca COLAPSADO: el código no se ve', () => {
    const html = renderToStaticMarkup(<Markdown text={HTML_DOC} />)
    expect(html).not.toContain('<pre>')
    expect(html).not.toContain('&lt;h1&gt;hola&lt;/h1&gt;')
  })

  it('el botón para desplegar el código existe aunque esté colapsado (aria-expanded=false)', () => {
    const html = renderToStaticMarkup(<Markdown text={HTML_DOC} />)
    expect(html).toContain('aria-expanded="false"')
  })

  it('un fragmento HTML (también renderable) arranca igual de colapsado', () => {
    const html = renderToStaticMarkup(<Markdown text={HTML_FRAGMENT} />)
    expect(html).not.toContain('<pre>')
  })

  it('```slides (deck en HTML/CSS) se trata como documento renderable, igual que ```html', () => {
    const html = renderToStaticMarkup(<Markdown text={SLIDES_DOC} />)
    expect(html).not.toContain('<pre>')
    expect(html).toContain('aria-expanded="false"')
  })

  it('un bloque de código normal (no HTML) se ve siempre, sin botón de desplegar', () => {
    const html = renderToStaticMarkup(<Markdown text={JS_CODE} />)
    expect(html).toContain('<pre>')
    expect(html).toContain('hljs-keyword') // el resaltado de sintaxis corrió: el código de verdad está ahí
    expect(html).not.toContain('aria-expanded')
  })

  it('un documento ya CERRADO no muestra "Generando documento" (ya le toca al renglón normal)', () => {
    const html = renderToStaticMarkup(<Markdown text={HTML_DOC} />)
    expect(html).not.toContain('Generando documento')
  })

  it('bug real: mientras la valla ```html sigue ABIERTA, muestra "Generando documento…" en vez del renglón normal', () => {
    // Este es el caso que `isSameDoc`+`useSyncExternalStore` solos NUNCA detectaban: react-markdown
    // ya pinta el bloque como "completo" (colapsado, con sus botones) apenas aparece una etiqueta,
    // mucho antes de que la valla de cierre realmente llegue — por eso hacía falta esta señal aparte.
    const html = renderToStaticMarkup(<Markdown text={HTML_DOC_SIN_CERRAR} />)
    expect(html).toContain('Generando documento')
    expect(html).not.toContain('aria-expanded')
    expect(html).not.toContain('Abrir vista previa')
  })
})

describe('isFenceOpen: ¿la valla de código sigue sin cerrar?', () => {
  it('sin ninguna línea de cierre: abierta', () => {
    expect(isFenceOpen('```html\n<!doctype html><html>')).toBe(true)
  })

  it('con la línea de cierre (solo backticks, nada más): cerrada', () => {
    expect(isFenceOpen('```html\n<!doctype html></html>\n```')).toBe(false)
  })

  it('la línea de apertura NO se confunde con una de cierre (trae el lenguaje)', () => {
    expect(isFenceOpen('```html')).toBe(true)
  })

  it('líneas en blanco al final no cuentan como cierre', () => {
    expect(isFenceOpen('```html\n<p>x</p>\n\n\n')).toBe(true)
  })

  it('tilde (~~~) también cuenta como cierre', () => {
    expect(isFenceOpen('~~~html\n<p>x</p>\n~~~')).toBe(false)
  })

  it('una línea con backticks pero texto extra (no es un cierre real): sigue abierta', () => {
    expect(isFenceOpen('```html\n<p>usa ``` en el medio del texto</p>')).toBe(true)
  })
})

describe('isSameDoc: qué bloque es "este" documento que se está generando', () => {
  // La rama de "Generando documento…" depende de useSyncExternalStore, que en SSR
  // (renderToStaticMarkup, usada arriba) ignora el store real y usa el snapshot de servidor — así
  // que esa rama no se puede ejercitar con esos tests. Se prueba la comparación en sí, pura.
  const code = '<!doctype html><html><body><h1>hola</h1></body></html>'

  it('nada generándose: false', () => {
    expect(isSameDoc(null, code)).toBe(false)
  })

  it('generándose ESTE documento: true', () => {
    expect(isSameDoc(code, code)).toBe(true)
  })

  it('generándose OTRO documento: false', () => {
    expect(isSameDoc('<div>otro</div>', code)).toBe(false)
  })

  it('tolera espacios/saltos de línea de más en los extremos (react-markdown vs. el fragmento crudo)', () => {
    expect(isSameDoc(`  ${code}\n`, code)).toBe(true)
  })
})
