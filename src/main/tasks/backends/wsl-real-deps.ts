/**
 * Dependencias REALES de `WslBackend` para Windows (F8-B81, B1): `spawn` de `wsl.exe` (con stdin y con stdout a archivo), disco y descarga.
 * NO lo importa `index.ts` ni nada de producción en esta ronda: solo `wsl-setup.win.test.ts` (en el PC, con `LAZUNOX_WSL_IT=1`) lo usa.
 * Los comandos llegan ya como `WslSpawnSpec` (lista cerrada de `wsl-spec.ts`): aquí no se arma ningún argumento.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createReadStream, createWriteStream, statfsSync } from 'node:fs'
import { connect as netConnect, createServer } from 'node:net'
import { copyFile, lstat, mkdir, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { join, parse } from 'node:path'
import type { Duplex, Readable } from 'node:stream'
import { sha256File, type FetchLike } from '../../remote/tunnel/binary'
import { pinnedDownload } from './pinned-download'
import type { WslDeps, WslProcess, WslSetupExtras } from './wsl'
import type { LzpkInputFile } from './wsl-payload'
import { assertAllowedWslArgs, type WslSpawnSpec } from './wsl-spec'
import type { SetupPin, WslSetupFs } from './wsl-setup'
import { parseSetupPin } from './wsl-setup'
import type { RunResult } from './wsl-status'

/** Tope de lo que se acumula de stdout/stderr de comandos de control (los datos grandes van a archivo). */
const MAX_CAPTURE = 4 * 1024 * 1024

function collect(child: ChildProcess, ms: number, stdoutTo?: NodeJS.WritableStream): Promise<RunResult> {
  return new Promise((resolve) => {
    const out: Buffer[] = []
    const err: Buffer[] = []
    let outLen = 0
    let errLen = 0
    let done = false
    let error: string | undefined
    const finish = (code: number | null): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      const end = (): void => resolve({ code: error ? null : code, stdout: Buffer.concat(out), stderr: Buffer.concat(err), error })
      if (stdoutTo) stdoutTo.end(end)
      else end()
    }
    const timer = setTimeout(() => {
      error = 'timeout'
      child.kill('SIGKILL')
    }, ms)
    child.stdout?.on('data', (c: Buffer) => {
      if (stdoutTo) {
        stdoutTo.write(c)
        return
      }
      if (outLen < MAX_CAPTURE) {
        out.push(c)
        outLen += c.length
      }
    })
    child.stderr?.on('data', (c: Buffer) => {
      if (errLen < MAX_CAPTURE) {
        err.push(c)
        errLen += c.length
      }
    })
    child.on('error', (e: NodeJS.ErrnoException) => {
      error ??= e.code ?? 'spawn'
      finish(null)
    })
    child.on('close', (code) => finish(code))
  })
}

function start(spec: WslSpawnSpec): ChildProcess {
  assertAllowedWslArgs(spec.args)
  return spawn(spec.command, spec.args, {
    env: spec.env,
    windowsHide: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false
  })
}

/** `wsl.exe` de larga vida (el lanzador del sandbox): stdin/stdout son el puente. Mismo filtro de argumentos que el resto. */
export function realSpawn(spec: WslSpawnSpec): WslProcess {
  return start(spec) as unknown as WslProcess
}

/** Conexión al servidor/proxy local del anfitrión: SOLO 127.0.0.1. */
export function realConnect(port: number): Promise<Duplex> {
  return new Promise((resolve, reject) => {
    const s = netConnect({ host: '127.0.0.1', port })
    s.once('error', reject)
    s.once('connect', () => {
      s.off('error', reject)
      resolve(s)
    })
  })
}

/** Escucha en 127.0.0.1 (nunca en `0.0.0.0`): los flujos que abre el agente por el puente. */
export function realListen(port: number, onConnection: (socket: Duplex) => void): Promise<{ close(): Promise<void> }> {
  return new Promise((resolve, reject) => {
    const srv = createServer((sock) => onConnection(sock))
    srv.once('error', reject)
    srv.listen(port, '127.0.0.1', () => {
      srv.off('error', reject)
      resolve({ close: () => new Promise<void>((r) => srv.close(() => r())) })
    })
  })
}

/** `wsl.exe` hasta el final; sin stdin (se cierra al instante). */
export function realRun(spec: WslSpawnSpec, ms: number): Promise<RunResult> {
  const child = start(spec)
  child.stdin?.end()
  return collect(child, ms)
}

/** `wsl.exe` con `input` por stdin (carga LZPK1, tar de datos). Un EPIPE (el instalador salió antes) no tumba la app. */
export function realRunWithInput(spec: WslSpawnSpec, input: Readable, ms: number): Promise<RunResult> {
  const child = start(spec)
  child.stdin?.on('error', () => undefined)
  input.on('error', () => child.kill('SIGKILL'))
  if (child.stdin) input.pipe(child.stdin)
  return collect(child, ms)
}

/** `wsl.exe` con el stdout escrito a `dest` (p. ej. `--export-home`); no se acumula en memoria. */
export function realRunToFile(spec: WslSpawnSpec, dest: string, ms: number): Promise<RunResult> {
  const child = start(spec)
  child.stdin?.end()
  const file = createWriteStream(dest, { flags: 'w', mode: 0o600 })
  return collect(child, ms, file)
}

export const realSetupFs: WslSetupFs = {
  mkdir: async (p) => void (await mkdir(p, { recursive: true })),
  lstat: async (p) => {
    try {
      return await lstat(p)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
  },
  readdir: (p) => readdir(p),
  rename: (a, b) => rename(a, b),
  rm: (p) => rm(p, { force: true }),
  rmdir: (p) => rmdir(p),
  freeBytes: async (p) => {
    // Sube hasta la raíz de la unidad si la carpeta aún no existe.
    const st = statfsSync(parse(p).root || p)
    return Number(st.bavail) * Number(st.bsize)
  },
  sha256: (p) => sha256File(p),
  readFile: (p) => readFile(p),
  writeFile: (p, data) => writeFile(p, data, { mode: 0o600 }),
  readStream: (p) => createReadStream(p),
  copyFile: (a, b) => copyFile(a, b)
}

/** Los `.py` de la carga, de `<dir>` (`resources/wsl` en desarrollo, `<resources>/wsl` empaquetado). */
export const PAYLOAD_PY_NAMES = ['launcher.py', 'landlock.py', 'mux.py', 'protocol.py'] as const
export async function readPayloadPyFiles(dir: string): Promise<LzpkInputFile[]> {
  return Promise.all(PAYLOAD_PY_NAMES.map(async (name) => ({ path: name, data: await readFile(join(dir, name)) })))
}

/** Lee `pin.json` (raíz de confianza, dentro de la app) y lo valida. */
export async function readSetupPin(pinJsonPath: string): Promise<SetupPin | null> {
  try {
    return parseSetupPin(JSON.parse(await readFile(pinJsonPath, 'utf8')))
  } catch {
    return null
  }
}

export interface RealSetupOptions {
  /** `createManualFetch(net)` en producción. */
  fetch: FetchLike
  /** `%LOCALAPPDATA%`. */
  localAppData: string | undefined
  pin: SetupPin | null
  payloadDir: string
  /** Archivos de imagen/opencode incluidos en el instalador (`<resources>/wsl/images`); sin esto se descarga. */
  localSource?: (kind: 'rootfs' | 'opencode') => string | null
  log?: (msg: string) => void
}

/** `WslDeps.setup` con todo real. */
export function createRealSetupExtras(o: RealSetupOptions): NonNullable<WslDeps['setup']> {
  const extras: WslSetupExtras = {
    runWithInput: realRunWithInput,
    runToFile: realRunToFile,
    download: (url, dest, opts) => pinnedDownload(url, dest, { ...opts, fetch: o.fetch }),
    fs: realSetupFs,
    localSource: o.localSource,
    localAppData: o.localAppData,
    pin: () => o.pin,
    payloadFiles: () => readPayloadPyFiles(o.payloadDir),
    now: () => Date.now(),
    log: o.log ?? (() => undefined)
  }
  return extras
}

export interface RealWslDepsOptions extends RealSetupOptions {
  hostEnv: Record<string, string | undefined>
  policyDisabled?: () => boolean
}

/** `WslDeps` completas con todo real (producción en Windows; solo las construye `win-provider.ts`). */
export function createRealWslDeps(o: RealWslDepsOptions): WslDeps {
  return {
    platform: 'win32',
    hostEnv: o.hostEnv,
    spawn: realSpawn,
    run: realRun,
    connect: realConnect,
    listen: realListen,
    policyDisabled: o.policyDisabled,
    setup: createRealSetupExtras(o)
  }
}
