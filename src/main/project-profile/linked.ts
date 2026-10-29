/**
 * Carpetas añadidas a un proyecto de Code (Ficha del proyecto). La validación vive en main: la pantalla solo propone una ruta.
 * Una carpeta añadida la IA la usa sin preguntar, así que se rechazan las que serían una puerta a todo el equipo o a secretos:
 * raíces, la carpeta personal entera, carpetas del sistema, el estado interno de la app, claves (SSH, nube…) y carpetas dentro del proyecto.
 */
import { existsSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, resolve, sep } from 'node:path'
import { isSafeLinkedPath } from '@shared/permission-rules'

export const MAX_LINKED_FOLDERS = 10

export type LinkedFolderCheck = { ok: true; path: string } | { ok: false; reason: LinkedRejection }
export type LinkedRejection =
  | 'not-absolute'
  | 'missing'
  | 'not-folder'
  | 'root-or-home'
  | 'system'
  | 'app-state'
  | 'secrets'
  | 'same-as-project'
  | 'inside-project'
  | 'contains-project'
  | 'has-wildcards'

const SECRET_DIRS = ['.ssh', '.aws', '.gnupg', '.kube', '.docker', '.config/gcloud', '.config/gh', '.azure', '.npm', '.cache']
const POSIX_SYSTEM = [
  '/system',
  '/usr',
  '/bin',
  '/sbin',
  '/etc',
  '/var',
  '/private',
  '/library',
  '/applications',
  '/opt',
  '/dev',
  '/proc',
  '/sys',
  '/boot',
  '/lib',
  '/volumes'
]
const WIN_SYSTEM = [
  'c:/windows',
  'c:/program files',
  'c:/program files (x86)',
  'c:/programdata',
  'c:/$recycle.bin',
  'c:/system volume information'
]

const norm = (p: string, win: boolean): string => {
  const t = p.replace(/\\/g, '/').replace(/\/+$/, '')
  return win ? t.toLowerCase() : t
}
const inside = (child: string, parent: string): boolean => child === parent || child.startsWith(parent + '/')

export function checkLinkedFolder(
  raw: string,
  ctx: { project: string; home: string; userData: string; platform?: NodeJS.Platform }
): LinkedFolderCheck {
  const platform = ctx.platform ?? process.platform
  const win = platform === 'win32'
  if (typeof raw !== 'string' || !isAbsolute(raw)) return { ok: false, reason: 'not-absolute' }
  if (/[*?[\]{}\u0000-\u001f]/.test(raw)) return { ok: false, reason: 'has-wildcards' }
  let real: string
  try {
    if (!existsSync(raw)) return { ok: false, reason: 'missing' }
    real = realpathSync(resolve(raw))
    if (!statSync(real).isDirectory()) return { ok: false, reason: 'not-folder' }
  } catch {
    return { ok: false, reason: 'missing' }
  }
  const p = norm(real, win)
  let homeReal = ctx.home
  let userDataReal = ctx.userData
  try {
    homeReal = realpathSync(ctx.home)
  } catch {
    // la carpeta personal siempre existe; si no se puede resolver, se compara tal cual
  }
  try {
    userDataReal = realpathSync(ctx.userData)
  } catch {
    // puede no existir aún
  }
  const home = norm(homeReal, win)
  if (p === '' || p === '/' || /^[a-z]:$/.test(p) || p === home || inside(home, p)) return { ok: false, reason: 'root-or-home' }
  const sys = win ? WIN_SYSTEM : POSIX_SYSTEM
  // Dentro de la carpeta personal nada cuenta como «sistema» (en macOS las temporales viven bajo /private).
  if (!inside(p, home) && sys.some((s) => inside(p, s))) return { ok: false, reason: 'system' }
  if (inside(p, norm(userDataReal, win))) return { ok: false, reason: 'app-state' }
  if (SECRET_DIRS.some((s) => inside(p, `${home}/${s}`))) return { ok: false, reason: 'secrets' }
  if (win && /\/appdata\//.test(p)) return { ok: false, reason: 'app-state' }
  let project = ctx.project
  try {
    project = realpathSync(resolve(ctx.project))
  } catch {
    // el proyecto puede no existir en disco al probar; se compara tal cual
  }
  const proj = norm(project, win)
  if (p === proj) return { ok: false, reason: 'same-as-project' }
  if (inside(p, proj)) return { ok: false, reason: 'inside-project' }
  if (inside(proj, p)) return { ok: false, reason: 'contains-project' }
  // Defensa final: lo que llega a las reglas del motor debe ser una ruta absoluta segura.
  if (!isSafeLinkedPath(real)) return { ok: false, reason: 'not-absolute' }
  return { ok: true, path: real.split(sep).join(sep) }
}
