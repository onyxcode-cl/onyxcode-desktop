/**
 * Migración diferida de la carpeta de trabajo que el modo Tareas dejaba dentro de cada carpeta del usuario:
 * `<carpeta>/.cowork/` → `<carpeta>/.onyxcode/trabajo/`. Se llama desde main (Seatbelt no permite renombrar fuera del
 * scratch) justo antes de lanzar el servidor de la carpeta. Nunca toca `.onyxcode/memoria.md` ni sigue symlinks.
 */
import { lstatSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
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

export function migrateFolderScratch(folder: string, log: (msg: string, err?: unknown) => void = () => undefined): FolderScratchResult {
  const oldDir = join(folder, LEGACY_FOLDER_SCRATCH)
  const parent = join(folder, NEW_FOLDER_SCRATCH[0])
  const newDir = join(folder, ...NEW_FOLDER_SCRATCH)
  const result: FolderScratchResult = { status: 'none', moved: [], left: [] }
  try {
    if (!exists(oldDir)) return result
    if (isSymlink(oldDir) || isSymlink(parent) || isSymlink(newDir) || !lstatSync(oldDir).isDirectory()) {
      log(`${oldDir}: symlink o no es carpeta; no se migra`)
      return { ...result, status: 'skipped', reason: 'symlink o no es carpeta' }
    }
    if (exists(parent) && !lstatSync(parent).isDirectory()) return { ...result, status: 'skipped', reason: 'la ruta nueva no es carpeta' }
    mkdirSync(parent, { recursive: true })
    if (!exists(newDir)) {
      renameSync(oldDir, newDir)
      return { status: 'renamed', moved: [], left: [] }
    }
    for (const name of readdirSync(oldDir)) {
      const from = join(oldDir, name)
      const to = join(newDir, name)
      if (isSymlink(from) || exists(to)) {
        result.left.push(name)
        continue
      }
      try {
        renameSync(from, to)
        result.moved.push(name)
      } catch (err) {
        log(`no se pudo mover ${from}`, err)
        result.left.push(name)
      }
    }
    if (result.left.length) log(`${oldDir}: quedan ${result.left.length} entrada(s) sin mover (colisión o symlink)`)
    return { ...result, status: result.left.length ? 'partial' : 'merged' }
  } catch (err) {
    log(`migrateFolderScratch(${folder}) falló`, err)
    return { ...result, status: 'skipped', reason: err instanceof Error ? err.message : String(err) }
  }
}
