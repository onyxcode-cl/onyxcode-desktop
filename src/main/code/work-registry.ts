/**
 * Carpetas donde un servicio de `main` (Rutinas, Telegram, celular, Comparar) mandó trabajo al motor hace poco. El comprobador de «motor ocioso»
 * (`engine-flags-restart.ts`) NO puede preguntar el estado de una carpeta que no está abierta con confianza (preguntar la carga en el motor),
 * así que usa esto como evidencia de «posiblemente en curso» y aplaza el reinicio. Es evidencia, no certeza: solo ve lo que estos servicios
 * mandaron, y caduca (un turno más largo que `WORK_TTL_MS` sin que nadie vuelva a mandar nada deja de verse). Solo en memoria.
 */
export const WORK_TTL_MS = 15 * 60_000
const last = new Map<string, number>()
const key = (d: string): string => d.replace(/\\/g, '/').replace(/\/+$/, '')

/** Anota que se mandó trabajo a esa carpeta ahora. Nunca lanza. */
export function noteWork(directory: string | undefined, now: () => number = Date.now): void {
  if (typeof directory !== 'string' || !directory) return
  last.set(key(directory), now())
  if (last.size > 200) for (const [k, t] of last) if (now() - t > WORK_TTL_MS) last.delete(k)
}

/** Carpetas (claves normalizadas) con trabajo mandado en los últimos `WORK_TTL_MS`. */
export function recentWorkKeys(now: () => number = Date.now): Set<string> {
  const out = new Set<string>()
  for (const [k, t] of last) if (now() - t < WORK_TTL_MS) out.add(k)
  return out
}

export const workKey = key
export function clearWorkForTests(): void {
  last.clear()
}
