/**
 * Motor falso para las pruebas de «Comparar modelos»: sin red, sin modelos. Cada modelo tiene un guion
 * (escribir un archivo, fallar por cuota, tardar…). Registra las llamadas y la concurrencia máxima.
 */
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { CompareEngine, EngineMessage, EngineStatus } from './engine'

export interface FakeScript {
  /** Archivos que "escribe" el modelo en la carpeta de la sesión. */
  write?: Record<string, string>
  /** Enlaces simbólicos que crea (nombre -> destino). */
  symlinks?: Record<string, string>
  /** Cuántas veces responde con un error de cuota antes de acertar (Infinity = siempre). */
  quotaFailures?: number
  /** Duración del trabajo. */
  delayMs?: number
  cost?: number
  tokens?: { input: number; output: number }
  /** No responde a `abort` (se queda ocupada). */
  ignoreAbort?: boolean
  /** Error no recuperable. */
  fail?: { name: string; message: string }
  /** El estado `retry` del motor, en bucle, con este mensaje (para abortar la columna). */
  engineRetry?: { message: string; attempt: number }
}

interface Sess {
  id: string
  directory: string
  modelID: string
  busy: boolean
  retry: { message: string; attempt: number } | null
  messages: EngineMessage[]
  attempts: number
  gen: number
}

export class FakeEngine implements CompareEngine {
  sessions = new Map<string, Sess>()
  calls: { fn: string; args: unknown }[] = []
  startTimes: number[] = []
  maxBusyByProvider = new Map<string, number>()
  private n = 0
  private providerOf = new Map<string, string>()

  constructor(
    public scripts: Record<string, FakeScript>,
    private readonly nowFn: () => number = Date.now
  ) {}

  private rec(fn: string, args: unknown): void {
    this.calls.push({ fn, args })
  }

  count(fn: string): number {
    return this.calls.filter((c) => c.fn === fn).length
  }

  async createSession(a: { directory: string; title: string; agent: string; metadata: Record<string, unknown>; permission?: unknown }): Promise<string> {
    this.rec('createSession', a)
    const id = `ses_${++this.n}`
    this.sessions.set(id, { id, directory: a.directory, modelID: '', busy: false, retry: null, messages: [], attempts: 0, gen: 0 })
    return id
  }

  async prompt(a: { sessionID: string; directory: string; agent: string; model: { providerID: string; modelID: string }; variant?: string; text: string }): Promise<void> {
    this.rec('prompt', a)
    const s = this.sessions.get(a.sessionID)
    if (!s) throw new Error('no session')
    s.modelID = a.model.modelID
    this.providerOf.set(s.id, a.model.providerID)
    this.startTimes.push(this.nowFn())
    s.busy = true
    const gen = ++s.gen
    const script = this.scripts[a.model.modelID] ?? {}
    const prov = a.model.providerID
    const busyNow = [...this.sessions.values()].filter((x) => x.busy && this.providerOf.get(x.id) === prov).length
    this.maxBusyByProvider.set(prov, Math.max(this.maxBusyByProvider.get(prov) ?? 0, busyNow))
    if (script.engineRetry) {
      s.retry = script.engineRetry
      return
    }
    const finish = (): void => {
      if (s.gen !== gen || !s.busy) return
      const created = this.nowFn()
      s.attempts++
      const base = { id: `m${s.messages.length}`, role: 'assistant', time: { created, completed: created + 5 } }
      const info: EngineMessage['info'] = { ...base, cost: script.cost ?? 0, tokens: { input: script.tokens?.input ?? 0, output: script.tokens?.output ?? 0, reasoning: 0, cache: { read: 0, write: 0 } } }
      if (script.fail) (info as { error?: unknown }).error = { name: script.fail.name, data: { message: script.fail.message } }
      else if (s.attempts <= (script.quotaFailures ?? 0)) (info as { error?: unknown }).error = { name: 'APIError', data: { message: 'token rate limit exceeded', statusCode: 429, isRetryable: true } }
      else for (const [f, c] of Object.entries(script.write ?? {})) {
        mkdirSync(dirname(join(s.directory, f)), { recursive: true })
        writeFileSync(join(s.directory, f), c.startsWith('base64:') ? Buffer.from(c.slice(7), 'base64') : c)
      }
      if (!(info as { error?: unknown }).error) for (const [n, target] of Object.entries(script.symlinks ?? {})) symlinkSync(target, join(s.directory, n))
      s.messages.push({ info })
      s.busy = false
    }
    setTimeout(finish, script.delayMs ?? 5)
  }

  async abort(a: { sessionID: string; directory: string }): Promise<void> {
    this.rec('abort', a)
    const s = this.sessions.get(a.sessionID)
    if (!s) return
    if (this.scripts[s.modelID]?.ignoreAbort) return
    s.gen++
    s.busy = false
    s.retry = null
  }

  async statuses(directory: string): Promise<Record<string, EngineStatus>> {
    const out: Record<string, EngineStatus> = {}
    for (const s of this.sessions.values()) {
      if (s.directory !== directory) continue
      if (s.retry && s.busy) out[s.id] = { type: 'retry', attempt: s.retry.attempt, message: s.retry.message }
      else if (s.busy) out[s.id] = { type: 'busy' }
    }
    return out
  }

  async messages(a: { sessionID: string; directory: string }): Promise<EngineMessage[]> {
    return [...(this.sessions.get(a.sessionID)?.messages ?? [])]
  }

  async children(): Promise<string[]> {
    return []
  }

  async deleteSession(a: { sessionID: string; directory: string }): Promise<void> {
    this.rec('deleteSession', a)
    this.sessions.delete(a.sessionID)
  }

  async disposeInstance(directory: string): Promise<void> {
    this.rec('disposeInstance', directory)
  }
}
