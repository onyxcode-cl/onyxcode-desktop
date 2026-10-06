/**
 * Argumentos de `tar.exe` (bsdtar de `%SystemRoot%\System32`) para crear el ZIP de entregables en Windows. PURO: `win32` fijo
 * para poder probarlo en macOS. Sin shell: van como lista a `execFile`. Mismo resultado que `zip -j` de macOS cuando los
 * nombres no se repiten (solo el nombre, sin rutas); con nombres repetidos conserva la ruta relativa al ancestro común.
 */
import { win32 } from 'node:path'

/** Un nombre que empieza por `-` se antepone `.\\`: bsdtar admite opciones entre los operandos y lo tomaría por una. */
const member = (name: string): string => (name.startsWith('-') ? `.\\${name}` : name)

export function winTarZipArgs(out: string, files: string[]): { args: string[]; cwd?: string } {
  const names = files.map((f) => win32.basename(f))
  if (new Set(names.map((n) => n.toLowerCase())).size === names.length) {
    // `-C <carpeta> <nombre>` por archivo: bsdtar guarda el nombre sin la ruta.
    return { args: ['-a', '-c', '-f', out, ...files.flatMap((f) => ['-C', win32.dirname(f), member(win32.basename(f))])] }
  }
  const parts = files.map((f) => win32.dirname(f).split('\\'))
  let common = parts[0]!
  for (const p of parts.slice(1)) {
    let i = 0
    while (i < common.length && i < p.length && common[i]!.toLowerCase() === p[i]!.toLowerCase()) i++
    common = common.slice(0, i)
  }
  const base = common.join('\\') || 'C:\\'
  return { args: ['-a', '-c', '-f', out, '-C', base, ...files.map((f) => member(win32.relative(base, f)))] }
}
