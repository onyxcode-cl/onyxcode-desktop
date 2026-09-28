/**
 * Acorta rutas absolutas para mostrarlas en la UI. OpenCode a veces entrega la
 * ruta relativa a "/" (sin barra inicial) cuando la carpeta no es un repo git.
 */
export function shortenPath(value: string): string {
  const looksAbsolute = /^\/|^(Users|private|tmp|var|Volumes|home|opt)\//.test(value)
  if (!looksAbsolute || /\s/.test(value)) return value
  const parts = value.split('/').filter(Boolean)
  return parts.length <= 2 ? parts.join('/') : `…/${parts.slice(-2).join('/')}`
}
