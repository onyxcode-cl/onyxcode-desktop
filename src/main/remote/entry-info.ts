/**
 * Lista de archivos de arranque de la interfaz completa de ESTA versión del Mac, con su hash SRI (sha384). Sale de
 * `pwa/dist/app/entry.json` (el que genera la compilación) y se calcula UNA vez en el Mac: es lo que manda por el canal (`entry`)
 * a un celular v4 del modo nube. Sin `app/` o con un `entry.json` raro devuelve `null` (no se anuncia la capacidad).
 *
 * Solo coherencia de versión y detección de corrupción: no es una defensa contra un sitio malicioso (ver docs/SEGURIDAD.md).
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ENTRY_PATH_RE, MAX_ENTRY_FILES, type EntryFile } from '@shared/remote/protocol'

export interface EntryInfo {
  /** Versión de la app del Mac. */
  v: string
  js: string
  files: EntryFile[]
}

const MAX_FILE_BYTES = 8 * 1024 * 1024

export function sriOf(bytes: Uint8Array): string {
  return `sha384-${createHash('sha384').update(bytes).digest('base64')}`
}

/** `appDir` = carpeta `app/` de la PWA compilada. `read` es inyectable para las pruebas. */
export function loadEntryInfo(
  appDir: string,
  version: string,
  read: (file: string) => Uint8Array = (f) => readFileSync(f)
): EntryInfo | null {
  try {
    const e = JSON.parse(Buffer.from(read(join(appDir, 'entry.json'))).toString('utf8')) as {
      js?: unknown
      css?: unknown
      preload?: unknown
      bootCss?: unknown
    }
    if (typeof e.js !== 'string' || !ENTRY_PATH_RE.test(e.js) || !e.js.endsWith('.js')) return null
    const names = new Set<string>([e.js])
    for (const list of [e.css, e.preload, e.bootCss]) {
      if (list === undefined) continue
      if (!Array.isArray(list)) return null
      for (const n of list) {
        if (typeof n !== 'string' || !ENTRY_PATH_RE.test(n)) return null
        names.add(n)
      }
    }
    if (names.size > MAX_ENTRY_FILES || !/^[A-Za-z0-9.+-]{1,32}$/.test(version)) return null
    const files: EntryFile[] = []
    for (const p of names) {
      const bytes = read(join(appDir, p))
      if (bytes.length === 0 || bytes.length > MAX_FILE_BYTES) return null
      files.push({ p, sri: sriOf(bytes) })
    }
    return { v: version, js: e.js, files }
  } catch {
    return null
  }
}
