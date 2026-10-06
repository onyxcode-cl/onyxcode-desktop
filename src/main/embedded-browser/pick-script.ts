/**
 * Recogida del elemento elegido, EN LA PÁGINA y en el mundo aislado (F8-B71).
 *
 * `pickInPage` se escribe como función real y se serializa con `.toString()` para `Runtime.callFunctionOn` sobre el
 * `objectId` del nodo (con `this` = el nodo). Por eso tiene que ser AUTOCONTENIDA: no puede usar nada del módulo (ni helpers ni
 * constantes); lo único que recibe es `lim` (los topes de `PICK_LIMITS`, que pasa `pickLimitsForPage()`).
 *
 * No toca el DOM de la página: el HTML se SERIALIZA recorriendo los nodos (nada de `cloneNode` ni de `setAttribute`), y los
 * estilos se leen con `getComputedStyle` sobre el propio nodo (no se inserta ningún elemento de prueba).
 * Devuelve solo datos planos. El saneado de aquí es la primera de dos pasadas: `pick.ts` (main) vuelve a sanear todo.
 *
 * Nunca sale: `value=`, `checked`/`selected`, el texto de un `<textarea>`, `input[type=password|hidden]` ni los de
 * `autocomplete=cc-*|one-time-code|current-password|new-password` (se sustituyen por `<input type="…" data-lazunox-redacted>`),
 * `on*`, `srcdoc`, `nonce`, `integrity`, `style`, `srcset`, atributos con nombre de secreto, query/fragmento de las URLs,
 * `<script>`/`<style>`/`<template>`/`<noscript>` ni el trazado de un `<svg>`.
 */
import { PICK_LIMITS, PICK_STYLE_PROPS } from '@shared/ipc-browser'
import type { PickRaw } from './pick'

export interface PickPageLimits {
  html: number
  text: number
  name: number
  textNode: number
  depth: number
  children: number
  styleValue: number
  props: readonly string[]
}

/** Topes que se le pasan a `pickInPage` como único argumento. */
export function pickLimitsForPage(): PickPageLimits {
  return {
    html: PICK_LIMITS.html,
    text: PICK_LIMITS.text,
    name: PICK_LIMITS.name,
    textNode: PICK_LIMITS.textNode,
    depth: PICK_LIMITS.depth,
    children: PICK_LIMITS.children,
    styleValue: PICK_LIMITS.styleValue,
    props: PICK_STYLE_PROPS
  }
}

/** `functionDeclaration` para `Runtime.callFunctionOn`. */
export function pickInPageSource(): string {
  return pickInPage.toString()
}

interface PEl {
  nodeType: number
  nodeName: string
  data?: string
  attributes?: ArrayLike<{ name: string; value: string }>
  childNodes?: ArrayLike<PEl>
  children?: ArrayLike<PEl>
  parentElement?: PEl | null
  ownerDocument: PDoc
  value?: string
  textContent?: string | null
  getAttribute(name: string): string | null
  getBoundingClientRect(): { x: number; y: number; width: number; height: number }
}

interface PWin {
  innerWidth: number
  innerHeight: number
  devicePixelRatio: number
  scrollX: number
  scrollY: number
  parent: unknown
  frameElement?: unknown
  CSS?: { escape?: (s: string) => string }
  getComputedStyle(el: PEl): { getPropertyValue(p: string): string }
}

interface PDoc {
  defaultView: PWin | null
  documentElement: PEl | null
  body: PEl | null
  getElementById(id: string): PEl | null
  querySelectorAll(sel: string): ArrayLike<PEl>
}

export function pickInPage(this: unknown, lim: PickPageLimits): PickRaw {
  const el = this as PEl
  const doc = el.ownerDocument
  const win = doc.defaultView as PWin

  const SECRET_NAME_RE = /token|secret|key|auth|pass|csrf|xsrf|session|signature|credential/i
  const UNSTABLE_ID_RE = /\d{4,}|^[a-f0-9-]{16,}$|:r\d/
  const GENERATED_CLASS_RE = /^(css|sc|jsx)-|[A-Za-z]+_[a-z0-9]{5,}$|__[A-Za-z0-9]{4,}$|\d{4,}/
  const DROP_TAGS = ['script', 'style', 'template', 'noscript']
  const VOID_TAGS = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']
  const URL_ATTRS = [
    'href',
    'src',
    'action',
    'formaction',
    'poster',
    'data',
    'cite',
    'background',
    'longdesc',
    'ping',
    'manifest',
    'xlink:href'
  ]
  const DROP_ATTRS = ['srcdoc', 'nonce', 'integrity', 'style', 'srcset', 'imagesrcset', 'value', 'checked', 'selected']
  const VALUELESS_INPUT = ['submit', 'button', 'reset', 'image', 'checkbox', 'radio', 'file', 'color', 'range', 'hidden']
  const REDACTED = 'data-lazunox-redacted'

  const acc = { redactions: 0, sensitive: false, truncated: false, size: 0 }

  function collapse(s: string): string {
    return String(s).replace(/\s+/g, ' ').trim()
  }
  function clip(s: string, max: number): string {
    return s.length > max ? s.slice(0, Math.max(0, max - 1)) + '…' : s
  }
  function attr(n: PEl, name: string): string | null {
    const v = n.getAttribute(name)
    return v === null || v === undefined ? null : String(v)
  }
  function tagOf(n: PEl): string {
    return String(n.nodeName).toLowerCase()
  }
  function escText(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
  function escAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  }
  function stripUrl(v: string): string {
    const raw = v.trim()
    const sch = /^(data|blob|javascript|vbscript):/i.exec(raw)
    if (sch) return sch[1].toLowerCase() + ':…(recortado)'
    const cut = raw.search(/[?#]/)
    if (cut === -1) return raw
    const head = raw.slice(0, cut)
    return head === '' && raw[cut] === '#' ? '#' : head
  }
  function stableId(n: PEl): string | null {
    const id = attr(n, 'id')
    return id && id.length <= 80 && !UNSTABLE_ID_RE.test(id) && !/\s/.test(id) ? id : null
  }
  function stableClasses(n: PEl): string[] {
    const raw = attr(n, 'class')
    if (!raw) return []
    const out: string[] = []
    for (const c of raw.split(/\s+/)) {
      if (!c || c.length > 40 || GENERATED_CLASS_RE.test(c)) continue
      out.push(c)
      if (out.length >= 2) break
    }
    return out
  }
  function cssEscape(s: string): string {
    if (win.CSS && win.CSS.escape) return win.CSS.escape(s)
    return String(s)
      .replace(/[^a-zA-Z0-9_\u00a0-\uffff-]/g, '\\$&')
      .replace(/^(-?)(\d)/, '$1\\3$2 ')
  }
  function isSensitiveInput(n: PEl): boolean {
    if (tagOf(n) !== 'input') return false
    const type = (attr(n, 'type') || 'text').toLowerCase()
    if (type === 'password') return true
    const ac = (attr(n, 'autocomplete') || '').toLowerCase().split(/\s+/)
    for (const t of ac) {
      if (t.indexOf('cc-') === 0 || t === 'one-time-code' || t === 'current-password' || t === 'new-password') return true
    }
    return false
  }

  // ── HTML saneado (serialización sin tocar el DOM) ──
  function openTag(n: PEl, tag: string): string {
    if (tag === 'input') {
      const type = ((attr(n, 'type') || 'text').toLowerCase().replace(/[^a-z-]/g, '') || 'text').slice(0, 20)
      const sens = isSensitiveInput(n)
      if (sens || type === 'hidden') {
        acc.redactions++
        if (sens) acc.sensitive = true
        return '<input type="' + type + '" ' + REDACTED + '>'
      }
      // Un campo con texto escrito: el valor no sale, pero la captura lo mostraría.
      if (VALUELESS_INPUT.indexOf(type) === -1 && n.value) acc.sensitive = true
    }
    const parts: string[] = []
    const attrs = n.attributes
    const count = attrs ? attrs.length : 0
    for (let i = 0; i < count; i++) {
      const a = attrs![i]
      const name = String(a.name).toLowerCase()
      const val = String(a.value)
      if (name.indexOf('on') === 0) continue
      if (name === 'value') {
        if (val && (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'option' || tag === 'button')) acc.redactions++
        continue
      }
      if (DROP_ATTRS.indexOf(name) !== -1) continue
      if (tag === 'meta' && name === 'content') continue
      if (SECRET_NAME_RE.test(name)) {
        if (val) acc.redactions++
        continue
      }
      const v = clip(URL_ATTRS.indexOf(name) !== -1 ? stripUrl(val) : val, lim.textNode)
      parts.push(String(a.name) + '="' + escAttr(v) + '"')
    }
    return '<' + tag + (parts.length ? ' ' + parts.join(' ') : '') + '>'
  }

  function serialize(n: PEl, depth: number): string {
    if (acc.size > lim.html * 4) {
      acc.truncated = true
      return ''
    }
    if (n.nodeType === 3) {
      const t = collapse(n.data || '')
      return t ? escText(clip(t, lim.textNode)) : ''
    }
    if (n.nodeType !== 1) return ''
    const tag = tagOf(n)
    if (DROP_TAGS.indexOf(tag) !== -1) return ''
    if (tag === 'svg') return openTag(n, tag) + '</svg>'
    const open = openTag(n, tag)
    if (tag === 'input' && open.indexOf(REDACTED) !== -1) return open
    if (VOID_TAGS.indexOf(tag) !== -1) return open
    if (tag === 'textarea') {
      if (n.value || collapse(n.textContent || '')) {
        acc.redactions++
        acc.sensitive = true
      }
      return open + '</textarea>'
    }
    let out = open
    const kids = n.childNodes
    const total = kids ? kids.length : 0
    let emitted = 0
    let skippedElements = 0
    for (let i = 0; i < total; i++) {
      const c = kids![i]
      if (c.nodeType === 1) {
        if (depth >= lim.depth || emitted >= lim.children) {
          skippedElements++
          continue
        }
        const s = serialize(c, depth + 1)
        if (s) {
          out += s
          emitted++
        }
      } else if (c.nodeType === 3) {
        if (emitted >= lim.children) continue
        const s = serialize(c, depth)
        if (s) {
          out += s
          emitted++
        }
      }
    }
    if (skippedElements > 0) {
      acc.truncated = true
      out += '<!-- +' + Math.min(skippedElements, 9999) + ' más -->'
    }
    out += '</' + tag + '>'
    acc.size += out.length
    return out
  }

  // ── texto visible (mismas exclusiones que el HTML) ──
  function collectText(n: PEl, parts: string[], len: { v: number }): void {
    if (len.v > lim.text) return
    if (n.nodeType === 3) {
      const t = collapse(n.data || '')
      if (t) {
        parts.push(t)
        len.v += t.length + 1
      }
      return
    }
    if (n.nodeType !== 1) return
    const tag = tagOf(n)
    if (DROP_TAGS.indexOf(tag) !== -1 || tag === 'textarea' || tag === 'select' || tag === 'svg' || tag === 'input') return
    const kids = n.childNodes
    const total = kids ? kids.length : 0
    for (let i = 0; i < total && len.v <= lim.text; i++) collectText(kids![i], parts, len)
  }
  function textOf(n: PEl, max: number): string {
    const parts: string[] = []
    collectText(n, parts, { v: 0 })
    return clip(collapse(parts.join(' ')), max)
  }

  // ── rol y nombre ──
  function roleOf(n: PEl): string | undefined {
    const explicit = attr(n, 'role')
    if (explicit) return explicit.split(/\s+/)[0].slice(0, 30)
    const tag = tagOf(n)
    if (tag === 'a') return n.getAttribute('href') !== null ? 'link' : undefined
    if (tag === 'button') return 'button'
    if (tag === 'input') {
      const type = (attr(n, 'type') || 'text').toLowerCase()
      if (type === 'button' || type === 'submit' || type === 'reset' || type === 'image') return 'button'
      if (type === 'checkbox') return 'checkbox'
      if (type === 'radio') return 'radio'
      if (type === 'range') return 'slider'
      if (type === 'search') return 'searchbox'
      if (type === 'hidden') return undefined
      return 'textbox'
    }
    const map: Record<string, string> = {
      textarea: 'textbox',
      select: 'combobox',
      img: 'img',
      h1: 'heading',
      h2: 'heading',
      h3: 'heading',
      h4: 'heading',
      h5: 'heading',
      h6: 'heading',
      nav: 'navigation',
      main: 'main',
      header: 'banner',
      footer: 'contentinfo',
      ul: 'list',
      ol: 'list',
      li: 'listitem',
      table: 'table',
      form: 'form',
      dialog: 'dialog'
    }
    return map[tag]
  }
  function nameOf(n: PEl): string | undefined {
    const label = attr(n, 'aria-label')
    if (label && collapse(label)) return clip(collapse(label), lim.name)
    const by = attr(n, 'aria-labelledby')
    if (by) {
      const parts: string[] = []
      for (const id of by.split(/\s+/)) {
        const ref = id ? doc.getElementById(id) : null
        if (ref) parts.push(textOf(ref, lim.name))
      }
      const joined = collapse(parts.join(' '))
      if (joined) return clip(joined, lim.name)
    }
    const alt = attr(n, 'alt')
    if (alt && collapse(alt)) return clip(collapse(alt), lim.name)
    const title = attr(n, 'title')
    if (title && collapse(title)) return clip(collapse(title), lim.name)
    const ph = attr(n, 'placeholder')
    if (ph && collapse(ph)) return clip(collapse(ph), lim.name)
    const t = textOf(n, lim.name)
    return t || undefined
  }

  // ── selector único y migas de pan ──
  function qsa(sel: string): ArrayLike<PEl> | null {
    try {
      return doc.querySelectorAll(sel)
    } catch {
      return null
    }
  }
  function isUnique(sel: string): boolean {
    const found = qsa(sel)
    return !!found && found.length === 1 && found[0] === el
  }
  function sameTagIndex(n: PEl): { index: number; count: number } {
    const parent = n.parentElement
    const sibs = parent && parent.children ? parent.children : null
    if (!sibs) return { index: 1, count: 1 }
    const tag = tagOf(n)
    let index = 0
    let count = 0
    for (let i = 0; i < sibs.length; i++) {
      if (tagOf(sibs[i]) === tag) {
        count++
        if (sibs[i] === n) index = count
      }
    }
    return { index: index || 1, count }
  }
  function buildSelector(): string {
    const id = stableId(el)
    if (id && isUnique('#' + cssEscape(id))) return '#' + cssEscape(id)
    for (const a of ['data-testid', 'data-test', 'data-cy']) {
      const v = attr(el, a)
      if (v && v.length <= 80) {
        const s = '[' + a + '="' + v.replace(/["\\]/g, '\\$&') + '"]'
        if (isUnique(s)) return s
      }
    }
    const aria = attr(el, 'aria-label')
    if (aria && aria.length <= 60) {
      const s = tagOf(el) + '[aria-label="' + aria.replace(/["\\]/g, '\\$&') + '"]'
      if (isUnique(s)) return s
    }
    let chain = ''
    let cur: PEl | null | undefined = el
    for (let level = 0; level < 6 && cur && cur.nodeType === 1; level++) {
      const tag = tagOf(cur)
      if (tag === 'html') break
      const base =
        tag +
        stableClasses(cur)
          .map((c) => '.' + cssEscape(c))
          .join('')
      const pos = sameTagIndex(cur)
      const plain = chain ? base + ' > ' + chain : base
      if (isUnique(plain)) return plain
      const seg = pos.count > 1 ? base + ':nth-of-type(' + pos.index + ')' : base
      chain = chain ? seg + ' > ' + chain : seg
      if (isUnique(chain)) return chain
      const parent: PEl | null | undefined = cur.parentElement
      const pid = parent ? stableId(parent) : null
      if (parent && pid) {
        const withId = '#' + cssEscape(pid) + ' > ' + chain
        if (isUnique(withId)) return withId
      }
      cur = parent
    }
    return chain || tagOf(el)
  }
  function buildPath(): string {
    const segs: string[] = []
    let cur: PEl | null | undefined = el
    for (let i = 0; i < 5 && cur && cur.nodeType === 1; i++) {
      const tag = tagOf(cur)
      if (i > 0 && (tag === 'html' || tag === 'body')) break
      const id = stableId(cur)
      segs.unshift(
        tag +
          (id ? '#' + id : '') +
          stableClasses(cur)
            .map((c) => '.' + c)
            .join('')
      )
      cur = cur.parentElement
    }
    return segs.join(' > ')
  }

  // ── estilos calculados (lista cerrada, sin los valores por defecto) ──
  const DEFAULTS: Record<string, string> = {
    position: 'static',
    'box-sizing': 'content-box',
    margin: '0px',
    padding: '0px',
    gap: 'normal',
    'flex-direction': 'row',
    'justify-content': 'normal',
    'align-items': 'normal',
    'grid-template-columns': 'none',
    'background-color': 'rgba(0, 0, 0, 0)',
    'background-image': 'none',
    'letter-spacing': 'normal',
    'line-height': 'normal',
    'text-align': 'start',
    'border-radius': '0px',
    'box-shadow': 'none',
    opacity: '1',
    visibility: 'visible',
    overflow: 'visible',
    'z-index': 'auto',
    cursor: 'auto',
    transform: 'none'
  }
  function collectStyles(): Record<string, string> {
    const out: Record<string, string> = {}
    let cs: { getPropertyValue(p: string): string }
    try {
      cs = win.getComputedStyle(el)
    } catch {
      return out
    }
    const display = String(cs.getPropertyValue('display') || '')
    const isFlex = display.indexOf('flex') !== -1
    const isGrid = display.indexOf('grid') !== -1
    for (const prop of lim.props) {
      if (!isFlex && !isGrid && (prop === 'flex-direction' || prop === 'justify-content' || prop === 'align-items' || prop === 'gap'))
        continue
      if (!isGrid && prop === 'grid-template-columns') continue
      let v = collapse(cs.getPropertyValue(prop) || '')
      if (!v) continue
      if (DEFAULTS[prop] !== undefined && DEFAULTS[prop] === v) continue
      if (prop === 'border' && /^0px none/.test(v)) continue
      if (prop === 'background-image') v = clip(v.replace(/url\([^)]*\)/gi, 'url(…)'), 120)
      out[prop] = clip(v, lim.styleValue)
    }
    return out
  }

  // ── montaje ──
  const tag = tagOf(el)
  const html = serialize(el, 0)
  const text = textOf(el, lim.text + 1)
  if (text.length > lim.text) acc.truncated = true
  const rect = el.getBoundingClientRect()
  let inIframe = false
  try {
    inIframe = win.parent !== win || !!win.frameElement
  } catch {
    inIframe = true
  }
  const result: PickRaw = {
    tag,
    role: roleOf(el),
    name: nameOf(el),
    text: clip(text, lim.text),
    selector: buildSelector(),
    path: buildPath(),
    html,
    styles: collectStyles(),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    viewport: { width: win.innerWidth, height: win.innerHeight, dpr: win.devicePixelRatio || 1 },
    scrollX: win.scrollX || 0,
    scrollY: win.scrollY || 0,
    flags: { sensitive: acc.sensitive, inIframe, truncated: acc.truncated },
    redactions: acc.redactions
  }
  return result
}
