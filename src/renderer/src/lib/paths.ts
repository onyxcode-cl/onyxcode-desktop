/**
 * Rutas para mostrar en la UI. Aceptan `/` y `\` (Windows: `C:\Users\x\repo`, `C:/Users/x/repo`).
 */

const WIN_ABS = /^[A-Za-z]:[\\/]/

/**
 * Acorta rutas absolutas para mostrarlas en la UI. OpenCode a veces entrega la
 * ruta relativa a "/" (sin barra inicial) cuando la carpeta no es un repo git.
 */
export function shortenPath(value: string): string {
  const looksAbsolute = /^\/|^(Users|private|tmp|var|Volumes|home|opt)\//.test(value) || WIN_ABS.test(value)
  if (!looksAbsolute || /\s/.test(value)) return value
  const parts = value
    .replace(/^[A-Za-z]:/, '')
    .split(/[\\/]+/)
    .filter(Boolean)
  return parts.length <= 2 ? parts.join('/') : `…/${parts.slice(-2).join('/')}`
}

/** Reemplaza la carpeta personal (`/Users/<x>`, `/home/<x>` o `C:\Users\<x>`) por `~`; conserva el resto y su separador. */
export function tildify(p: string): string {
  return p.replace(/^(?:\/(?:Users|home)\/[^/]+|[A-Za-z]:[\\/]+Users[\\/]+[^\\/]+)(?=[\\/]|$)/, '~')
}

/** Último segmento de una ruta (acepta `/` y `\`). */
export function baseName(p: string): string {
  const parts = p.replace(/[/\\]+$/, '').split(/[/\\]/)
  return parts[parts.length - 1] || p
}

/** Separa una ruta en carpeta y nombre (acepta `/` y `\`); sin separador, carpeta vacía. */
export function splitPath(p: string): { dir: string; name: string } {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i < 0 ? { dir: '', name: p } : { dir: p.slice(0, i), name: p.slice(i + 1) }
}
