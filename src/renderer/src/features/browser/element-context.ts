/**
 * Elemento elegido en el navegador integrado (`PickedElement` v2) llevado al compositor y al mensaje. Lógica pura
 * (sin React ni DOM): etiqueta del chip, casillas por defecto, serialización del bloque de texto para el modelo,
 * lectura inversa del bloque (la burbuja del usuario) y armado de las partes del prompt.
 *
 * El bloque de texto es un prompt para el modelo y lleva etiquetas FIJAS en español (como los demás prompts de la
 * app, no cambian con el idioma de la interfaz): así el lector inverso `parseElementContext` no depende del idioma ni
 * de que el motor conserve `metadata`. El marcador `ELEMENT_MARKER` va siempre al principio del texto.
 */
import type { PickedElement } from '@shared/ipc-browser'
import { PICK_LIMITS } from '@shared/ipc-browser'

/** Primera línea del bloque (plan B acordado: sirve de marca aunque el motor no conserve `metadata`). */
export const ELEMENT_MARKER = '[Elemento de la página]' // i18n-ignore: marca del prompt al modelo
export const ELEMENT_METADATA = { kind: 'browser_element', v: 2 } as const
/** Tope del bloque de texto: cabe en `LIMITS.maxPromptChars` (8000) del celular y en `maxTextPartChars` (12000). */
export const ELEMENT_TEXT_MAX = 8000
/** Elementos a la vez en un mismo borrador (cada uno son 2 partes como máximo; el tope del motor es 100 y el del celular 40). */
export const MAX_ELEMENTS = 3
export const ELEMENT_IMAGE_NAME = 'elemento.jpg'

export interface ElementInclude {
  image: boolean
  diagnostics: boolean
}

/** Adjunto de elemento del compositor (Code y Tareas). Se convierte en partes al enviar. */
export interface ElementAttachment {
  id: string
  kind: 'element'
  /** Etiqueta del chip: `<tag> selector corto`. */
  name: string
  element: PickedElement
  include: ElementInclude
}

const oneLine = (s: string): string => s.replace(/[\r\n\u2028\u2029]+/g, ' ').trim()

export function hostOfUrl(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

/** Último tramo del selector (tras `>`), recortado: `main > div.cta > a.buy` → `a.buy`. */
export function shortSelector(selector: string, max = 40): string {
  const parts = selector.split('>')
  const last = (parts[parts.length - 1] ?? selector).trim() || selector.trim()
  return last.length > max ? `${last.slice(0, max - 1)}…` : last
}

/** Etiqueta del chip: `<tag> selector corto` (sin repetir la etiqueta si el selector ya empieza por ella). */
export function elementLabel(el: Pick<PickedElement, 'tag' | 'selector'>): string {
  const tag = el.tag.toLowerCase()
  let rest = shortSelector(el.selector)
  if (rest.toLowerCase().startsWith(tag)) rest = rest.slice(tag.length)
  return `<${tag}>${rest ? ` ${rest}` : ''}`.trim()
}

/** Cuántos errores (consola + red) trae el diagnóstico. */
export function diagnosticsCount(el: Pick<PickedElement, 'diagnostics'>): number {
  const d = el.diagnostics
  return d ? d.console.length + d.network.length : 0
}

/** ¿La captura es utilizable? Nunca con campos sensibles, y solo un JPEG `data:` dentro del tope. */
export function usableImage(el: PickedElement): PickedElement['image'] | undefined {
  const img = el.image
  if (!img || el.flags.sensitive) return undefined
  if (!/^data:image\/jpeg;base64,/i.test(img.dataUrl)) return undefined
  const bytes = Math.floor(((img.dataUrl.length - img.dataUrl.indexOf(',') - 1) * 3) / 4)
  if (bytes > PICK_LIMITS.imageBytes) return undefined
  return img
}

/** Casillas por defecto: marcadas salvo que no haya nada que incluir; `sensitive` nunca incluye captura. */
export function defaultInclude(el: PickedElement): ElementInclude {
  return { image: !!usableImage(el), diagnostics: diagnosticsCount(el) > 0 }
}

/** Las casillas realmente aplicables (la captura no sale si el elemento es sensible o no hay imagen). */
export function effectiveInclude(el: PickedElement, include: ElementInclude): ElementInclude {
  return { image: include.image && !!usableImage(el), diagnostics: include.diagnostics && diagnosticsCount(el) > 0 }
}

let seq = 0
export function makeElementAttachment(el: PickedElement): ElementAttachment {
  seq += 1
  return { id: `el-${Date.now()}-${seq}`, kind: 'element', name: elementLabel(el), element: el, include: defaultInclude(el) }
}

export function isElementAttachment(a: { kind?: string }): a is ElementAttachment {
  return a.kind === 'element'
}

/** Añade un elemento al borrador conservando solo los `MAX_ELEMENTS` más recientes (los demás adjuntos no se tocan). */
export function addElementAttachment<T extends { kind?: string }>(list: T[], att: ElementAttachment & T): T[] {
  const els = list.filter(isElementAttachment)
  const drop = new Set<T>(els.slice(0, Math.max(0, els.length + 1 - MAX_ELEMENTS)))
  return [...list.filter((a) => !drop.has(a)), att]
}

// ---------------------------------------------------------------------------
// Serialización del bloque de texto para el modelo
// ---------------------------------------------------------------------------

const fmtNum = (n: number): string => String(Math.round(n))

function consoleLines(el: PickedElement): string[] {
  return (el.diagnostics?.console ?? []).map((c) => `- ${c.level}: ${oneLine(c.text)}`)
}

function networkLines(el: PickedElement): string[] {
  return (el.diagnostics?.network ?? []).map((n) => `- ${n.method} ${oneLine(n.url)} → ${n.status ?? oneLine(n.error ?? '?')}`)
}

function stylesLine(el: PickedElement): string {
  return Object.entries(el.styles)
    .map(([k, v]) => `${k}: ${oneLine(v)}`)
    .join('; ')
}

/** Corta el HTML a `max` caracteres en una etiqueta completa (nunca deja un `<div cl` suelto). */
function cutHtml(html: string, max: number): string {
  if (html.length <= max) return html
  const cut = html.slice(0, Math.max(0, max))
  const lt = cut.lastIndexOf('<')
  const gt = cut.lastIndexOf('>')
  const safe = lt > gt ? cut.slice(0, lt) : cut
  return `${safe}\n<!-- … -->`
}

interface Sections {
  head: string[]
  diag: string[]
}

function render(s: Sections, html: string, styles: string): string {
  const fence = html.replace(/```/g, '` ` `')
  return [
    ...s.head,
    'HTML (recortado):', // i18n-ignore: prompt al modelo
    '```html',
    fence,
    '```',
    ...(styles ? [`Estilos calculados: ${styles}`] : []), // i18n-ignore: prompt al modelo
    ...s.diag
  ].join('\n')
}

/**
 * Bloque de texto del elemento para el modelo. `include.diagnostics` decide si salen consola y red; `include.image` solo
 * añade la línea «Captura: adjunta» (la imagen va en otra parte). Nunca pasa de `ELEMENT_TEXT_MAX` caracteres: si hace
 * falta se recorta primero el HTML, luego los estilos y por último el diagnóstico.
 */
export function formatElementContext(el: PickedElement, include: ElementInclude): string {
  const inc = effectiveInclude(el, include)
  const d = el.diagnostics
  const role = el.role ? `[${oneLine(el.role)}]` : ''
  const name = el.name ? ` "${oneLine(el.name)}"` : ''
  const head: string[] = [
    ELEMENT_MARKER,
    `Página: ${oneLine(el.title) || hostOfUrl(el.url)} — ${oneLine(el.url)}`, // i18n-ignore: prompt al modelo
    `Selector: ${oneLine(el.selector)}`, // i18n-ignore: prompt al modelo
    `Ruta: ${oneLine(el.path)}`, // i18n-ignore: prompt al modelo
    `Elemento: ${el.tag}${role}${name} · ${fmtNum(el.rect.width)}×${fmtNum(el.rect.height)} px en (${fmtNum(el.rect.x)}, ${fmtNum(el.rect.y)}) · viewport ${fmtNum(el.viewport.width)}×${fmtNum(el.viewport.height)}` // i18n-ignore: prompt al modelo
  ]
  if (inc.image) head.push('Captura: adjunta') // i18n-ignore: prompt al modelo
  if (el.flags.sensitive) head.push('Aviso: contiene campos sensibles; no se incluyen sus valores ni la captura.') // i18n-ignore: prompt al modelo
  if (el.redactions > 0) head.push(`Omitidos: ${el.redactions}`) // i18n-ignore: prompt al modelo
  if (el.flags.truncated) head.push('Recortado: sí') // i18n-ignore: prompt al modelo

  const diag: string[] = []
  if (inc.diagnostics && d) {
    const c = consoleLines(el)
    const n = networkLines(el)
    if (c.length) diag.push(`Errores de consola (${c.length}):`, ...c) // i18n-ignore: prompt al modelo
    if (n.length) diag.push(`Peticiones con fallo (${n.length}):`, ...n) // i18n-ignore: prompt al modelo
  }
  const sec: Sections = { head, diag }

  let html = el.html
  let styles = stylesLine(el)
  let out = render(sec, html, styles)
  if (out.length > ELEMENT_TEXT_MAX) {
    html = cutHtml(html, Math.max(0, html.length - (out.length - ELEMENT_TEXT_MAX) - 16))
    out = render(sec, html, styles)
  }
  if (out.length > ELEMENT_TEXT_MAX) {
    html = cutHtml(html, 0)
    styles = styles.slice(0, Math.max(0, styles.length - (out.length - ELEMENT_TEXT_MAX)))
    out = render(sec, html, styles)
  }
  if (out.length > ELEMENT_TEXT_MAX) {
    sec.diag = diag.slice(0, 8)
    out = render(sec, html, styles)
  }
  return out.length > ELEMENT_TEXT_MAX ? out.slice(0, ELEMENT_TEXT_MAX) : out
}

export interface ElementTextPart {
  type: 'text'
  text: string
  synthetic: true
  metadata: { kind: 'browser_element'; v: 2 }
}
export interface ElementFilePart {
  type: 'file'
  mime: 'image/jpeg'
  filename: string
  url: string
}

/**
 * Partes del prompt de un elemento: el texto sintético y, solo si la casilla está marcada (y el elemento no es sensible),
 * la captura como parte `file` con URL `data:` (única forma que sale desde Chat y desde el celular).
 */
export function buildElementParts(att: ElementAttachment): { text: ElementTextPart; file?: ElementFilePart } {
  const inc = effectiveInclude(att.element, att.include)
  const img = inc.image ? usableImage(att.element) : undefined
  return {
    text: { type: 'text', text: formatElementContext(att.element, inc), synthetic: true, metadata: ELEMENT_METADATA },
    ...(img ? { file: { type: 'file', mime: 'image/jpeg', filename: ELEMENT_IMAGE_NAME, url: img.dataUrl } satisfies ElementFilePart } : {})
  }
}

/** Todas las partes (texto y captura) de varios elementos, en orden. */
export function elementPartsOf(list: ElementAttachment[]): Array<ElementTextPart | ElementFilePart> {
  return list.flatMap((a) => {
    const p = buildElementParts(a)
    return p.file ? [p.text, p.file] : [p.text]
  })
}

// ---------------------------------------------------------------------------
// Lectura inversa (burbuja del usuario) y vista de detalle
// ---------------------------------------------------------------------------

/** ¿Es este texto el bloque de un elemento? (por el marcador: no depende de `synthetic` ni de `metadata`). */
export function isElementContextText(text: string): boolean {
  return text.startsWith(ELEMENT_MARKER)
}

/** Datos de un elemento listos para mostrar (compositor y burbuja). */
export interface ElementDetail {
  tag: string
  label: string
  host: string
  url: string
  title: string
  selector: string
  path: string
  /** `ancho×alto` en píxeles, si se conoce. */
  size?: string
  html: string
  styles: Array<[string, string]>
  console: string[]
  network: string[]
  redactions: number
  sensitive: boolean
  truncated: boolean
  /** Solo en el compositor (la burbuja ya muestra la captura como un adjunto más). */
  imageUrl?: string
  hasImage: boolean
}

export function detailFromElement(el: PickedElement): ElementDetail {
  return {
    tag: el.tag,
    label: elementLabel(el),
    host: hostOfUrl(el.url),
    url: el.url,
    title: el.title,
    selector: el.selector,
    path: el.path,
    size: `${fmtNum(el.rect.width)}×${fmtNum(el.rect.height)}`,
    html: el.html,
    styles: Object.entries(el.styles),
    console: (el.diagnostics?.console ?? []).map((c) => `${c.level}: ${oneLine(c.text)}`),
    network: (el.diagnostics?.network ?? []).map((n) => `${n.method} ${oneLine(n.url)} → ${n.status ?? oneLine(n.error ?? '?')}`),
    redactions: el.redactions,
    sensitive: el.flags.sensitive,
    truncated: el.flags.truncated,
    imageUrl: usableImage(el)?.dataUrl,
    hasImage: !!usableImage(el)
  }
}

/** Lee el bloque de texto (el que vio el modelo) y devuelve lo que muestra la burbuja; `null` si no es un bloque de elemento. */
export function parseElementContext(text: string): ElementDetail | null {
  if (!isElementContextText(text)) return null
  const lines = text.split('\n')
  // Las líneas de cabecera acaban en «HTML (recortado):»; lo demás se lee después del bloque.
  const htmlAt = lines.indexOf('HTML (recortado):') // i18n-ignore: prompt al modelo
  const head = htmlAt < 0 ? lines : lines.slice(0, htmlAt)
  const headField = (label: string): string => {
    const pre = `${label}: `
    const l = head.find((x) => x.startsWith(pre))
    return l ? l.slice(pre.length).trim() : ''
  }
  const page = headField('Página') // i18n-ignore: prompt al modelo
  const sep = page.lastIndexOf(' — ')
  const url = sep < 0 ? page : page.slice(sep + 3)
  const title = sep < 0 ? '' : page.slice(0, sep)
  const selector = headField('Selector') // i18n-ignore: prompt al modelo
  const elementLine = headField('Elemento') // i18n-ignore: prompt al modelo
  const tag = /^([a-z][a-z0-9-]*)/i.exec(elementLine)?.[1] ?? ''
  const size = /(\d+)×(\d+) px/.exec(elementLine)
  let html = ''
  let after = lines.length
  if (htmlAt >= 0 && lines[htmlAt + 1]?.startsWith('```')) {
    let end = htmlAt + 2
    while (end < lines.length && lines[end] !== '```') end++
    html = lines.slice(htmlAt + 2, end).join('\n')
    after = end + 1
  }
  const tail = lines.slice(after)
  const stylesRaw = tail.find((x) => x.startsWith('Estilos calculados: ')) // i18n-ignore: prompt al modelo
  const styles: Array<[string, string]> = stylesRaw
    ? stylesRaw
        .slice('Estilos calculados: '.length) // i18n-ignore: prompt al modelo
        .split('; ')
        .map((kv): [string, string] => {
          const i = kv.indexOf(': ')
          return i < 0 ? [kv, ''] : [kv.slice(0, i), kv.slice(i + 2)]
        })
        .filter(([k]) => k)
    : []
  const list = (header: RegExp): string[] => {
    const i = tail.findIndex((x) => header.test(x))
    if (i < 0) return []
    const out: string[] = []
    for (let j = i + 1; j < tail.length && tail[j]!.startsWith('- '); j++) out.push(tail[j]!.slice(2))
    return out
  }
  const omitted = Number(/^Omitidos: (\d+)$/m.exec(head.join('\n'))?.[1] ?? 0) // i18n-ignore: prompt al modelo
  const label = elementLabel({ tag: tag || 'div', selector })
  return {
    tag,
    label,
    host: hostOfUrl(url),
    url,
    title,
    selector,
    path: headField('Ruta'), // i18n-ignore: prompt al modelo
    size: size ? `${size[1]}×${size[2]}` : undefined,
    html,
    styles,
    console: list(/^Errores de consola \(\d+\):$/), // i18n-ignore: prompt al modelo
    network: list(/^Peticiones con fallo \(\d+\):$/), // i18n-ignore: prompt al modelo
    redactions: omitted,
    sensitive: head.some((x) => x.startsWith('Aviso: contiene campos sensibles')), // i18n-ignore: prompt al modelo
    truncated: head.includes('Recortado: sí'), // i18n-ignore: prompt al modelo
    hasImage: head.includes('Captura: adjunta') // i18n-ignore: prompt al modelo
  }
}

/** Partes de texto de un mensaje que son bloques de elemento (sintéticas o no). */
export function elementTextsOf(parts: ReadonlyArray<{ type: string; text?: string }>): string[] {
  return parts.flatMap((p) => (p.type === 'text' && typeof p.text === 'string' && isElementContextText(p.text) ? [p.text] : []))
}
