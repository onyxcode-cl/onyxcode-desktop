/**
 * Política de carpetas de Tareas en WINDOWS (zona INTOCABLE: lista cerrada, falla CERRADO).
 *
 * Módulo PURO (sin Electron, sin `fs`, sin PowerShell): todo lo que toca el sistema (unidades, enlaces) entra
 * inyectado en `WinFolderPolicyContext`, así que se prueba en macOS con rutas de Windows. `folder-policy.ts` lo
 * invoca cuando la plataforma es `win32`.
 *
 * Decisiones (siempre la opción MÁS restrictiva cuando el plan era ambiguo):
 *  - La ruta entra por `resolveUiPath` (única puerta): UNC, `\\?\`, `\\.\`, ADS (`:`), `..`, reservados (CON/NUL),
 *    8.3 (`PROGRA~1`), terminadas en punto o espacio, relativas y `C:foo` se rechazan ANTES de mirar la lista.
 *  - Solo discos FIJOS locales: red, extraíbles, ópticos, RAM, desconocidos y alias `subst` se rechazan.
 *    Si no se pudo leer la lista de unidades (`drives === null`) no se aprueba NADA.
 *  - Raíz de unidad; `Windows`, `Program Files*`, `ProgramData`, `$Recycle.Bin`, `System Volume Information`…
 *    en CUALQUIER unidad (no solo en `C:`); `Users` entero salvo el perfil propio; otros usuarios y `Public`.
 *  - Perfil propio: la raíz y sus ancestros; TODO `AppData` (no hay excepción «salvo la carpeta elegida»);
 *    claves y credenciales (`.ssh`, `.gnupg`, `.aws`, …); carpetas heredadas de Windows (`Application Data`,
 *    `Cookies`, `Local Settings`…); la carpeta de datos de Lazunox y las rutas extra del llamador.
 *  - Las listas de zonas vetadas se comparan en AMBOS sentidos: no se puede elegir ni la zona vetada ni una carpeta
 *    que la CONTENGA (una carpeta que contiene `.ssh` es el perfil entero o `.`).
 *  - Mayúsculas: se pliegan con `toUpperCase().toLowerCase()` (más amplio que NTFS: también unifica `ı`, `ſ`, `K`),
 *    así que puede rechazar de más, nunca de menos.
 *  - Enlaces: un enlace simbólico o junction en la ruta (cualquier ancestro) o DENTRO de la carpeta se rechaza
 *    (decisión D3 en su variante estricta); si no se puede comprobar (error de `readdir`, demasiadas entradas o
 *    demasiada profundidad) también se rechaza.
 *  - Las raíces de la política gestionada (`allowedRoots`) solo RESTRINGEN: nunca abren una zona vetada.
 */
import { t } from '@shared/i18n'
import { DISPLAY_NAME } from '@shared/brand'
import { checkNoLinks } from '@shared/wsl-paths'
import { resolveUiPath } from './ui-path'

export type WinDriveKind = 'fixed' | 'removable' | 'network' | 'optical' | 'ram' | 'unknown'

export interface WinDrive {
  /** Letra de unidad (`C`). */
  letter: string
  kind: WinDriveKind
}

/** Entrada de directorio vista con `lstat` (sin seguir enlaces). */
export interface WinDirEntry {
  name: string
  isSymbolicLink: boolean
  isDirectory: boolean
}

export interface WinLinkProbe {
  /** `lstat` sin seguir enlaces; `null` si no existe. Puede lanzar (se trata como enlace: falla cerrado). */
  lstat(p: string): { isSymbolicLink(): boolean } | null
  /** Lista un directorio con `lstat` por entrada. Puede lanzar (falla cerrado). */
  readdir(p: string): WinDirEntry[]
}

export interface WinFolderPolicyContext {
  /** `%USERPROFILE%`. */
  userProfile: string
  /** `%SystemRoot%`. */
  systemRoot: string
  /** `%ProgramData%`. */
  programData: string
  /** `%ProgramFiles%`, `%ProgramFiles(x86)%`, `%ProgramW6432%` (los que existan). */
  programFiles: string[]
  /** userData de Lazunox (estado interno: tokens, credenciales cifradas, otros sandboxes). */
  userData: string
  /** `%APPDATA%` y `%LOCALAPPDATA%`; si faltan se deducen del perfil (`AppData\Roaming` / `AppData\Local`). */
  appData?: string
  localAppData?: string
  /** Más rutas vetadas (carpeta de instalación de Lazunox, distro WSL de Tareas, temporales…). */
  extraDenied?: string[]
  /** Unidades del equipo; `null` = no se pudo leer (no se aprueba nada). */
  drives: WinDrive[] | null
  /** Letras de unidad creadas con `subst` (si se conocen). */
  substDrives?: string[]
  /** Raíces de la política gestionada (ya normalizadas por el llamador). */
  allowedRoots?: string[]
  /** Acceso a disco para comprobar enlaces; ausente = se rechaza (no se puede verificar). */
  links?: WinLinkProbe
}

/** Carpetas de primer nivel de CUALQUIER unidad que nunca se autorizan (comparación sin mayúsculas). */
export const WIN_SYSTEM_TOPLEVEL = [
  'windows',
  'program files',
  'program files (x86)',
  'programdata',
  '$recycle.bin',
  'recycler',
  'system volume information',
  'recovery',
  'boot',
  'config.msi',
  'documents and settings',
  'perflogs',
  'msocache',
  '$windows.~bt',
  '$windows.~ws',
  '$winreagent',
  '$sysreset',
  'windows.old'
]

/** Subrutas del perfil que guardan credenciales o datos privados (relativas al perfil; `/` separa). */
export const WIN_PROFILE_SECRETS = [
  '.ssh',
  '.gnupg',
  '.gpg',
  '.aws',
  '.azure',
  '.kube',
  '.docker',
  '.config/gcloud',
  '.config/gh',
  '.config/hub',
  '.config/opencode',
  '.local/share/opencode',
  '.local/state/opencode',
  '.netrc',
  '_netrc',
  '.git-credentials',
  '.npmrc',
  '.yarnrc',
  '.pypirc',
  '.cargo/credentials',
  '.cargo/credentials.toml',
  '.gem/credentials',
  '.terraform.d',
  '.terraformrc',
  '.claude',
  '.codex',
  '.gemini',
  '.openai',
  '.bash_history',
  '.python_history',
  '.node_repl_history',
  '.psql_history',
  '.lesshst',
  '.wslconfig',
  'ntuser.dat',
  // Carpetas heredadas de Windows (junctions de compatibilidad hacia AppData y similares)
  'application data',
  'local settings',
  'cookies',
  'nethood',
  'printhood',
  'recent',
  'sendto',
  'start menu',
  'templates',
  'microsoftedgebackups'
]

type Kind = 'system' | 'appData' | 'secrets' | 'appState'
interface Deny {
  /** Ruta ya plegada (`c:/users/ben`). */
  key: string
  /** Ruta canónica para mostrar. */
  shown: string
  kind: Kind
}

const WIN_TOPLEVEL_SET = new Set(WIN_SYSTEM_TOPLEVEL)

/** `c:\a\b\` → `C:\a\b` (sin tocar disco). Null si no es una ruta absoluta con unidad. */
function canon(p: unknown): string | null {
  if (typeof p !== 'string') return null
  const r = resolveUiPath(p.replace(/^\\\\\?\\(?=[A-Za-z]:)/, ''), 'win32')
  return r.ok ? r.path.replace(/(?<=.)\\+$/, '') : null
}

/** Plegado para comparar: barra normal, sin barra final y mayúsculas/minúsculas ampliadas. */
export function foldWinKey(p: string): string {
  const s = p.replace(/\\/g, '/').toUpperCase().toLowerCase()
  return s.length > 3 && s.endsWith('/') ? s.slice(0, -1) : s
}

function within(k: string, root: string): boolean {
  return k === root || k.startsWith(root.endsWith('/') ? root : root + '/')
}

function driveOf(path: string): string {
  return path.slice(0, 1).toUpperCase()
}

/** Contexto mínimo comprobado: si falta algo esencial no se aprueba nada. */
function buildDenies(ctx: WinFolderPolicyContext): Deny[] | null {
  const profile = canon(ctx.userProfile)
  const sysRoot = canon(ctx.systemRoot)
  const pdata = canon(ctx.programData)
  const userData = canon(ctx.userData)
  if (!profile || !sysRoot || !pdata || !userData) return null
  const out: Deny[] = []
  const add = (path: string | null, kind: Kind): void => {
    if (path) out.push({ key: foldWinKey(path), shown: path, kind })
  }
  add(sysRoot, 'system')
  add(pdata, 'system')
  for (const pf of ctx.programFiles ?? []) add(canon(pf), 'system')
  add(userData, 'appState')
  for (const e of ctx.extraDenied ?? []) {
    const c = canon(e)
    if (!c) return null // una ruta extra ilegible es un contexto roto: falla cerrado
    add(c, 'appState')
  }
  add(canon(ctx.appData ?? `${profile}\\AppData\\Roaming`), 'appData')
  add(canon(ctx.localAppData ?? `${profile}\\AppData\\Local`), 'appData')
  add(`${profile}\\AppData`, 'appData')
  for (const rel of WIN_PROFILE_SECRETS) add(`${profile}\\${rel.replace(/\//g, '\\')}`, 'secrets')
  return out
}

const NET_REASONS = new Set(['unc', 'device'])

/**
 * Motivo por el que `folder` no puede usarse como carpeta de Tareas en Windows, o `null` si es válida.
 * `folder` es la ruta que eligió el usuario (o la ya normalizada por `realpath.native`): se vuelve a validar.
 */
export function forbiddenWinFolderReason(folder: string, ctx: WinFolderPolicyContext): string | null {
  const r = resolveUiPath(typeof folder === 'string' ? folder : '', 'win32')
  if (!r.ok) {
    return NET_REASONS.has(r.reason)
      ? t('merr.folder.winNetwork', { where: typeof folder === 'string' ? folder.slice(0, 120) : '' })
      : t('merr.folder.winBadPath')
  }
  const f = r.path.replace(/(?<=.)\\+$/, '')
  const k = foldWinKey(f)
  const letter = driveOf(f)

  // Unidad: solo discos fijos, y la lista tiene que haberse podido leer.
  if (ctx.drives === null || !Array.isArray(ctx.drives)) return t('merr.folder.winDrivesUnknown')
  if ((ctx.substDrives ?? []).some((s) => s.toUpperCase() === letter)) return t('merr.folder.winSubst', { drive: letter })
  const drive = ctx.drives.find((d) => d.letter.toUpperCase() === letter)
  if (!drive) return t('merr.folder.winDriveType', { drive: letter, kind: 'unknown' })
  if (drive.kind === 'network') return t('merr.folder.winNetwork', { where: `${letter}:` })
  if (drive.kind !== 'fixed') return t('merr.folder.winDriveType', { drive: letter, kind: drive.kind })

  // Raíz de unidad
  if (/^[A-Z]:\\?$/.test(f)) return t('merr.folder.winDriveRoot', { drive: letter })

  const denies = buildDenies(ctx)
  if (!denies) return t('merr.folder.winContext')
  const profile = foldWinKey(canon(ctx.userProfile)!)
  const profileShown = canon(ctx.userProfile)!

  // Perfil propio: la raíz y todo lo que lo contiene (`C:\Users`, `C:\`)
  if (k === profile || within(profile, k)) {
    return t(k === profile ? 'merr.folder.rootOrHome' : 'merr.folder.containsHome')
  }

  // Carpetas de primer nivel del sistema, en cualquier unidad
  const top = k.slice(3).split('/')[0]!
  if (WIN_TOPLEVEL_SET.has(top)) {
    if (top === '$recycle.bin' || top === 'recycler') return t('merr.folder.trash')
    return t('merr.folder.system', { system: `${letter}:\\${f.slice(3).split('\\')[0]}` })
  }

  // `Users` (o el padre del perfil): solo el perfil propio. Otros usuarios y `Public` quedan fuera.
  const usersParent = foldWinKey(profileShown.replace(/\\[^\\]+$/, ''))
  const isUsersDir = top === 'users'
  if (isUsersDir || (usersParent.length > 3 && within(k, usersParent))) {
    if (!within(k, profile)) return t('merr.folder.winOtherUsers', { path: f })
  }

  // AppData primero: `AppData` y `AppData\Roaming` contienen userData y deben dar el motivo de AppData.
  denies.sort((a, b) => Number(b.kind === 'appData') - Number(a.kind === 'appData'))
  for (const d of denies) {
    const hit = within(k, d.key) || within(d.key, k)
    if (!hit) continue
    switch (d.kind) {
      case 'system':
        return t('merr.folder.system', { system: d.shown })
      case 'appData':
        // Ascendientes de AppData son el perfil (ya rechazado arriba); aquí solo «dentro de» o la propia.
        if (within(k, d.key)) return t('merr.folder.winAppData', { path: d.shown })
        break
      case 'appState':
        return t('merr.folder.appState', { app: DISPLAY_NAME })
      case 'secrets':
        return t('merr.folder.secrets', { path: d.shown.replace(profileShown, '~') })
    }
  }

  // Enlaces simbólicos y junctions: en la ruta (ancestros) y dentro de la carpeta.
  const link = linkReason(f, ctx.links)
  if (link) return link

  // Política de la organización: solo restringe, nunca abre una zona vetada (ya rechazada arriba).
  if (ctx.allowedRoots) {
    const roots = ctx.allowedRoots.map((x) => canon(x)).filter((x): x is string => !!x)
    const keys = roots.map(foldWinKey)
    if (!keys.some((rk) => within(k, rk))) {
      return keys.length ? t('merr.folder.orgRoots', { roots: roots.join(', '), folder: f }) : t('merr.folder.orgNone')
    }
  }
  return null
}

/** Límites del recorrido en busca de enlaces dentro de la carpeta (superarlos = no verificable = se rechaza). */
export const LINK_SCAN_MAX_ENTRIES = 50_000
export const LINK_SCAN_MAX_DEPTH = 24

function linkReason(folder: string, probe: WinLinkProbe | undefined): string | null {
  if (!probe) return t('merr.folder.winLinkUnverified', { why: 'lstat' })
  // 1) Ancestros y la propia carpeta (de la unidad hacia abajo).
  const segs = folder.slice(3).split('\\').filter(Boolean)
  const anc = checkNoLinks(`${folder.slice(0, 2)}`, segs, (p) => probe.lstat(p))
  if (!anc.ok) return t('merr.folder.winLink', { path: anc.at })
  // 2) Dentro de la carpeta (anchura primero, con topes).
  let seen = 0
  const queue: Array<{ path: string; depth: number }> = [{ path: folder, depth: 0 }]
  while (queue.length) {
    const { path, depth } = queue.shift()!
    let entries: WinDirEntry[]
    try {
      entries = probe.readdir(path)
    } catch {
      return t('merr.folder.winLinkUnverified', { why: path })
    }
    for (const e of entries) {
      if (++seen > LINK_SCAN_MAX_ENTRIES) return t('merr.folder.winLinkUnverified', { why: String(LINK_SCAN_MAX_ENTRIES) })
      const child = `${path.replace(/\\+$/, '')}\\${e.name}`
      if (e.isSymbolicLink) return t('merr.folder.winLink', { path: child })
      if (e.isDirectory) {
        if (depth + 1 > LINK_SCAN_MAX_DEPTH) return t('merr.folder.winLinkUnverified', { why: child })
        queue.push({ path: child, depth: depth + 1 })
      }
    }
  }
  return null
}
