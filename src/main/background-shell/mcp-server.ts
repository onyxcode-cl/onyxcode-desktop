/**
 * Servidor MCP mínimo (JSON-RPC 2.0 delimitado por saltos de línea sobre stdio) con las herramientas de `shell_bg`.
 * No usa el SDK de MCP (no está en node_modules y no se añaden dependencias): implementa solo lo necesario —
 * `initialize`, `ping`, `tools/list`, `tools/call`, `logging/setLevel` y notificaciones — que es lo que un cliente de
 * herramientas usa.
 *
 * Los avisos (fin, posible atasco) salen como `notifications/message` (logging de MCP) y además se entregan a
 * `onEvent` para que quien integre los convierta en un mensaje que despierte al modelo.
 */
import type { BackgroundShellManager } from './manager'
import { ShellBgError, type ShellBgEvent } from './types'

export const SERVER_NAME = 'shell_bg'
export const SERVER_VERSION = '0.1.0'
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']

interface Schema {
  type: 'object'
  properties: Record<string, PropSchema>
  required?: string[]
  additionalProperties: false
}
interface PropSchema {
  type: 'string' | 'integer' | 'number' | 'object' | 'array'
  description: string
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  maxItems?: number
  items?: { type: 'string'; maxLength?: number }
  additionalProperties?: { type: 'string' }
}

export interface ToolDef {
  name: string
  description: string
  inputSchema: Schema
}

const ID_PROP: PropSchema = {
  type: 'string',
  description: 'Job id returned by shell_bg_start (looks like "bg_1a2b3c4d").',
  minLength: 1,
  maxLength: 64
}

export const TOOLS: ToolDef[] = [
  {
    name: 'shell_bg_start',
    description:
      'Start a shell command in the background and return immediately with a job id. Use it for anything that can take more than ' +
      'a minute or two (builds, test suites, dev servers, installs, long scripts) instead of the normal shell tool, which has a ' +
      'time limit. The command runs in its own process group with a clean environment. There is NO fixed timeout: the job keeps ' +
      'running while it shows signs of life (new output, CPU use, watched files growing). If it shows none for a long time it is ' +
      'NOT killed; it is flagged "possibly-stuck" and you are told so you can decide with the user whether to keep waiting or ' +
      'stop it. IMPORTANT: do not wait with sleep or poll in a loop. You are notified automatically when the job exits ' +
      '(exit code, duration and last lines) or looks stuck, so continue with other useful work or end your turn. At most 8 jobs ' +
      'run at once; extra starts are rejected (nothing is killed).',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command line to run with /bin/sh -c.', minLength: 1, maxLength: 8192 },
        cwd: {
          type: 'string',
          description: 'Absolute path of the working directory (must exist). Defaults to the directory this tool was started in.',
          minLength: 1,
          maxLength: 4096
        },
        env: {
          type: 'object',
          description:
            'Optional extra environment variables (string values). Only a short allow-list of harmless names is accepted ' +
            '(NODE_ENV, CI, FORCE_COLOR, NO_COLOR, DEBUG, PORT, HOST, PYTHONUNBUFFERED, RUST_LOG, LOG_LEVEL, TZ, LANG, LC_ALL...). ' +
            'Never put secrets here; they are rejected.',
          additionalProperties: { type: 'string' }
        },
        quietMinutes: {
          type: 'integer',
          description:
            'Minutes without any sign of life before the job is flagged possibly-stuck (default 15). It is never killed for this.',
          minimum: 1,
          maximum: 720
        },
        maxMinutes: {
          type: 'integer',
          description: 'OPTIONAL hard limit in minutes after which the job is killed. Omit it unless the user asked for a limit.',
          minimum: 1,
          maximum: 10080
        },
        watchPaths: {
          type: 'array',
          description:
            'Optional absolute file paths whose growth counts as a sign of life (for example a log or output file the command writes).',
          maxItems: 16,
          items: { type: 'string', maxLength: 4096 }
        }
      },
      required: ['command'],
      additionalProperties: false
    }
  },
  {
    name: 'shell_bg_status',
    description:
      'Get the state of one background job: running, possibly-stuck, exited, stopped or killed-limit, with exit code, duration, ' +
      'seconds since the last sign of life, output size and the last few lines. Do NOT call this repeatedly to wait for a job: ' +
      'you are notified automatically when it finishes or looks stuck. Use it only when you need a one-off check.',
    inputSchema: { type: 'object', properties: { id: ID_PROP }, required: ['id'], additionalProperties: false }
  },
  {
    name: 'shell_bg_read',
    description:
      'Read the combined stdout+stderr of a job in small pieces. Pass fromByte (start at 0) and then use the returned nextByte ' +
      'for the next call; each call returns at most maxBytes (default 16 KiB, max 64 KiB), so read a little at a time and prefer ' +
      'the tail (totalBytes minus a few KiB) when you only care about the end. Very large output is trimmed to its beginning and ' +
      'end; the gap is reported as omittedBytes.',
    inputSchema: {
      type: 'object',
      properties: {
        id: ID_PROP,
        fromByte: { type: 'integer', description: 'Byte offset to start reading from (default 0).', minimum: 0 },
        maxBytes: { type: 'integer', description: 'Maximum bytes to return (default 16384, max 65536).', minimum: 1, maximum: 65536 }
      },
      required: ['id'],
      additionalProperties: false
    }
  },
  {
    name: 'shell_bg_stop',
    description:
      'Stop a background job and ALL the processes it started (SIGTERM, then SIGKILL after a short grace period). Use it when the ' +
      'job is no longer needed or was reported possibly-stuck and the user agreed to cut it. Returns the final status.',
    inputSchema: { type: 'object', properties: { id: ID_PROP }, required: ['id'], additionalProperties: false }
  },
  {
    name: 'shell_bg_list',
    description: 'List all known background jobs (running and recently finished) with their state. Takes no arguments.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  }
]

/** Valida `args` contra el subconjunto de JSON Schema que usan las herramientas. Devuelve el mensaje de error o `null`. */
export function validateArgs(schema: Schema, args: unknown): string | null {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return 'arguments must be an object.'
  const a = args as Record<string, unknown>
  for (const k of Object.keys(a)) if (!(k in schema.properties)) return `unexpected argument "${k}".`
  for (const k of schema.required ?? []) if (a[k] === undefined) return `missing required argument "${k}".`
  for (const [k, p] of Object.entries(schema.properties)) {
    const v = a[k]
    if (v === undefined) continue
    switch (p.type) {
      case 'string':
        if (typeof v !== 'string') return `"${k}" must be a string.`
        if (p.minLength !== undefined && v.length < p.minLength) return `"${k}" is too short.`
        if (p.maxLength !== undefined && v.length > p.maxLength) return `"${k}" is too long (max ${p.maxLength}).`
        break
      case 'integer':
      case 'number':
        if (typeof v !== 'number' || !Number.isFinite(v) || (p.type === 'integer' && !Number.isInteger(v))) {
          return `"${k}" must be ${p.type === 'integer' ? 'an integer' : 'a number'}.`
        }
        if (p.minimum !== undefined && v < p.minimum) return `"${k}" must be >= ${p.minimum}.`
        if (p.maximum !== undefined && v > p.maximum) return `"${k}" must be <= ${p.maximum}.`
        break
      case 'object':
        if (typeof v !== 'object' || v === null || Array.isArray(v)) return `"${k}" must be an object.`
        if (p.additionalProperties?.type === 'string') {
          for (const [ek, ev] of Object.entries(v)) if (typeof ev !== 'string') return `"${k}.${ek}" must be a string.`
        }
        break
      case 'array':
        if (!Array.isArray(v)) return `"${k}" must be an array.`
        if (p.maxItems !== undefined && v.length > p.maxItems) return `"${k}" has too many items (max ${p.maxItems}).`
        for (const it of v) {
          if (typeof it !== 'string') return `"${k}" items must be strings.`
          if (p.items?.maxLength !== undefined && it.length > p.items.maxLength) return `"${k}" has an item that is too long.`
        }
        break
    }
  }
  return null
}

/** Texto legible (en inglés, para el modelo) de un evento. */
export function formatEvent(e: ShellBgEvent): string {
  const secs = (ms: number): string => `${Math.round(ms / 1000)}s`
  const tail = (lines: string[]): string => (lines.length ? `\nLast lines:\n${lines.join('\n')}` : '')
  switch (e.type) {
    case 'exit': {
      const how =
        e.state === 'stopped'
          ? 'was stopped'
          : e.state === 'killed-limit'
            ? 'was killed because it reached its maximum run time'
            : e.signal
              ? `was terminated by signal ${e.signal}`
              : `exited with code ${e.exitCode}`
      return `Background job ${e.id} (${e.command.slice(0, 120)}) ${how} after ${secs(e.durationMs)}.${tail(e.lastLines)}`
    }
    case 'possibly-stuck':
      return (
        `Background job ${e.id} (${e.command.slice(0, 120)}) has shown no output, CPU use or file growth for ${secs(e.idleMs)} ` +
        `(notice #${e.repeat}). It has NOT been stopped. Ask the user whether to keep waiting or cut it with shell_bg_stop; ` +
        `it returns to running by itself if it shows any sign of life.${tail(e.lastLines)}`
      )
    case 'resumed':
      return `Background job ${e.id} showed signs of life again and is running normally.`
  }
}

interface JsonRpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: unknown
  params?: unknown
}

export interface McpServerOptions {
  manager: BackgroundShellManager
  /** Directorio de trabajo por defecto cuando `start` no trae `cwd`. */
  defaultCwd: string
  write: (line: string) => void
}

export class ShellBgMcpServer {
  private readonly m: BackgroundShellManager
  private readonly write: (line: string) => void
  private readonly defaultCwd: string

  constructor(o: McpServerOptions) {
    this.m = o.manager
    this.write = o.write
    this.defaultCwd = o.defaultCwd
  }

  /** Para conectarlo a `onEvent` del manager: publica el aviso como notificación MCP. */
  notifyEvent(e: ShellBgEvent): void {
    const level = e.type === 'possibly-stuck' ? 'warning' : 'info'
    this.send({
      jsonrpc: '2.0',
      method: 'notifications/message',
      params: { level, logger: SERVER_NAME, data: { ...e, message: formatEvent(e) } }
    })
  }

  /** Procesa una línea JSON-RPC y escribe la respuesta (si corresponde). */
  async handleLine(line: string): Promise<void> {
    const trimmed = line.trim()
    if (trimmed === '') return
    let msg: JsonRpcRequest
    try {
      msg = JSON.parse(trimmed) as JsonRpcRequest
    } catch {
      this.send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      return
    }
    if (typeof msg !== 'object' || msg === null || Array.isArray(msg) || typeof msg.method !== 'string') {
      // Respuestas del cliente u objetos inválidos: sin id no hay a quién contestar.
      if (msg && typeof msg === 'object' && !Array.isArray(msg) && msg.id !== undefined && 'method' in msg) {
        this.send({ jsonrpc: '2.0', id: msg.id, error: { code: -32600, message: 'Invalid Request' } })
      } else if (Array.isArray(msg)) {
        this.send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Batches are not supported' } })
      }
      return
    }
    const isNotification = msg.id === undefined
    try {
      const result = await this.dispatch(msg.method, msg.params)
      if (!isNotification) this.send({ jsonrpc: '2.0', id: msg.id as string | number | null, result })
    } catch (e) {
      if (isNotification) return
      const rpc = e instanceof RpcError ? e : new RpcError(-32603, 'Internal error')
      this.send({ jsonrpc: '2.0', id: msg.id as string | number | null, error: { code: rpc.code, message: rpc.message } })
    }
  }

  private send(obj: unknown): void {
    this.write(JSON.stringify(obj))
  }

  private async dispatch(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'initialize': {
        const asked = (params as { protocolVersion?: unknown } | undefined)?.protocolVersion
        const version = typeof asked === 'string' && SUPPORTED_PROTOCOLS.includes(asked) ? asked : SUPPORTED_PROTOCOLS[0]
        return {
          protocolVersion: version,
          capabilities: { tools: { listChanged: false }, logging: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          instructions:
            'Background shell. Start long commands with shell_bg_start and keep working: you are notified when they finish or look stuck. Never poll with sleep.'
        }
      }
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return {}
      case 'ping':
      case 'logging/setLevel':
        return {}
      case 'tools/list':
        return { tools: TOOLS }
      case 'tools/call':
        return this.callTool(params)
      default:
        throw new RpcError(-32601, `Method not found: ${method}`)
    }
  }

  private async callTool(params: unknown): Promise<unknown> {
    const p = params as { name?: unknown; arguments?: unknown } | undefined
    const def = typeof p?.name === 'string' ? TOOLS.find((t) => t.name === p.name) : undefined
    if (!def) throw new RpcError(-32602, `Unknown tool: ${String(p?.name)}`)
    const args = p?.arguments ?? {}
    const bad = validateArgs(def.inputSchema, args)
    if (bad) return toolError(`Invalid arguments for ${def.name}: ${bad}`)
    const a = args as Record<string, unknown>
    try {
      switch (def.name) {
        case 'shell_bg_start': {
          const id = await this.m.start(a.command as string, {
            cwd: (a.cwd as string | undefined) ?? this.defaultCwd,
            env: a.env as Record<string, string> | undefined,
            quietMs: a.quietMinutes === undefined ? undefined : (a.quietMinutes as number) * 60_000,
            maxRuntimeMs: a.maxMinutes === undefined ? undefined : (a.maxMinutes as number) * 60_000,
            watchPaths: a.watchPaths as string[] | undefined
          })
          const s = this.m.status(id)
          return toolOk({
            id,
            state: s.state,
            pid: s.pid,
            cwd: s.cwd,
            note: 'Started. Do not poll or sleep: you will be notified when it exits or looks stuck. Read output a little at a time with shell_bg_read.'
          })
        }
        case 'shell_bg_status':
          return toolOk(this.m.status(a.id as string))
        case 'shell_bg_read':
          return toolOk(
            this.m.read(a.id as string, { fromByte: a.fromByte as number | undefined, maxBytes: a.maxBytes as number | undefined })
          )
        case 'shell_bg_stop':
          return toolOk(await this.m.stop(a.id as string))
        case 'shell_bg_list':
          return toolOk({ jobs: this.m.list() })
      }
    } catch (e) {
      if (e instanceof ShellBgError) return toolError(`${e.code}: ${e.message}`)
      return toolError(`Unexpected error: ${(e as Error).message}`)
    }
    throw new RpcError(-32602, 'Unknown tool')
  }
}

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message)
  }
}

const toolOk = (data: unknown): { content: { type: 'text'; text: string }[]; isError: false } => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
  isError: false
})
const toolError = (text: string): { content: { type: 'text'; text: string }[]; isError: true } => ({
  content: [{ type: 'text', text }],
  isError: true
})
