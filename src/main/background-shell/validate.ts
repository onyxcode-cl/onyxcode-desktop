/**
 * Validación estricta de las entradas de `start` (todo lo que viene del modelo es no confiable).
 */
import { isAbsolute } from 'node:path'
import type { ShellBgFs } from './fs-port'
import { ShellBgError } from './types'

export const DEFAULT_MAX_COMMAND_LENGTH = 8192

/** Variables del entorno del padre que SÍ heredan los trabajos. Todo lo demás (claves de API, tokens…) no pasa. */
export const INHERITED_ENV = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LANGUAGE',
  'TZ',
  'TMPDIR',
  'TERM',
  'COLORTERM',
  'SystemRoot',
  'ComSpec',
  'PATHEXT',
  'USERPROFILE',
  'TEMP',
  'TMP'
] as const

/** Variables extra que el modelo puede fijar. Lista blanca cerrada: cualquier otra se rechaza. */
export const ALLOWED_EXTRA_ENV = [
  'NODE_ENV',
  'CI',
  'FORCE_COLOR',
  'NO_COLOR',
  'DEBUG',
  'PORT',
  'HOST',
  'PYTHONUNBUFFERED',
  'PYTHONDONTWRITEBYTECODE',
  'RUST_LOG',
  'RUST_BACKTRACE',
  'LOG_LEVEL',
  'TZ',
  'LANG',
  'LC_ALL'
] as const

const MAX_ENV_VALUE = 2048

export function validateCommand(command: unknown, maxLength: number): string {
  if (typeof command !== 'string' || command.trim() === '') {
    throw new ShellBgError('INVALID_INPUT', 'command must be a non-empty string.')
  }
  if (command.length > maxLength) {
    throw new ShellBgError(
      'INVALID_INPUT',
      `command is too long (${command.length} > ${maxLength} characters). Put long scripts in a file and run that file.`
    )
  }
  if (command.includes('\0')) throw new ShellBgError('INVALID_INPUT', 'command must not contain NUL characters.')
  return command
}

export function validateCwd(cwd: unknown, fs: ShellBgFs): string {
  if (typeof cwd !== 'string' || cwd === '' || cwd.includes('\0')) {
    throw new ShellBgError('INVALID_INPUT', 'cwd must be a non-empty string.')
  }
  if (!isAbsolute(cwd)) throw new ShellBgError('INVALID_INPUT', `cwd must be an absolute path (got "${cwd}").`)
  const st = fs.stat(cwd)
  if (!st || !st.isDirectory) throw new ShellBgError('INVALID_INPUT', `cwd does not exist or is not a directory: ${cwd}`)
  try {
    return fs.realpath(cwd)
  } catch {
    throw new ShellBgError('INVALID_INPUT', `cwd cannot be resolved: ${cwd}`)
  }
}

/** Entorno final del hijo: variables heredadas permitidas + extras de la lista blanca. */
export function buildChildEnv(
  base: Record<string, string | undefined>,
  extra: unknown,
  allowedExtra: readonly string[] = ALLOWED_EXTRA_ENV
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const k of INHERITED_ENV) {
    const v = base[k]
    if (typeof v === 'string') env[k] = v
  }
  for (const [k, v] of Object.entries(base)) {
    if (/^LC_[A-Z_]+$/.test(k) && typeof v === 'string') env[k] = v
  }
  if (extra === undefined) return env
  if (typeof extra !== 'object' || extra === null || Array.isArray(extra)) {
    throw new ShellBgError('INVALID_INPUT', 'env must be an object of string values.')
  }
  for (const [k, v] of Object.entries(extra)) {
    if (!allowedExtra.includes(k)) {
      throw new ShellBgError(
        'INVALID_INPUT',
        `env variable "${k}" is not allowed. Allowed: ${allowedExtra.join(', ')}. Secrets are never passed through this tool.`
      )
    }
    if (typeof v !== 'string' || v.length > MAX_ENV_VALUE || v.includes('\0')) {
      throw new ShellBgError('INVALID_INPUT', `env variable "${k}" must be a string of at most ${MAX_ENV_VALUE} characters.`)
    }
    env[k] = v
  }
  return env
}

export function validateWatchPaths(paths: unknown): string[] {
  if (paths === undefined) return []
  if (!Array.isArray(paths) || paths.length > 16) {
    throw new ShellBgError('INVALID_INPUT', 'watchPaths must be an array of at most 16 absolute paths.')
  }
  for (const p of paths) {
    if (typeof p !== 'string' || !isAbsolute(p) || p.includes('\0')) {
      throw new ShellBgError('INVALID_INPUT', `watchPaths entries must be absolute paths (got ${JSON.stringify(p)}).`)
    }
  }
  return paths as string[]
}
