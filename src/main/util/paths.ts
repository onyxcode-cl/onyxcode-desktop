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

/** Letra de unidad en mayúscula (`c:\x` → `C:\x`); sin efecto en otras plataformas ni rutas sin unidad. */
export function normalizeDrive(p: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? p.replace(/^([a-z]):/, (_m, d: string) => `${d.toUpperCase()}:`) : p
}

/**
 * true si `a` y `b` son la misma ruta. En Windows: `\` ≡ `/`, sin distinguir mayúsculas (unidad incluida) y sin
 * barra final; en el resto, comparación exacta (salvo la barra final).
 */
export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  const norm = (s: string): string => {
    const x = platform === 'win32' ? s.replace(/\\/g, '/').toLowerCase() : s
    return x.length > 1 && x.endsWith('/') ? x.slice(0, -1) : x
  }
  return norm(a) === norm(b)
}
