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
  /** Texto a mostrar (marcadores `{x}` sustituidos por «…»). */
  text: string
  /** Fragmento fijo más largo del texto original: sirve para localizar la opción en la página. */
  anchor: string
  norm: string
}

export interface SearchGroup<Id extends string = string> {
  section: Id
  label: string
  /** La coincidencia es el propio título de la sección. */
  titleMatch: boolean
  entries: SearchEntry<Id>[]
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
      const template = plain(msg)
      const text = template.replace(/\{[^}]*\}/g, '…').trim()
      if (text.length < 3 || text === '…') continue
      // Plantillas casi todo datos («{n} modelos · origen: {x}») no sirven como resultado legible.
      if (text.startsWith('…') || (template.match(/\{[^}]*\}/g)?.length ?? 0) >= 2) continue
      const dedupe = `${sec.id}\u0000${text}`
      if (seenText.has(dedupe)) continue
      seenKeys.add(key)
      seenText.add(dedupe)
      out.push({ section: sec.id, key, text, anchor: anchorOf(template), norm: normalize(text) })
    }
  }
  return out
}

/** Palabras de la consulta (todas deben aparecer, en cualquier orden). */
export function queryWords(query: string): string[] {
  return normalize(query).split(/\s+/).filter(Boolean)
}

/** Agrupa por sección: primero las secciones cuyo título coincide, luego por número de opciones. `maxPerSection` limita la lista. */
export function searchSettings<Id extends string>(
  sections: readonly SearchSection<Id>[],
  index: readonly SearchEntry<Id>[],
  query: string,
  maxPerSection = 6
): SearchGroup<Id>[] {
  const words = queryWords(query)
  if (words.length === 0) return []
  const groups: SearchGroup<Id>[] = []
  for (const sec of sections) {
    const label = normalize(sec.label)
    const titleMatch = words.every((w) => label.includes(w))
    const entries = index
      .filter((e) => e.section === sec.id && e.norm !== label && words.every((w) => e.norm.includes(w)))
      .sort((a, b) => a.text.length - b.text.length)
      .slice(0, maxPerSection)
    if (titleMatch || entries.length > 0) groups.push({ section: sec.id, label: sec.label, titleMatch, entries })
  }
  return groups.sort((a, b) => Number(b.titleMatch) - Number(a.titleMatch) || b.entries.length - a.entries.length)
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
