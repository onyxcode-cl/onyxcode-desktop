/**
 * Comprobación de la carpeta privada de una tarea (`userData/tasks-sandbox/<clave>`) ANTES de armar el perfil y de sembrar nada (1.8.18).
 *
 * Una tarea podía vaciar su carpeta privada, borrarla y dejar en su lugar un enlace simbólico (por ejemplo a la carpeta personal). En
 * el siguiente arranque el perfil resolvía la ruta real y concedía lectura y escritura sobre el DESTINO del enlace, por encima de las
 * negaciones de secretos. Ahora:
 *  - el perfil niega borrar o renombrar la propia carpeta privada y sus subcarpetas fijas (`sandbox-profile.ts`);
 *  - y aquí, en el proceso principal, cada tramo bajo `userData` tiene que ser una carpeta REAL (no un enlace) y la ruta real de la
 *    carpeta privada tiene que ser exactamente la esperada. Si la carpeta privada o una subcarpeta fija es un enlace (o un archivo), se
 *    borra ESE enlace (nunca su destino) y se crea una carpeta nueva y vacía: la tarea arranca con una carpeta real, jamás con el
 *    destino del enlace. Si el problema está más arriba (`tasks-sandbox` es un enlace, o la ruta no cuelga de `userData`), no se arranca:
 *    error claro.
 */
import { t } from '@shared/i18n'
import { mkdirSync } from 'node:fs'
import { join, sep } from 'node:path'
import { ensureRealDir, isWriteDenied, LinkRefusedError } from './no-follow'
import { PRIVATE_SUBDIRS, sandboxDirs, TASK_APP_DIRS, type SandboxDirs } from './sandbox-profile'

export interface PrivateDirIsolation {
  privateDir: string
  userData: string
}

/**
 * Asegura la carpeta privada y sus subcarpetas fijas como carpetas reales bajo `userData`. Lanza un `Error` con texto para la persona
 * si no se puede garantizar. Devuelve las rutas (las de siempre: `sandboxDirs(privateDir)`).
 */
export function ensureTaskPrivateDir(
  iso: PrivateDirIsolation,
  log: (msg: string) => void = (m) => console.warn('[tasks]', m)
): SandboxDirs {
  try {
    mkdirSync(iso.userData, { recursive: true }) // userData es de la app (no es escribible desde dentro del encierro)
    const tasksRoot = join(iso.userData, 'tasks-sandbox')
    // `tasks-sandbox` NO se reemplaza: desde dentro no se puede tocar; si es un enlace, algo raro pasa y no se arranca.
    ensureRealDir(iso.userData, tasksRoot, { create: true })
    const onReplaced = (p: string): void =>
      log(`la carpeta privada tenía un enlace o un archivo en ${p}; se quitó el enlace y se creó una carpeta nueva`)
    ensureRealDir(tasksRoot, iso.privateDir, { create: true, replace: true, onReplaced })
    for (const sub of PRIVATE_SUBDIRS) ensureRealDir(iso.privateDir, join(iso.privateDir, sub), { create: true, replace: true, onReplaced })
  } catch (e) {
    if (e instanceof LinkRefusedError) throw new Error(t('merr.task.privateDirUnsafe'))
    throw e
  }
  return sandboxDirs(iso.privateDir)
}

/**
 * Corrección tras la revisión 1 (1.8.18): crea como carpetas REALES las carpetas de la app dentro de la carpeta de la tarea
 * (`.lazunox`, `.lazunox/trabajo`, `descargas`, `grabaciones`; ver `TASK_APP_DIRS`) ANTES de lanzar, para que la regla del perfil que
 * niega borrarlas o renombrarlas se aplique a una carpeta y no a un hueco que la tarea podría ocupar con un enlace. Es la carpeta de la
 * persona: si alguna ya es un enlace o un archivo, no se toca nada y no se arranca (error claro, como en el resto de la carpeta).
 */
export function ensureTaskAppDirs(folder: string): void {
  // Corrección tras la revisión 2: en una carpeta SIN permiso de escritura (compartida de solo lectura, imagen montada…) no se puede
  // crear `.lazunox`, y en 1.8.17 la tarea arrancaba igual. Si el sistema lo niega (EACCES/EPERM/EROFS) no se crea esa carpeta ni las
  // que cuelgan de ella y se sigue: es seguro, la tarea corre con el mismo usuario y con más restricciones, así que tampoco puede crear
  // nada ahí. Lo que necesite escribir (memoria, descargas, grabaciones) falla después con un mensaje claro. Un enlace, un archivo u
  // otro error siguen impidiendo el arranque.
  const skipped: string[] = []
  for (const d of TASK_APP_DIRS) {
    if (skipped.some((s) => d === s || d.startsWith(s + sep))) continue
    try {
      ensureRealDir(folder, join(folder, d), { create: true })
    } catch (e) {
      if (e instanceof LinkRefusedError) throw new Error(t('merr.task.appDirUnsafe', { path: d }))
      if (isWriteDenied(e)) {
        skipped.push(d)
        continue
      }
      throw e
    }
  }
}
