/**
 * Migración diferida de la carpeta de trabajo que el modo Tareas dejaba dentro de cada carpeta del usuario:
 * `<carpeta>/.cowork/` → `<carpeta>/.lazunox/trabajo/`. Se llama desde main (Seatbelt no permite renombrar fuera del
 * scratch) justo antes de lanzar el servidor de la carpeta. Nunca toca `.lazunox/memoria.md` ni sigue symlinks.
 */
import { lstatSync, mkdirSync, readdirSync, renameSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { LEGACY_FOLDER_SCRATCH, NEW_FOLDER_SCRATCH } from './legacy-names'
import { exists } from './json-util'

export interface FolderScratchResult {
  status: 'none' | 'renamed' | 'merged' | 'partial' | 'skipped'
  /** Entradas movidas (nombres de primer nivel). */
  moved: string[]
  /** Entradas que se quedan en la carpeta vieja (colisión, symlink o error). */
  left: string[]
  reason?: string
}

const isSymlink = (p: string): boolean => {
  try {
    return lstatSync(p).isSymbolicLink()
  } catch {
    return false
  }
}

type Mark = { dev: number; ino: number }

const markOf = (p: string): Mark | null => {
  try {
    const st = lstatSync(p)
    return st.isDirectory() && !st.isSymbolicLink() ? { dev: st.dev, ino: st.ino } : null
  } catch {
    return null
  }
}

/** La ruta sigue siendo la MISMA carpeta real (mismo dispositivo e inodo, no un enlace). */
const same = (p: string, m: Mark): boolean => {
  const now = markOf(p)
  return !!now && now.dev === m.dev && now.ino === m.ino
}

/**
 * 1.8.18 (corrección tras la revisión 1): la carpeta la controla la tarea y un proceso suyo que siga vivo podía cambiar `.cowork` por un
 * enlace (por ejemplo a `~/.ssh`) justo entre la comprobación y el `readdir`/`rename`: los archivos del destino del enlace acababan
 * MOVIDOS a la carpeta de la tarea. Ahora `.cowork` y `.lazunox/trabajo` se anotan (dispositivo e inodo) y se comprueban antes y después
 * de listar y de cada movimiento; si algo cambió, no se mueve nada más. `rename` del propio
 * `.cowork` nunca sigue un enlace en el último tramo; si lo que llegó a `.lazunox/trabajo` es un enlace, se quita ESE enlace.
 * Límite: un doble cambio en microsegundos entre dos comprobaciones seguidas no se puede descartar sin `openat` (ver `safe-write.ts`).
 */
export function migrateFolderScratch(
  folder: string,
  log: (msg: string, err?: unknown) => void = () => undefined,
  /** Solo pruebas: se llama después de listar `.cowork` (para simular el cambio por un enlace en ese momento). */
  testHooks?: { afterList?: () => void }
): FolderScratchResult {
  const oldDir = join(folder, LEGACY_FOLDER_SCRATCH)
  const parent = join(folder, NEW_FOLDER_SCRATCH[0])
  const newDir = join(folder, ...NEW_FOLDER_SCRATCH)
  const result: FolderScratchResult = { status: 'none', moved: [], left: [] }
  const changed = (): FolderScratchResult => {
    log(`${oldDir}: la carpeta cambió (¿un enlace?) mientras se migraba; no se mueve nada más`)
    return { ...result, status: 'skipped', reason: 'la carpeta cambió mientras se migraba' }
  }
  try {
    if (!exists(oldDir)) return result
    if (isSymlink(oldDir) || isSymlink(parent) || isSymlink(newDir) || !lstatSync(oldDir).isDirectory()) {
      log(`${oldDir}: symlink o no es carpeta; no se migra`)
      return { ...result, status: 'skipped', reason: 'symlink o no es carpeta' }
    }
    if (exists(parent) && !lstatSync(parent).isDirectory()) return { ...result, status: 'skipped', reason: 'la ruta nueva no es carpeta' }
    const oldMark = markOf(oldDir)
    if (!oldMark) return changed()
    mkdirSync(parent, { recursive: true })
    if (!exists(newDir)) {
      renameSync(oldDir, newDir)
      // `rename` mueve la ENTRADA (no sigue un enlace en el último tramo). Si lo que llegó es un enlace (puesto en `.cowork` entre
      // medias), se quita ese enlace (nunca su destino). No se compara el inodo: en FAT puede cambiar al renombrar.
      if (isSymlink(newDir)) {
        unlinkSync(newDir)
        return changed()
      }
      return { status: 'renamed', moved: [], left: [] }
    }
    const newMark = markOf(newDir)
    if (!newMark) return { ...result, status: 'skipped', reason: 'la ruta nueva no es carpeta' }
    const ok = (): boolean => same(oldDir, oldMark) && same(newDir, newMark)
    if (!ok()) return changed()
    const names = readdirSync(oldDir)
    testHooks?.afterList?.()
    if (!ok()) return changed()
    for (const name of names) {
      const from = join(oldDir, name)
      const to = join(newDir, name)
      if (isSymlink(from) || exists(to)) {
        result.left.push(name)
        continue
      }
      if (!ok()) return changed()
      try {
        renameSync(from, to)
      } catch (err) {
        log(`no se pudo mover ${from}`, err)
        result.left.push(name)
        continue
      }
      result.moved.push(name)
      // Después de mover: si algo cambió, se para (no se devuelve nada: con `.cowork` ya cambiada, «devolver» lo llevaría al destino del
      // enlace).
      if (!ok()) return changed()
    }
    if (result.left.length) log(`${oldDir}: quedan ${result.left.length} entrada(s) sin mover (colisión o symlink)`)
    return { ...result, status: result.left.length ? 'partial' : 'merged' }
  } catch (err) {
    log(`migrateFolderScratch(${folder}) falló`, err)
    return { ...result, status: 'skipped', reason: err instanceof Error ? err.message : String(err) }
  }
}
