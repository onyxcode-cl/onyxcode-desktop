/**
 * Backend WSL de Tareas en Windows (F8-B81, fase 1). NO SE ACTIVA EN PRODUCCIÓN: `backends/index.ts` no lo importa y
 * `capsFor('win32').tasks` sigue en `false` mientras la bandera `tasksWin` esté apagada. Todo lo que toca el sistema
 * (`spawn` de wsl.exe, sockets) entra por `WslDeps`, así que se prueba entero con dobles en el Mac.
 *
 * Pendiente en el PC Windows (docs/WINDOWS-TAREAS.md): `setup()` (importar la distro desde un rootfs fijado por sha256),
 * instalar `resources/wsl/*` en `/opt/lazunox`, y la batería de ataques A1-A15.
 */
import { EventEmitter } from 'node:events'
import { win32 } from 'node:path'
import { PassThrough, type Duplex, type Readable, type Writable } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { WslBridgeHost, type BridgeListener } from './wsl-bridge-host'
import { classifyWslStatus, type RunResult } from './wsl-status'
import { buildWslInit, buildWslSpawn, type WslCommand, type WslSpawnSpec } from './wsl-spec'
import { fromSandboxPath, toSandboxPath } from './wsl-paths'
import type { LaunchedSandbox, SandboxBackend, SandboxLaunchSpec } from './types'

/** Lo mínimo que se usa de un `ChildProcess` de wsl.exe (el `spawn` real lo cumple; los dobles también). */
export interface WslProcess extends EventEmitter {
  stdin: Writable
  stdout: Readable
  stderr: Readable
  pid?: number
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  kill(signal?: NodeJS.Signals | number): boolean
}

export interface WslDeps {
  platform: string
  hostEnv: Record<string, string | undefined>
  spawn(spec: WslSpawnSpec): WslProcess
  /** Ejecuta un comando de wsl.exe hasta el final (con tiempo límite) y devuelve su salida cruda. */
  run(spec: WslSpawnSpec, timeoutMs: number): Promise<RunResult>
  connect(port: number): Promise<Duplex>
  listen(port: number, onConnection: (socket: Duplex) => void): Promise<BridgeListener>
  policyDisabled?: () => boolean
  onReject?: (info: { port: number; streamId: number }) => void
}

const STATUS_TIMEOUT_MS = 20_000
const KILL_GRACE_MS = 2_000

export function createWslBackend(deps: WslDeps): SandboxBackend {
  const run = (cmd: WslCommand, ms = STATUS_TIMEOUT_MS): Promise<RunResult> => deps.run(buildWslSpawn(cmd, deps.hostEnv), ms)
  return {
    id: 'wsl',
    async status() {
      if (deps.platform !== 'win32') return { state: 'unsupported' }
      if (deps.policyDisabled?.()) return { state: 'policyDisabled' }
      const version = await run({ kind: 'version' })
      const list = await run({ kind: 'list' })
      // El probe arranca la distro: solo si ya existe (y nunca si wsl.exe no está).
      let probe: RunResult | null = null
      const pre = classifyWslStatus({ version, list })
      if (pre.state === 'broken' && pre.detail === 'probe') probe = await run({ kind: 'probe' })
      return classifyWslStatus({ version, list, probe })
    },
    async launch(spec: SandboxLaunchSpec): Promise<LaunchedSandbox> {
      if (!spec.isolation) throw new Error('falta el directorio privado del sandbox')
      const sandboxKey = win32.basename(spec.isolation.privateDir)
      const env = { ...spec.baseEnv, ...spec.proxyEnv, ...spec.extraEnv }
      const { frame, mounts } = buildWslInit({
        folder: spec.folder,
        extraFolders: (spec.extraFolders ?? []).map((e) => ({ path: e.path, mode: e.mode })),
        configDir: spec.configDir,
        allowDelete: spec.allowDelete,
        sandboxKey,
        serverPort: spec.serverPort,
        serveArgs: spec.serveArgs,
        env,
        relayPorts: spec.outboundPorts
      })
      const proc = deps.spawn(buildWslSpawn({ kind: 'launch' }, deps.hostEnv))
      const bridge = new WslBridgeHost({
        input: proc.stdout,
        output: proc.stdin,
        initFrame: frame,
        allowedPorts: spec.outboundPorts,
        serverPort: spec.serverPort,
        connect: deps.connect,
        listen: deps.listen,
        onReject: deps.onReject
      })

      // `child` que ve sandbox.ts: stderr = el del servidor (vía wsl.exe), stdout vacío (en wsl.exe viaja el puente).
      const facade = new EventEmitter() as EventEmitter & {
        pid?: number
        exitCode: number | null
        signalCode: NodeJS.Signals | null
        stdout: PassThrough
        stderr: Readable
        kill(s?: NodeJS.Signals | number): boolean
      }
      facade.pid = proc.pid
      facade.exitCode = null
      facade.signalCode = null
      facade.stdout = new PassThrough()
      facade.stderr = proc.stderr
      let killTimer: NodeJS.Timeout | undefined
      facade.kill = (sig) => {
        void bridge.close() // EOF al lanzador: mata su espacio de nombres
        killTimer ??= setTimeout(() => proc.kill('SIGKILL'), KILL_GRACE_MS)
        killTimer.unref?.()
        return proc.kill(typeof sig === 'string' ? sig : 'SIGTERM')
      }
      proc.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
        if (killTimer) clearTimeout(killTimer)
        void bridge.close()
        facade.exitCode = code ?? (signal ? null : 0)
        facade.signalCode = signal
        facade.emit('exit', code, signal)
      })
      proc.on('error', (e: Error) => facade.emit('error', e))

      try {
        await bridge.start()
      } catch (e) {
        proc.kill('SIGKILL')
        throw e
      }

      return {
        child: facade as unknown as ChildProcess,
        toHostPath: (p) => {
          const r = fromSandboxPath(p, mounts)
          return r.ok ? r.path : null
        },
        toSandboxPath: (p) => {
          const r = toSandboxPath(p)
          if (!r.ok) throw new Error(`ruta no traducible a la distro (${r.reason})`)
          return r.path
        },
        dispose: async () => {
          await bridge.close()
        }
      }
    }
  }
}
