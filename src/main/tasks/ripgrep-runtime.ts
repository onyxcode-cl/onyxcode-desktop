/**
 * ripgrep (`rg`) incluido en la app.
 *
 * El motor busca `rg` en el `PATH`; si no lo encuentra intenta BAJARLO de github.com. Dentro del encierro de Tareas (macOS) eso falla
 * (sin red, carpeta de datos vacía) y con él fallan `grep`, `glob` y la herramienta que carga las skills (1.8.17). La app lleva su propio
 * `rg`, fijado por versión y huella (`resources/ripgrep-bin/pin.json`, `scripts/fetch-ripgrep.mjs`), y pone SU carpeta al principio del
 * `PATH` de los motores: así ningún motor necesita descargar nada. Aquí solo se LOCALIZA y se arma el `PATH`; si no está, no se cambia nada.
 *
 * macOS y Windows (x64). Empaquetado: `Contents/Resources/ripgrep/rg` (macOS) y `resources\ripgrep\rg.exe` (Windows), fuera del asar.
 * Las Tareas en WSL no lo usan: la distro ya trae `ripgrep` (`scripts/wsl-rootfs/packages.txt`) en su `/usr/bin`.
 */
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join, posix, win32 } from 'node:path'
import { augmentedPath } from '../process/child-env'
import { unpacked } from '../util/asar'

/** Plataformas en que la app lleva `rg` (las que `scripts/fetch-ripgrep.mjs` sabe preparar para el instalador). */
export function ripgrepSupported(platform: string, arch: string): boolean {
  return (platform === 'darwin' && arch === 'arm64') || (platform === 'win32' && arch === 'x64')
}

export interface RipgrepLookup {
  platform: string
  arch: string
  /** `process.resourcesPath` (app empaquetada). */
  resourcesPath?: string
  /** `app.getAppPath()` (desarrollo: raíz del repo). */
  appPath: string
  exists: (p: string) => boolean
}

/** Rutas candidatas de `rg`, por orden de preferencia (empaquetado primero, luego el árbol de desarrollo). */
export function ripgrepCandidates(l: Omit<RipgrepLookup, 'exists'>): string[] {
  if (!ripgrepSupported(l.platform, l.arch)) return []
  const win = l.platform === 'win32'
  const name = win ? 'rg.exe' : 'rg'
  const out: string[] = []
  if (l.resourcesPath) out.push((win ? win32 : posix).join(l.resourcesPath, 'ripgrep', name))
  out.push(unpacked(join(l.appPath, 'resources', 'ripgrep-bin', 'bin', name)))
  return out
}

/** Primer candidato que existe, o `null`. */
export function findBundledRipgrep(l: RipgrepLookup): string | null {
  return ripgrepCandidates(l).find((p) => l.exists(p)) ?? null
}

/**
 * `PATH` con la carpeta de `rg` al principio y el resto como lo arma la app para sus motores (`augmentedPath`). Pura: no toca el sistema.
 * Vacío si no hay `rg` incluido (el motor sigue como antes).
 */
export function ripgrepPathEnv(bin: string | null, basePath: string, platform: NodeJS.Platform = process.platform): Record<string, string> {
  if (!bin) return {}
  const win = platform === 'win32'
  const delim = win ? win32.delimiter : posix.delimiter
  const dir = win ? win32.dirname(bin) : posix.dirname(bin)
  const rest = augmentedPath(basePath, undefined, platform)
    .split(delim)
    .filter((d) => d && d !== dir)
  return { PATH: [dir, ...rest].join(delim) }
}

/** `PATH` para los motores de esta app, resolviendo el `rg` real del sistema de archivos. Nunca lanza. */
export function bundledRipgrepPathEnv(): Record<string, string> {
  try {
    const bin = findBundledRipgrep({
      platform: process.platform,
      arch: process.arch,
      resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
      appPath: app.getAppPath(),
      exists: existsSync
    })
    return ripgrepPathEnv(bin, process.env.PATH ?? '')
  } catch {
    return {}
  }
}
