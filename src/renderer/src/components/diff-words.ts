/**
 * Resaltado de palabra dentro de una línea de diff (solo escritorio): empareja las líneas borradas/añadidas de cada bloque y,
 * si el cambio es pequeño, marca solo las palabras que cambiaron con `<span data-w>`. Todo es puro (sin React ni DOM): el
 * render lo hace `DiffView`, que lo desactiva en el celular (`!touch`) y en diffs recortados.
 */
import { diffWordsWithSpace } from 'diff'

export interface WordRange {
  start: number
  end: number
}

/** Una línea supera este largo: no se intenta un diff de palabra (la línea ya se marca entera). */
const MAX_LINE = 400
/** Más de este porcentaje de la línea cambiado: la línea ya se marca entera, no se resalta por palabra. */
const MAX_CHANGE = 0.6
/** Tope de pares por diff (los diffs grandes no se resaltan por palabra). */
const MAX_PAIRS = 200

/**
 * Empareja, por índice, cada bloque de líneas borradas (`del`) seguido de uno de añadidas (`add`): `del[i]` con `add[i]`
 * hasta `min(n, m)`, con un máximo de 200 pares. Devuelve los índices dentro de `lines`.
 */
export function pairChangedRuns(lines: ReadonlyArray<{ kind: string }>): Array<{ del: number; add: number }> {
  const pairs: Array<{ del: number; add: number }> = []
  let i = 0
  while (i < lines.length && pairs.length < MAX_PAIRS) {
    if (lines[i]!.kind !== 'del') {
      i += 1
      continue
    }
    let delEnd = i
    while (delEnd < lines.length && lines[delEnd]!.kind === 'del') delEnd += 1
    let addEnd = delEnd
    while (addEnd < lines.length && lines[addEnd]!.kind === 'add') addEnd += 1
    const count = Math.min(delEnd - i, addEnd - delEnd)
    for (let k = 0; k < count && pairs.length < MAX_PAIRS; k++) pairs.push({ del: i + k, add: delEnd + k })
    // Sin bloque `add` contiguo se salta el bloque `del`; con él, se continúa tras el bloque `add`.
    i = addEnd > delEnd ? addEnd : delEnd
  }
  return pairs
}

/**
 * Rangos de caracteres de `b` que cambian respecto de `a` (las palabras añadidas/modificadas). Devuelve `[]` si alguna
 * línea supera `MAX_LINE`, si son idénticas, o si cambia más del `MAX_CHANGE` de la línea.
 */
export function wordRanges(a: string, b: string): WordRange[] {
  if (a.length > MAX_LINE || b.length > MAX_LINE || a === b) return []
  const parts = diffWordsWithSpace(a, b)
  let added = 0
  let removed = 0
  let same = 0
  for (const p of parts) {
    if (p.added) added += p.value.length
    else if (p.removed) removed += p.value.length
    else same += p.value.length
  }
  const total = added + removed + same
  if (total === 0 || (added + removed) / total > MAX_CHANGE) return []
  const ranges: WordRange[] = []
  let pos = 0
  for (const p of parts) {
    if (p.added) {
      ranges.push({ start: pos, end: pos + p.value.length })
      pos += p.value.length
    } else if (!p.removed) {
      pos += p.value.length
    }
  }
  return ranges
}

/**
 * Envuelve los rangos (offsets de TEXTO, no de HTML) con `<span data-w="">…</span>` dentro del HTML ya resaltado de hljs
 * (solo hay `<span …>`, `</span>` y entidades). Cierra y reabre el realce en los límites de etiqueta para no romper el anidado.
 */
export function wrapRanges(html: string, ranges: WordRange[]): string {
  if (ranges.length === 0) return html
  const events = new Map<number, { open: number; close: number }>()
  for (const r of ranges) {
    if (r.end <= r.start) continue
    let s = events.get(r.start)
    if (!s) {
      s = { open: 0, close: 0 }
      events.set(r.start, s)
    }
    s.open += 1
    let e = events.get(r.end)
    if (!e) {
      e = { open: 0, close: 0 }
      events.set(r.end, e)
    }
    e.close += 1
  }
  const ordered = [...events.entries()].map(([at, ev]) => ({ at, ...ev })).sort((a, b) => a.at - b.at)
  const OPEN = '<span data-w="">'
  const CLOSE = '</span>'
  let out = ''
  let textPos = 0
  let open = 0
  let ei = 0
  let i = 0

  const applyEvents = (): void => {
    while (ei < ordered.length && ordered[ei]!.at <= textPos) {
      const ev = ordered[ei]!
      for (let k = 0; k < ev.close; k++) {
        out += CLOSE
        open -= 1
      }
      for (let k = 0; k < ev.open; k++) {
        out += OPEN
        open += 1
      }
      ei += 1
    }
  }
  const reopen = (): void => {
    for (let k = 0; k < open; k++) out += OPEN
  }
  const closeAll = (): void => {
    for (let k = 0; k < open; k++) out += CLOSE
  }

  while (i < html.length) {
    const ch = html[i]!
    if (ch === '<') {
      const close = html.indexOf('>', i)
      const tag = html.slice(i, close + 1)
      closeAll()
      out += tag
      reopen()
      i = close + 1
      continue
    }
    if (ch === '&') {
      const semi = html.indexOf(';', i)
      const lt = html.indexOf('<', i)
      if (semi !== -1 && semi - i <= 10 && (lt === -1 || semi < lt)) {
        applyEvents()
        out += html.slice(i, semi + 1)
        textPos += 1
        i = semi + 1
        continue
      }
    }
    // Texto literal: carácter a carácter, aplicando los eventos de rango.
    const nextTag = html.indexOf('<', i)
    const nextAmp = html.indexOf('&', i)
    let end = html.length
    if (nextTag !== -1 && nextTag < end) end = nextTag
    if (nextAmp !== -1 && nextAmp < end) end = nextAmp
    while (i < end) {
      applyEvents()
      out += html[i]!
      textPos += 1
      i += 1
    }
  }
  applyEvents()
  return out
}
