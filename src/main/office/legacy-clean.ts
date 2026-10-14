/**
 * Limpieza, en el equipo del cliente, de las carpetas `userData/bin/libreoffice-<versión>` (~800 MB) que dejaron versiones viejas de
 * la app: LibreOffice ya no se usa ni se instala (lo reemplazó ArtCraft). Nombres estrictos (`libreoffice-X.Y[.Z[.W]]`), solo dentro
 * de `binDir`, sin seguir enlaces simbólicos, y nunca lanza hacia fuera (misma disciplina que `craft/craft-clean.ts`).
 */
import { lstatSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { CleanFs } from './craft/craft-clean'

const LIBREOFFICE_DIR_RE = /^libreoffice-\d+(\.\d+){1,3}$/

const realFs: CleanFs = {
  readdirSync: (p) => readdirSync(p),
  lstatSync: (p) => lstatSync(p),
  realpathSync: (p) => realpathSync(p),
  rmSync: (p, o) => rmSync(p, o)
}

/** Devuelve los nombres borrados. No lanza nunca. */
export function cleanLegacyLibreOffice(o: { binDir: string; fs?: CleanFs }): string[] {
  const fs = o.fs ?? realFs
  const removed: string[] = []
  try {
    const realBin = fs.realpathSync(o.binDir)
    for (const name of fs.readdirSync(o.binDir)) {
      if (!LIBREOFFICE_DIR_RE.test(name)) continue
      try {
        const path = join(o.binDir, name)
        const st = fs.lstatSync(path)
        if (st.isSymbolicLink() || !st.isDirectory()) continue
        // La ruta real debe ser exactamente binDir/<nombre> (nada fuera de bin, ni por enlaces en medio).
        if (fs.realpathSync(path) !== join(realBin, name)) continue
        fs.rmSync(path, { recursive: true, force: true })
        removed.push(name)
        console.warn(`[limpieza] borrada la carpeta de LibreOffice abandonado: ${name}`)
      } catch (err) {
        console.warn(`[limpieza] no se pudo borrar ${name}:`, err instanceof Error ? err.message : err)
      }
    }
  } catch {
    // Sin carpeta bin (instalación nueva) o ilegible: nada que limpiar.
  }
  return removed
}
