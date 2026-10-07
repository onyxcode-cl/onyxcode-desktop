/** Lógica pura de "proyectos abiertos" en Code (varios proyectos a la vez en la barra lateral). Sin React ni Zustand. */

export const MAX_OPEN_PROJECTS = 8

export interface OpenProjects {
  open: string[]
  focus: string | null
}

/** Compara dos rutas de carpeta ignorando una barra final (`/a/b` === `/a/b/`). */
export function sameDir(a: string, b: string): boolean {
  const trim = (s: string): string => s.replace(/[/\\]+$/, '')
  return trim(a) === trim(b)
}

/**
 * Lee la clave nueva `code.projects` (JSON `{v:1, open:string[], focus:string|null}`) y, si falta o es inválida,
 * hace la migración desde la clave vieja `code.project` (una sola carpeta en texto plano, o `null`).
 * Deduplica con `sameDir`, recorta a `max` y fuerza `focus` a estar dentro de `open` (si no, usa `open[0] ?? null`).
 */
export function parseOpenProjects(rawNew: string | null, rawLegacy: string | null, max: number): OpenProjects {
  const dedupe = (list: string[]): string[] => {
    const out: string[] = []
    for (const d of list) {
      if (typeof d !== 'string' || !d) continue
      if (!out.some((x) => sameDir(x, d))) out.push(d)
    }
    return out.slice(0, max)
  }
  if (rawNew) {
    try {
      const parsed = JSON.parse(rawNew) as { v?: unknown; open?: unknown; focus?: unknown }
      if (parsed && parsed.v === 1 && Array.isArray(parsed.open)) {
        const open = dedupe(parsed.open.filter((x): x is string => typeof x === 'string'))
        const focusRaw = typeof parsed.focus === 'string' ? parsed.focus : null
        const focus = focusRaw && open.some((d) => sameDir(d, focusRaw)) ? focusRaw : (open[0] ?? null)
        return { open, focus }
      }
    } catch {
      // sigue a la migración / vacío
    }
  }
  if (rawLegacy) return { open: [rawLegacy], focus: rawLegacy }
  return { open: [], focus: null }
}

/**
 * Decide qué pasa al pedir abrir `dir` dado lo ya abierto:
 *  - si `dir` ya está abierto (por `sameDir`): no cambia nada (`evict: null`, `refused: false`).
 *  - si hay hueco (`open.length < max`): se agrega al final.
 *  - si está lleno: se desaloja el más viejo por foco (`focusRank` más chico) que NO esté "vivo" (`isLive`).
 *  - si todos los que están llenos están vivos: `refused: true` y `open` queda IGUAL (no se agrega nada).
 */
export function planOpen(
  open: readonly string[],
  dir: string,
  max: number,
  isLive: (d: string) => boolean,
  focusRank: (d: string) => number
): { open: string[]; evict: string | null; refused: boolean } {
  if (open.some((d) => sameDir(d, dir))) return { open: [...open], evict: null, refused: false }
  if (open.length < max) return { open: [...open, dir], evict: null, refused: false }
  const candidates = open.filter((d) => !isLive(d))
  if (candidates.length === 0) return { open: [...open], evict: null, refused: true }
  let oldest = candidates[0]!
  for (const d of candidates) if (focusRank(d) < focusRank(oldest)) oldest = d
  const next = open.filter((d) => !sameDir(d, oldest))
  next.push(dir)
  return { open: next, evict: oldest, refused: false }
}

/**
 * A qué proyecto pasa el foco al cerrar `closed` (que estaba en `open`, con foco). Prioridad: el de foco más
 * reciente entre los que quedan (`focusRank` más alto); si hay empate o no hay datos de foco, el vecino siguiente
 * en la lista original, o si no había siguiente, el anterior. `null` si no queda ninguno.
 */
export function nextFocusAfterClose(open: readonly string[], closed: string, focusRank: (d: string) => number): string | null {
  const remaining = open.filter((d) => !sameDir(d, closed))
  if (remaining.length === 0) return null
  const idx = open.findIndex((d) => sameDir(d, closed))
  let best = remaining[0]!
  let bestRank = focusRank(best)
  let anyRanked = bestRank > -Infinity
  for (const d of remaining) {
    const r = focusRank(d)
    if (r > -Infinity) anyRanked = true
    if (r > bestRank) {
      best = d
      bestRank = r
    }
  }
  if (anyRanked) return best
  // Sin datos de foco: vecino siguiente, o si no hay, el anterior.
  const after = open[idx + 1]
  if (after && remaining.some((d) => sameDir(d, after))) return after
  for (let i = idx - 1; i >= 0; i--) {
    const before = open[i]!
    if (remaining.some((d) => sameDir(d, before))) return before
  }
  return remaining[0]!
}
