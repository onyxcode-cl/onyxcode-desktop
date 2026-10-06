/**
 * Renombrado atómico que en Windows reintenta unos instantes. Allí `rename` sobre un archivo que otro proceso tiene abierto (antivirus,
 * indexador, copia de seguridad) falla con `EPERM`/`EBUSY`/`EACCES` durante milisegundos; en macOS/Linux eso no ocurre y se llama a
 * `rename` una sola vez, exactamente como antes. Nunca silencia el error: tras los intentos, lanza el último.
 */
import { renameSync } from 'node:fs'

const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES'])

export interface RenameRetryOptions {
  platform?: string
  rename?: (from: string, to: string) => void
  /** Espera síncrona en ms (inyectable en pruebas). */
  sleep?: (ms: number) => void
  attempts?: number
  delayMs?: number
}

function realSleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

export function renameReplaceSync(from: string, to: string, o: RenameRetryOptions = {}): void {
  const rename = o.rename ?? renameSync
  const win = (o.platform ?? process.platform) === 'win32'
  const attempts = win ? Math.max(1, o.attempts ?? 5) : 1
  const sleep = o.sleep ?? realSleep
  for (let i = 1; ; i++) {
    try {
      rename(from, to)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (i >= attempts || !code || !TRANSIENT.has(code)) throw err
      sleep((o.delayMs ?? 25) * i)
    }
  }
}
