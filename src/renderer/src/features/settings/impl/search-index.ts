/**
 * Búsqueda en Ajustes: el índice se construye a partir de las claves i18n que usa cada sección (por prefijo), nunca con textos
 * copiados a mano; así sigue al idioma activo y no se desactualiza cuando cambia un texto. Puro: sin DOM ni React (se prueba solo).
 */
import { DICTIONARIES, type Lang, type Msg } from '@shared/i18n'

export interface SearchSection<Id extends string = string> {
  id: Id
  label: string
  /** Prefijos de claves i18n (`settings.general.`) o claves completas que pintan la sección. */
  prefixes: readonly string[]
}

export interface SearchEntry<Id extends string = string> {
  section: Id
  key: string
  /** Texto completo de la opción. Las plantillas con parámetros (`{x}`) no entran al índice: solo tienen sentido con datos. */
  text: string
  /** Fragmento del texto que sirve para localizar la opción en la página. */
  anchor: string
  norm: string
  /** Frase corta y completa para mostrar en la lista (el texto va en `text`); se calcula al buscar. */
  shown: string
}

export interface SearchGroup<Id extends string = string> {
  section: Id
  label: string
  /** La coincidencia es el propio título de la sección. */
  titleMatch: boolean
  entries: SearchEntry<Id>[]
  /** Resultados que no caben en `maxPerSection` (para «Ver N más»); ya vienen sin casi-duplicados. */
  more: SearchEntry<Id>[]
}

/** Minúsculas y sin tildes: «conexion» encuentra «Conexión». */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Claves que no son una opción visible (errores, avisos de guardado, etiquetas de accesibilidad…). */
const NOISE = /(error|err|fail|aria|saving|saved|loading|busy|toast|confirm|placeholder)/i

function plain(m: Msg): string {
  return typeof m === 'string' ? m : m.other
}

function anchorOf(template: string): string {
  const parts = template
    .split(/\{[^}]*\}/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 3)
  return parts.sort((a, b) => b.length - a.length)[0] ?? ''
}

/** Todas las claves de las secciones, con su texto en el idioma pedido. Una clave solo se cuenta en la primera sección que la reclama. */
export function buildSearchIndex<Id extends string>(
  sections: readonly SearchSection<Id>[],
  lang: Lang,
  dict: Record<string, Msg> = DICTIONARIES[lang]
): SearchEntry<Id>[] {
  const out: SearchEntry<Id>[] = []
  const seenKeys = new Set<string>()
  const seenText = new Set<string>()
  for (const sec of sections) {
    for (const [key, msg] of Object.entries(dict)) {
      if (seenKeys.has(key)) continue
      if (!sec.prefixes.some((p) => key === p || (p.endsWith('.') && key.startsWith(p)))) continue
      const last = key.slice(key.lastIndexOf('.') + 1)
      if (NOISE.test(last)) continue
      const text = plain(msg).trim()
      // Plantillas con parámetros («Clave de {x}», «Probando la clave de {x}…») solo tienen sentido con datos: fuera del índice.
      if (/[{}]/.test(text) || text.length < 3) continue
      // Frases ya cortadas en el original («Pulsa la combinación… (Esc cancela)») no sirven como resultado.
      if (/…|\.\.\./.test(text.replace(/(…|\.\.\.)$/, ''))) continue
      const dedupe = `${sec.id}\u0000${text}`
      if (seenText.has(dedupe)) continue
      seenKeys.add(key)
      seenText.add(dedupe)
      out.push({ section: sec.id, key, text, anchor: anchorOf(text), norm: normalize(text), shown: text })
    }
  }
  return out
}

/** Palabras de la consulta (todas deben aparecer, en cualquier orden). */
export function queryWords(query: string): string[] {
  return normalize(query).split(/\s+/).filter(Boolean)
}

/** Largo máximo (en caracteres) de la frase que se muestra en la lista. */
export const SHOWN_MAX = 110

/** Textos de ayuda (no etiquetas de opciones): se muestran después de las etiquetas. */
const HELP_KEY = /(description|desc|help|hint|note|body|intro|subtitle|privacy|what|why|detail|explain|empty)/i

/** Recorta en un límite de palabra con «…» solo al final. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max + 1)
  const at = cut.lastIndexOf(' ')
  const head = (at > max * 0.5 ? cut.slice(0, at) : cut.slice(0, max)).replace(/[\s,;:.\-–—(«"]+$/, '')
  return head + '…'
}

/**
 * Frase completa y útil para mostrar: la primera oración que contiene la consulta (o la primera del texto), recortada en un límite
 * de palabra con «…» solo al final. Si la coincidencia quedaría fuera del recorte, se parte la oración antes de la coincidencia.
 */
export function shownText(text: string, words: readonly string[], max = SHOWN_MAX): string {
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡«“])|\n+/).map((x) => x.trim()).filter(Boolean)
  if (sentences.length === 0) return text
  const hit = sentences.find((x) => words.every((w) => normalize(x).includes(w)))
  const pick = hit ?? sentences.find((x) => words.some((w) => normalize(x).includes(w))) ?? sentences[0]
  if (pick.length <= max) return pick
  // Que la primera coincidencia quede visible: si cae pasado el límite, empezar en la palabra anterior a ella (sin «…» al inicio).
  const norm = normalize(pick)
  const firstAt = Math.min(...words.map((w) => norm.indexOf(w)).filter((i) => i >= 0), Infinity)
  let start = 0
  if (Number.isFinite(firstAt) && firstAt > max - 24) {
    start = pick.lastIndexOf(' ', Math.max(0, firstAt - 12)) + 1
  }
  const body = pick.slice(start)
  const first = body.charAt(0)
  return clip(start > 0 ? first.toUpperCase() + body.slice(1) : body, max)
}

function wordSet(norm: string): Set<string> {
  return new Set(norm.split(/[^a-z0-9ñ]+/).filter((w) => w.length > 2))
}

/** Casi idénticos: comparten la gran mayoría de sus palabras (p. ej. la misma frase para Mac y para Windows). */
function nearDuplicate(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false
  let common = 0
  for (const w of a) if (b.has(w)) common++
  return common / Math.min(a.size, b.size) >= 0.8 && common / Math.max(a.size, b.size) >= 0.6
}

/** Orden de relevancia: etiquetas de opciones antes que ayudas largas; luego coincidencia al inicio de una palabra; luego lo más corto. */
function rank(e: SearchEntry, words: readonly string[]): number {
  const last = e.key.slice(e.key.lastIndexOf('.') + 1)
  const help = HELP_KEY.test(last) || e.text.length > 90 ? 1 : 0
  const atWordStart = words.every((w) => new RegExp('(^|[^a-z0-9ñ])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(e.norm)) ? 0 : 1
  return help * 1000 + atWordStart * 500 + Math.min(e.text.length, 499)
}

/**
 * Agrupa por sección: primero las secciones cuyo título coincide, luego por número de opciones. En cada sección: etiquetas antes que
 * ayudas, sin casi-duplicados, los `maxPerSection` más relevantes en `entries` y el resto en `more` («Ver N más»).
 */
export function searchSettings<Id extends string>(
  sections: readonly SearchSection<Id>[],
  index: readonly SearchEntry<Id>[],
  query: string,
  maxPerSection = 4
): SearchGroup<Id>[] {
  const words = queryWords(query)
  if (words.length === 0) return []
  const groups: SearchGroup<Id>[] = []
  for (const sec of sections) {
    const label = normalize(sec.label)
    const titleMatch = words.every((w) => label.includes(w))
    const ranked = index
      .filter((e) => e.section === sec.id && e.norm !== label && words.every((w) => e.norm.includes(w)))
      .map((e) => ({ e, r: rank(e as SearchEntry, words) }))
      .sort((a, b) => a.r - b.r)
    const kept: SearchEntry<Id>[] = []
    const sets: Set<string>[] = []
    for (const { e } of ranked) {
      const shown = shownText(e.text, words)
      const set = wordSet(normalize(shown))
      if (sets.some((o) => nearDuplicate(o, set))) continue
      sets.push(set)
      kept.push({ ...e, shown })
    }
    const entries = kept.slice(0, maxPerSection)
    const more = kept.slice(maxPerSection)
    if (titleMatch || entries.length > 0) groups.push({ section: sec.id, label: sec.label, titleMatch, entries, more })
  }
  return groups.sort(
    (a, b) => Number(b.titleMatch) - Number(a.titleMatch) || b.entries.length + b.more.length - (a.entries.length + a.more.length)
  )
}

/** Parte `text` en trozos con las coincidencias marcadas (para resaltar sin `dangerouslySetInnerHTML`). */
export function highlightParts(text: string, query: string): { text: string; hit: boolean }[] {
  const words = queryWords(query)
  if (words.length === 0) return [{ text, hit: false }]
  // Cada carácter se normaliza por separado para conservar la correspondencia de posiciones (NFD puede alargar un carácter).
  const chars = [...text]
  const norm = chars.map((c) => normalize(c))
  const flat = norm.join('')
  const starts: number[] = []
  let pos = 0
  for (const n of norm) {
    starts.push(pos)
    pos += n.length
  }
  const mark = new Array<boolean>(chars.length).fill(false)
  for (const w of words) {
    let from = 0
    for (;;) {
      const at = flat.indexOf(w, from)
      if (at < 0) break
      chars.forEach((_, i) => {
        if (starts[i] < at + w.length && starts[i] + norm[i].length > at) mark[i] = true
      })
      from = at + w.length
    }
  }
  const parts: { text: string; hit: boolean }[] = []
  chars.forEach((c, i) => {
    const last = parts[parts.length - 1]
    if (last && last.hit === mark[i]) last.text += c
    else parts.push({ text: c, hit: mark[i] })
  })
  return parts
}

/** Localiza en la página la opción cuyo texto fijo es `anchor`: devuelve su fila (o el elemento) para desplazarse y enfocar. */
export function findAnchorElement(root: ParentNode, anchor: string): HTMLElement | null {
  const want = normalize(anchor)
  if (!want) return null
  const doc = (root as Node).ownerDocument ?? (root as Document)
  const walker = doc.createTreeWalker(root as Node, 4 /* NodeFilter.SHOW_TEXT */)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!normalize(n.nodeValue ?? '').includes(want)) continue
    const el = (n as Text).parentElement
    if (!el) continue
    return (el.closest('[data-row]') as HTMLElement | null) ?? el
  }
  // Marcadores, etiquetas ARIA o placeholders: respaldo por atributos visibles.
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[aria-label],[placeholder],[title]'))) {
    const v = el.getAttribute('aria-label') ?? el.getAttribute('placeholder') ?? el.getAttribute('title') ?? ''
    if (normalize(v).includes(want)) return el
  }
  return null
}
