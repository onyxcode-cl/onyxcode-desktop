import { sep } from 'node:path'

/**
 * true si `p` es `dir` o está dentro de `dir`. Tolera barra final en `dir` (`/a/b/` ≡ `/a/b`) y
 * la raíz (`/` contiene todo). Comparación léxica: no resuelve `..` ni symlinks; normalizar antes
 * (`resolve`) si hace falta. En Windows trata `\` y `/` por igual y no distingue mayúsculas (letra de unidad
 * incluida), como el sistema de archivos.
 */
export function isInside(p: string, dir: string, platform: NodeJS.Platform = process.platform): boolean {
  const win = platform === 'win32'
  const norm = (s: string): string => (win ? s.replace(/\\/g, '/').toLowerCase() : s)
  const s = win ? '/' : sep
  const path = norm(p)
  const d = norm(dir)
  const base = d.length > 1 && d.endsWith(s) ? d.slice(0, -1) : d
  if (path === base) return true
  return path.startsWith(base === s ? s : base + s)
}
