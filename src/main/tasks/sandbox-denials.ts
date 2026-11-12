/** Idea clase A: observar negaciones etiquetadas (sandbox-runtime) y clasificarlas (Codex).
 * Implementación propia. Ningún texto del registro sale de este módulo ni se escribe en disco.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import type { SandboxDenial, SandboxDenialKind } from '@shared/ipc-tasks'
import { requestsRead, type ReadIntent, type ReadIntentSource } from './sandbox-read-intents'

export const MAX_SANDBOX_DENIALS = 50
const MAX_RECORD = 32_768
const READ_EVIDENCE_WAIT_MS = 2_000
const DENIAL = /Sandbox:\s+[^\n]+?\(\d+\)\s+deny(?:\(\d+\))?\s+([a-z][a-z0-9*-]+)(?:[ \t]+([^\r\n]*))?/

export interface DenialContext {
  folder: string
  allowDelete?: boolean
  extraFolders?: Array<{ path: string; mode: 'ro' | 'rw' }>
}

/** No inferimos bloqueos de un EPERM: solo de un registro Seatbelt con nuestra etiqueta exacta. */
export function classifySandboxDenial(message: string, tag: string, context: DenialContext, at = Date.now()): SandboxDenial | null {
  if (!/^lzx-denial-[a-f0-9]{32}$/.test(tag)) return null
  // El mensaje del perfil es una línea separada al final; una etiqueta dentro de una ruta no cuenta.
  if (!message.trimEnd().endsWith('\n' + tag)) return null
  const hit = DENIAL.exec(message)
  if (!hit) return null
  const [, operation, raw = ''] = hit
  // En algunas versiones la etiqueta va al final; no conservarla como parte de la ruta.
  const path = raw.replace(new RegExp(`\\s*${tag}.*$`), '').trim()
  let kind: SandboxDenialKind = 'other'
  if (operation.startsWith('file-write') && /\/\.git\/hooks(?:\/|$)/.test(path)) kind = 'git-hooks'
  else if (operation === 'file-write-unlink') kind = 'delete'
  else if (operation.startsWith('file-write')) kind = 'write'
  else if (operation.startsWith('file-read')) kind = 'read'
  else if (operation.startsWith('network')) kind = 'network'
  const inside = (p: string, dir: string): boolean => p === dir || p.startsWith(dir + '/')
  const canAllowDelete =
    kind === 'delete' &&
    !context.allowDelete &&
    path.startsWith(context.folder + '/') &&
    !inside(path, context.folder + '/.lazunox') &&
    !(context.extraFolders ?? []).some((e) => inside(path, e.path))
  return { kind, at, canAllowDelete }
}

export type SandboxLogReader = (tag: string) => ChildProcess

/** No shell, no lectura retrospectiva, predicado por lanzamiento. stderr se drena sin guardarlo. */
export const readSandboxLog: SandboxLogReader = (tag) => {
  if (!/^lzx-denial-[a-f0-9]{32}$/.test(tag)) throw new Error('Invalid sandbox denial tag')
  return spawn('/usr/bin/log', ['stream', '--style', 'ndjson', '--predicate', `eventMessage ENDSWITH "${tag}"`], {
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

export class SandboxDenialMonitor {
  private child?: ChildProcess
  private killTimer?: ReturnType<typeof setTimeout>
  private events: SandboxDenial[] = []
  private running = false
  private closing?: Promise<void>
  private finishStop?: () => void
  private readController?: AbortController
  private readIntents: ReadIntent[] = []
  private pendingReads: Array<{ event: SandboxDenial; path: string; expires: number }> = []
  private readTimer?: ReturnType<typeof setTimeout>
  private intentTimer?: ReturnType<typeof setTimeout>

  constructor(
    private readonly tag: string,
    private readonly folder: string,
    private readonly onChange: (events: SandboxDenial[]) => void,
    private readonly reader: SandboxLogReader = readSandboxLog,
    private readonly context: Omit<DenialContext, 'folder'> = {},
    private readonly onUnavailable: () => void = () => {},
    private readonly readSource?: ReadIntentSource
  ) {
    if (!/^lzx-denial-[a-f0-9]{32}$/.test(tag)) throw new Error('Invalid sandbox denial tag')
  }

  start(): void {
    this.running = true
    if (this.child) return
    let child: ChildProcess
    try {
      child = this.reader(this.tag)
    } catch {
      this.running = false
      this.onUnavailable()
      return
    }
    this.child = child
    const ctl = new AbortController()
    this.readController = ctl
    void this.readSource?.((intent) => {
      if (!this.running || ctl.signal.aborted) return
      this.readIntents = [...this.readIntents.filter((i) => i.id !== intent.id).slice(-49), intent]
      this.pruneIntents()
      this.flushReads()
    }, ctl.signal).catch(() => undefined)
    const decoder = new StringDecoder('utf8')
    let pending = ''
    let dropping = false
    child.stdout?.on('data', (chunk: Buffer) => {
      if (!this.running || this.child !== child) return
      for (const part of decoder.write(chunk).split(/(?<=\n)/)) {
        if (!dropping) pending += part
        if (pending.length > MAX_RECORD) {
          pending = ''
          dropping = true
        }
        if (!part.endsWith('\n')) continue
        if (!dropping) this.record(pending)
        pending = ''
        dropping = false
      }
    })
    child.stderr?.resume()
    // Un error de lectura no equivale a ausencia de negaciones. No sustituirlo por heurísticas de stderr del comando.
    child.once('error', () => {
      this.onUnavailable()
      void this.stop()
    })
    child.once('close', () => {
      if (this.child !== child) return
      if (this.running && !this.closing) this.onUnavailable()
      const restart = this.running && !!this.closing
      clearTimeout(this.killTimer)
      this.killTimer = undefined
      this.child = undefined
      this.clearReads()
      pending = ''
      const finish = this.finishStop
      this.closing = undefined
      this.finishStop = undefined
      finish?.()
      if (restart) this.start()
      else this.running = false
    })
  }

  private record(line: string): void {
    let record: { eventMessage?: unknown; processID?: unknown; processImagePath?: unknown; timestamp?: unknown }
    try {
      record = JSON.parse(line)
    } catch {
      return
    }
    if (!record || typeof record !== 'object') return
    // Solo kernel/sandboxd: un proceso de la tarea no puede fabricar este origen con logger.
    if (record.processID !== 0 && record.processImagePath !== '/usr/libexec/sandboxd') return
    const message = record.eventMessage
    if (typeof message !== 'string') return
    const timestamp = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : NaN
    const event = classifySandboxDenial(
      message,
      this.tag,
      { folder: this.folder, ...this.context },
      Number.isFinite(timestamp) ? timestamp : Date.now()
    )
    if (!event) return
    if (event.kind === 'read') {
      // La etiqueta identifica el servidor, no la causa. Sus sondas de arranque y las de git/Python
      // también la heredan: exigir que el modelo haya pasado ESTA ruta a una herramienta.
      const path = DENIAL.exec(message)?.[2]?.trim() ?? ''
      this.pendingReads = [...this.pendingReads.slice(-49), { event, path, expires: Date.now() + READ_EVIDENCE_WAIT_MS }]
      this.flushReads()
      return
    }
    this.publish(event)
  }

  private publish(event: SandboxDenial): void {
    this.events = [...this.events.slice(-(MAX_SANDBOX_DENIALS - 1)), event]
    this.onChange(this.events.map((e) => ({ ...e })))
  }

  private flushReads(): void {
    clearTimeout(this.readTimer)
    const pending = this.pendingReads
    this.pendingReads = []
    for (const read of pending) {
      if (this.readIntents.some((intent) => requestsRead(intent, read.path, this.folder, read.event.at))) this.publish(read.event)
      else if (read.expires > Date.now()) this.pendingReads.push(read)
    }
    if (this.pendingReads.length) this.readTimer = setTimeout(() => this.flushReads(), READ_EVIDENCE_WAIT_MS)
  }

  private clearReads(): void {
    this.readController?.abort()
    this.readController = undefined
    clearTimeout(this.readTimer)
    clearTimeout(this.intentTimer)
    this.readIntents = []
    this.pendingReads = []
  }

  private pruneIntents(): void {
    clearTimeout(this.intentTimer)
    this.readIntents = this.readIntents.filter((i) => i.end + 30_000 > Date.now())
    if (this.readIntents.length) {
      const next = Math.min(...this.readIntents.map((i) => i.end + 30_000)) - Date.now()
      this.intentTimer = setTimeout(() => this.pruneIntents(), Math.max(1, next))
    }
  }

  /** process.on('exit') no espera promesas; mata únicamente nuestro lector, sin buscar procesos ajenos. */
  killSync(): void {
    this.running = false
    this.events = []
    this.clearReads()
    clearTimeout(this.killTimer)
    this.killTimer = undefined
    this.child?.kill('SIGKILL')
  }

  stop(): Promise<void> {
    this.running = false
    this.events = []
    this.clearReads()
    if (this.closing) return this.closing
    const child = this.child
    if (!child) return Promise.resolve()
    const closing = new Promise<void>((resolve) => {
      this.finishStop = resolve
    })
    this.closing = closing
    // Timer referenciado: main espera close antes de dar por terminada la limpieza.
    this.killTimer = setTimeout(() => child.kill('SIGKILL'), 1000)
    child.kill('SIGTERM')
    return closing
  }
}
