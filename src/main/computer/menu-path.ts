/**
 * Elegir una opción de la barra de menús por RUTA («Conexiones» › «Modo de teclado» › «Unicode») con la accesibilidad, sin mover el ratón.
 *
 * El helper expone la barra de menús con referencias de ruta: la barra es `m`, cada título de la barra `m.<i>`, el menú que despliega es su hijo 0
 * (`m.<i>.0`) y sus opciones `m.<i>.0.<j>`; una opción con submenú repite el patrón (`m.<i>.0.<j>.0.<k>`). Aquí solo está la parte pura
 * (resolver cada tramo de la ruta entre los nodos que devuelve `ax-find`); la herramienta `app_menu` de `mcp-server.ts` hace las llamadas.
 */

export interface MenuNodeLike {
  ref: string
  role: string
  title?: string
  enabled?: boolean
}

/** Minúsculas y sin acentos ni puntos suspensivos finales («Preferencias…» ≈ «preferencias»). */
export const foldTitle = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[….]+\s*$/u, '')
    .toLowerCase()
    .trim()

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** ¿`ref` es hijo directo (una opción) del menú de `parentRef`? Con `null`, un título de la barra de menús. */
export function isMenuChild(ref: string, parentRef: string | null): boolean {
  return parentRef === null ? /^m\.\d+$/.test(ref) : new RegExp(`^${escapeRegExp(parentRef)}\\.0\\.\\d+$`).test(ref)
}

export interface MenuPick {
  node?: MenuNodeLike
  /** Títulos disponibles en ese nivel (para decirle al modelo qué hay si no encontró el que pidió). */
  options: string[]
}

/** Elige, entre `nodes`, la opción llamada `wanted` justo debajo de `parentRef`: título igual > empieza por > contiene (solo si es única). */
export function pickMenuNode(nodes: MenuNodeLike[], parentRef: string | null, wanted: string): MenuPick {
  const level = nodes.filter((n) => n.title && isMenuChild(n.ref, parentRef))
  const options = [...new Set(level.map((n) => n.title as string))]
  const w = foldTitle(wanted)
  if (!w) return { options }
  const exact = level.find((n) => foldTitle(n.title as string) === w)
  if (exact) return { node: exact, options }
  const starts = level.filter((n) => foldTitle(n.title as string).startsWith(w))
  if (starts.length === 1) return { node: starts[0], options }
  const has = level.filter((n) => foldTitle(n.title as string).includes(w))
  if (has.length === 1) return { node: has[0], options }
  return { options }
}
