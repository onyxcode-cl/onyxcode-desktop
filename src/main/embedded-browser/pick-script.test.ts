/**
 * `pickInPage` se prueba tal y como corre en la página: se serializa con `.toString()` (como `Runtime.callFunctionOn`) y se evalúa
 * con `new Function` sobre un DOM de mentira mínimo. Así se fija que es autocontenida (no depende de nada del módulo).
 */
import { describe, expect, it } from 'vitest'
import { PICK_LIMITS } from '@shared/ipc-browser'
import { PICKED_ELEMENT_SCHEMA } from '../ipc/schemas'
import { buildPickedElement, sanitizePickedHtml, type PickRaw } from './pick'
import { pickInPageSource, pickLimitsForPage } from './pick-script'

interface FakeNode {
  nodeType: number
  nodeName: string
  data?: string
  attrs: [string, string][]
  attributes: { name: string; value: string }[]
  childNodes: FakeNode[]
  children: FakeNode[]
  parentElement: FakeNode | null
  ownerDocument: FakeDoc
  value?: string
  textContent: string
  getAttribute(n: string): string | null
  getBoundingClientRect(): { x: number; y: number; width: number; height: number }
}

interface FakeDoc {
  defaultView: unknown
  documentElement: FakeNode
  body: FakeNode
  all: FakeNode[]
  getElementById(id: string): FakeNode | null
  querySelectorAll(sel: string): FakeNode[]
}

function makeDoc(styles: Record<string, string> = {}): FakeDoc {
  const doc = { all: [] as FakeNode[] } as FakeDoc
  const win = {
    innerWidth: 1280,
    innerHeight: 800,
    devicePixelRatio: 2,
    scrollX: 0,
    scrollY: 120,
    parent: null as unknown,
    getComputedStyle: () => ({ getPropertyValue: (p: string) => styles[p] ?? '' })
  }
  win.parent = win
  doc.defaultView = win
  doc.getElementById = (id) => doc.all.find((n) => n.attrs.some(([k, v]) => k === 'id' && v === id)) ?? null
  doc.querySelectorAll = (sel) => doc.all.filter((n) => matches(n, sel))
  return doc
}

function node(
  doc: FakeDoc,
  tag: string,
  attrs: Record<string, string> = {},
  kids: (FakeNode | string)[] = [],
  extra: Partial<FakeNode> = {}
): FakeNode {
  const n: FakeNode = {
    nodeType: 1,
    nodeName: tag.toUpperCase(),
    attrs: Object.entries(attrs),
    attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
    childNodes: [],
    children: [],
    parentElement: null,
    ownerDocument: doc,
    textContent: '',
    getAttribute: (k) => attrs[k] ?? null,
    getBoundingClientRect: () => ({ x: 10, y: 20, width: 120, height: 40 }),
    ...extra
  }
  for (const k of kids) {
    if (typeof k === 'string') {
      n.childNodes.push({ nodeType: 3, nodeName: '#text', data: k } as unknown as FakeNode)
    } else {
      k.parentElement = n
      n.childNodes.push(k)
      n.children.push(k)
    }
  }
  n.textContent = n.childNodes.map((c) => (c.nodeType === 3 ? (c.data ?? '') : c.textContent)).join('')
  doc.all.push(n)
  return n
}

/** Selectores que genera `pickInPage`: `#id`, `[a="v"]`, `tag[a="v"]`, `tag.c1.c2:nth-of-type(k)` y cadenas con ` > `. */
function matches(n: FakeNode, sel: string): boolean {
  const parts = sel.split(' > ')
  let cur: FakeNode | null = n
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!cur || !simple(cur, parts[i])) return false
    cur = cur.parentElement
  }
  return true
}

function simple(n: FakeNode, s: string): boolean {
  const attr = (k: string): string => n.getAttribute(k) ?? ''
  let rest = s
  const tag = /^[a-z][a-z0-9-]*/.exec(rest)
  if (tag) {
    if (n.nodeName.toLowerCase() !== tag[0]) return false
    rest = rest.slice(tag[0].length)
  }
  while (rest) {
    let m: RegExpExecArray | null
    if ((m = /^#((?:\\.|[\w-])+)/.exec(rest))) {
      if (attr('id') !== m[1].replace(/\\/g, '')) return false
    } else if ((m = /^\.((?:\\.|[\w-])+)/.exec(rest))) {
      if (!attr('class').split(/\s+/).includes(m[1].replace(/\\/g, ''))) return false
    } else if ((m = /^\[([\w-]+)="((?:\\.|[^"\\])*)"\]/.exec(rest))) {
      if (attr(m[1]) !== m[2].replace(/\\(.)/g, '$1')) return false
    } else if ((m = /^:nth-of-type\((\d+)\)/.exec(rest))) {
      const sibs = (n.parentElement?.children ?? []).filter((c) => c.nodeName === n.nodeName)
      if (sibs.indexOf(n) + 1 !== Number(m[1])) return false
    } else {
      throw new Error(`selector no soportado por el DOM de prueba: ${s}`)
    }
    rest = rest.slice(m[0].length)
  }
  return true
}

function run(el: FakeNode): PickRaw {
  const fn = new Function(`return (${pickInPageSource()})`)() as (this: unknown, lim: unknown) => PickRaw
  // Igual que `returnByValue`: solo datos planos.
  return JSON.parse(JSON.stringify(fn.call(el, pickLimitsForPage()))) as PickRaw
}

function page(doc: FakeDoc): { form: FakeNode; button: FakeNode } {
  const button = node(
    doc,
    'button',
    { class: 'cta primary css-1x2y3z', 'data-testid': 'buy', onclick: 'steal()', style: 'color:red', value: 'v1' },
    ['Comprar ahora']
  )
  const pwd = node(doc, 'input', { type: 'password', name: 'pw', value: 'hunter2' }, [], { value: 'hunter2' })
  const hidden = node(doc, 'input', { type: 'hidden', name: 'csrf', value: 'SECRET123' }, [], { value: 'SECRET123' })
  const typed = node(doc, 'input', { type: 'text', name: 'q', placeholder: 'Buscar', value: 'juan' }, [], { value: 'juan' })
  const area = node(doc, 'textarea', { name: 'msg' }, ['mi secreto'], { value: 'mi secreto' })
  const link = node(doc, 'a', { href: 'https://shop.example.com/cart?session=abc#top', 'data-csrf-token': 'abc' }, ['Carrito'])
  const script = node(doc, 'script', {}, ['var token="SECRET"'])
  const svg = node(doc, 'svg', { viewBox: '0 0 1 1' }, [node(doc, 'path', { d: 'M0 0L1 1' })])
  const img = node(doc, 'img', { src: 'data:image/png;base64,AAAA', alt: 'logo' })
  const form = node(doc, 'form', { action: '/buy?x=1', class: 'buy-form' }, [pwd, hidden, typed, area, link, button, script, svg, img])
  const main = node(doc, 'main', {}, [node(doc, 'section', { class: 'hero' }, [form])])
  const body = node(doc, 'body', {}, [main])
  const html = node(doc, 'html', {}, [body])
  doc.documentElement = html
  doc.body = body
  return { form, button }
}

describe('pickInPage (en la página, mundo aislado)', () => {
  it('el botón: selector único estable, rol, nombre y html sin on*, style ni value', () => {
    const doc = makeDoc({
      display: 'inline-block',
      color: 'rgb(255, 255, 255)',
      position: 'static',
      margin: '0px',
      'background-image': 'url("https://a.com/x.png?t=1")'
    })
    const { button } = page(doc)
    const r = run(button)
    expect(r.selector).toBe('[data-testid="buy"]')
    expect(doc.querySelectorAll(r.selector)).toEqual([button])
    expect(r.tag).toBe('button')
    expect(r.role).toBe('button')
    expect(r.name).toBe('Comprar ahora')
    expect(r.text).toBe('Comprar ahora')
    expect(r.html).toBe('<button class="cta primary css-1x2y3z" data-testid="buy">Comprar ahora</button>')
    expect(r.styles).toEqual({ display: 'inline-block', color: 'rgb(255, 255, 255)', 'background-image': 'url(…)' })
    expect(r.path).toBe('main > section.hero > form.buy-form > button.cta.primary')
    expect(r.viewport).toEqual({ width: 1280, height: 800, dpr: 2 })
    expect(r.scrollY).toBe(120)
    expect(r.rect).toEqual({ x: 10, y: 20, width: 120, height: 40 })
    expect(r.flags.inIframe).toBe(false)
  })

  it('el formulario: nunca valores, campos sensibles redactados y sin captura (sensitive)', () => {
    const doc = makeDoc()
    const { form } = page(doc)
    const r = run(form)
    expect(r.html).not.toMatch(/hunter2|SECRET123|juan|mi secreto|value=|onclick|style=|csrf|session=|token|<script|path d=|AAAA/)
    expect(r.html).toContain('<input type="password" data-onyx-redacted>')
    expect(r.html).toContain('<input type="hidden" data-onyx-redacted>')
    expect(r.html).toContain('<textarea name="msg"></textarea>')
    expect(r.html).toContain('<svg viewBox="0 0 1 1"></svg>')
    expect(r.html).toContain('href="https://shop.example.com/cart"')
    expect(r.html).toContain('src="data:…(recortado)"')
    expect(r.flags.sensitive).toBe(true)
    expect(r.redactions).toBeGreaterThanOrEqual(5)
    expect(r.text).not.toMatch(/mi secreto|juan|hunter2/)
    expect(r.selector).toBe('form.buy-form')
    expect(doc.querySelectorAll(r.selector).length).toBe(1)
  })

  it('un campo de texto con algo escrito marca sensitive aunque no salga su valor', () => {
    const doc = makeDoc()
    page(doc)
    const typed = doc.all.find((n) => n.getAttribute('name') === 'q')!
    const r = run(typed)
    expect(r.html).toBe('<input type="text" name="q" placeholder="Buscar">')
    expect(r.flags.sensitive).toBe(true)
    expect(r.name).toBe('Buscar')
    const empty = node(doc, 'input', { type: 'text', name: 'vacio' }, [], { value: '' })
    expect(run(empty).flags.sensitive).toBe(false)
  })

  it('el campo de contraseña: html redactado y sensitive', () => {
    const doc = makeDoc()
    page(doc)
    const pwd = doc.all.find((n) => n.getAttribute('type') === 'password')!
    const r = run(pwd)
    expect(r.html).toBe('<input type="password" data-onyx-redacted>')
    expect(r.flags.sensitive).toBe(true)
  })

  it('selector: id estable > data-testid > aria-label > ruta; ignora ids y clases generados', () => {
    const doc = makeDoc()
    const a = node(doc, 'div', { id: 'main-nav' })
    const b = node(doc, 'div', { id: 'r12345:r1' })
    const c = node(doc, 'button', { 'aria-label': 'Cerrar' })
    const item1 = node(doc, 'li', { class: 'item' }, ['uno'])
    const item2 = node(doc, 'li', { class: 'item css-9xk2q1 Button_root__a1b2c' }, ['dos'])
    const ul = node(doc, 'ul', { class: 'lista' }, [item1, item2])
    node(doc, 'body', {}, [a, b, c, ul])
    expect(run(a).selector).toBe('#main-nav')
    const sb = run(b).selector
    expect(sb).not.toContain('r12345')
    expect(run(c).selector).toBe('button[aria-label="Cerrar"]')
    const s2 = run(item2).selector
    expect(s2).toBe('li.item:nth-of-type(2)')
    expect(doc.querySelectorAll(s2)).toEqual([item2])
    expect(s2).not.toMatch(/css-|Button_/)
  })

  it('profundidad 4 y 20 hijos por nodo, con marcadores', () => {
    const doc = makeDoc()
    const deepest = node(doc, 'span', {}, ['hondo', node(doc, 'b', {}, ['mas'])])
    const l3 = node(doc, 'div', { class: 'l3' }, [deepest])
    const l2 = node(doc, 'div', {}, [l3])
    const l1 = node(doc, 'div', {}, [l2])
    const l0 = node(doc, 'div', {}, [l1, node(doc, 'p', {}, ['x'])])
    expect(run(l0).html).toBe('<div><div><div><div class="l3"><span>hondo<!-- +1 más --></span></div></div></div><p>x</p></div>')
    const many = node(
      doc,
      'ul',
      {},
      Array.from({ length: 25 }, (_, i) => node(doc, 'li', {}, [`n${i}`]))
    )
    const r = run(many)
    expect((r.html.match(/<li>/g) ?? []).length).toBe(PICK_LIMITS.children)
    expect(r.html).toContain('<!-- +5 más -->')
    expect(r.flags.truncated).toBe(true)
  })

  it('lo que sale de la página se vuelve a sanear en main sin cambios (idempotente)', () => {
    const doc = makeDoc()
    const { form } = page(doc)
    const r = run(form)
    expect(sanitizePickedHtml(r.html).html).toBe(r.html)
    expect(sanitizePickedHtml(r.html).redactions).toBe(0)
  })

  it('de punta a punta: el resultado de la página, en main, cumple el contrato', () => {
    const doc = makeDoc({ display: 'block' })
    const { button } = page(doc)
    const el = buildPickedElement(run(button), { url: 'https://shop.example.com/cart?session=abc', title: 'Tienda' })
    expect(() => PICKED_ELEMENT_SCHEMA(el)).not.toThrow()
    expect(JSON.stringify(el)).not.toMatch(/hunter2|SECRET123|session=|steal/)
  })

  it('en un marco (la ventana no es la de arriba) lo marca inIframe', () => {
    const doc = makeDoc()
    const el = node(doc, 'div')
    ;(doc.defaultView as { parent: unknown }).parent = {}
    expect(run(el).flags.inIframe).toBe(true)
  })

  it('es autocontenida: no usa nada del módulo ni de globales ausentes', () => {
    const src = pickInPageSource()
    expect(src.startsWith('function')).toBe(true)
    expect(src).not.toMatch(/PICK_LIMITS|PICK_STYLE_PROPS|__name|require\(/)
  })
})
