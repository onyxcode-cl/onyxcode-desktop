/**
 * Detección y validación del binario de OpenCode: `execFile` SIN shell, entorno mínimo, cwd neutro y
 * timeout corto. Nunca instala nada.
 */
import { execFile } from 'node:child_process'
import { accessSync, constants, realpathSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { OPENCODE_SDK_VERSION } from '@shared/opencode-links'
import type { OpencodeInfo } from '@shared/types'
import { minimalEnv } from '../process/child-env'

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

/** Ejecuta `<bin> --version`; devuelve la salida recortada (stdout, o stderr si stdout está vacío). */
export function runVersion(bin: string, timeoutMs = VERSION_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      ['--version'],
      { env: minimalEnv(), cwd: tmpdir(), timeout: timeoutMs, maxBuffer: 64 * 1024, windowsHide: true },
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
  if (typeof path !== 'string' || !path || path.includes('\0') || !isAbsolute(path)) return { ok: false, error: 'La ruta no es válida.' }
  let real: string
  try {
    real = realpathSync(path)
    if (!statSync(real).isFile()) return { ok: false, error: 'La ruta no es un archivo.' }
  } catch {
    return { ok: false, error: 'El archivo no existe.' }
  }
  try {
    accessSync(real, constants.X_OK)
  } catch {
    return { ok: false, error: 'El archivo no es ejecutable.' }
  }
  try {
    const output = await runVersion(real, timeoutMs)
    if (!output) return { ok: false, error: 'El archivo no imprime una versión con `--version`; no parece OpenCode.' }
    return { ok: true, path, output, version: parseVersion(output) }
  } catch {
    return { ok: false, error: 'No se pudo ejecutar `--version`; no parece OpenCode.' }
  }
}

/** Estado del binario que la app usaría ahora (`findOpencodeBinary` inyectado para poder probarlo). */
export async function getOpencodeInfo(find: () => string | null): Promise<OpencodeInfo> {
  const path = find()
  if (!path) return { found: false, path: null, version: null, sdkVersion: OPENCODE_SDK_VERSION, compatible: false }
  let version: string | null = null
  try {
    version = parseVersion(await runVersion(path))
  } catch {
    version = null
  }
  return { found: true, path, version, sdkVersion: OPENCODE_SDK_VERSION, compatible: isCompatible(version) }
}
