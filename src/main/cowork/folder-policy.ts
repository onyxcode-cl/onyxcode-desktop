/**
 * Política de carpetas de Cowork: qué carpetas NO se pueden autorizar ni vincular, con un
 * motivo accionable en español para cada caso.
 *
 * Módulo PURO (solo `node:path` y `sandbox-profile`, sin Electron ni acceso a disco) para poder
 * probarlo con esbuild + node fuera de la app. El llamador (`manager.ts`) normaliza la ruta con
 * `realpath` y le pasa `home`, `userData` y la tabla de montajes (`/sbin/mount`).
 *
 * Las comparaciones no distinguen mayúsculas (APFS/HFS+ lo son por defecto): puede rechazar de
 * más en un volumen sensible a mayúsculas, nunca de menos.
 */
import { resolve, sep } from 'node:path'
import { APP_NAME } from '@shared/brand'
import { defaultDeniedReadPaths } from './sandbox-profile'

/** Una línea de la salida de `/sbin/mount`. */
export interface MountInfo {
  device: string
  mountPoint: string
  fsType: string
}

export interface FolderPolicyContext {
  home: string
  /** userData de la app (estado interno: tokens MCP, otros sandboxes…). */
  userData: string
  mounts: MountInfo[]
  /** Política gestionada: si existe, la carpeta debe estar dentro de alguna de estas raíces. */
  allowedRoots?: string[]
}

/** Sistemas de archivos de red (o virtuales de red): no fiables para el sandbox ni para sincronizar. */
export const NETWORK_FS_TYPES = ['smbfs', 'afpfs', 'nfs', 'webdav', 'cifs', 'ftp', 'macfuse', 'osxfuse']

/** Carpetas del sistema que nunca se autorizan (`/private/*` cubre /private/tmp, /private/var y /private/etc). */
export const SYSTEM_FOLDERS = [
  '/System',
  '/Library',
  '/Applications',
  '/usr',
  '/bin',
  '/sbin',
  '/etc',
  '/opt',
  '/private',
  '/tmp',
  '/var',
  '/dev',
  '/cores',
  '/Network'
]

/**
 * Lee la salida de `/sbin/mount`: `<dispositivo> on <punto de montaje> (<tipo>, <opciones>…)`.
 * El punto de montaje puede llevar espacios; el tipo es el primer elemento entre paréntesis.
 */
export function parseMountOutput(text: string): MountInfo[] {
  const out: MountInfo[] = []
  for (const line of text.split('\n')) {
    const m = /^(.*?) on (.*) \(([^()]*)\)\s*$/.exec(line.trim())
    if (!m) continue
    const fsType = m[3].split(',')[0].trim().toLowerCase()
    if (!m[2] || !fsType) continue
    out.push({ device: m[1], mountPoint: m[2], fsType })
  }
  return out
}

/** Normaliza sin tocar disco: ruta absoluta, sin barra final y en minúsculas (comparación). */
function key(p: string): string {
  let r = resolve(p)
  if (r.length > 1 && r.endsWith(sep)) r = r.slice(0, -1)
  return r.toLowerCase()
}

function isInside(f: string, dir: string): boolean {
  return f === dir || f.startsWith(dir === '/' ? '/' : dir + sep)
}

/** Ruta con `~` en lugar del home, para los mensajes. */
function tilde(p: string, home: string): string {
  const h = resolve(home)
  return p === h ? '~' : p.startsWith(h + sep) ? `~${p.slice(h.length)}` : p
}

/**
 * Motivo por el que `folder` (ya normalizada) no puede usarse como carpeta de Cowork, o `null`
 * si es válida. Los mensajes dicen qué hacer en su lugar.
 */
export function forbiddenFolderReason(folder: string, ctx: FolderPolicyContext): string | null {
  const shown = resolve(folder)
  const f = key(folder)
  const home = key(ctx.home)

  // Raíz o carpeta personal completa
  if (f === '/' || f === home) {
    return 'No se puede usar la raíz del disco ni tu carpeta personal completa. Elige una carpeta concreta, por ejemplo una dentro de Documentos.'
  }
  if (home.startsWith(f + sep)) {
    return 'Esa carpeta contiene tu carpeta personal. Elige una más específica, por ejemplo una dentro de Documentos.'
  }

  // Papelera (la de tu usuario y la de cada volumen)
  const segments = f.split(sep)
  if (segments.includes('.trash') || segments.includes('.trashes')) {
    return 'La Papelera no se puede usar como carpeta de trabajo. Restaura primero los archivos que necesites y elige esa carpeta.'
  }

  // Estado interno de la app
  const userData = key(ctx.userData)
  if (isInside(f, userData)) {
    return `Esa carpeta guarda el estado interno de ${APP_NAME} (tareas, credenciales y ajustes). Elige otra carpeta.`
  }

  // ~/Library: iCloud Drive con su propio mensaje
  const icloud = key(`${ctx.home}/Library/Mobile Documents`)
  if (isInside(f, icloud)) {
    return 'iCloud Drive está en una ubicación protegida de macOS (~/Library/Mobile Documents) y Cowork no puede trabajar ahí. Copia los archivos a una carpeta local, por ejemplo dentro de Documentos, y elige esa carpeta.'
  }
  if (isInside(f, key(`${ctx.home}/Library`))) {
    return 'Esa es una ubicación protegida de macOS (Library), donde las apps guardan sus datos, y Cowork no puede usarla. Prueba con una carpeta dentro de Documentos.'
  }

  // Carpetas del sistema
  const system = SYSTEM_FOLDERS.find((s) => isInside(f, s.toLowerCase()))
  if (system) {
    return `«${system}» es una carpeta del sistema y no se puede usar. Elige una carpeta dentro de tu carpeta personal.`
  }

  // Volúmenes: la carpeta /Volumes en sí, y volúmenes de red
  if (f === '/volumes') {
    return 'Elige una carpeta dentro del volumen, no la lista de volúmenes.'
  }
  let mount: MountInfo | null = null
  for (const m of ctx.mounts) {
    const mp = key(m.mountPoint)
    if (mp === '/' || !isInside(f, mp)) continue
    if (!mount || mp.length > key(mount.mountPoint).length) mount = m
  }
  if (mount && NETWORK_FS_TYPES.includes(mount.fsType)) {
    return `Esa carpeta está en un volumen de red (${mount.fsType}, ${mount.mountPoint}). Cowork no puede trabajar de forma segura sobre volúmenes de red: copia los archivos a una carpeta local y elige esa carpeta.`
  }

  // Credenciales y datos privados
  for (const denied of defaultDeniedReadPaths(ctx.home)) {
    if (isInside(f, key(denied))) {
      return `Esa carpeta guarda credenciales o datos privados (${tilde(resolve(denied), ctx.home)}) y Cowork no puede darle acceso al agente. Elige otra carpeta.`
    }
  }

  // Política gestionada por la organización
  if (ctx.allowedRoots) {
    const roots = ctx.allowedRoots.map(key)
    if (!roots.some((r) => isInside(f, r))) {
      return roots.length
        ? `Tu organización solo permite carpetas dentro de: ${ctx.allowedRoots.join(', ')}. «${tilde(shown, ctx.home)}» queda fuera.`
        : 'Tu organización no permite usar carpetas en Cowork.'
    }
  }
  return null
}
