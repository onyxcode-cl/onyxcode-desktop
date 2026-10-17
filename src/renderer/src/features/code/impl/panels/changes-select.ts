/**
 * Selección de archivo del panel «Cambios» (lógica pura, sin React): seleccionar el primero al abrir, conservar la
 * selección mientras el archivo siga existiendo y moverse con ↑/↓. Probada en `changes-select.test.ts`.
 */

export interface ChangeSelection {
  path: string
  staged: boolean
}

export type ChangeRowRef = ChangeSelection

/** Clave estable de una fila (la misma ruta puede salir preparada y sin preparar a la vez). */
export function rowKey(r: ChangeRowRef): string {
  return `${r.staged ? 's' : 'u'}:${r.path}`
}

/** Filas en el orden en que se pintan: primero las preparadas y luego las demás. */
export function orderedRows(staged: readonly { path: string }[], unstaged: readonly { path: string }[]): ChangeRowRef[] {
  return [...staged.map((f) => ({ path: f.path, staged: true })), ...unstaged.map((f) => ({ path: f.path, staged: false }))]
}

/**
 * Qué archivo debe estar seleccionado: el actual si sigue en la lista; si no, el recordado (de otra sesión o de la vez anterior
 * que se abrió el panel) si sigue existiendo; si no, el primero. Sin filas, `null`.
 */
export function pickSelection(
  rows: readonly ChangeRowRef[],
  current: ChangeSelection | null,
  remembered?: ChangeSelection | null
): ChangeSelection | null {
  if (rows.length === 0) return null
  const has = (s: ChangeSelection | null | undefined): boolean => !!s && rows.some((r) => r.path === s.path && r.staged === s.staged)
  if (current && has(current)) return current
  if (remembered && has(remembered)) return remembered
  // El mismo archivo pasó de «sin preparar» a «preparado» (o al revés): se conserva el archivo, no la sección.
  const moved = [current, remembered].find((s) => !!s && rows.some((r) => r.path === s.path))
  if (moved) {
    const r = rows.find((x) => x.path === moved.path)!
    return { path: r.path, staged: r.staged }
  }
  return { path: rows[0].path, staged: rows[0].staged }
}

/** ↑/↓: la fila anterior o siguiente (sin dar la vuelta). Sin selección, la primera. */
export function moveSelection(rows: readonly ChangeRowRef[], current: ChangeSelection | null, delta: -1 | 1): ChangeSelection | null {
  if (rows.length === 0) return null
  const i = current ? rows.findIndex((r) => r.path === current.path && r.staged === current.staged) : -1
  if (i < 0) return { path: rows[0].path, staged: rows[0].staged }
  const j = Math.min(rows.length - 1, Math.max(0, i + delta))
  return { path: rows[j].path, staged: rows[j].staged }
}

/** Siguiente fila pendiente de revisar después de `current` (para encadenar «aceptar»). */
export function nextPending(
  rows: readonly ChangeRowRef[],
  current: ChangeSelection | null,
  isPending: (path: string) => boolean
): ChangeSelection | null {
  const i = current ? rows.findIndex((r) => r.path === current.path && r.staged === current.staged) : -1
  for (let k = 1; k <= rows.length; k++) {
    const r = rows[(i + k) % rows.length]
    if (!r) continue
    if (current && r.path === current.path && r.staged === current.staged) continue
    if (isPending(r.path)) return { path: r.path, staged: r.staged }
  }
  return null
}

/** Última selección por carpeta: sobrevive a cerrar y volver a abrir el panel y a cambiar de sesión del mismo proyecto. */
const remembered = new Map<string, ChangeSelection>()
export function rememberSelection(dir: string, sel: ChangeSelection | null): void {
  if (sel) remembered.set(dir, sel)
  else remembered.delete(dir)
}
export const recallSelection = (dir: string): ChangeSelection | null => remembered.get(dir) ?? null
export const forgetSelections = (): void => remembered.clear()
