import { lstatSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Escritura atómica: tmp en la misma carpeta y `rename`. */
export function writeFileAtomic(file: string, data: string | Buffer): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, data)
  renameSync(tmp, file)
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Renombra la clave `from` → `to` conservando el orden. Si `to` ya existe gana la nueva (la vieja se descarta:
 * su valor queda en la copia de seguridad). Devuelve true si cambió algo.
 */
export function renameKey(obj: Record<string, unknown>, from: string, to: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(obj, from)) return false
  if (Object.prototype.hasOwnProperty.call(obj, to)) {
    delete obj[from]
    return true
  }
  const entries = Object.entries(obj)
  for (const k of Object.keys(obj)) delete obj[k]
  for (const [k, v] of entries) obj[k === from ? to : k] = v
  return true
}

/** Existe la entrada (sin seguir symlinks: un enlace roto cuenta como existente). */
export function exists(p: string): boolean {
  try {
    lstatSync(p)
    return true
  } catch {
    return false
  }
}
