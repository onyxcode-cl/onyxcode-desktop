import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { PICK_LIMITS, PICK_STYLE_PROPS, type PickedElement } from '@shared/ipc-browser'
import { ALLOWED_CDP } from './api'
import {
  buildPickedElement,
  capPicked,
  captureElementImage,
  planElementClip,
  sanitizeDiagnostics,
  sanitizePickedHtml,
  sanitizeStyles,
  stripQuery,
  type PickRaw
} from './pick'
import { isCancelKey } from './keys'
import { PICKED_ELEMENT_SCHEMA } from '../ipc/schemas'

const FAKE_KEY = 'sk-' + 'a1B2c3D4e5F6g7H8'

function raw(over: Partial<PickRaw> = {}): PickRaw {
  return {
    tag: 'button',
    role: 'button',
    name: 'Comprar',
    text: 'Comprar ahora',
    selector: '[data-testid="buy"]',
    path: 'main > div.cta > button',
    html: '<button data-testid="buy" class="cta">Comprar ahora</button>',
    styles: { display: 'inline-block', color: 'rgb(255, 255, 255)' },
    rect: { x: 10, y: 20, width: 120, height: 40 },
    viewport: { width: 1280, height: 800, dpr: 2 },
    scrollX: 0,
    scrollY: 100,
    flags: { sensitive: false, inIframe: false, truncated: false },
    redactions: 0,
    ...over
  }
}

describe('stripQuery', () => {
  it('quita query, fragmento y credenciales', () => {
    expect(stripQuery('https://user:pw@example.com/a/b?token=1#x')).toBe('https://example.com/a/b')
    expect(stripQuery('http://localhost:5173/?x=1')).toBe('http://localhost:5173/')
    expect(stripQuery('/ruta?a=1#b')).toBe('/ruta')
    expect(stripQuery('#top')).toBe('#')
    expect(stripQuery('data:image/png;base64,AAAA')).toBe('data:…(recortado)')
    expect(stripQuery('javascript:alert(1)')).toBe('javascript:…(recortado)')
    expect(stripQuery('about:blank')).toBe('about:blank')
  })
  it('es idempotente', () => {
    for (const u of ['https://a.com/x?y=1', 'https://a.com', '/r?a#b', '#z', 'data:text/html,hola', '']) {
      expect(stripQuery(stripQuery(u))).toBe(stripQuery(u))
    }
  })
})

describe('sanitizePickedHtml', () => {
  it('quita value, campos de contraseña, hidden y autocomplete sensible', () => {
    const html =
      '<form action="https://a.com/login?next=/x"><input type="text" name="user" value="juan" placeholder="Usuario">' +
      '<INPUT TYPE=PASSWORD VALUE=hunter2>' +
      '<input type="hidden" name="csrf" value="SECRET123">' +
      '<input type="text" autocomplete="cc-number" value="4111111111111111">' +
      '<input type="text" autocomplete="one-time-code">' +
      "<input type='checkbox' checked>" +
      '<textarea name="m">mi secreto</textarea>' +
      '<select><option value="a" selected>Uno</option></select></form>'
    const r = sanitizePickedHtml(html)
    expect(r.html).not.toMatch(/juan|hunter2|SECRET123|4111|mi secreto|value=|checked|selected/i)
    expect(r.html).toContain('<input type="password" data-onyx-redacted>')
    expect(r.html).toContain('<input type="hidden" data-onyx-redacted>')
    expect(r.html).toContain('<input type="text" data-onyx-redacted>')
    expect(r.html).toContain('action="https://a.com/login"')
    expect(r.html).toContain('placeholder="Usuario"')
    expect(r.html).toContain('<textarea name="m"></textarea>')
    expect(r.sensitive).toBe(true)
    // value=juan, password, hidden, cc, otp, textarea, option value → ≥ 7 valores
    expect(r.redactions).toBeGreaterThanOrEqual(7)
  })

  it('quita on*, srcdoc, style, nonce, integrity y atributos con pinta de secreto', () => {
    const html =
      '<div onclick="x()" style="color:red" nonce="n" data-csrf-token="abc" data-session-id="s" aria-label="Menú" class="a">' +
      '<iframe srcdoc="<b>x</b>" src="https://e.com/p?q=1"></iframe><a href="/x?y=1#z" integrity="sha">ir</a></div>'
    const r = sanitizePickedHtml(html)
    expect(r.html).not.toMatch(/onclick|style=|nonce|csrf|session|srcdoc|integrity|q=1|y=1/)
    expect(r.html).toContain('aria-label="Menú"')
    expect(r.html).toContain('class="a"')
    expect(r.html).toContain('src="https://e.com/p"')
    expect(r.html).toContain('href="/x"')
  })

  it('elimina script, style, template, noscript y comentarios; reduce el svg', () => {
    const html =
      '<div><script>var t="SECRET";</script><style>.a{}</style><template><b>t</b></template><noscript>n</noscript>' +
      '<!-- nota privada --><svg viewBox="0 0 1 1"><path d="M0 0L1 1"/><svg><g/></svg></svg><p>ok</p></div>'
    const r = sanitizePickedHtml(html)
    expect(r.html).toBe('<div><svg viewBox="0 0 1 1"></svg><p>ok</p></div>')
  })

  it('reduce data:, blob: y javascript: de las URL', () => {
    const r = sanitizePickedHtml(
      '<img src="data:image/png;base64,AAAA"><a href="javascript:alert(1)">x</a><video poster="blob:https://a/1"></video>'
    )
    expect(r.html).toContain('src="data:…(recortado)"')
    expect(r.html).toContain('href="javascript:…(recortado)"')
    expect(r.html).toContain('poster="blob:…(recortado)"')
  })

  it('un > dentro de un valor entre comillas no rompe la etiqueta', () => {
    const r = sanitizePickedHtml('<a title="a > b" href="/p?x=1">t</a>')
    expect(r.html).toBe('<a title="a > b" href="/p">t</a>')
  })

  it('oculta claves en texto y en atributos y las cuenta', () => {
    const r = sanitizePickedHtml(`<p title="${FAKE_KEY}">clave ${FAKE_KEY} y Bearer abcdefgh12345678</p>`)
    expect(r.html).not.toContain(FAKE_KEY)
    expect(r.html).not.toContain('abcdefgh12345678')
    expect(r.redactions).toBeGreaterThanOrEqual(2)
  })

  it('recorta cada texto a 200 caracteres', () => {
    const r = sanitizePickedHtml(`<p>${'palabra '.repeat(100)}</p>`)
    const text = />([^<]*)</.exec(r.html)?.[1] ?? ''
    expect(text.length).toBe(PICK_LIMITS.textNode)
    expect(text.endsWith('…')).toBe(true)
  })

  it('no supera 4 KB, corta en una etiqueta completa y marca truncated', () => {
    const html = `<ul>${'<li class="item">elemento de prueba</li>'.repeat(400)}</ul>`
    const r = sanitizePickedHtml(html)
    expect(Buffer.byteLength(r.html)).toBeLessThanOrEqual(PICK_LIMITS.html)
    expect(r.truncated).toBe(true)
    expect(r.html.endsWith('<!-- recortado -->')).toBe(true)
    expect(r.html.slice(0, -'<!-- recortado -->'.length).endsWith('>')).toBe(true)
  })

  it('cuenta bytes, no caracteres (texto no ASCII)', () => {
    const html = `<div>${'<p>ñandú árbol</p>'.repeat(500)}</div>`
    expect(Buffer.byteLength(sanitizePickedHtml(html).html)).toBeLessThanOrEqual(PICK_LIMITS.html)
  })

  it('una etiqueta sin cerrar o basura binaria no revienta', () => {
    expect(sanitizePickedHtml('<div class="a').html).toBe('')
    expect(sanitizePickedHtml('a < b <3 <<<').html).not.toMatch(/<(?![!/])[^&]*$/)
    expect(() => sanitizePickedHtml('<'.repeat(100_000))).not.toThrow()
  })

  it('es idempotente', () => {
    const inputs = [
      '<form><input type="password" value="x"><input type="hidden" value="y"><textarea>z</textarea><p onclick="a()">hola   mundo</p></form>',
      `<div data-x="${FAKE_KEY}"><svg><path d="M"/></svg><!-- +3 más --><a href="/a?b=1">x</a></div>`,
      `<ul>${'<li class="item">elemento de prueba</li>'.repeat(400)}</ul>`,
      `<p>${'palabra '.repeat(100)}</p>`
    ]
    for (const input of inputs) {
      const once = sanitizePickedHtml(input).html
      const twice = sanitizePickedHtml(once)
      expect(twice.html).toBe(once)
      expect(twice.redactions).toBe(0)
    }
  })

  it('conserva los marcadores de recorte de la página', () => {
    expect(sanitizePickedHtml('<ul><li>a</li><!-- +5 más --></ul>').html).toBe('<ul><li>a</li><!-- +5 más --></ul>')
  })
})

describe('sanitizeStyles', () => {
  it('solo la lista cerrada, sin url(), con valores recortados y como mucho 40', () => {
    const input: Record<string, string> = {
      color: 'red',
      'background-image': 'url("https://a.com/x.png?token=1"), linear-gradient(red, blue)',
      'font-family': 'x'.repeat(500),
      content: '"hack"',
      '--secret': 'x',
      cursor: 'pointer'
    }
    const r = sanitizeStyles(input)
    expect(Object.keys(r.styles)).toEqual(['color', 'background-image', 'font-family', 'cursor'])
    expect(r.styles['background-image']).toBe('url(…), linear-gradient(red, blue)')
    expect(r.styles['font-family'].length).toBe(PICK_LIMITS.styleValue)
    expect(r.truncated).toBe(true)
    expect(Object.keys(sanitizeStyles(Object.fromEntries(PICK_STYLE_PROPS.map((p) => [p, '1px']))).styles).length).toBeLessThanOrEqual(40)
  })
  it('es idempotente y tolera basura', () => {
    const once = sanitizeStyles({ color: 'red', 'background-image': 'url(a)' }).styles
    expect(sanitizeStyles(once).styles).toEqual(once)
    expect(sanitizeStyles(null).styles).toEqual({})
    expect(sanitizeStyles({ color: 5 }).styles).toEqual({})
  })
})

describe('sanitizeDiagnostics', () => {
  it('sin query, sin secretos, últimos 10 y con topes', () => {
    const consoleIn = Array.from({ length: 15 }, (_, i) => ({
      level: i % 2 ? 'warn' : 'error',
      text: `fallo ${i} en https://a.com/x?token=abc#h ${FAKE_KEY}`
    }))
    const networkIn = [
      { method: 'get', url: 'https://a.com/api/x?token=1', status: 500 },
      { method: 'POST', url: 'https://a.com/api/y?z=1', error: 'net::ERR_CONNECTION_REFUSED' },
      { method: 'GET', url: 'https://a.com/ok?z=1', status: 200 },
      { method: 'GET', url: '', status: 404 }
    ]
    const { diagnostics, redactions } = sanitizeDiagnostics({
      console: [...consoleIn, { level: 'info', text: 'no' }],
      network: networkIn,
      sinceMs: 1234.6
    })
    expect(diagnostics!.console.length).toBeLessThanOrEqual(10)
    expect(JSON.stringify(diagnostics)).not.toMatch(/token=|#h|sk-a1B2/)
    expect(diagnostics!.network).toEqual([
      { method: 'GET', url: 'https://a.com/api/x', status: 500 },
      { method: 'POST', url: 'https://a.com/api/y', error: 'net::ERR_CONNECTION_REFUSED' }
    ])
    expect(diagnostics!.sinceMs).toBe(1235)
    expect(redactions).toBeGreaterThan(0)
    expect(diagnostics!.console.every((e) => e.text.length <= PICK_LIMITS.diagText)).toBe(true)
  })
  it('el total no pasa de 3 KB', () => {
    const big = Array.from({ length: 10 }, (_, i) => ({ level: 'error', text: `${i} ` + 'e'.repeat(290) }))
    const { diagnostics } = sanitizeDiagnostics({
      console: big,
      network: [{ method: 'GET', url: 'https://a.com/' + 'p'.repeat(400), status: 404 }],
      sinceMs: 5
    })
    expect(Buffer.byteLength(JSON.stringify(diagnostics))).toBeLessThanOrEqual(PICK_LIMITS.diagBytes)
  })
  it('es idempotente', () => {
    const first = sanitizeDiagnostics({
      console: [{ level: 'error', text: `x ${FAKE_KEY} https://a.com/?q=1` }],
      network: [{ method: 'GET', url: 'https://a.com/z?q=1', status: 404 }],
      sinceMs: 9
    }).diagnostics!
    expect(sanitizeDiagnostics(first).diagnostics).toEqual(first)
  })
  it('sin datos → undefined', () => {
    expect(sanitizeDiagnostics(undefined).diagnostics).toBeUndefined()
  })
})

describe('planElementClip y captureElementImage', () => {
  it('añade 8 px de margen, suma el scroll y limita a 800 px de lado largo', () => {
    const plan = planElementClip({ x: 100, y: 50, width: 200, height: 100 }, { x: 0, y: 300 })!
    expect(plan.clip).toMatchObject({ x: 92, y: 342, width: 216, height: 116, scale: 1 })
    const big = planElementClip({ x: 0, y: 0, width: 1600, height: 400 }, { x: 0, y: 0 })!
    expect(big.clip.scale).toBeCloseTo(800 / 1608, 5)
    expect(Math.max(big.width, big.height)).toBeLessThanOrEqual(800)
  })
  it('no se sale por arriba/izquierda', () => {
    const plan = planElementClip({ x: 2, y: 3, width: 50, height: 50 }, { x: 0, y: 0 })!
    expect(plan.clip.x).toBe(0)
    expect(plan.clip.y).toBe(0)
    expect(plan.clip.width).toBe(50 + 16 - 6)
  })
  it('null si el área es 0, no es finita o el lado corto queda por debajo de 8 px', () => {
    expect(planElementClip({ x: 0, y: 0, width: 0, height: 40 }, { x: 0, y: 0 })).toBeNull()
    expect(planElementClip({ x: NaN, y: 0, width: 10, height: 10 }, { x: 0, y: 0 })).toBeNull()
    expect(planElementClip({ x: 0, y: 0, width: 8000, height: 2 }, { x: 0, y: 0 })).toBeNull()
  })
  it('recaptura con calidad 60 si pasa de 300 KB y omite si aun así no cabe', async () => {
    const plan = planElementClip({ x: 0, y: 0, width: 100, height: 100 }, { x: 0, y: 0 })!
    const qualities: number[] = []
    const heavy = Buffer.alloc(PICK_LIMITS.imageBytes + 10, 1).toString('base64')
    const light = Buffer.alloc(1000, 2).toString('base64')
    const img = await captureElementImage(async (q) => {
      qualities.push(q)
      return q === 80 ? heavy : light
    }, plan)
    expect(qualities).toEqual([80, 60])
    expect(img?.dataUrl).toBe(`data:image/jpeg;base64,${light}`)
    expect(img).toMatchObject({ mime: 'image/jpeg', width: 108, height: 108 })
    expect(await captureElementImage(async () => heavy, plan)).toBeUndefined()
    expect(await captureElementImage(async () => 'no base64!', plan)).toBeUndefined()
    expect(await captureElementImage(async () => Promise.reject(new Error('x')), plan)).toBeUndefined()
  })
})

describe('buildPickedElement', () => {
  it('produce un PickedElement v2 que cumple el esquema estricto', () => {
    const el = buildPickedElement(raw(), {
      url: 'https://shop.example.com/cart?session=abc#top',
      title: 'Carrito',
      diagnostics: {
        console: [{ level: 'error', text: 'boom' }],
        network: [{ method: 'GET', url: 'https://shop.example.com/missing?x=1', status: 404 }],
        sinceMs: 800
      }
    })
    expect(el.v).toBe(2)
    expect(el.url).toBe('https://shop.example.com/cart')
    expect(el.diagnostics?.network).toEqual([{ method: 'GET', url: 'https://shop.example.com/missing', status: 404 }])
    expect(() => PICKED_ELEMENT_SCHEMA(el)).not.toThrow()
    expect(el.flags).toEqual({ sensitive: false, truncated: false })
  })

  it('una página hostil no puede colar datos: se vuelve a sanear todo', () => {
    const el = buildPickedElement(
      raw({
        html: `<input type="hidden" name="csrf" value="SECRET123"><p onclick="x()" title="${FAKE_KEY}">hola</p>`,
        text: `texto ${FAKE_KEY}`,
        name: `nombre ${FAKE_KEY}`,
        selector: `a[href="${FAKE_KEY}"]`,
        styles: { color: 'red', 'background-image': 'url(https://a.com/?t=1)' },
        redactions: 2
      }),
      { url: 'https://a.com/', title: `t ${FAKE_KEY}` }
    )
    const dump = JSON.stringify(el)
    expect(dump).not.toMatch(/SECRET123|sk-a1B2|onclick|t=1/)
    expect(el.redactions).toBeGreaterThanOrEqual(2 + 1 + 1)
    expect(() => PICKED_ELEMENT_SCHEMA(el)).not.toThrow()
  })

  it('con un campo sensible no hay imagen y flags.sensitive es true', () => {
    const image = { mime: 'image/jpeg' as const, dataUrl: 'data:image/jpeg;base64,AAAA', width: 10, height: 10 }
    const el = buildPickedElement(
      raw({ html: '<form><input type="password" value="x"></form>', flags: { sensitive: false, inIframe: false, truncated: false } }),
      {
        url: 'https://a.com/',
        title: 't',
        image
      }
    )
    expect(el.flags.sensitive).toBe(true)
    expect(el.image).toBeUndefined()
    const ok = buildPickedElement(raw(), { url: 'https://a.com/', title: 't', image })
    expect(ok.image).toEqual(image)
  })

  it('aplica los topes: html 4 KB, texto 300, nombre 80, estilos 40', () => {
    const el = buildPickedElement(
      raw({
        html: `<ul>${'<li class="item">elemento de prueba</li>'.repeat(400)}</ul>`,
        text: 'x '.repeat(400),
        name: 'n'.repeat(300),
        styles: Object.fromEntries(PICK_STYLE_PROPS.map((p) => [p, 'v'.repeat(500)]))
      }),
      { url: 'https://a.com/', title: 't'.repeat(500) }
    )
    expect(Buffer.byteLength(el.html)).toBeLessThanOrEqual(PICK_LIMITS.html)
    expect(el.text!.length).toBeLessThanOrEqual(PICK_LIMITS.text)
    expect(el.name!.length).toBeLessThanOrEqual(PICK_LIMITS.name)
    expect(el.title.length).toBeLessThanOrEqual(PICK_LIMITS.title)
    expect(Object.keys(el.styles).length).toBeLessThanOrEqual(PICK_LIMITS.styleCount)
    expect(Object.values(el.styles).every((v) => v.length <= PICK_LIMITS.styleValue)).toBe(true)
    expect(el.flags.truncated).toBe(true)
    expect(() => PICK_LIMITS && PICKED_ELEMENT_SCHEMA(el)).not.toThrow()
  })

  it('tolera una respuesta incompleta de la página sin lanzar', () => {
    const partial = { tag: 'div', html: '', selector: '', path: '' } as unknown as PickRaw
    const el = buildPickedElement(partial, { url: '', title: '' })
    expect(() => PICKED_ELEMENT_SCHEMA(el)).not.toThrow()
  })

  it('capPicked es idempotente', () => {
    const el = buildPickedElement(
      raw({ html: `<form><input type="hidden" value="a"><p>${'x'.repeat(5000)}</p></form>`, text: 'y'.repeat(900) }),
      {
        url: 'https://a.com/p?x=1',
        title: 'T',
        diagnostics: { console: [{ level: 'error', text: `e ${FAKE_KEY}` }], network: [], sinceMs: 3 }
      }
    )
    expect(capPicked(el)).toEqual(el)
    expect(capPicked(capPicked(el))).toEqual(capPicked(el))
  })
})

describe('PICKED_ELEMENT_SCHEMA', () => {
  const good = (): PickedElement => buildPickedElement(raw(), { url: 'https://a.com/', title: 'A' })
  it('rechaza claves extra, tag raro, estilos fuera de la lista, imagen que no es jpeg y html enorme', () => {
    expect(() => PICKED_ELEMENT_SCHEMA({ ...good(), extra: 1 })).toThrow()
    expect(() => PICKED_ELEMENT_SCHEMA({ ...good(), tag: 'Div<' })).toThrow()
    expect(() => PICKED_ELEMENT_SCHEMA({ ...good(), styles: { content: 'x' } })).toThrow()
    expect(() =>
      PICKED_ELEMENT_SCHEMA({ ...good(), image: { mime: 'image/png', dataUrl: 'data:image/png;base64,AA', width: 1, height: 1 } })
    ).toThrow()
    expect(() => PICKED_ELEMENT_SCHEMA({ ...good(), html: 'x'.repeat(PICK_LIMITS.html + 1) })).toThrow()
    expect(() => PICKED_ELEMENT_SCHEMA({ ...good(), v: 1 })).toThrow()
    expect(() =>
      PICKED_ELEMENT_SCHEMA({ ...good(), diagnostics: { console: [{ level: 'info', text: 'x' }], network: [], sinceMs: 0 } })
    ).toThrow()
  })
})

describe('sin canales ni métodos CDP nuevos', () => {
  it('ALLOWED_CDP queda igual que antes de F8-B71', () => {
    const hash = createHash('sha256').update(JSON.stringify(ALLOWED_CDP)).digest('hex')
    expect(hash).toBe('9ffce3eb6847aecb6f2125b424eac1499a2085d21a8247d3e560d89296c74630')
  })
})

describe('isCancelKey', () => {
  it('solo Esc sin modificadores', () => {
    expect(isCancelKey({ key: 'Escape' })).toBe(true)
    expect(isCancelKey({ key: 'Escape', meta: true })).toBe(false)
    expect(isCancelKey({ key: 'Escape', shift: true })).toBe(false)
    expect(isCancelKey({ key: 'a' })).toBe(false)
  })
})
