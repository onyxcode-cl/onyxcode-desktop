/**
 * Política de carpetas de Tareas: qué carpetas NO se pueden autorizar ni vincular, con un
 * motivo accionable en español para cada caso.
 *
 * Módulo PURO (solo `node:path` y `sandbox-profile`, sin Electron ni acceso a disco) para poder
 * probarlo con esbuild + node fuera de la app. El llamador (`manager.ts`) normaliza la ruta con
 * `realpath` y le pasa `home`, `userData` y la tabla de montajes (`/sbin/mount`).
 *
 * Las comparaciones no distinguen mayúsculas (APFS/HFS+ lo son por defecto): puede rechazar de
 * más en un volumen sensible a mayúsculas, nunca de menos.
 */
import { t } from '@shared/i18n'
import { resolve, sep } from 'node:path'
import { APP_NAME } from '@shared/brand'
import { isInside } from '../util/paths'
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

/** Ruta con `~` en lugar del home, para los mensajes. */
function tilde(p: string, home: string): string {
  const h = resolve(home)
  return p === h ? '~' : p.startsWith(h + sep) ? `~${p.slice(h.length)}` : p
}

/**
 * Motivo por el que `folder` (ya normalizada) no puede usarse como carpeta de Tareas, o `null`
 * si es válida. Los mensajes dicen qué hacer en su lugar.
 */
export function forbiddenFolderReason(folder: string, ctx: FolderPolicyContext): string | null {
  const shown = resolve(folder)
  const f = key(folder)
  const home = key(ctx.home)

  // Raíz o carpeta personal completa
  if (f === '/' || f === home) {
    return t('merr.folder.rootOrHome')
  }
  if (home.startsWith(f + sep)) {
    return t('merr.folder.containsHome')
  }

  // Papelera (la de tu usuario y la de cada volumen)
  const segments = f.split(sep)
  if (segments.includes('.trash') || segments.includes('.trashes')) {
    return t('merr.folder.trash')
  }

  // Estado interno de la app
  const userData = key(ctx.userData)
  if (isInside(f, userData)) {
    return t('merr.folder.appState', { app: APP_NAME })
  }

  // ~/Library: iCloud Drive con su propio mensaje
  const icloud = key(`${ctx.home}/Library/Mobile Documents`)
  if (isInside(f, icloud)) {
    return t('merr.folder.icloud')
  }
  if (isInside(f, key(`${ctx.home}/Library`))) {
    return t('merr.folder.library')
  }

  // Carpetas del sistema
  const system = SYSTEM_FOLDERS.find((s) => isInside(f, s.toLowerCase()))
  if (system) {
    return t('merr.folder.system', { system })
  }

  // Volúmenes: la carpeta /Volumes en sí, y volúmenes de red
  if (f === '/volumes') {
    return t('merr.folder.volumes')
  }
  let mount: MountInfo | null = null
  for (const m of ctx.mounts) {
    const mp = key(m.mountPoint)
    if (mp === '/' || !isInside(f, mp)) continue
    if (!mount || mp.length > key(mount.mountPoint).length) mount = m
  }
  if (mount && NETWORK_FS_TYPES.includes(mount.fsType)) {
    return t('merr.folder.network', { fsType: mount.fsType, mountPoint: mount.mountPoint })
  }

  // Credenciales y datos privados
  for (const denied of defaultDeniedReadPaths(ctx.home)) {
    if (isInside(f, key(denied))) {
      return t('merr.folder.secrets', { path: tilde(resolve(denied), ctx.home) })
    }
  }

  // Política gestionada por la organización
  if (ctx.allowedRoots) {
    const roots = ctx.allowedRoots.map(key)
    if (!roots.some((r) => isInside(f, r))) {
      return roots.length
        ? t('merr.folder.orgRoots', { roots: ctx.allowedRoots.join(', '), folder: tilde(shown, ctx.home) })
        : t('merr.folder.orgNone')
    }
  }
  return null
}
