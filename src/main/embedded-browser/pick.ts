/**
 * «Elegir un elemento del navegador y enviarlo al chat» (F8-B71), lado main y PURO (sin Electron: se prueba con vitest).
 *
 * `pick-script.ts` recoge los datos en la página (mundo aislado) y ya los sanea; aquí se vuelve a sanear TODO sobre las
 * cadenas (por si la página tocó el DOM entre medias, o por si un script de la página devolvió algo raro) y se aplican los
 * topes. Reglas, las mismas que `docs/SEGURIDAD.md` §3 quater:
 *   - nunca valores de formulario: ni `value=`, ni `checked`/`selected`, ni el texto de un `<textarea>`;
 *   - `input[type=password|hidden]` y campos `autocomplete=cc-*|one-time-code|current-password|new-password` se sustituyen por
 *     `<input type="…" data-lazunox-redacted>`;
 *   - fuera `on*`, `srcdoc`, `nonce`, `integrity`, `style`, `srcset` y todo atributo cuyo nombre parezca un secreto;
 *   - `href`/`src`/`action`… sin query ni fragmento y los `data:`/`blob:`/`javascript:` reducidos;
 *   - `<script>`, `<style>`, `<template>`, `<noscript>` fuera; `<svg>` reducido a su etiqueta;
 *   - todo texto y valor de atributo pasa por `redactSecrets`.
 * La función es idempotente: sanear dos veces da lo mismo (las pruebas lo fijan).
 */
import {
  PICK_LIMITS,
  PICK_STYLE_PROPS,
  type BrowserRect,
  type PickedConsoleEntry,
  type PickedElement,
  type PickedImage,
  type PickedNetworkEntry
} from '@shared/ipc-browser'
import { maskSecretPatterns } from '@shared/redact-patterns'

/** Lo que devuelve `pickInPage` (ya saneado en la página, pero no se confía en ello). */
export interface PickRaw {
  tag: string
  role?: string
  name?: string
  text?: string
  selector: string
  path: string
  html: string
  styles: Record<string, string>
  rect: BrowserRect
  viewport: { width: number; height: number; dpr: number }
  scrollX: number
  scrollY: number
  flags: { sensitive: boolean; inIframe: boolean; truncated: boolean }
  redactions: number
}

/** Errores recogidos desde que se activó la selección (`pick-diagnostics.ts`), sin sanear. */
export interface RawDiagnostics {
  console: { level: string; text: string }[]
  network: { method: string; url: string; status?: number; error?: string }[]
  sinceMs: number
}

const ELLIPSIS = '…'
const TRUNC_MARKER = '<!-- recortado -->'
const KEEP_COMMENT_RE = /^<!-- (?:\+\d{1,4} más|recortado) -->$/
/** Se descarta todo el HTML por encima de esto antes de analizarlo (acota el trabajo ante una página hostil). */
const MAX_INPUT = 64 * 1024

const DROP_TAGS = new Set(['script', 'style', 'template', 'noscript'])
const URL_ATTRS = new Set([
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
])
const DROP_ATTRS = new Set(['srcdoc', 'nonce', 'integrity', 'style', 'srcset', 'imagesrcset', 'value', 'checked', 'selected'])
const SECRET_NAME_RE = /token|secret|key|auth|pass|csrf|xsrf|session|signature|credential/i
const SENSITIVE_AUTOCOMPLETE = (t: string): boolean =>
  t.startsWith('cc-') || t === 'one-time-code' || t === 'current-password' || t === 'new-password'
const REDACTED_ATTR = 'data-lazunox-redacted'
/** Tipos de `<input>` cuyo contenido es un valor escrito por la persona (se usa en la página; aquí por simetría). */
export const VALUELESS_INPUT_TYPES = new Set(['submit', 'button', 'reset', 'image', 'checkbox', 'radio', 'file', 'color', 'range'])

// ───────────────────────────── utilidades de texto y URL ─────────────────────────────

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** Recorta a `max` caracteres (con «…» incluida): idempotente, porque lo recortado ya mide exactamente `max`. */
function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, Math.max(0, max - 1)) + ELLIPSIS : s
}

/** `redactSecrets` contando si cambió algo. */
function redactCount(s: string): { text: string; n: number } {
  const text = maskSecretPatterns(s)
  return { text, n: text === s ? 0 : 1 }
}

/**
 * URL sin credenciales, query ni fragmento. `data:`/`blob:`/`javascript:` se reducen; lo que no es una URL absoluta se corta en
 * el primer `?` o `#`. Idempotente.
 */
export function stripQuery(url: string): string {
  const raw = String(url ?? '').trim()
  if (!raw) return ''
  if (/^(?:data|blob|javascript|vbscript):/i.test(raw)) return `${raw.slice(0, raw.indexOf(':')).toLowerCase()}:${ELLIPSIS}(recortado)`
  try {
    const u = new URL(raw)
    if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'ws:' || u.protocol === 'wss:') {
      return clip(`${u.origin}${u.pathname}`, PICK_LIMITS.url)
    }
    if (u.protocol === 'about:') return clip(`${u.protocol}${u.pathname}`, PICK_LIMITS.url)
  } catch {
    /* relativa u ocurrencia rara: se corta a mano */
  }
  const cut = raw.search(/[?#]/)
  if (cut === -1) return clip(raw, PICK_LIMITS.url)
  const head = raw.slice(0, cut)
  return head === '' && raw[cut] === '#' ? '#' : clip(head, PICK_LIMITS.url)
}

/** Quita query y fragmento de cada URL absoluta que aparezca dentro de un texto libre (consola). */
function stripUrlsInText(s: string): string {
  return s.replace(/https?:\/\/[^\s"'<>)\]]+/gi, (u) => stripQuery(u))
}

// ───────────────────────────── saneado del HTML ─────────────────────────────

export interface SanitizedHtml {
  html: string
  /** Valores quitados u ocultados (value, secretos, campos ocultos, claves en texto). */
  redactions: number
  /** Se cortó por el tope de tamaño. */
  truncated: boolean
  /** Había un campo sensible (contraseña, tarjeta, código) o un `<textarea>` con contenido. */
  sensitive: boolean
}

const ATTR_RE = /\s*([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/y

interface ParsedAttr {
  name: string
  value: string | null
}

function escapeAttr(v: string): string {
  return v.replace(/"/g, '&quot;')
}

function escapeText(v: string): string {
  return v.replace(/</g, '&lt;')
}

/** Valor de un atributo URL: sin query ni fragmento; lo que no es URL absoluta se corta en `?`/`#`. */
function sanitizeUrlAttr(value: string): string {
  return stripQuery(value)
}

function renderTag(
  tag: string,
  attrs: ParsedAttr[],
  acc: { redactions: number; sensitive: boolean }
): { open: string; redactedInput: boolean } {
  const byName = new Map<string, string>()
  for (const a of attrs) byName.set(a.name.toLowerCase(), a.value ?? '')

  if (tag === 'input') {
    const type =
      (byName.get('type') ?? 'text')
        .toLowerCase()
        .replace(/[^a-z-]/g, '')
        .slice(0, 20) || 'text'
    const ac = (byName.get('autocomplete') ?? '').toLowerCase().split(/\s+/).filter(Boolean)
    const sensitiveField = type === 'password' || ac.some(SENSITIVE_AUTOCOMPLETE)
    if (sensitiveField || type === 'hidden' || byName.has(REDACTED_ATTR)) {
      if (!byName.has(REDACTED_ATTR)) acc.redactions++
      if (sensitiveField) acc.sensitive = true
      // Un campo ya sustituido solo conserva su tipo (y el marcador): idempotente.
      return { open: `<input type="${type}" ${REDACTED_ATTR}>`, redactedInput: true }
    }
  }

  const parts: string[] = []
  for (const a of attrs) {
    const name = a.name.toLowerCase()
    if (name.startsWith('on')) continue
    if (name === 'value') {
      if (a.value && (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'option' || tag === 'button')) acc.redactions++
      continue
    }
    if (DROP_ATTRS.has(name)) continue
    if (tag === 'meta' && name === 'content') continue
    if (SECRET_NAME_RE.test(name)) {
      if (a.value) acc.redactions++
      continue
    }
    // El nombre conserva su mayúscula original (`viewBox` en un svg); las decisiones se toman con el nombre en minúsculas.
    if (a.value === null) {
      parts.push(a.name)
      continue
    }
    let v: string
    if (URL_ATTRS.has(name)) {
      v = sanitizeUrlAttr(a.value)
    } else {
      const r = redactCount(a.value)
      acc.redactions += r.n
      v = r.text
    }
    v = clip(v, PICK_LIMITS.textNode)
    parts.push(`${a.name}="${escapeAttr(v)}"`)
  }
  return { open: `<${tag}${parts.length ? ` ${parts.join(' ')}` : ''}>`, redactedInput: false }
}

/** Saneado completo del HTML que llega de la página (ver el encabezado). Idempotente. */
export function sanitizePickedHtml(input: string): SanitizedHtml {
  const src = String(input ?? '').slice(0, MAX_INPUT)
  const acc = { redactions: 0, sensitive: false }
  const budget = PICK_LIMITS.html - TRUNC_MARKER.length
  let out = ''
  let outBytes = 0
  let truncated = src.length < String(input ?? '').length
  let stop = false
  let pending = ''

  const emit = (s: string): void => {
    if (stop || !s) return
    const b = Buffer.byteLength(s)
    if (outBytes + b > budget) {
      stop = true
      truncated = true
      return
    }
    out += s
    outBytes += b
  }
  const flushText = (): void => {
    if (!pending) return
    const collapsed = collapse(pending)
    pending = ''
    if (!collapsed) return
    const r = redactCount(collapsed)
    acc.redactions += r.n
    emit(escapeText(clip(r.text, PICK_LIMITS.textNode)))
  }

  const n = src.length
  let i = 0
  while (i < n && !stop) {
    const lt = src.indexOf('<', i)
    if (lt === -1) {
      pending += src.slice(i)
      break
    }
    if (lt > i) pending += src.slice(i, lt)
    i = lt
    if (src.startsWith('<!--', i)) {
      flushText()
      const end = src.indexOf('-->', i + 4)
      const raw = end === -1 ? src.slice(i) : src.slice(i, end + 3)
      if (KEEP_COMMENT_RE.test(raw)) emit(raw)
      i = end === -1 ? n : end + 3
      continue
    }
    const next = src[i + 1] ?? ''
    if (next === '!' || next === '?') {
      flushText()
      const gt = src.indexOf('>', i)
      i = gt === -1 ? n : gt + 1
      continue
    }
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/.exec(src.slice(i, i + 64))
    if (!m) {
      pending += '<'
      i++
      continue
    }
    flushText()
    const closing = m[1] === '/'
    const tag = m[2].toLowerCase()
    let pos = i + m[0].length
    const attrs: ParsedAttr[] = []
    let ended = false
    let selfClose = false
    while (pos < n) {
      const ch = src[pos]
      if (ch === '>') {
        pos++
        ended = true
        break
      }
      if (ch === '/' || /\s/.test(ch)) {
        if (ch === '/' && src[pos + 1] === '>') selfClose = true
        pos++
        continue
      }
      ATTR_RE.lastIndex = pos
      const am = ATTR_RE.exec(src)
      if (!am || am.index !== pos) {
        pos++
        continue
      }
      attrs.push({ name: am[1], value: am[2] ?? am[3] ?? am[4] ?? null })
      pos = ATTR_RE.lastIndex
    }
    if (!ended) break // etiqueta sin cerrar: se descarta el resto
    i = pos

    if (closing) {
      if (!DROP_TAGS.has(tag)) emit(`</${tag}>`)
      continue
    }
    if (DROP_TAGS.has(tag)) {
      if (!selfClose) {
        const re = new RegExp(`</${tag}\\s*>`, 'ig')
        re.lastIndex = i
        const cm = re.exec(src)
        i = cm ? cm.index + cm[0].length : n
      }
      continue
    }
    if (tag === 'svg') {
      const { open } = renderTag(tag, attrs, acc)
      emit(open)
      if (!selfClose) {
        const re = /<(\/?)svg\b[^>]*>/gi
        re.lastIndex = i
        let depth = 1
        let cm: RegExpExecArray | null
        let endAt = n
        while ((cm = re.exec(src))) {
          depth += cm[1] === '/' ? -1 : cm[0].endsWith('/>') ? 0 : 1
          if (depth === 0) {
            endAt = cm.index + cm[0].length
            break
          }
        }
        i = endAt
      }
      emit('</svg>')
      continue
    }
    const { open } = renderTag(tag, attrs, acc)
    emit(open)
    if (tag === 'textarea' && !selfClose) {
      // El contenido de un `<textarea>` es su valor: nunca sale.
      const re = /<\/textarea\s*>/gi
      re.lastIndex = i
      const cm = re.exec(src)
      const inner = src.slice(i, cm ? cm.index : n)
      if (inner.trim()) {
        acc.redactions++
        acc.sensitive = true
      }
      i = cm ? cm.index + cm[0].length : n
      emit('</textarea>')
    }
  }
  if (!stop) flushText()
  if (truncated) out += TRUNC_MARKER
  return { html: out, redactions: acc.redactions, truncated, sensitive: acc.sensitive }
}

// ───────────────────────────── estilos, diagnóstico, textos ─────────────────────────────

/** Deja solo la lista cerrada de estilos, sin `url()`, con valores recortados y como mucho `styleCount` propiedades. */
export function sanitizeStyles(raw: unknown): { styles: Record<string, string>; redactions: number; truncated: boolean } {
  const styles: Record<string, string> = {}
  let redactions = 0
  let truncated = false
  if (!raw || typeof raw !== 'object') return { styles, redactions, truncated }
  const src = raw as Record<string, unknown>
  for (const prop of PICK_STYLE_PROPS) {
    if (Object.keys(styles).length >= PICK_LIMITS.styleCount) break
    const v = src[prop]
    if (typeof v !== 'string') continue
    let s = collapse(v).replace(/url\([^)]*\)/gi, 'url(…)')
    if (!s) continue
    const r = redactCount(s)
    redactions += r.n
    s = r.text
    if (s.length > PICK_LIMITS.styleValue) {
      s = s.slice(0, PICK_LIMITS.styleValue)
      truncated = true
    }
    styles[prop] = s
  }
  return { styles, redactions, truncated }
}

function cleanLogText(s: unknown): { text: string; n: number } {
  const r = redactCount(collapse(stripUrlsInText(String(s ?? ''))))
  return { text: clip(r.text, PICK_LIMITS.diagText), n: r.n }
}

function jsonBytes(v: unknown): number {
  return Buffer.byteLength(JSON.stringify(v))
}

/** Sanea la consola y la red: últimos `diagEntries` de cada una, sin query ni secretos y ≤ `diagBytes` en total. */
export function sanitizeDiagnostics(raw: RawDiagnostics | undefined): { diagnostics: PickedElement['diagnostics']; redactions: number } {
  if (!raw) return { diagnostics: undefined, redactions: 0 }
  let redactions = 0
  const consoleOut: PickedConsoleEntry[] = []
  for (const e of Array.isArray(raw.console) ? raw.console : []) {
    const level = e?.level === 'error' || e?.level === 'warning' ? e.level : e?.level === 'warn' ? 'warning' : null
    if (!level) continue
    const c = cleanLogText(e.text)
    redactions += c.n
    if (c.text) consoleOut.push({ level, text: c.text })
  }
  const networkOut: PickedNetworkEntry[] = []
  for (const e of Array.isArray(raw.network) ? raw.network : []) {
    const method = String(e?.method ?? '')
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, 10)
    const url = stripQuery(String(e?.url ?? ''))
    if (!method || !url) continue
    const entry: PickedNetworkEntry = { method, url: redactCount(url).text }
    if (typeof e.status === 'number' && Number.isInteger(e.status) && e.status >= 400 && e.status <= 599) entry.status = e.status
    if (typeof e.error === 'string' && e.error) entry.error = clip(collapse(e.error).replace(/[^\w:.\- ]/g, ''), 100)
    if (entry.status === undefined && !entry.error) continue
    networkOut.push(entry)
  }
  const out = {
    console: consoleOut.slice(-PICK_LIMITS.diagEntries),
    network: networkOut.slice(-PICK_LIMITS.diagEntries),
    sinceMs: Math.max(0, Math.min(Math.round(Number(raw.sinceMs) || 0), 24 * 3600 * 1000))
  }
  // Tope total: se quita lo más antiguo de la lista más larga hasta que quepa.
  while (jsonBytes(out) > PICK_LIMITS.diagBytes && (out.console.length || out.network.length)) {
    if (out.console.length >= out.network.length) out.console.shift()
    else out.network.shift()
  }
  return { diagnostics: out, redactions }
}

// ───────────────────────────── captura recortada del elemento ─────────────────────────────

export interface ClipPlan {
  /** Región en píxeles CSS del documento (no del viewport) y escala de salida, para `Page.captureScreenshot`. */
  clip: { x: number; y: number; width: number; height: number; scale: number }
  /** Tamaño de la imagen resultante. */
  width: number
  height: number
}

const CLIP_PAD = 8
const CLIP_MAX_CSS = 8000

/** `null` si no hay nada que capturar (área vacía o lado corto < 8 px tras escalar). */
export function planElementClip(rect: BrowserRect, scroll: { x: number; y: number }): ClipPlan | null {
  const vals = [rect.x, rect.y, rect.width, rect.height, scroll.x, scroll.y]
  if (!vals.every((v) => typeof v === 'number' && Number.isFinite(v))) return null
  if (rect.width < 1 || rect.height < 1) return null
  const left = rect.x + scroll.x - CLIP_PAD
  const top = rect.y + scroll.y - CLIP_PAD
  const x = Math.max(0, left)
  const y = Math.max(0, top)
  const width = Math.min(rect.width + 2 * CLIP_PAD - (x - left), CLIP_MAX_CSS)
  const height = Math.min(rect.height + 2 * CLIP_PAD - (y - top), CLIP_MAX_CSS)
  if (width < 1 || height < 1) return null
  const scale = Math.min(1, PICK_LIMITS.imageLongSide / Math.max(width, height))
  const outW = Math.max(1, Math.round(width * scale))
  const outH = Math.max(1, Math.round(height * scale))
  if (Math.min(outW, outH) < 8) return null
  return { clip: { x, y, width, height, scale }, width: outW, height: outH }
}

function base64Bytes(b64: string): number {
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.floor((b64.length * 3) / 4) - pad
}

/**
 * Captura con calidad 80 y, si pesa más de `imageBytes`, con 60; si aun así no cabe, devuelve `undefined` (se omite la imagen).
 * `shot` hace la llamada CDP (solo `Page.captureScreenshot`, que ya está en `ALLOWED_CDP`) y devuelve el base64.
 */
export async function captureElementImage(
  shot: (quality: number, plan: ClipPlan) => Promise<string>,
  plan: ClipPlan
): Promise<PickedImage | undefined> {
  for (const quality of [80, 60]) {
    let data: string
    try {
      data = await shot(quality, plan)
    } catch {
      return undefined
    }
    if (typeof data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return undefined
    if (base64Bytes(data) <= PICK_LIMITS.imageBytes) {
      return { mime: 'image/jpeg', dataUrl: `data:image/jpeg;base64,${data}`, width: plan.width, height: plan.height }
    }
  }
  return undefined
}

// ───────────────────────────── ensamblado final ─────────────────────────────

export interface BuildContext {
  /** URL de la pestaña (se le quitan query y fragmento). */
  url: string
  title: string
  image?: PickedImage
  diagnostics?: RawDiagnostics
}

function num(v: unknown, digits = 1): number {
  const x = typeof v === 'number' && Number.isFinite(v) ? v : 0
  const f = 10 ** digits
  return Math.max(-20_000, Math.min(20_000, Math.round(x * f) / f))
}

function intNum(v: unknown, max: number): number {
  const x = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0
  return Math.max(0, Math.min(max, x))
}

function cleanLine(s: unknown, max: number): { text: string; n: number } {
  const r = redactCount(collapse(String(s ?? '')))
  return { text: clip(r.text, max), n: r.n }
}

/** El tipo `PickedElement` ya con todos los topes y sin nada sin sanear. Idempotente: `capPicked(capPicked(x))` es `capPicked(x)`. */
export function capPicked(el: PickedElement): PickedElement {
  const html = sanitizePickedHtml(el.html)
  const styles = sanitizeStyles(el.styles)
  const out: PickedElement = {
    v: 2,
    tag: /^[a-z][a-z0-9-]{0,30}$/.test(el.tag) ? el.tag : 'div',
    selector: cleanLine(el.selector, PICK_LIMITS.selector).text,
    path: cleanLine(el.path, PICK_LIMITS.path).text,
    html: html.html,
    styles: styles.styles,
    rect: { x: num(el.rect?.x), y: num(el.rect?.y), width: num(el.rect?.width), height: num(el.rect?.height) },
    viewport: {
      width: intNum(el.viewport?.width, 20_000),
      height: intNum(el.viewport?.height, 20_000),
      dpr: Math.max(0.1, Math.min(8, num(el.viewport?.dpr || 1, 2)))
    },
    url: stripQuery(el.url),
    title: cleanLine(el.title, PICK_LIMITS.title).text,
    flags: { sensitive: !!el.flags?.sensitive || html.sensitive, truncated: !!el.flags?.truncated || html.truncated || styles.truncated },
    redactions: intNum(el.redactions, 1_000_000)
  }
  if (el.role && /^[a-z-]{1,30}$/.test(el.role)) out.role = el.role
  if (el.name) {
    const nm = cleanLine(el.name, PICK_LIMITS.name).text
    if (nm) out.name = nm
  }
  if (el.text) {
    const tx = cleanLine(el.text, PICK_LIMITS.text).text
    if (tx) out.text = tx
  }
  if (el.image && !out.flags.sensitive && el.image.mime === 'image/jpeg') {
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(el.image.dataUrl)
    if (m && base64Bytes(m[1]) <= PICK_LIMITS.imageBytes) {
      out.image = {
        mime: 'image/jpeg',
        dataUrl: el.image.dataUrl,
        width: intNum(el.image.width, PICK_LIMITS.imageLongSide),
        height: intNum(el.image.height, PICK_LIMITS.imageLongSide)
      }
    }
  }
  if (el.diagnostics) {
    out.diagnostics = sanitizeDiagnostics(el.diagnostics).diagnostics
  }
  return out
}

/**
 * Ensambla el `PickedElement` v2 que sale por `browser:picked`: sanea el HTML, el texto, los estilos y el diagnóstico, descarta la
 * imagen si el elemento es sensible y aplica todos los topes. `redactions` suma lo que hizo la página y lo que hace main.
 */
export function buildPickedElement(raw: PickRaw, ctx: BuildContext): PickedElement {
  const html = sanitizePickedHtml(raw.html)
  const styles = sanitizeStyles(raw.styles)
  const diag = sanitizeDiagnostics(ctx.diagnostics)
  const name = cleanLine(raw.name, PICK_LIMITS.name)
  const text = cleanLine(raw.text, PICK_LIMITS.text)
  const selector = cleanLine(raw.selector, PICK_LIMITS.selector)
  const path = cleanLine(raw.path, PICK_LIMITS.path)
  const title = cleanLine(ctx.title, PICK_LIMITS.title)
  const sensitive = !!raw.flags?.sensitive || html.sensitive
  const redactions =
    intNum(raw.redactions, 1_000_000) +
    html.redactions +
    styles.redactions +
    diag.redactions +
    name.n +
    text.n +
    selector.n +
    path.n +
    title.n
  const draft: PickedElement = {
    v: 2,
    tag: String(raw.tag ?? '').toLowerCase(),
    role: raw.role,
    name: name.text || undefined,
    text: text.text || undefined,
    selector: selector.text,
    path: path.text,
    html: html.html,
    styles: styles.styles,
    rect: raw.rect,
    viewport: raw.viewport,
    url: ctx.url,
    title: title.text,
    image: sensitive ? undefined : ctx.image,
    diagnostics: diag.diagnostics,
    flags: {
      sensitive,
      truncated: !!raw.flags?.truncated || html.truncated || styles.truncated || (raw.text ?? '').length > PICK_LIMITS.text
    },
    redactions
  }
  const out = capPicked(draft)
  out.redactions = Math.max(out.redactions, 0)
  return out
}
