/**
 * `Engine1Adapter`: implementa `EngineClient` sobre el motor 1 (OpenCode 1.19 fijado en
 * `resources/opencode-bin/pin.json`) con el cliente generado `@opencode-ai/sdk/v2/client`.
 *
 * OJO con el nombre: ese «v2» del SDK es el cliente de la API 1.19 (rutas `/session`, `/permission`,
 * `/global/event`…), NO el motor 2.x. El motor 2.x va en `engine2.ts`.
 *
 * Es el ÚNICO archivo de `src/shared/engine/` que importa el SDK en tiempo de ejecución (los alias
 * de tipos viven en `../types.ts` como `import type`). La receta de creación del cliente
 * (`{ baseUrl, headers: { Authorization }, fetch }`) es la misma que hoy usan `src/main/opencode/*`,
 * `compare/engine.ts`, `computer/abort.ts` y `src/renderer/src/lib/opencode.ts`; el bucle SSE
 * copia el de `startEventStream` (reconexión 0,5 s … 10 s, sin reintentos propios del SDK).
 * No usa nada de Node: sirve en main, renderer y PWA.
 */
import { createOpencodeClient, type GlobalEvent, type OpencodeClient } from '@opencode-ai/sdk/v2/client'
import {
  listElicitations,
  parseElicitationRejected,
  parseElicitationReplied,
  parseElicitationRequest,
  replyElicitation
} from '../../mcp-elicitation'
import type { EngineClient, EngineConnection } from '../client'
import { EngineError, toEngineError } from '../errors'
import type { EngineEvent, EngineEventHandler, EngineEventOptions } from '../events'
import type { MessageWithParts, Scope } from '../types'

// ───────────────────────────── utilidades de transporte ─────────────────────────────

/** Forma mínima de lo que devuelve cualquier método del SDK (sin `throwOnError`). */
interface SdkResult<T> {
  data?: T
  error?: unknown
  /** Ausente si el `fetch` falló antes de recibir respuesta (red caída, aborto, tiempo agotado). */
  response?: Response
}

/** Espera la llamada, convierte excepciones de red y respuestas no-2xx en `EngineError`. */
async function call<T>(p: Promise<SdkResult<T>>): Promise<SdkResult<T>> {
  let r: SdkResult<T>
  try {
    r = await p
  } catch (err) {
    throw toEngineError(err)
  }
  if (!r.response) throw toEngineError(r.error ?? new Error('Sin respuesta del motor'))
  // `response.ok` es la verdad: un 204 trae `data` vacío y un cuerpo de error puede venir como texto vacío.
  if (!r.response.ok) throw toEngineError(r.error, r.response.status)
  return r
}

/** Llamada cuyo resultado se usa. */
async function data<T>(p: Promise<SdkResult<T>>): Promise<T> {
  const r = await call(p)
  if (r.data === undefined || r.data === null) {
    throw new EngineError('engine', 'Respuesta vacía del motor', { status: r.response?.status })
  }
  return r.data
}

/** Llamada de la que solo importa que haya salido bien. */
async function done<T>(p: Promise<SdkResult<T>>): Promise<void> {
  await call(p)
}

/** Fetch con tope de tiempo por petición (para las rutas de main). */
function withTimeout(base: typeof fetch, timeoutMs: number): typeof fetch {
  return (input, init) => {
    const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)]
    if (init?.signal) signals.push(init.signal)
    else if (input instanceof Request) signals.push(input.signal)
    return base(input, { ...init, signal: AbortSignal.any(signals) })
  }
}

function buildClient(conn: EngineConnection, timeoutMs: number | undefined): OpencodeClient {
  const headers: Record<string, string> = { ...conn.headers }
  if (conn.authorization) headers.Authorization = conn.authorization
  const baseFetch: typeof fetch = conn.fetch ?? ((input, init) => fetch(input, init))
  return createOpencodeClient({
    baseUrl: conn.baseUrl,
    headers,
    fetch: timeoutMs ? withTimeout(baseFetch, timeoutMs) : baseFetch
  })
}

// ───────────────────────────── normalización de eventos ─────────────────────────────

/** `mcp.elicitation.*` (motor propio). Un evento mal formado no se descarta: llega como `unknown` para no perderlo de vista. */
function elicitationEvent(directory: string, p: { type: string; properties?: unknown }): EngineEvent | null {
  if (typeof p.type !== 'string' || !p.type.startsWith('mcp.elicitation.')) return null
  switch (p.type) {
    case 'mcp.elicitation.asked': {
      const request = parseElicitationRequest(p.properties)
      if (request) return { directory, type: 'mcp.elicitation.asked', request }
      break
    }
    case 'mcp.elicitation.replied': {
      const r = parseElicitationReplied(p.properties)
      if (r) return { directory, type: 'mcp.elicitation.replied', id: r.id, sessionID: r.sessionID, action: r.action }
      break
    }
    case 'mcp.elicitation.rejected': {
      const r = parseElicitationRejected(p.properties)
      if (r) return { directory, type: 'mcp.elicitation.rejected', id: r.id, sessionID: r.sessionID, reason: r.reason }
      break
    }
  }
  return { directory, type: 'unknown', rawType: p.type, raw: p }
}

/** Traduce un evento del stream global del motor 1 al `EngineEvent` propio. Pura y sin estado. */
export function normalizeEvent(g: GlobalEvent): EngineEvent {
  const directory = g.directory
  const p = g.payload
  // Eventos del motor propio que el SDK fijado no conoce (no están en su unión de tipos): se leen aparte y se sanean.
  const own = elicitationEvent(directory, p)
  if (own) return own
  switch (p.type) {
    case 'server.connected':
      return { directory, type: 'connected' }
    case 'session.created':
      return { directory, type: 'session.created', session: p.properties.info }
    case 'session.updated':
      return { directory, type: 'session.updated', session: p.properties.info }
    case 'session.deleted':
      return { directory, type: 'session.deleted', session: p.properties.info }
    case 'session.status':
      return { directory, type: 'session.status', sessionID: p.properties.sessionID, status: p.properties.status }
    case 'session.idle':
      return { directory, type: 'session.idle', sessionID: p.properties.sessionID }
    case 'session.error':
      return { directory, type: 'session.error', sessionID: p.properties.sessionID, error: p.properties.error }
    case 'session.diff':
      return { directory, type: 'session.diff', sessionID: p.properties.sessionID, diff: p.properties.diff }
    case 'message.updated':
      return { directory, type: 'message.updated', sessionID: p.properties.sessionID, info: p.properties.info }
    case 'message.removed':
      return { directory, type: 'message.removed', sessionID: p.properties.sessionID, messageID: p.properties.messageID }
    case 'message.part.updated':
      return { directory, type: 'part.updated', sessionID: p.properties.sessionID, part: p.properties.part, time: p.properties.time }
    case 'message.part.delta':
      return {
        directory,
        type: 'part.delta',
        sessionID: p.properties.sessionID,
        messageID: p.properties.messageID,
        partID: p.properties.partID,
        field: p.properties.field,
        delta: p.properties.delta
      }
    case 'message.part.removed':
      return {
        directory,
        type: 'part.removed',
        sessionID: p.properties.sessionID,
        messageID: p.properties.messageID,
        partID: p.properties.partID
      }
    case 'permission.asked':
      return { directory, type: 'permission.asked', request: p.properties }
    case 'permission.replied':
      return {
        directory,
        type: 'permission.replied',
        sessionID: p.properties.sessionID,
        requestID: p.properties.requestID,
        reply: p.properties.reply
      }
    case 'question.asked':
      return { directory, type: 'question.asked', request: p.properties }
    case 'question.replied':
      return {
        directory,
        type: 'question.replied',
        sessionID: p.properties.sessionID,
        requestID: p.properties.requestID,
        answers: p.properties.answers
      }
    case 'question.rejected':
      return { directory, type: 'question.rejected', sessionID: p.properties.sessionID, requestID: p.properties.requestID }
    case 'todo.updated':
      return { directory, type: 'todo.updated', sessionID: p.properties.sessionID, todos: p.properties.todos }
    case 'file.edited':
      return { directory, type: 'file.edited', file: p.properties.file }
    case 'vcs.branch.updated':
      return { directory, type: 'vcs.branch', branch: p.properties.branch }
    default:
      return { directory, type: 'unknown', rawType: String(p.type), raw: p }
  }
}

/** Evento global bien formado (el stream puede traer latidos u objetos vacíos). */
function isGlobalEvent(ev: unknown): ev is GlobalEvent {
  return !!ev && typeof ev === 'object' && 'payload' in ev && typeof (ev as { payload: unknown }).payload === 'object'
}

// ───────────────────────────── adaptador ─────────────────────────────

export class Engine1Adapter implements EngineClient {
  readonly kind = 'engine1' as const
  readonly sessions: EngineClient['sessions']
  readonly permissions: EngineClient['permissions']
  readonly questions: EngineClient['questions']
  readonly elicitations: EngineClient['elicitations']
  readonly events: EngineClient['events']
  readonly providers: EngineClient['providers']
  readonly mcp: EngineClient['mcp']
  readonly files: EngineClient['files']
  readonly vcs: EngineClient['vcs']
  readonly pty: EngineClient['pty']
  readonly config: EngineClient['config']
  readonly agents: EngineClient['agents']

  private readonly sdk: OpencodeClient

  constructor(private readonly conn: EngineConnection) {
    const sdk = buildClient(conn, conn.timeoutMs)
    this.sdk = sdk
    /** `directory` de la llamada, o la de la conexión; nada si ninguna (el motor usa la suya). */
    const dir = (o?: Scope): { directory?: string } => {
      const d = o?.directory ?? conn.directory
      return d ? { directory: d } : {}
    }

    this.sessions = {
      list: async (o) =>
        data(
          sdk.session.list({
            ...dir(o),
            ...(o?.roots !== undefined ? { roots: o.roots } : {}),
            ...(o?.project ? { scope: 'project' as const } : {}),
            ...(o?.search ? { search: o.search } : {}),
            ...(o?.start !== undefined ? { start: o.start } : {}),
            ...(o?.limit !== undefined ? { limit: o.limit } : {})
          })
        ),
      get: (id, o) => data(sdk.session.get({ sessionID: id, ...dir(o) })),
      create: (i) =>
        data(
          sdk.session.create({
            ...dir(i),
            ...(i?.title !== undefined ? { title: i.title } : {}),
            ...(i?.parentID ? { parentID: i.parentID } : {}),
            ...(i?.agent ? { agent: i.agent } : {}),
            ...(i?.model ? { model: i.model } : {}),
            ...(i?.metadata ? { metadata: i.metadata } : {}),
            ...(i?.permission ? { permission: i.permission } : {})
          })
        ),
      update: (id, p, o) =>
        data(
          sdk.session.update({
            sessionID: id,
            ...dir(o),
            ...(p.title !== undefined ? { title: p.title } : {}),
            ...(p.metadata ? { metadata: p.metadata } : {}),
            ...(p.permission ? { permission: p.permission } : {}),
            // `archived: 0` desarchiva (el motor trata 0 como «sin archivar»).
            ...(p.archived !== undefined ? { time: { archived: p.archived ?? 0 } } : {})
          })
        ),
      remove: (id, o) => done(sdk.session.delete({ sessionID: id, ...dir(o) })),
      children: (id, o) => data(sdk.session.children({ sessionID: id, ...dir(o) })),
      // El motor omite las inactivas; con 204/cuerpo vacío no hay estado: se entrega `{}`.
      status: async (o) => (await call(sdk.session.status({ ...dir(o) }))).data ?? {},
      todos: async (id, o) => (await call(sdk.session.todo({ sessionID: id, ...dir(o) }))).data ?? [],
      diff: async (id, o) =>
        (await call(sdk.session.diff({ sessionID: id, ...dir(o), ...(o?.messageID ? { messageID: o.messageID } : {}) }))).data ?? [],
      messages: async (id, o): Promise<MessageWithParts[]> =>
        (
          await call(
            sdk.session.messages({
              sessionID: id,
              ...dir(o),
              ...(o?.limit !== undefined ? { limit: o.limit } : {}),
              ...(o?.before ? { before: o.before } : {})
            })
          )
        ).data ?? [],
      message: (id, messageID, o) => data(sdk.session.message({ sessionID: id, messageID, ...dir(o) })),
      deleteMessage: (id, messageID, o) => done(sdk.session.deleteMessage({ sessionID: id, messageID, ...dir(o) })),
      send: (id, i, o) => done(sdk.session.promptAsync({ sessionID: id, ...dir(o), ...i })),
      runCommand: (id, i, o) => done(sdk.session.command({ sessionID: id, ...dir(o), ...i })),
      abort: (id, o) => done(sdk.session.abort({ sessionID: id, ...dir(o) })),
      fork: (id, o) => data(sdk.session.fork({ sessionID: id, ...dir(o), ...(o?.messageID ? { messageID: o.messageID } : {}) })),
      revert: (id, messageID, o) =>
        data(sdk.session.revert({ sessionID: id, messageID, ...dir(o), ...(o?.partID ? { partID: o.partID } : {}) })),
      unrevert: (id, o) => data(sdk.session.unrevert({ sessionID: id, ...dir(o) })),
      summarize: (id, model, o) =>
        done(sdk.session.summarize({ sessionID: id, ...dir(o), providerID: model.providerID, modelID: model.modelID }))
    }

    this.permissions = {
      list: async (o) => (await call(sdk.permission.list({ ...dir(o) }))).data ?? [],
      // Motor 1: la ruta es `/permission/{id}/reply`; `sessionID` no se usa.
      reply: (id, reply, o) =>
        done(sdk.permission.reply({ requestID: id, ...dir(o), reply, ...(o?.message ? { message: o.message } : {}) }))
    }

    this.questions = {
      list: async (o) => (await call(sdk.question.list({ ...dir(o) }))).data ?? [],
      reply: (id, answers, o) => done(sdk.question.reply({ requestID: id, ...dir(o), answers })),
      reject: (id, o) => done(sdk.question.reject({ requestID: id, ...dir(o) }))
    }

    // Rutas propias del motor (el SDK fijado no las trae): `fetch` crudo con la misma autorización y el mismo `fetch` inyectable.
    this.elicitations = {
      list: async (o) => {
        const r = await listElicitations(this.rawConn(), o?.directory ?? conn.directory, conn.fetch)
        return r.available ? r.list : []
      },
      reply: (id, action, content, o) => replyElicitation(this.rawConn(), id, action, content, o?.directory ?? conn.directory, conn.fetch)
    }

    this.events = {
      subscribe: (handler, o) => this.subscribe(handler, o)
    }

    this.providers = {
      list: (o) => data(sdk.provider.list({ ...dir(o) })),
      configured: (o) => data(sdk.config.providers({ ...dir(o) })),
      authMethods: async (o) => (await call(sdk.provider.auth({ ...dir(o) }))).data ?? {},
      setKey: (providerID, key) => done(sdk.auth.set({ providerID, auth: { type: 'api', key } })),
      removeKey: (providerID) => done(sdk.auth.remove({ providerID })),
      oauthStart: (providerID, method, inputs) => data(sdk.provider.oauth.authorize({ providerID, method, ...(inputs ? { inputs } : {}) })),
      oauthFinish: (providerID, method, code) => done(sdk.provider.oauth.callback({ providerID, method, ...(code ? { code } : {}) })),
      refresh: () => done(sdk.global.dispose())
    }

    this.mcp = {
      status: async (o) => (await call(sdk.mcp.status({ ...dir(o) }))).data ?? {},
      connect: (name, o) => done(sdk.mcp.connect({ name, ...dir(o) })),
      disconnect: (name, o) => done(sdk.mcp.disconnect({ name, ...dir(o) })),
      authenticate: (name, o) => data(sdk.mcp.auth.authenticate({ name, ...dir(o) }))
    }

    this.files = {
      list: async (path, o) => (await call(sdk.file.list({ path, ...dir(o) }))).data ?? [],
      read: (path, o) => data(sdk.file.read({ path, ...dir(o) })),
      status: async (o) => (await call(sdk.file.status({ ...dir(o) }))).data ?? [],
      find: async (query, o) =>
        (
          await call(
            sdk.find.files({
              query,
              ...dir(o),
              ...(o?.type ? { type: o.type } : {}),
              ...(o?.limit !== undefined ? { limit: o.limit } : {})
            })
          )
        ).data ?? []
    }

    this.vcs = {
      info: (o) => data(sdk.vcs.get({ ...dir(o) })),
      status: async (o) => (await call(sdk.vcs.status({ ...dir(o) }))).data ?? [],
      diff: async (mode, o) => (await call(sdk.vcs.diff({ mode, ...dir(o) }))).data ?? []
    }

    this.pty = {
      list: async (o) => (await call(sdk.pty.list({ ...dir(o) }))).data ?? [],
      create: (i) =>
        data(
          sdk.pty.create({
            ...dir(i),
            ...(i?.command ? { command: i.command } : {}),
            ...(i?.args ? { args: i.args } : {}),
            ...(i?.cwd ? { cwd: i.cwd } : {}),
            ...(i?.title ? { title: i.title } : {}),
            ...(i?.env ? { env: i.env } : {})
          })
        ),
      resize: (id, cols, rows, o) => done(sdk.pty.update({ ptyID: id, ...dir(o), size: { rows, cols } })),
      remove: (id, o) => done(sdk.pty.remove({ ptyID: id, ...dir(o) }))
    }

    this.config = {
      get: (o) => data(sdk.config.get({ ...dir(o) }))
    }

    this.agents = {
      list: async (o) => (await call(sdk.app.agents({ ...dir(o) }))).data ?? [],
      commands: async (o) => (await call(sdk.command.list({ ...dir(o) }))).data ?? []
    }
  }

  async health(): Promise<{ ok: boolean; version?: string }> {
    try {
      const r = await this.sdk.global.health()
      if (r.response?.ok && r.data) return { ok: true, version: r.data.version }
      return { ok: false }
    } catch {
      return { ok: false }
    }
  }

  /**
   * Stream global (`global.event`) con reconexión, copiado de `startEventStream` del renderer.
   * Usa un cliente SIN tope de tiempo por petición: el stream dura horas.
   */
  /** Conexión para las rutas sin SDK: URL base y autorización de siempre. */
  private rawConn(): { baseUrl: string; authorization?: string } {
    return { baseUrl: this.conn.baseUrl, ...(this.conn.authorization ? { authorization: this.conn.authorization } : {}) }
  }

  private subscribe(handler: EngineEventHandler, o: EngineEventOptions = {}): () => void {
    const sdk = this.conn.timeoutMs ? buildClient(this.conn, undefined) : this.sdk
    const controller = new AbortController()
    let stopped = false
    const stop = (): void => {
      stopped = true
      controller.abort()
    }
    if (o.signal) {
      if (o.signal.aborted) {
        stop()
        return () => undefined
      }
      o.signal.addEventListener('abort', stop, { once: true })
    }

    const loop = async (): Promise<void> => {
      let attempt = 0
      while (!stopped) {
        try {
          const { stream } = await sdk.global.event({
            signal: controller.signal,
            sseMaxRetryAttempts: 0,
            onSseError: (err: unknown) => o.onError?.(toEngineError(err))
          })
          let opened = false
          for await (const ev of stream) {
            if (!opened) {
              opened = true
              attempt = 0
              o.onOpen?.()
            }
            if (!isGlobalEvent(ev)) continue
            try {
              handler(normalizeEvent(ev))
            } catch (err) {
              // Un fallo del consumidor no debe tumbar el stream de todos los demás.
              o.onError?.(toEngineError(err))
            }
          }
        } catch (err) {
          if (stopped) return
          o.onError?.(toEngineError(err))
        }
        if (stopped) return
        attempt++
        await new Promise((r) => setTimeout(r, Math.min(500 * 2 ** attempt, 10_000)))
      }
    }
    void loop()

    return () => {
      o.signal?.removeEventListener('abort', stop)
      stop()
    }
  }
}
