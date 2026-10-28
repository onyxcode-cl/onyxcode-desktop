/**
 * Icono real de una app para la tarjeta de permiso («¿Permitir que Lazunox use Spotify?»). Se resuelve en main y viaja como
 * data URL PNG pequeño en `AccessRequestApp.icon`. Falla SIEMPRE a «sin icono» (nunca rompe la tarjeta).
 *  - macOS: bundleId (validado con regex estricta) → ruta de la .app con `mdfind` (execFile, sin shell) → icono del archivo.
 *  - Windows: la clave de la app (`exe:<ruta>|pub:…`) ya trae la ruta del .exe (`parseAppKey`). Las apps UWP (`aumid:`) no
 *    tienen ruta: solo unas pocas de Windows con equivalente clásico en System32 (Bloc de notas, Paint, Calculadora) usan ese
 *    ejecutable FIJO (tabla `WIN_UWP_CLASSIC_EXE`, no sale de la clave ni del renderer); el resto queda sin icono (la tarjeta cae a la letra).
 * Este módulo no importa electron: la parte nativa (`getFileIcon`) se inyecta desde `tasks-computer-wiring.ts`.
 */
import { isSafeIconDataUrl } from '@shared/app-icon'
import { parseAppKey, UNSIGNED_PUBLISHER } from './policy/app-key'

/** Apps UWP de Windows con ejecutable clásico fijo en System32 (prefijo del paquete del AUMID, en minúsculas → nombre del exe). */
const WIN_UWP_CLASSIC_EXE: ReadonlyArray<readonly [string, string]> = [
  ['microsoft.windowsnotepad_', 'notepad.exe'],
  ['microsoft.paint_', 'mspaint.exe'],
  ['microsoft.windowscalculator_', 'calc.exe']
]

const CACHE_MAX = 64
const BUNDLE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
/** Un fallo (app no encontrada, icono vacío…) se recuerda solo un rato: la app puede instalarse después. */
export const FAILURE_TTL_MS = 10 * 60_000

// ───────────────────────────── macOS: dónde buscar la .app ─────────────────────────────

/** Únicas carpetas donde se busca la .app de un bundleId (de más a menos fiable). Nunca la carpeta de trabajo ni /tmp. */
export function macAppSearchDirs(home: string): string[] {
  return [
    '/System/Applications',
    '/System/Library/CoreServices',
    '/Applications',
    ...(home.startsWith('/') && home !== '/' ? [`${home.replace(/\/+$/, '')}/Applications`] : [])
  ]
}

/** Argumentos EXACTOS de `mdfind`: un `-onlyin` por carpeta y el predicado al final (el bundleId ya está validado). */
export function macAppFindArgs(bundleId: string, home: string): string[] | null {
  if (!BUNDLE_ID_RE.test(bundleId)) return null
  const args: string[] = []
  for (const d of macAppSearchDirs(home)) args.push('-onlyin', d)
  args.push(`kMDItemCFBundleIdentifier == "${bundleId}"`)
  return args
}

const FORBIDDEN_PREFIXES = ['/tmp/', '/private/', '/var/', '/Volumes/']

/**
 * Elige una ruta de la salida de `mdfind`: absoluta, termina en `.app`, sin `..`, dentro de una carpeta de apps permitida
 * (y no bajo /tmp, /private, /Volumes ni `excludeDirs`, p. ej. la carpeta de trabajo). Prefiere la del sistema.
 */
export function pickMacAppPath(out: string, home: string, excludeDirs: string[] = []): string | null {
  const dirs = macAppSearchDirs(home)
  const excluded = excludeDirs.filter((d) => d.startsWith('/')).map((d) => (d.endsWith('/') ? d : `${d}/`))
  let best: { path: string; rank: number } | null = null
  for (const raw of String(out).split('\n')) {
    const l = raw.trim()
    if (!l.startsWith('/') || !l.endsWith('.app') || l.includes('\0') || l.split('/').some((seg) => seg === '..' || seg === '.')) continue
    if (FORBIDDEN_PREFIXES.some((f) => l.startsWith(f)) || excluded.some((e) => l.startsWith(e))) continue
    const rank = dirs.findIndex((d) => l.startsWith(`${d}/`))
    if (rank < 0) continue
    if (!best || rank < best.rank) best = { path: l, rank }
  }
  return best?.path ?? null
}

export type ExecFileLike = (
  file: string,
  args: string[],
  opts: { timeout: number; maxBuffer: number },
  cb: (err: Error | null, stdout: string | Buffer) => void
) => unknown

/** `findMacAppPath` real: `mdfind` (execFile, sin shell) acotado a las carpetas de apps del sistema. */
export function createMacAppFinder(opts: {
  execFile: ExecFileLike
  home: string
  excludeDirs?: () => string[]
}): (bundleId: string) => Promise<string | null> {
  return (bundleId) =>
    new Promise((resolve) => {
      const args = macAppFindArgs(bundleId, opts.home)
      if (!args) return resolve(null)
      try {
        opts.execFile('/usr/bin/mdfind', args, { timeout: 2_000, maxBuffer: 64 * 1024 }, (err, out) => {
          if (err) return resolve(null)
          resolve(pickMacAppPath(String(out), opts.home, opts.excludeDirs?.() ?? []))
        })
      } catch {
        resolve(null)
      }
    })
}

// ───────────────────────────── Resolvedor con caché ─────────────────────────────

export interface AppIconDeps {
  platform: string
  /** Busca la .app de un bundleId ya validado (macOS). `null` = no se encontró. */
  findMacAppPath: (bundleId: string) => Promise<string | null>
  /** PNG del icono del archivo ya reducido, como data URL (la parte con electron). */
  fileIconDataUrl: (path: string) => Promise<string | null>
  /** Reloj inyectable (pruebas de caducidad). */
  now?: () => number
  /** Windows: unidad del sistema donde se aceptan iconos (las demás pueden ser unidades de red mapeadas). Por defecto `c:`. */
  winLocalDrive?: string
  /** Windows: carpeta del sistema (`%SystemRoot%`) para los exe clásicos de las apps UWP de la tabla. Por defecto `c:\\windows`. */
  winSystemDir?: string
  /** Windows: ¿existe el archivo? (sin esto no se usan los exe clásicos de la tabla). */
  pathExists?: (path: string) => boolean
}

interface Entry {
  icon: string | null
  /** Marca de caducidad (solo los fallos). */
  until: number
}

export function createAppIconResolver(deps: AppIconDeps): (appKey: string) => Promise<string | undefined> {
  const now = deps.now ?? Date.now
  const cache = new Map<string, Entry>()
  const byPath = new Map<string, Entry>()
  const inflight = new Map<string, Promise<string | null>>()
  /** Icono (data URL) → ruta que lo produjo. Dos rutas distintas con el MISMO icono ⇒ es el genérico del sistema, no un logo. */
  const owners = new Map<string, string>()
  const generic = new Set<string>()
  const put = (m: Map<string, Entry>, k: string, icon: string | null): void => {
    if (m.size >= CACHE_MAX) m.delete(m.keys().next().value as string)
    m.set(k, { icon, until: icon ? Infinity : now() + FAILURE_TTL_MS })
  }
  const get = (m: Map<string, Entry>, k: string): Entry | undefined => {
    const e = m.get(k)
    if (e && e.until <= now()) {
      m.delete(k)
      return undefined
    }
    return e
  }
  const purgeGeneric = (url: string): void => {
    for (const m of [cache, byPath]) for (const [k, e] of m) if (e.icon === url) m.set(k, { icon: null, until: now() + FAILURE_TTL_MS })
  }
  const iconForPath = async (path: string): Promise<string | null> => {
    const hit = get(byPath, path)
    if (hit) return hit.icon
    let icon: string | null = null
    const url = await deps.fileIconDataUrl(path)
    if (isSafeIconDataUrl(url) && !generic.has(url)) {
      const owner = owners.get(url)
      if (owner && owner !== path) {
        generic.add(url)
        purgeGeneric(url)
      } else {
        owners.set(url, path)
        icon = url
      }
    }
    put(byPath, path, icon)
    return icon
  }
  const resolveKey = async (appKey: string): Promise<string | null> => {
    let path: string | null = null
    if (deps.platform === 'win32') {
      const parsed = parseAppKey(appKey)
      if (parsed?.kind === 'exe') {
        // Sin firma ⇒ cualquiera pudo ponerle el icono que quisiera; fuera de la unidad local puede ser una unidad de red mapeada.
        const drive = (deps.winLocalDrive ?? 'c:').toLowerCase()
        if (parsed.publisher !== UNSIGNED_PUBLISHER && parsed.path.toLowerCase().startsWith(`${drive}\\`)) path = parsed.path
      } else if (parsed?.kind === 'aumid' && deps.pathExists) {
        const hit = WIN_UWP_CLASSIC_EXE.find(([prefix]) => parsed.id.toLowerCase().startsWith(prefix))
        const sys = (deps.winSystemDir ?? 'c:\\windows').replace(/[\\/]+$/, '')
        const drive = (deps.winLocalDrive ?? 'c:').toLowerCase()
        const candidate = hit ? `${sys}\\system32\\${hit[1]}` : null
        if (candidate && candidate.toLowerCase().startsWith(`${drive}\\`) && deps.pathExists(candidate)) path = candidate
      }
    } else if (deps.platform === 'darwin' && BUNDLE_ID_RE.test(appKey)) {
      path = await deps.findMacAppPath(appKey)
    }
    return path ? iconForPath(path) : null
  }
  return async (appKey) => {
    if (typeof appKey !== 'string' || appKey.length > 600) return undefined
    const hit = get(cache, appKey)
    if (hit) return hit.icon ?? undefined
    let p = inflight.get(appKey)
    if (!p) {
      p = resolveKey(appKey)
        .catch((err) => {
          console.warn('[computer] icono de app:', err instanceof Error ? err.message : err)
          return null
        })
        .then((icon) => {
          put(cache, appKey, icon)
          return icon
        })
        .finally(() => inflight.delete(appKey))
      inflight.set(appKey, p)
    }
    return (await p) ?? undefined
  }
}
