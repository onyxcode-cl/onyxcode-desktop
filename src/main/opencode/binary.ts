/**
 * Detección y validación del binario de OpenCode: `execFile` SIN shell, entorno mínimo, cwd neutro y
 * timeout corto. Nunca instala nada.
 */
import { t } from '@shared/i18n'
import { execFile } from 'node:child_process'
import { accessSync, constants, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'
import { OPENCODE_SDK_VERSION } from '@shared/opencode-links'
import type { OpencodeInfo, OpencodeSource } from '@shared/types'
import { app } from 'electron'
import { minimalEnv } from '../process/child-env'
import { testLauncher } from './test-launcher'

function appIsPackaged(): boolean {
  try {
    return app.isPackaged === true
  } catch {
    return false
  }
}

const VERSION_TIMEOUT_MS = 5_000
const SEMVER = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/

/** Extrae el primer número de versión de la salida de `--version` (null si no hay). */
export function parseVersion(output: string): string | null {
  return SEMVER.exec(output)?.[0] ?? null
}

/** Compatible = misma versión mayor y menor que el SDK (el parche puede diferir). */
export function isCompatible(version: string | null, sdk: string = OPENCODE_SDK_VERSION): boolean {
  if (!version) return false
  const [a, b] = version.split('.')
  const [c, d] = sdk.split('.')
  return a === c && b === d
}

/** Entorno de la sonda: XDG_* en un temporal para que `--version` no cree carpetas en los datos del CLI del usuario. */
export function probeEnv(): Record<string, string> {
  const root = join(tmpdir(), 'onyxcode-version-probe')
  return minimalEnv({
    XDG_DATA_HOME: join(root, 'data'),
    XDG_CONFIG_HOME: join(root, 'config'),
    XDG_CACHE_HOME: join(root, 'cache'),
    XDG_STATE_HOME: join(root, 'state')
  })
}

/** Ejecuta `<bin> --version`; devuelve la salida recortada (stdout, o stderr si stdout está vacío). */
export function runVersion(bin: string, timeoutMs = VERSION_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    // Solo pruebas: el falso `.mjs` se ejecuta con node en Windows (nunca empaquetado).
    const exec = testLauncher(bin, ['--version'], { isPackaged: appIsPackaged() })
    execFile(
      exec.command,
      exec.args,
      { env: probeEnv(), cwd: tmpdir(), timeout: timeoutMs, maxBuffer: 64 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) return reject(err)
        resolve((stdout.toString().trim() || stderr.toString().trim()).slice(0, 500))
      }
    )
  })
}

export type BinaryCheck = { ok: true; path: string; output: string; version: string | null } | { ok: false; error: string }

/**
 * Valida un binario elegido por el usuario: ruta absoluta, archivo regular, ejecutable y que
 * `--version` termine bien e imprima algo.
 */
export async function validateOpencodeBin(path: string, timeoutMs = VERSION_TIMEOUT_MS): Promise<BinaryCheck> {
  if (typeof path !== 'string' || !path || path.includes('\0') || !isAbsolute(path)) return { ok: false, error: t('merr.bin.invalidPath') }
  let real: string
  try {
    real = realpathSync(path)
    if (!statSync(real).isFile()) return { ok: false, error: t('merr.bin.notFile') }
  } catch {
    return { ok: false, error: t('merr.bin.notExist') }
  }
  try {
    accessSync(real, constants.X_OK)
  } catch {
    return { ok: false, error: t('merr.bin.notExecutable') }
  }
  try {
    const output = await runVersion(real, timeoutMs)
    if (!output) return { ok: false, error: t('merr.bin.noVersion') }
    return { ok: true, path, output, version: parseVersion(output) }
  } catch {
    return { ok: false, error: t('merr.bin.versionFailed') }
  }
}

/** Binario elegido por la resolución y de dónde sale. */
export interface ResolvedOpencode {
  path: string
  source: OpencodeSource
}

// Caché de la versión del CLI del usuario por (ruta, mtime): `--version` (un proceso de ~100 MB)
// no se ejecuta en cada llamada. `undefined` = aún no medida; `null` = no se pudo leer.
const cliVersions = new Map<string, { mtimeMs: number; version: string | null }>()

function mtimeOf(path: string): number | null {
  try {
    return statSync(path).mtimeMs
  } catch {
    return null
  }
}

/** Versión cacheada del CLI en `path` (undefined si no se midió o el archivo cambió desde entonces). */
export function cachedCliVersion(path: string): string | null | undefined {
  const hit = cliVersions.get(path)
  if (!hit) return undefined
  return hit.mtimeMs === mtimeOf(path) ? hit.version : undefined
}

/** Mide (con `execFile` y timeout, sin bloquear el proceso) y cachea la versión del CLI en `path`. */
export async function warmCliVersion(path: string, run: (bin: string) => Promise<string> = runVersion): Promise<string | null> {
  const cached = cachedCliVersion(path)
  if (cached !== undefined) return cached
  const mtimeMs = mtimeOf(path)
  let version: string | null = null
  try {
    version = parseVersion(await run(path))
  } catch {
    version = null
  }
  if (mtimeMs !== null) cliVersions.set(path, { mtimeMs, version })
  return version
}

export function clearCliVersionCache(): void {
  cliVersions.clear()
}

export interface PickInput {
  /** `OPENCODE_BIN`. */
  env?: string
  /** `settings.opencodeBin`. */
  configured?: string
  /** CLI del usuario (PATH y carpetas habituales), o null. */
  cli: string | null
  /** Binario embebido presente (solo empaquetado), o null. */
  bundled: string | null
  isExecutable: (path: string) => boolean
  /** Versión del CLI si ya se midió (`undefined` = desconocida). */
  cliVersion: (path: string) => string | null | undefined
}

/**
 * Orden de resolución: `OPENCODE_BIN` → `settings.opencodeBin` → CLI del usuario SI es compatible →
 * embebido → CLI incompatible (último recurso). Sin embebido (desarrollo) el CLI se usa tal cual,
 * sin medir su versión: el comportamiento es el de siempre. Con embebido, un CLI de versión aún
 * desconocida NO se da por bueno (gana el embebido, que es el probado).
 */
export function pickOpencode(i: PickInput): ResolvedOpencode | null {
  if (i.env && i.isExecutable(i.env)) return { path: i.env, source: 'env' }
  if (i.configured && i.isExecutable(i.configured)) return { path: i.configured, source: 'settings' }
  if (i.cli && !i.bundled) return { path: i.cli, source: 'cli' }
  if (i.cli && i.bundled) {
    const v = i.cliVersion(i.cli)
    if (v !== undefined && isCompatible(v)) return { path: i.cli, source: 'cli' }
    return { path: i.bundled, source: 'bundled' }
  }
  return i.bundled ? { path: i.bundled, source: 'bundled' } : null
}

/** Estado del binario que la app usaría ahora (`find` inyectado para poder probarlo). */
export async function getOpencodeInfo(find: () => string | ResolvedOpencode | null): Promise<OpencodeInfo> {
  const found = find()
  if (!found) return { found: false, path: null, source: null, version: null, sdkVersion: OPENCODE_SDK_VERSION, compatible: false }
  const { path, source } = typeof found === 'string' ? { path: found, source: 'cli' as const } : found
  let version: string | null = null
  try {
    version = parseVersion(await runVersion(path))
  } catch {
    version = null
  }
  return { found: true, path, source, version, sdkVersion: OPENCODE_SDK_VERSION, compatible: isCompatible(version) }
}
