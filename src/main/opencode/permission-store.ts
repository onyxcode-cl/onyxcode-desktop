/**
 * Carpeta de los permisos «siempre» que recuerda el motor (ver `@shared/permission-persist`): `userData/permisos-siempre`, modo 0700.
 * Guarda un archivo JSON por carpeta de proyecto (`{directory, rules}`). «Olvidar los permisos guardados» vacía su contenido (y el de los
 * directorios privados de los servidores aislados de Tareas, que no pueden escribir en la carpeta general), sin tocar nada más.
 */
import { app } from 'electron'
import { chmodSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { PERMISSION_DIR_NAME } from '@shared/permission-persist'
import { chmodDirNoFollow, ensureRealDir, isRealDir, readFileNoFollow, writeFileNoFollow } from '../tasks/no-follow'

/**
 * Herramientas propias del motor (copia de `PROPIAS` en `permission/siempre-disco.ts` del motor). Para ellas un «siempre» cuyo patrón es
 * solo comodines sería permiso total y permanente.
 */
const ENGINE_OWN_TOOLS = new Set([
  'bash',
  'shell',
  'shell_wait',
  'execute',
  'execute_wait',
  'edit',
  'write',
  'multiedit',
  'patch',
  'apply_patch',
  'task',
  'webfetch',
  'websearch',
  'skill',
  'question',
  'read',
  'glob',
  'grep',
  'list',
  'todowrite',
  'todoread',
  'lsp'
])

/** Herramienta de un conector («servidor_herramienta»): su «siempre» se guarda con el patrón `*` exacto (el motor no le da otro). */
const isConnectorTool = (permission: string): boolean =>
  !ENGINE_OWN_TOOLS.has(permission) && /^[A-Za-z0-9-]+_[A-Za-z0-9_.-]+$/.test(permission)

/** ¿El patrón queda vacío al quitarle los comodines (`*`, `?`) y los espacios? (`*`, `**`, `?*`, `* *`… equivalen a «todo»). */
export function isWildcardOnly(pattern: string): boolean {
  return pattern.replace(/[*?\s]/g, '') === ''
}

/**
 * ¿Se puede recordar (o cargar) esta regla «permitir siempre»? Defensa de la app sobre lo que guarda el motor: un programa de la tarea puede
 * escribir el JSON de `permisos-siempre` (vive en su carpeta privada) y el motor lo carga al arrancar.
 * - El nombre del permiso no puede llevar comodines (el motor también compara el NOMBRE con comodines: `*` aprobaría cualquier herramienta).
 * - Un patrón que solo tiene comodines y espacios no vale; la única excepción es el `*` exacto de la herramienta de un conector.
 */
export function isPersistableRule(rule: unknown): boolean {
  if (!rule || typeof rule !== 'object') return false
  const { permission, pattern } = rule as { permission?: unknown; pattern?: unknown }
  if (typeof permission !== 'string' || typeof pattern !== 'string') return false
  if (!permission || permission.length > 200 || /[*?\s]/.test(permission)) return false
  if (!pattern || pattern.length > 500 || /[\r\n\0]/.test(pattern)) return false
  if (isWildcardOnly(pattern)) return pattern === '*' && isConnectorTool(permission)
  return true
}

/** Tope de lo que se lee de un archivo de reglas (el motor guarda como mucho 500 reglas cortas). */
const MAX_RULES_FILE = 1024 * 1024

type RulesFile = { directory?: unknown; rules?: unknown }
function parseRulesFile(content: Buffer | undefined): RulesFile | null {
  if (!content) return null
  try {
    const v: unknown = JSON.parse(content.toString('utf8'))
    return v && typeof v === 'object' ? (v as RulesFile) : null
  } catch {
    return null
  }
}

/**
 * Limpia una carpeta de guardado antes de que el motor la lea (el motor lee con `readFileSync`, que SÍ sigue enlaces):
 * - borra (sin seguirla) toda entrada que no sea un archivo regular: enlaces, carpetas, tuberías…;
 * - borra los `.json` que no se pueden leer o no son un archivo de reglas;
 * - en los demás quita las reglas que no son `isPersistableRule`.
 * Devuelve cuántas entradas o reglas quitó. Mejor esfuerzo: nunca lanza.
 */
export function sanitizeSavedPermissions(dir: string): number {
  let removed = 0
  let names: string[] = []
  try {
    if (!isRealDir(dir)) return 0
    names = readdirSync(dir)
  } catch {
    return 0
  }
  const drop = (p: string): void => {
    try {
      const st = lstatSync(p)
      rmSync(p, { recursive: st.isDirectory() && !st.isSymbolicLink(), force: true })
      removed++
    } catch (err) {
      console.error('[permisos] no se pudo borrar una entrada de permisos guardados:', err instanceof Error ? err.message : 'error')
    }
  }
  for (const name of names) {
    const file = join(dir, name)
    try {
      const st = lstatSync(file)
      if (!st.isFile() || st.nlink > 1) {
        drop(file)
        continue
      }
      if (!name.endsWith('.json')) continue
      const read = readFileNoFollow(file, MAX_RULES_FILE)
      const json = parseRulesFile(read?.content)
      if (!json || typeof json !== 'object' || !Array.isArray(json.rules)) {
        drop(file)
        continue
      }
      const kept = json.rules.filter(isPersistableRule)
      if (kept.length === json.rules.length) continue
      const tmp = `${file}.${process.pid}.limpio.tmp`
      writeFileNoFollow(tmp, JSON.stringify({ ...json, rules: kept }, null, 2), { mode: 0o600, replace: true })
      renameSync(tmp, file)
      removed += json.rules.length - kept.length
    } catch (err) {
      console.error('[permisos] no se pudo revisar un archivo de permisos guardados:', err instanceof Error ? err.message : 'error')
    }
  }
  if (removed) console.warn(`[permisos] se quitaron ${removed} reglas o entradas no válidas de los permisos guardados`)
  return removed
}

/**
 * Reglas válidas (`isPersistableRule`) de los archivos de una carpeta de guardado del motor cuyo `directory` es `folder`. Sin seguir
 * enlaces ni carpetas que sean enlaces; lo que no se entiende se ignora.
 */
export function readEngineAlwaysRules(dir: string, folder: string): Array<{ permission: string; pattern: string }> {
  const out: Array<{ permission: string; pattern: string }> = []
  let names: string[] = []
  try {
    if (!isRealDir(dir)) return out
    names = readdirSync(dir).filter((n) => n.endsWith('.json'))
  } catch {
    return out
  }
  for (const name of names) {
    try {
      const read = readFileNoFollow(join(dir, name), MAX_RULES_FILE)
      if (!read) continue
      const json = JSON.parse(read.content.toString('utf8')) as { directory?: unknown; rules?: unknown }
      if (!json || json.directory !== folder || !Array.isArray(json.rules)) continue
      for (const r of json.rules.slice(0, 500)) {
        if (!isPersistableRule(r)) continue
        const { permission, pattern } = r as { permission: string; pattern: string }
        if (!out.some((x) => x.permission === permission && x.pattern === pattern)) out.push({ permission, pattern })
      }
    } catch {
      /* archivo roto: se ignora */
    }
  }
  return out
}

/** Vacía una carpeta de guardado (sin seguir enlaces). Si la carpeta misma es un enlace, no se toca. */
export function emptySavedPermissionDir(dir: string): number {
  return isRealDir(dir) ? emptyDir(dir) : 0
}

/** Carpeta de guardado general (sidecar principal y servidores de Tareas sin aislamiento). */
export function permissionDir(userData: string = app.getPath('userData')): string {
  return join(userData, PERMISSION_DIR_NAME)
}

/** Carpeta de guardado de un servidor de Tareas aislado: dentro de su directorio privado, el único sitio donde el sandbox puede escribir. */
export const sandboxPermissionDir = (privateDir: string): string => join(privateDir, PERMISSION_DIR_NAME)

/** Crea la carpeta con modo 0700 (y lo reafirma si ya existía). Mejor esfuerzo: nunca lanza. */
export function ensurePermissionDir(dir: string = permissionDir()): void {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    chmodSync(dir, 0o700)
  } catch (err) {
    console.error('[permisos] no se pudo preparar la carpeta de permisos guardados:', err)
  }
  sanitizeSavedPermissions(dir)
}

/**
 * Lo mismo para la carpeta de un servidor de Tareas aislado, que vive dentro de su carpeta privada (que la tarea controla) (1.8.18): sin
 * seguir enlaces. Si `permisos-siempre` es un enlace (o un archivo), se borra ESE nombre y se crea una carpeta real; el modo se fija con
 * `fchmod`. Mejor esfuerzo: nunca lanza.
 */
export function ensureSandboxPermissionDir(privateDir: string): void {
  try {
    chmodDirNoFollow(ensureRealDir(privateDir, sandboxPermissionDir(privateDir), { create: true, replace: true, mode: 0o700 }), 0o700)
  } catch (err) {
    console.error('[permisos] no se pudo preparar la carpeta de permisos guardados de la tarea:', err)
  }
  // La tarea pudo escribir aquí (por ejemplo `{bash, "?*"}`): se limpia antes de que su motor arranque y lo cargue.
  sanitizeSavedPermissions(sandboxPermissionDir(privateDir))
}

/** Vacía una carpeta de guardado (no la borra). Devuelve cuántos elementos quitó. Los enlaces se borran sin seguirlos. */
function emptyDir(dir: string): number {
  let removed = 0
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return 0
  }
  for (const name of names) {
    const p = join(dir, name)
    try {
      const st = lstatSync(p)
      rmSync(p, { recursive: st.isDirectory() && !st.isSymbolicLink(), force: true })
      removed++
    } catch (err) {
      console.error('[permisos] no se pudo borrar un permiso guardado:', err)
    }
  }
  return removed
}

/** Borra TODO lo que el motor recordó. Devuelve cuántos archivos o carpetas quitó. */
export function forgetSavedPermissions(userData: string = app.getPath('userData')): number {
  let removed = emptyDir(permissionDir(userData))
  const sandboxes = join(userData, 'tasks-sandbox')
  let keys: string[] = []
  try {
    keys = readdirSync(sandboxes)
  } catch {
    // sin servidores aislados todavía
  }
  for (const k of keys) {
    // Carpeta privada y `permisos-siempre` controladas por la tarea: si alguna es un enlace, NO se sigue (vaciaría su destino).
    const priv = join(sandboxes, k)
    if (!isRealDir(priv) || !isRealDir(sandboxPermissionDir(priv))) continue
    removed += emptyDir(sandboxPermissionDir(priv))
  }
  return removed
}
