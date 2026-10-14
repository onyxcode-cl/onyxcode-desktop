/**
 * Limpieza de lo que dejan las instalaciones de Craft en `userData/bin`: las carpetas `craft-<X.Y.Z>` de versiones
 * anteriores y las carpetas temporales `.craft-tmp-*` abandonadas (más de 24 h). Se llama SOLO tras una instalación completa y
 * verificada. Nunca falla hacia fuera: cualquier problema se registra y se sigue. Solo borra dentro de `binDir`, solo nombres que
 * cumplan los patrones, y nunca sigue enlaces simbólicos.
 */
import { lstatSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const VERSION_DIR_RE = /^craft-\d+\.\d+\.\d+$/
const TMP_DIR_RE = /^\.craft-tmp-/
export const STALE_TMP_MS = 24 * 60 * 60 * 1000

export interface CleanFs {
  readdirSync(path: string): string[]
  lstatSync(path: string): { isDirectory(): boolean; isSymbolicLink(): boolean; mtimeMs: number }
  realpathSync(path: string): string
  rmSync(path: string, opts: { recursive: boolean; force: boolean }): void
}

const realFs: CleanFs = {
  readdirSync: (p) => readdirSync(p),
  lstatSync: (p) => lstatSync(p),
  realpathSync: (p) => realpathSync(p),
  rmSync: (p, o) => rmSync(p, o)
}

export interface CleanStaleCraftOptions {
  /** `userData/bin`. */
  binDir: string
  /** Carpeta de la versión actual del pin (`<binDir>/craft-<versión>`): no se toca. */
  currentDir: string
  now: number
  fs?: CleanFs
}

/** Devuelve los nombres borrados. No lanza nunca. */
export function cleanStaleCraft(o: CleanStaleCraftOptions): string[] {
  const fs = o.fs ?? realFs
  const removed: string[] = []
  try {
    const realBin = fs.realpathSync(o.binDir)
    // La carpeta actual debe estar dentro de binDir; si no, algo no cuadra y no se borra nada.
    if (dirname(o.currentDir) !== o.binDir && dirname(o.currentDir) !== realBin) return removed
    const keep = basename(o.currentDir)
    for (const name of fs.readdirSync(o.binDir)) {
      const isVersion = VERSION_DIR_RE.test(name)
      const isTmp = TMP_DIR_RE.test(name)
      if ((!isVersion && !isTmp) || name === keep) continue
      try {
        const path = join(o.binDir, name)
        const st = fs.lstatSync(path)
        if (st.isSymbolicLink() || !st.isDirectory()) continue
        // La ruta real debe ser exactamente binDir/<nombre> (nada fuera de bin, ni por enlaces en medio).
        if (fs.realpathSync(path) !== join(realBin, name)) continue
        if (isTmp && !(o.now - st.mtimeMs > STALE_TMP_MS)) continue
        fs.rmSync(path, { recursive: true, force: true })
        removed.push(name)
      } catch (err) {
        console.warn(`[craft] no se pudo limpiar ${name}:`, err instanceof Error ? err.message : err)
      }
    }
  } catch (err) {
    console.warn('[craft] limpieza de versiones viejas omitida:', err instanceof Error ? err.message : err)
  }
  return removed
}
