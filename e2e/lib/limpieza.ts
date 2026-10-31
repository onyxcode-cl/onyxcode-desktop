import { rmSync } from 'node:fs'

/**
 * Borra una carpeta temporal de una prueba. En Windows la app (vigilante de archivos, git) puede seguir con la carpeta abierta
 * cuando termina la prueba y `rmdir` da EBUSY/EPERM aunque se reintente: eso es solo basura en el directorio temporal del
 * sistema, no un fallo de lo que la prueba comprueba, así que ahí se tolera. En macOS/Linux cualquier error sigue fallando.
 */
export function rmTemp(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (process.platform === 'win32' && (code === 'EBUSY' || code === 'EPERM' || code === 'ENOTEMPTY')) return
    throw e
  }
}
