/**
 * `fs/promises` SIN la magia de Electron para los `.asar`: en el proceso principal, `fs` trata `…/app.asar` como una carpeta virtual
 * (su `lstat` dice «directorio», `readdir` lista el interior y `open` falla con «not found in asar»), así que el recorrido del paquete
 * descargado veía `resources/app.asar` como carpeta y rechazaba TODA actualización. `original-fs` lo trata como el fichero que es. Fuera
 * de Electron (pruebas, scripts) no existe y se usa el `fs` normal.
 */
import { createRequire } from 'node:module'
import * as nodeFsPromises from 'node:fs/promises'

export function rawFsPromises(): typeof nodeFsPromises {
  try {
    const of = createRequire(process.execPath)('original-fs') as { promises?: typeof nodeFsPromises }
    return of.promises ?? nodeFsPromises
  } catch {
    return nodeFsPromises
  }
}
