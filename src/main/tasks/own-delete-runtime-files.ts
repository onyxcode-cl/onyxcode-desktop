/** Ayudantes de shell en la config de solo lectura para el sandbox. No contiene credenciales. */
import { chmodSync, copyFileSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureRealDir } from './no-follow'

/** El intérprete y el guion son rutas fijadas por main; ninguna proviene del shell de la tarea. */
export function prepareOwnDeleteBin(configDir: string, python: string, source: string): string {
  const bin = join(configDir, 'own-delete-bin')
  mkdirSync(bin, { recursive: true, mode: 0o700 })
  ensureRealDir(configDir, bin)
  const safeFile = (path: string): void => {
    try {
      const st = lstatSync(path)
      if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1) throw new Error('unsafe helper')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }
  const script = join(bin, 'lzx_rm.py')
  safeFile(script)
  copyFileSync(source, script)
  chmodSync(script, 0o600)
  const quote = (s: string): string => "'" + s.replace(/'/g, "'\\''") + "'"
  for (const verb of ['rm', 'rmdir', 'unlink']) {
    const path = join(bin, verb)
    safeFile(path)
    writeFileSync(path, `#!/bin/sh\nexec ${quote(python)} -I ${quote(script)} --lazunox-verb ${verb} "$@"\n`, { mode: 0o700 })
    chmodSync(path, 0o700)
  }
  return bin
}
