import { sep } from 'node:path'

/**
 * true si `p` es `dir` o está dentro de `dir`. Tolera barra final en `dir` (`/a/b/` ≡ `/a/b`) y
 * la raíz (`/` contiene todo). Comparación léxica: no resuelve `..` ni symlinks ni distingue
 * mayúsculas; normalizar antes (`resolve`) si hace falta.
 */
export function isInside(p: string, dir: string): boolean {
  const base = dir.length > 1 && dir.endsWith(sep) ? dir.slice(0, -1) : dir
  if (p === base) return true
  return p.startsWith(base === sep ? sep : base + sep)
}
