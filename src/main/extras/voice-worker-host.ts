/**
 * Anfitrión del proceso de dictado por voz (`voice-worker.ts`): lo arranca como `utilityProcess` la
 * primera vez que hace falta transcribir algo (no al abrir la app — no tiene sentido pagar el costo
 * de arrancar Node + cargar el modelo si nunca se usa la voz), y lo vuelve a arrancar solo si murió,
 * la PRÓXIMA vez que se pida transcribir (no hay un bucle de reintento de fondo: a diferencia del MCP
 * de Control del Mac, que tiene que seguir disponible todo el tiempo, acá alcanza con "la próxima vez
 * que se use, se levanta de nuevo").
 */
import { app, utilityProcess, type UtilityProcess } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { unpacked } from '../util/asar'
import type { VoiceModelProgress } from './voice-transcribe'

const READY_TIMEOUT_MS = 15_000

/** Carpeta donde `voice-transcribe.ts` cachea los archivos del modelo entre arranques — dentro de
 * `userData`, igual criterio que el resto de la app (nunca en una carpeta propia fuera del control de
 * la app). */
function voiceModelDir(): string {
  return join(app.getPath('userData'), 'models', 'voice')
}

/** Ruta de `voice-worker.js` (junto a `out/main/index.js`) — mismo patrón que `ComputerService.mcpScriptPath()`. */
export function voiceWorkerScriptPath(): string | null {
  const candidates = [
    unpacked(join(app.getAppPath(), 'out', 'main', 'voice-worker.js')),
    join(app.getAppPath(), 'out', 'main', 'voice-worker.js'),
    join(__dirname, 'voice-worker.js')
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

interface WorkerMessage {
  type?: string
  id?: number
  text?: string
  message?: string
  status?: string
  progress?: number
}

export class VoiceWorkerHost {
  private proc: UtilityProcess | null = null
  private starting: Promise<void> | null = null
  private disposed = false
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (text: string) => void; reject: (err: Error) => void }>()
  private onProgress: ((p: VoiceModelProgress) => void) | null = null

  constructor(private readonly scriptPath: () => string | null) {}

  /** Un solo oyente de progreso (igual que `onVoiceModelProgress` del lado puro) — `extras-handlers.ts` lo conecta a `broadcastExtras`. */
  setProgressListener(fn: ((p: VoiceModelProgress) => void) | null): void {
    this.onProgress = fn
  }

  private ensure(): Promise<void> {
    if (this.proc) return Promise.resolve()
    this.starting ??= this.launch().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async launch(): Promise<void> {
    const script = this.scriptPath()
    if (!script) throw new Error('Falta voice-worker.js (ejecuta `npm run build`).')
    const proc = utilityProcess.fork(script, [], {
      serviceName: 'Lazunox dictado por voz',
      stdio: 'pipe',
      env: { ...process.env, LAZUNOX_VOICE_MODEL_DIR: voiceModelDir() }
    })
    this.proc = proc
    proc.stdout?.on('data', (d: Buffer) => process.stdout.write(`[voice] ${d.toString()}`))
    proc.stderr?.on('data', (d: Buffer) => process.stderr.write(`[voice] ${d.toString()}`))

    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('El dictado por voz no arrancó a tiempo')), READY_TIMEOUT_MS)
      proc.on('message', (msg: WorkerMessage) => this.onMessage(msg, resolve, timer))
      proc.once('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`El proceso de dictado terminó al arrancar (code=${code})`))
      })
    })
    proc.once('exit', (code) => this.onExit(proc, code))
    try {
      await ready
    } catch (err) {
      if (this.proc === proc) this.proc = null
      proc.kill()
      throw err
    }
  }

  private onMessage(msg: WorkerMessage, resolveReady: () => void, readyTimer: NodeJS.Timeout): void {
    if (msg?.type === 'ready') {
      clearTimeout(readyTimer)
      resolveReady()
      return
    }
    if (msg?.type === 'progress') {
      this.onProgress?.({ status: msg.status === 'ready' ? 'ready' : 'downloading', progress: msg.progress ?? 0 })
      return
    }
    if (typeof msg?.id !== 'number') return
    const entry = this.pending.get(msg.id)
    if (!entry) return
    this.pending.delete(msg.id)
    if (msg.type === 'result') entry.resolve(msg.text ?? '')
    else if (msg.type === 'error') entry.reject(new Error(msg.message ?? 'Error de transcripción'))
  }

  /** El proceso murió (un crash nativo real fue justamente el motivo de aislar esto — F8-B144). Lo
   * que haya quedado pendiente falla con un mensaje claro en vez de colgarse para siempre; la
   * PRÓXIMA llamada a `transcribe()` lo vuelve a levantar solo. */
  private onExit(proc: UtilityProcess, code: number): void {
    if (this.proc !== proc) return
    this.proc = null
    for (const { reject } of this.pending.values()) {
      reject(new Error(`El proceso de dictado se cerró inesperadamente (code=${code}). Probá de nuevo.`))
    }
    this.pending.clear()
  }

  async transcribe(samples: Float32Array): Promise<string> {
    if (this.disposed) throw new Error('App cerrándose')
    await this.ensure()
    const proc = this.proc
    if (!proc) throw new Error('No se pudo iniciar el proceso de dictado')
    const id = this.nextId++
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      proc.postMessage({ type: 'transcribe', id, samples })
    })
  }

  dispose(): void {
    this.disposed = true
    const proc = this.proc
    this.proc = null
    for (const { reject } of this.pending.values()) reject(new Error('App cerrándose'))
    this.pending.clear()
    if (proc) proc.kill()
  }
}
