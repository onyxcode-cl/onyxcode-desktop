import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { pickedElement } from '../../../../test/fixtures/element'
import { ElementChipRow, ElementReadonlyChip } from './ElementChip'
import { ElementDetailBody } from './ElementDetailPopover'
import { detailFromElement, formatElementContext, makeElementAttachment, parseElementContext } from './element-context'

const noop = (): void => undefined

describe('ElementChipRow (compositor)', () => {
  it('chip con etiqueta, host y tamaño, botón quitar accesible y región aria-live', () => {
    const att = makeElementAttachment(pickedElement())
    const html = renderToStaticMarkup(<ElementChipRow elements={[att]} onRemove={noop} onInclude={noop} />)
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('data-testid="element-chips"')
    expect(html).toContain('&lt;button&gt; [data-testid=&quot;buy&quot;]')
    expect(html).toContain('localhost:3000 · 180×44')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('Quitar &lt;button&gt;')
    expect(html).toContain('2 errores')
    expect(html).toContain('<img')
  })
  it('sin elementos solo queda la región aria-live (vacía)', () => {
    const html = renderToStaticMarkup(<ElementChipRow elements={[]} onRemove={noop} onInclude={noop} />)
    expect(html).not.toContain('element-chips')
    expect(html).toContain('aria-live="polite"')
  })
  it('con la casilla de errores desmarcada el chip no muestra la insignia de errores', () => {
    const att = { ...makeElementAttachment(pickedElement()), include: { image: true, diagnostics: false } }
    expect(renderToStaticMarkup(<ElementChipRow elements={[att]} onRemove={noop} onInclude={noop} />)).not.toContain('2 errores')
  })
  it('un elemento sensible no enseña miniatura', () => {
    const att = makeElementAttachment(pickedElement({ flags: { sensitive: true, truncated: false } }))
    expect(renderToStaticMarkup(<ElementChipRow elements={[att]} onRemove={noop} onInclude={noop} />)).not.toContain('<img')
  })
})

describe('ElementDetailBody', () => {
  const el = pickedElement({ redactions: 2 })
  it('muestra selector, ruta, HTML, estilos, consola, red, las dos casillas marcadas y el aviso de omitidos', () => {
    const html = renderToStaticMarkup(
      <ElementDetailBody
        detail={detailFromElement(el)}
        include={{ image: true, diagnostics: true }}
        onIncludeChange={noop}
        canIncludeImage
      />
    )
    expect(html).toContain('[data-testid=&quot;buy&quot;]')
    expect(html).toContain('main &gt; section.hero')
    expect(html).toContain('Incluir captura')
    expect(html).toContain('Incluir errores de consola y red')
    expect(html.match(/type="checkbox"/g)).toHaveLength(2)
    expect(html.match(/checked=""/g)).toHaveLength(2)
    expect(html).toContain('Se omitieron 2 datos')
    expect(html).toContain('GET http://localhost:3000/missing → 404')
    expect(html).toContain('display')
  })
  it('sin captura utilizable la casilla de captura está desactivada y desmarcada', () => {
    const html = renderToStaticMarkup(
      <ElementDetailBody
        detail={detailFromElement(pickedElement({ flags: { sensitive: true, truncated: false } }))}
        include={{ image: true, diagnostics: true }}
        onIncludeChange={noop}
        canIncludeImage={false}
      />
    )
    expect(html.match(/disabled=""/g)).toHaveLength(1)
    expect(html.match(/checked=""/g)).toHaveLength(1)
    expect(html).toContain('Contiene campos sensibles')
  })
  it('sin casillas (burbuja) es de solo lectura', () => {
    const d = parseElementContext(formatElementContext(el, { image: true, diagnostics: true }))!
    expect(renderToStaticMarkup(<ElementDetailBody detail={d} />)).not.toContain('type="checkbox"')
  })
})

describe('ElementReadonlyChip (burbuja)', () => {
  it('chip compacto con etiqueta y host, sin el volcado completo', () => {
    const d = parseElementContext(formatElementContext(pickedElement(), { image: true, diagnostics: true }))!
    const html = renderToStaticMarkup(<ElementReadonlyChip detail={d} />)
    expect(html).toContain('&lt;button&gt; [data-testid=&quot;buy&quot;]')
    expect(html).toContain('· localhost:3000')
    expect(html).not.toContain('Estilos calculados')
    expect(html).not.toContain('class=&quot;cta&quot;')
  })
})
