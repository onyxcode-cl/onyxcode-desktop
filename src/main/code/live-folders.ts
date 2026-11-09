/**
 * Carpetas de Code abiertas CON confianza vigente, según el renderer (que es quien guarda la confianza: `trustedFolders` y la huella
 * aprobada viven en su almacenamiento local). Es lo único que `main` puede preguntar al motor además de la carpeta del Chat: cualquier
 * petición con `directory=` hace que el motor cargue esa carpeta (complementos de código y, con `command.list`/`GET /mcp`, conectores).
 * Solo en memoria: al arrancar la app está vacío hasta que el renderer lo informa (falla cerrado: nada que preguntar).
 */
const MAX_LIVE = 24
/**
 * La lista caduca si el renderer no la renueva (latido cada 30 s): si el aviso falla o la ventana deja de responder, no se queda una lista vieja
 * (carpetas ya cerradas o sin confianza); falla cerrado = vacía.
 */
export const LIVE_TTL_MS = 180_000
let live: string[] = []
let at = 0

/** Sustituye la lista. Ignora lo que no sea una ruta absoluta de texto razonable. */
export function setLiveFolders(dirs: unknown, now: () => number = Date.now): string[] {
  const next: string[] = []
  if (Array.isArray(dirs)) {
    for (const d of dirs) {
      if (typeof d !== 'string' || d.length === 0 || d.length > 4096 || next.includes(d)) continue
      if (!/^(\/|[A-Za-z]:[\\/]|\\\\)/.test(d)) continue
      next.push(d)
      if (next.length >= MAX_LIVE) break
    }
  }
  live = next
  at = now()
  return live
}

export function getLiveFolders(now: () => number = Date.now): string[] {
  return now() - at > LIVE_TTL_MS ? [] : [...live]
}
