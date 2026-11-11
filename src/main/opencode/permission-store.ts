/**
 * Carpeta de los permisos «siempre» que recuerda el motor (ver `@shared/permission-persist`): `userData/permisos-siempre`, modo 0700.
 * Guarda un archivo JSON por carpeta de proyecto (`{directory, rules}`). «Olvidar los permisos guardados» vacía su contenido (y el de los
 * directorios privados de los servidores aislados de Tareas, que no pueden escribir en la carpeta general), sin tocar nada más.
 */
import { app } from 'electron'
import { chmodSync, lstatSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { PERMISSION_DIR_NAME } from '@shared/permission-persist'
import { chmodDirNoFollow, ensureRealDir, isRealDir } from '../tasks/no-follow'

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
