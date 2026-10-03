/** Lógica pura del panel de archivos (sin React): rutas relativas del árbol y qué carpetas recargar. */

/** Carpeta contenedora de una ruta del árbol (`.` = raíz). */
export function parentOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '.' : path.slice(0, i)
}

export const baseOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

export const joinPath = (parent: string, name: string): string => (parent === '.' || parent === '' ? name : `${parent}/${name}`)

/** `.git` (cualquier nivel) está protegido: no se ofrece crear/renombrar/eliminar dentro. */
export const isProtectedPath = (path: string): boolean => path.split('/').some((p) => p.toLowerCase() === '.git')

/** Carpetas abiertas que hay que recargar tras un aviso del vigilante (`null` = todas las abiertas). */
export function dirsToReload(changed: string[] | null, expanded: Iterable<string>): string[] {
  const open = [...expanded]
  if (changed === null) return open
  const set = new Set(changed)
  return open.filter((d) => set.has(d))
}

/** ¿`p` es `root` o cuelga de él? */
export const isUnder = (p: string, root: string): boolean => p === root || p.startsWith(`${root}/`)

/** Parte del nombre sin extensión (para seleccionarla al renombrar); `.env` y `a.b.c` -> `a.b`. */
export function stemLength(name: string): number {
  const i = name.lastIndexOf('.')
  return i <= 0 ? name.length : i
}

/** Dónde crear según el elemento seleccionado: dentro si es carpeta, junto a él si es archivo, raíz si no hay. */
export function createParent(selected: { path: string; isDir: boolean } | null): string {
  if (!selected) return '.'
  return selected.isDir ? selected.path : parentOf(selected.path)
}
