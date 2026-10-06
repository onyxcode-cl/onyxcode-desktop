/**
 * Estado e instalación del entorno aislado de Tareas para la interfaz (`tasks:sandbox:*`). Sin Electron: el backend, el
 * reloj y la emisión de eventos entran inyectados.
 *
 *  - macOS: `ready` si existe `sandbox-exec`; si no, `unsupported`.
 *  - Windows con `tasksWin`: pregunta a la distro (`status()`, con caché de 5 s porque el sondeo la arranca). Si
 *    `selectBackend` cierra (bandera, compilación, informe, pin), el estado es `unsupported` con el motivo en `detail`:
 *    «esta versión aún no ofrece Tareas en Windows». Nunca se inventa un `ready`.
 *  - `setup()` solo corre si hace falta (`needsSetup`, o `broken` por la carga) y una vez a la vez; el error sale como CÓDIGO
 *    (`offline`, `no-space`…), no como texto técnico.
 */
import type { TasksSandboxSetup, TasksSandboxStatus } from '@shared/ipc-tasks'
import { WinBackendUnavailable } from './backends'
import type { SandboxBackend, SandboxSetupKind } from './backends/types'

export interface SandboxServiceDeps {
  platform: string
  /** macOS: ¿existe `sandbox-exec`? */
  seatbeltReady?: () => boolean
  /** Windows: el backend ya elegido (o lanza `WinBackendUnavailable`). Solo se llama con `tasksWin`. */
  getBackend?: () => Promise<SandboxBackend>
  tasksWin?: boolean
  emit: (s: TasksSandboxStatus) => void
  now?: () => number
}

export const SANDBOX_STATUS_TTL_MS = 5_000

/** Fase de instalación que `wsl-setup` informa y que la interfaz traduce; el resto se muestra genérico. */
function errorCode(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code
  return typeof code === 'string' && /^[a-z0-9-]{1,40}$/.test(code) ? code : 'unknown'
}

export class TasksSandboxService {
  private cached: { at: number; base: Omit<TasksSandboxStatus, 'setup'> } | null = null
  private setupState: TasksSandboxSetup | null = null
  private running: { promise: Promise<void>; abort: AbortController } | null = null
  private inflight: Promise<Omit<TasksSandboxStatus, 'setup'>> | null = null
  private backendP: Promise<SandboxBackend> | null = null

  constructor(private readonly deps: SandboxServiceDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  private async backend(): Promise<SandboxBackend> {
    if (!this.deps.getBackend) throw new WinBackendUnavailable('provider')
    // Solo se recuerda el éxito: si hoy cierra, mañana (otro informe, otro pin) puede abrir.
    this.backendP ??= this.deps.getBackend().catch((e: unknown) => {
      this.backendP = null
      throw e
    })
    return this.backendP
  }

  private async compute(): Promise<Omit<TasksSandboxStatus, 'setup'>> {
    const { platform } = this.deps
    if (platform === 'darwin') {
      return this.deps.seatbeltReady?.() ? { backend: 'seatbelt', state: 'ready' } : { backend: 'none', state: 'unsupported' }
    }
    if (platform !== 'win32') return { backend: 'none', state: 'unsupported' }
    if (this.deps.tasksWin !== true) return { backend: 'wsl', state: 'unsupported', detail: 'flag' }
    try {
      const st = await (await this.backend()).status()
      return { backend: 'wsl', state: st.state, ...(st.detail ? { detail: st.detail } : {}) }
    } catch (e) {
      if (e instanceof WinBackendUnavailable) return { backend: 'wsl', state: 'unsupported', detail: e.block }
      // Cualquier otro fallo al preguntar: no se sabe → roto (cierra), con un detalle genérico.
      return { backend: 'wsl', state: 'broken', detail: 'status' }
    }
  }

  async status(opts: { force?: boolean } = {}): Promise<TasksSandboxStatus> {
    const fresh = !opts.force && this.cached && this.now() - this.cached.at < SANDBOX_STATUS_TTL_MS
    if (!fresh) {
      this.inflight ??= this.compute().finally(() => {
        this.inflight = null
      })
      this.cached = { at: this.now(), base: await this.inflight }
    }
    return { ...this.cached!.base, setup: this.setupState ? { ...this.setupState } : null }
  }

  private async publish(force = false): Promise<TasksSandboxStatus> {
    const s = await this.status({ force })
    this.deps.emit(s)
    return s
  }

  /** Instala o repara. Devuelve el estado al empezar; el avance y el final salen por `emit`. */
  async setup(): Promise<TasksSandboxStatus> {
    if (this.running) return this.status()
    const before = await this.status({ force: true })
    if (before.backend !== 'wsl') return before
    const needs = before.state === 'needsSetup' || (before.state === 'broken' && before.detail === 'payload')
    if (!needs) return before
    const backend = await this.backend() // ya resuelto por status(); si cerrara, `before.state` no sería `needsSetup`
    if (!backend.setup) return before
    const kind: SandboxSetupKind = before.state === 'broken' ? 'repair' : before.detail?.startsWith('update:') ? 'update' : 'install'
    const abort = new AbortController()
    this.setupState = { running: true, pct: 0, phase: 'start' }
    const run = (async () => {
      try {
        await backend.setup!(
          (pct, phase) => {
            this.setupState = { running: true, pct: Math.max(0, Math.min(100, Math.round(pct))), phase }
            void this.deps.emit({ ...(this.cached?.base ?? before), setup: { ...this.setupState } })
          },
          { signal: abort.signal, kind }
        )
        this.setupState = null
      } catch (e) {
        this.setupState = abort.signal.aborted ? null : { running: false, pct: 0, phase: '', error: errorCode(e) }
      } finally {
        // `running` se libera DESPUÉS de publicar el estado final: `idle()` espera hasta que el evento salió.
        await this.publish(true).catch(() => undefined)
        this.running = null
      }
    })()
    this.running = { promise: run, abort }
    return { ...before, setup: { ...this.setupState } }
  }

  /** Cancela la instalación. Si no hay ninguna, no hace nada. */
  async cancel(): Promise<TasksSandboxStatus> {
    this.running?.abort.abort()
    return this.status()
  }

  /** Espera a que acabe lo que haya en marcha (cierre y pruebas). */
  async idle(): Promise<void> {
    await this.running?.promise
  }
}
