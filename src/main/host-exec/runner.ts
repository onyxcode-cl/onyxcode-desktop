/**
 * Ejecuta UN comando aprobado en el equipo (fuera del aislamiento de las Tareas). Sin electron: solo Node.
 *
 * - macOS/Linux: `/bin/zsh -c` (o `/bin/sh -c` si no hay zsh). Windows: `powershell.exe -NoProfile -NonInteractive -Command` con salida UTF-8.
 * - Entorno MÍNIMO (`minimalEnv`: lista blanca de variables, sin los secretos ni las variables internas de la app) y carpeta de trabajo = la de la tarea.
 * - Tiempo máximo (por defecto 60 s, tope 300 s), tope de salida (64 KB por flujo) y cierre de todo el árbol de procesos al vencer.
 * - Segundo plano (`background`): para dejar un servidor corriendo (`python3 app.py`). Sale del proceso a un archivo de registro privado, espera unos
 *   segundos para devolver el arranque y lo deja registrado para poder detenerlo; todo se mata al terminar la tarea o al cerrar la app.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { minimalEnv } from '../process/child-env'
import { killTree } from '../opencode/pids'

export const DEFAULT_TIMEOUT_MS = 60_000
export const MAX_TIMEOUT_MS = 300_000
export const MAX_OUTPUT_BYTES = 64 * 1024
export const BACKGROUND_GRACE_MS = 3_000
export const MAX_BACKGROUND_PER_OWNER = 3

export interface RunOptions {
  cwd?: string
  platform?: NodeJS.Platform
  timeoutMs?: number
  maxOutputBytes?: number
  /** Segundos de espera antes de devolver el arranque de un proceso en segundo plano. */
  graceMs?: number
  /** Variables de la Bóveda del proyecto: se suman al entorno mínimo (nunca pisan `PATH`, `HOME` ni las demás de la lista blanca). */
  extraEnv?: Record<string, string>
}

export interface RunResult {
  exitCode: number | null
  signal: string | null
  stdout: string
  stderr: string
  /** La salida se recortó al tope. */
  truncated: boolean
  timedOut: boolean
  ms: number
}

export interface BackgroundResult extends RunResult {
  pid: number
  /** El proceso seguía vivo al devolver el arranque. */
  running: boolean
}

/** `[archivo, argumentos]` con que se lanza un comando en la plataforma. */
export function shellInvocation(
  platform: NodeJS.Platform,
  command: string,
  exists: (p: string) => boolean = existsSync
): [string, string[]] {
  if (platform === 'win32') {
    const utf8 = '$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); '
    return ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', utf8 + command]]
  }
  return exists('/bin/zsh') ? ['/bin/zsh', ['-c', command]] : ['/bin/sh', ['-c', command]]
}

function clip(buf: Buffer[], size: number, max: number): { text: string; truncated: boolean } {
  const all = Buffer.concat(buf)
  const text = all.subarray(0, max).toString('utf8')
  return { text, truncated: size > max }
}

function envFor(platform: NodeJS.Platform, extra?: Record<string, string>): Record<string, string> {
  const base = minimalEnv({}, { platform })
  if (!extra) return base
  const out: Record<string, string> = { ...base }
  for (const [k, v] of Object.entries(extra)) if (!(k in base) && typeof v === 'string') out[k] = v
  return out
}

/** Corre el comando hasta que termina (o vence el tiempo). Nunca lanza: los fallos de arranque vuelven como `exitCode: null` y un texto en `stderr`. */
export function runHostCommand(command: string, opts: RunOptions = {}): Promise<RunResult> {
  const platform = opts.platform ?? process.platform
  const timeoutMs = Math.min(Math.max(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000), MAX_TIMEOUT_MS)
  const max = opts.maxOutputBytes ?? MAX_OUTPUT_BYTES
  const [file, args] = shellInvocation(platform, command)
  const started = Date.now()
  return new Promise<RunResult>((resolve) => {
    const out: Buffer[] = []
    const err: Buffer[] = []
    let outSize = 0
    let errSize = 0
    let timedOut = false
    let done = false
    let child: ChildProcess
    const finish = (exitCode: number | null, signal: string | null, extraErr = ''): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      const o = clip(out, outSize, max)
      const e = clip(err, errSize, max)
      resolve({
        exitCode,
        signal,
        stdout: o.text,
        stderr: extraErr ? `${e.text}${e.text ? '\n' : ''}${extraErr}` : e.text,
        truncated: o.truncated || e.truncated,
        timedOut,
        ms: Date.now() - started
      })
    }
    try {
      child = spawn(file, args, {
        cwd: opts.cwd,
        env: envFor(platform, opts.extraEnv),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: platform !== 'win32'
      })
    } catch (e) {
      resolve({
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: String((e as Error).message).slice(0, 300),
        truncated: false,
        timedOut: false,
        ms: 0
      })
      return
    }
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child.pid)
    }, timeoutMs)
    child.stdout?.on('data', (d: Buffer) => {
      outSize += d.length
      if (outSize <= max * 2) out.push(d)
    })
    child.stderr?.on('data', (d: Buffer) => {
      errSize += d.length
      if (errSize <= max * 2) err.push(d)
    })
    child.on('error', (e) => finish(null, null, String(e.message).slice(0, 300)))
    child.on('close', (code, signal) => finish(code, signal))
  })
}

// ───────────────────────────── Segundo plano ─────────────────────────────

interface Tracked {
  pid: number
  owner: string
  command: string
  logPath: string
}
const tracked = new Map<number, Tracked>()

function logDir(): string {
  const dir = join(tmpdir(), 'lazunox-host-exec')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function backgroundCount(owner: string): number {
  let n = 0
  for (const t of tracked.values()) if (t.owner === owner && isAlive(t.pid)) n++
  return n
}

/** Deja el comando corriendo en segundo plano y devuelve su arranque. El que llama aplica `MAX_BACKGROUND_PER_OWNER`. */
export function startBackground(command: string, owner: string, opts: RunOptions = {}): Promise<BackgroundResult> {
  const platform = opts.platform ?? process.platform
  const grace = opts.graceMs ?? BACKGROUND_GRACE_MS
  const max = opts.maxOutputBytes ?? MAX_OUTPUT_BYTES
  const [file, args] = shellInvocation(platform, command)
  const started = Date.now()
  const logPath = join(logDir(), `${randomBytes(6).toString('hex')}.log`)
  return new Promise<BackgroundResult>((resolve) => {
    let fd: number
    try {
      fd = openSync(logPath, 'w', 0o600)
    } catch (e) {
      resolve({
        pid: 0,
        running: false,
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: String((e as Error).message).slice(0, 300),
        truncated: false,
        timedOut: false,
        ms: 0
      })
      return
    }
    let child: ChildProcess
    try {
      child = spawn(file, args, {
        cwd: opts.cwd,
        env: envFor(platform, opts.extraEnv),
        stdio: ['ignore', fd, fd],
        windowsHide: true,
        detached: platform !== 'win32'
      })
    } catch (e) {
      closeSync(fd)
      resolve({
        pid: 0,
        running: false,
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: String((e as Error).message).slice(0, 300),
        truncated: false,
        timedOut: false,
        ms: 0
      })
      return
    }
    closeSync(fd)
    let exited: { code: number | null; signal: string | null } | null = null
    let errText = ''
    child.on('error', (e) => {
      errText = String(e.message).slice(0, 300)
    })
    child.on('exit', (code, signal) => {
      exited = { code, signal }
    })
    child.unref()
    const pid = child.pid ?? 0
    if (pid) tracked.set(pid, { pid, owner, command: command.slice(0, 200), logPath })
    setTimeout(() => {
      let text = ''
      let truncated = false
      try {
        const size = statSync(logPath).size
        const buf = readFileSync(logPath)
        text = buf.subarray(0, max).toString('utf8')
        truncated = size > max
      } catch {
        // sin registro todavía
      }
      const result = exited as { code: number | null; signal: string | null } | null
      const running = !result && !!pid && isAlive(pid)
      if (!running) {
        tracked.delete(pid)
        rmSync(logPath, { force: true })
      }
      resolve({
        pid,
        running,
        exitCode: result ? result.code : null,
        signal: result ? result.signal : null,
        stdout: text,
        stderr: errText,
        truncated,
        timedOut: false,
        ms: Date.now() - started
      })
    }, grace)
  })
}

/** Detiene un proceso en segundo plano de `owner`. `false` si no existe, no es suyo o ya terminó. */
export function stopBackground(pid: number, owner: string): boolean {
  const t = tracked.get(pid)
  if (!t || t.owner !== owner) return false
  killTree(pid)
  tracked.delete(pid)
  rmSync(t.logPath, { force: true })
  return true
}

/** Mata todos los de `owner` (termina su tarea). Devuelve cuántos. */
export function stopAllBackground(owner: string): number {
  let n = 0
  for (const t of [...tracked.values()]) {
    if (t.owner !== owner) continue
    killTree(t.pid)
    tracked.delete(t.pid)
    rmSync(t.logPath, { force: true })
    n++
  }
  return n
}

/** Mata todos los de la app (al cerrarla). */
export function stopEveryBackground(): number {
  let n = 0
  for (const t of [...tracked.values()]) {
    killTree(t.pid)
    rmSync(t.logPath, { force: true })
    n++
  }
  tracked.clear()
  return n
}
