/**
 * Papelera de los puntos de restauración. En producción: `shell.trashItem` (Papelera de macOS).
 * Solo pruebas: `ONYXCODE_E2E_TRASH_DIR` (honrada ÚNICAMENTE con la app sin empaquetar) mueve el
 * elemento a esa carpeta, para poder comprobar lo que iría a la Papelera sin tocar la real.
 */
import { cpSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'

export interface TrashEnvInput {
  isPackaged: boolean
  env: Record<string, string | undefined>
}

/** Carpeta de Papelera de pruebas, o null (siempre null con la app empaquetada o con ruta no absoluta). */
export function resolveE2eTrashDir(i: TrashEnvInput): string | null {
  const dir = !i.isPackaged ? i.env.ONYXCODE_E2E_TRASH_DIR : undefined
  return dir && isAbsolute(dir) ? dir : null
}

/** Mueve a la carpeta de pruebas con un prefijo único para no pisar nombres repetidos. */
export function trashToDir(dir: string, now: () => number = Date.now): (path: string) => Promise<void> {
  let n = 0
  return async (path) => {
    mkdirSync(dir, { recursive: true })
    const dest = join(dir, `${now()}-${n++}-${basename(path)}`)
    try {
      renameSync(path, dest)
    } catch (err) {
      // Otro volumen (EXDEV): copiar y quitar el original.
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
      cpSync(path, dest, { recursive: true })
      rmSync(path, { recursive: true, force: true })
    }
  }
}
