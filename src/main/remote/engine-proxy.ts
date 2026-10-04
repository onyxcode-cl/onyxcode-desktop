/**
 * Despachador real del celular (F0-T4): implementa `MuxDispatch` (T1) sobre `invokeAs` (T2) y `decide` (T3).
 *
 *  - `call` (IPC): canoniza rutas (`realpath`), `decide` → R/M se ejecuta; D espera la confirmación del Mac (`ConfirmQueue`,
 *    la UI y el PIN son de T6); X y todo lo desconocido → `forbidden` con un código corto. La política se vuelve a aplicar
 *    sobre el payload YA validado por el esquema (gancho `authorize` de `invokeAs`).
 *  - `http`: petición al sidecar con el `fetch` del main; la contraseña Basic la pone el Mac y NUNCA sale. Se resuelve el
 *    `realpath` de `directory`, de `path` y de los `file://` ANTES de decidir; `GET /file/content` rechaza archivos
 *    sensibles aunque la política lo permita; las respuestas de listados se filtran por ámbito; se acotan los tamaños y se
 *    cancela con el `AbortSignal` de la conexión.
 *  - Credenciales: `opencode:connection`, `opencode:restart`, `tasks:start` y el evento `opencode:connection` se reescriben
 *    (ver `engine-registry.ts`). Toda respuesta pasa por `registry.scrub` como red de seguridad final.
 *
 * Forma de la respuesta de `http` (la rehace en un `Response` el shim de `fetch` del celular, T5):
 *   `{ status, contentType?, body, encoding? }` — `body` es texto (JSON ya filtrado) o base64 si `encoding === 'base64'`.
 * El stream `/event` y `/global/event` NO se sirve por `http`: el celular usa `sub{eng}` (ver `sse-hub.ts`).
 */
import { fileURLToPath } from 'node:url'
import { isAbsolute, resolve } from 'node:path'
import { MuxError, type CallRequest, type DispatchCtx, type HttpRequest, type MuxDispatch } from '@shared/remote/mux'
import type { OpencodeConnection } from '@shared/types'
import type { TasksConnection } from '@shared/ipc-tasks'
import type { CallFrame, HttpFrame } from '@shared/remote/protocol'
import { ConfirmQueue, callDigest } from './confirm-queue'
import { EngineKnowledge, ScopeProvider, isDirectorySync, modelsFromProviderList } from './engine-scope'
import { EngineRegistry, type EngineTarget } from './engine-registry'
import { trimIpcEvent } from './event-trim'
import { isInsideReal, isSensitiveEither, realpathLoose } from './path-guard'
import { decide, sanitizeResult, type PolicyContext, type PolicyDecision } from './policy'
import { createRemoteSender, type RemoteSender } from './sender'
import type { EventLog } from '@shared/remote/mux'

/** Resultado de `invokeAs` (el mismo `{ok,data}` / `{ok:false,code,error}` que recibe un renderer). */
export type InvokeFn = (
  caller: { sender: RemoteSender; authorize: (channel: string, payload: unknown) => boolean | Promise<boolean> },
  channel: string,
  args: unknown[]
) => Promise<{ ok: true; data: unknown } | { ok: false; code?: string; error: string }>

export interface EngineShared {
  registry: EngineRegistry
  scope: ScopeProvider
  knowledge: EngineKnowledge
  confirm: ConfirmQueue
  invoke: InvokeFn
  /** Búfer de eventos de la conexión (el sender virtual publica aquí). */
  events: EventLog
  /** Un `sub` a este motor: abre bajo demanda el stream de subida. */
  onSub?: (eng: string) => void
  fetch?: typeof fetch
  maxBodyBytes?: number
  maxResponseBytes?: number
  timeoutMs?: number
}

export interface HttpResult {
  status: number
  contentType?: string
  body: string
  encoding?: 'base64'
}

const MAX_BODY = 12 * 1024 * 1024
const MAX_RESPONSE = 6 * 1024 * 1024
const TIMEOUT_MS = 120_000

/** Claves cuyos valores son rutas: se sustituyen por su `realpath` antes de decidir. */
const PATH_KEYS = new Set([
  'folder',
  'cwd',
  'path',
  'paths',
  'directory',
  'dir',
  'dirs',
  'root',
  'file',
  'files',
  'from',
  'to',
  'target',
  'worktree',
  'dest',
  'destination',
  'source',
  'src'
])
/** Base contra la que se resuelven las rutas relativas del payload. */
const BASE_KEYS = ['cwd', 'folder', 'directory'] as const

const forbidden = (reason: string): MuxError => new MuxError('forbidden', reason)

/** Peticiones de control/permisos: salen con prioridad máxima. */
export function isUrgentFrame(f: CallFrame | HttpFrame): boolean {
  if (f.t === 'call') return /^(computer:(stop|respondAccess|resume)|browser:respond|tasks:fullAccess:revokeAll)$/.test(f.ch)
  return /^\/(permission|question)(\/|$)/.test(f.path) || /^\/session\/[^/]+\/(abort|permissions)(\/|$)/.test(f.path)
}

interface Canon<T> {
  ok: boolean
  value: T
}

/** Sustituye las rutas absolutas de las claves de ruta por su `realpath` y comprueba que las relativas no escapen. */
export function canonPayload(p: unknown): Canon<unknown> {
  let ok = true
  const walk = (v: unknown, depth: number, inPathKey: boolean): unknown => {
    if (depth > 8) {
      ok = false
      return v
    }
    if (typeof v === 'string') {
      if (!inPathKey || !isAbsolute(v)) return v
      const real = realpathLoose(v)
      if (real === null) {
        ok = false
        return v
      }
      return real
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1, inPathKey))
    if (v !== null && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = walk(x, depth + 1, inPathKey || PATH_KEYS.has(k))
      return out
    }
    return v
  }
  const value = walk(p, 0, false)
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const o = value as Record<string, unknown>
    const baseKey = BASE_KEYS.find((k) => typeof o[k] === 'string' && isAbsolute(o[k] as string))
    if (baseKey) {
      const base = o[baseKey] as string
      for (const k of ['path', 'paths', 'file', 'files']) {
        const list = Array.isArray(o[k]) ? (o[k] as unknown[]) : o[k] === undefined ? [] : [o[k]]
        for (const rel of list) {
          if (typeof rel !== 'string' || isAbsolute(rel)) continue
          const real = realpathLoose(resolve(base, rel))
          if (real === null || !isInsideReal(base, real)) ok = false
        }
      }
    }
  }
  return { ok, value }
}

const SESSION_RE = /^\/session\/([A-Za-z0-9_.:-]{1,200})(?:\/|$)/
const PERMISSION_PATH_RES = [/^\/permission\/([A-Za-z0-9_.:-]{1,200})\/reply$/, /^\/session\/[^/]+\/permissions\/([A-Za-z0-9_.:-]{1,200})$/]

export class EngineProxy implements MuxDispatch {
  private readonly sender: RemoteSender
  private disposed = false

  constructor(
    private readonly s: EngineShared,
    private readonly device: { id: string; name: string }
  ) {
    this.sender = createRemoteSender((ch, ...args) => {
      // Eventos de recursos creados por este celular (p. ej. `files:changed`): mismo recorte que el bus.
      if (this.disposed) return
      const p = args[0]
      const out = trimIpcEvent(ch, p, s)
      if (out === null) return
      this.s.events.append('main', { ch, ...(out === undefined ? {} : { p: out }) })
    })
  }

  /** Libera el remitente virtual (pty/files) y rechaza lo pendiente de confirmar. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.sender.destroy()
    this.s.confirm.cancelDevice(this.device.id)
  }

  allowSub(eng: string): boolean {
    if (this.disposed || !this.s.registry.has(eng)) return false
    this.s.onSub?.(eng)
    return true
  }

  // ─────────────────────────────── contexto de política ───────────────────────────────

  private async pctx(): Promise<PolicyContext> {
    const sc = await this.s.scope.get()
    return {
      allowedDirs: sc.allowed,
      chatDirs: sc.chat,
      fullAccessDirs: sc.full,
      sessionDir: (id) => this.s.knowledge.sessionDir(id),
      knownModels: this.s.knowledge.knownModels(),
      permissionKind: (id) => this.s.knowledge.permissionKind(id),
      isDirectory: isDirectorySync
    }
  }

  private async confirmed(
    channel: string,
    payload: unknown,
    d: Extract<PolicyDecision, { confirm: true }>,
    ctx: DispatchCtx
  ): Promise<void> {
    const r = await this.s.confirm.request({
      deviceId: this.device.id,
      deviceName: this.device.name,
      channel,
      payload,
      summary: d.summary,
      detail: d.detail
    })
    // Cancelada mientras esperaba: aunque el dueño aprobara, NO se ejecuta.
    if (ctx.signal.aborted) throw new MuxError('cancelled')
    if (r.outcome !== 'approved') throw forbidden(r.outcome)
    if (r.digest !== callDigest(channel, payload)) throw forbidden('digest-mismatch')
  }

  // ─────────────────────────────── IPC ───────────────────────────────

  async call(req: CallRequest, ctx: DispatchCtx): Promise<unknown> {
    const ch = req.ch
    if (this.disposed || typeof ch !== 'string' || ch.startsWith('remote:')) throw forbidden('forbidden')
    const canon = canonPayload(req.p)
    if (!canon.ok) throw forbidden('out-of-scope')
    const payload = canon.value
    const pctx = await this.pctx()
    const d = decide({ kind: 'ipc', channel: ch, payload }, pctx)
    let approved = false
    if ('confirm' in d) {
      await this.confirmed(d.channel, payload, d, ctx)
      approved = true
    } else if (!d.allow) throw forbidden(d.reason)
    if (ctx.signal.aborted) throw new MuxError('cancelled')
    const res = await this.s.invoke(
      {
        sender: this.sender,
        // La política se aplica otra vez sobre el payload validado por el esquema (puede diferir del enviado).
        authorize: (channel, validated) => {
          const dd = decide({ kind: 'ipc', channel, payload: validated }, pctx)
          if ('confirm' in dd) return approved
          return dd.allow === true
        }
      },
      ch,
      payload === undefined ? [] : [payload]
    )
    if (!res.ok) {
      if (res.code === 'FORBIDDEN') throw forbidden('forbidden')
      throw new MuxError('failed', this.s.registry.scrub(String(res.error ?? '')).slice(0, 200))
    }
    return this.s.registry.scrub(this.rewriteResult(ch, res.data))
  }

  private rewriteResult(ch: string, data: unknown): unknown {
    const reg = this.s.registry
    const o = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null
    if ((ch === 'opencode:connection' || ch === 'opencode:restart') && o && typeof o.authorization === 'string') {
      return reg.rewriteConnection(o as unknown as OpencodeConnection)
    }
    if (ch === 'tasks:start' && o && typeof o.authorization === 'string') return reg.rewriteTasksConnection(o as unknown as TasksConnection)
    return sanitizeResult(ch, data)
  }

  // ─────────────────────────────── HTTP ───────────────────────────────

  async http(req: HttpRequest, ctx: DispatchCtx): Promise<unknown> {
    if (this.disposed) throw forbidden('forbidden')
    const reg = this.s.registry
    if (!reg.has(req.eng)) throw forbidden('unknown-engine')
    const method = String(req.method).toUpperCase()
    const path = req.path
    if (/^\/(global\/)?event$/.test(path)) throw new MuxError('unsupported', 'use-sub')

    // 1. Query: `directory` con `realpath` (solo rutas absolutas; una relativa se resolvería contra el Mac).
    const query: Record<string, string> = { ...(req.query ?? {}) }
    let dirReal: string | undefined
    if (query.directory !== undefined) {
      if (!isAbsolute(query.directory)) throw forbidden('out-of-scope')
      const real = realpathLoose(query.directory)
      if (real === null) throw forbidden('out-of-scope')
      dirReal = query.directory = real
    }

    // 2. Cuerpo: tamaño, JSON y `file://` con `realpath`.
    const maxBody = this.s.maxBodyBytes ?? MAX_BODY
    let body: unknown
    let rawBody: string | undefined
    if (req.body !== undefined) {
      if (Buffer.byteLength(req.body, 'utf8') > maxBody) throw new MuxError('too-large')
      const ct = (req.headers?.['content-type'] ?? 'application/json').toLowerCase()
      if (ct.includes('json')) {
        try {
          body = JSON.parse(req.body)
        } catch {
          throw new MuxError('bad-request')
        }
        const fixed = this.canonFileParts(body, dirReal)
        if (!fixed.ok) throw forbidden('out-of-scope')
        body = fixed.value
        rawBody = JSON.stringify(body)
      } else throw new MuxError('bad-request', 'content-type')
    }

    // 2b. `path` relativo de lecturas de archivos: sin escapar del directorio ni por enlaces.
    let sensitiveTarget: { lexical: string; real: string | null } | null = null
    if (method === 'GET' && (path === '/file/content' || path === '/file') && dirReal !== undefined && query.path !== undefined) {
      const abs = resolve(dirReal, query.path === '' ? '.' : query.path)
      const real = realpathLoose(abs)
      if (real === null || !isInsideReal(dirReal, real)) throw forbidden('path-escape')
      sensitiveTarget = { lexical: abs, real }
    }

    // 3. Lo que la política necesita saber (solo se consulta al motor para directorios YA dentro del ámbito).
    const target = await reg.resolve(req.eng)
    if (!target) throw forbidden('unknown-engine')
    await this.s.scope.refresh()
    const pol = { kind: 'http' as const, method, path, query, ...(body === undefined ? {} : { body }) }
    let d = decide(pol, await this.pctx())
    // Solo si la política necesita algo que aún no sabe (sesión, modelo, tipo de permiso) se consulta al motor y se decide de nuevo.
    const isPermReply = PERMISSION_PATH_RES.some((re) => re.test(path))
    const unknown = !('confirm' in d) && !d.allow && (d.reason === 'session-unknown' || d.reason === 'model-unknown')
    // Un modelo desconocido puede ser una lista vieja o vacía (p. ej. pedida antes de conectar la IA): se vuelve a pedir una vez.
    if (!('confirm' in d) && !d.allow && d.reason === 'model-unknown') this.s.knowledge.invalidateModels()
    if (unknown || (isPermReply && 'confirm' in d)) {
      await this.prefetch(target, method, path, dirReal, body, ctx)
      d = decide(pol, await this.pctx())
    }
    if ('confirm' in d) await this.confirmed(d.channel, { eng: req.eng, method, path, query, body }, d, ctx)
    else if (!d.allow) throw forbidden(d.reason === 'model-unknown' ? modelDetail(body, d.reason) : d.reason)
    if (ctx.signal.aborted) throw new MuxError('cancelled')

    // 4. Archivos sensibles: nunca, aunque la política deje leer el directorio.
    if (path === '/file/content' && sensitiveTarget && isSensitiveEither(sensitiveTarget.lexical, sensitiveTarget.real))
      throw forbidden('sensitive-file')

    // 5. Ejecutar y filtrar.
    const res = await this.fetchEngine(target, method, path, query, req.headers?.accept, rawBody, ctx.signal)
    return this.filterResponse(method, path, dirReal, res)
  }

  /** `file://` de las partes de un prompt: `realpath`, dentro del directorio de la sesión y sin archivos sensibles. */
  private canonFileParts(body: unknown, dir: string | undefined): Canon<unknown> {
    const o = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null
    if (!o || !Array.isArray(o.parts)) return { ok: true, value: body }
    let ok = true
    const parts = o.parts.map((p) => {
      const part = typeof p === 'object' && p !== null ? (p as Record<string, unknown>) : null
      if (!part) return p
      let out: Record<string, unknown> = part
      // `source.path` (origen del adjunto): misma regla que la URL.
      const src = typeof part.source === 'object' && part.source !== null ? (part.source as Record<string, unknown>) : null
      if (src && typeof src.path === 'string') {
        const real = isAbsolute(src.path) ? realpathLoose(src.path) : null
        if (!dir || real === null || !isInsideReal(dir, real) || isSensitiveEither(src.path, real)) ok = false
        else out = { ...out, source: { ...src, path: real } }
      }
      if (typeof part.url !== 'string' || !part.url.toLowerCase().startsWith('file:')) return out
      try {
        const u = new URL(part.url)
        if (u.host !== '' && u.host !== 'localhost') throw new Error('host')
        const abs = fileURLToPath(u)
        const real = realpathLoose(abs)
        if (!dir || real === null || !isInsideReal(dir, real) || isSensitiveEither(abs, real)) {
          ok = false
          return out
        }
        return { ...out, url: `file://${real.split('/').map(encodeURIComponent).join('/')}` }
      } catch {
        ok = false
        return out
      }
    })
    return { ok, value: { ...o, parts } }
  }

  /** Aprende (del motor, solo de lo que está en el ámbito) lo que `decide` necesita: sesión, tipo de permiso y modelos. */
  private async prefetch(
    target: EngineTarget,
    method: string,
    path: string,
    dir: string | undefined,
    body: unknown,
    ctx: DispatchCtx
  ): Promise<void> {
    const inScope = dir !== undefined && this.s.scope.inScope(dir)
    const k = this.s.knowledge
    const sm = SESSION_RE.exec(path)
    const sid = sm?.[1]
    if (sid && sid !== 'status' && inScope && !k.sessionDir(sid)) {
      const r = await this.internalGet(target, `/session/${sid}`, { directory: dir as string }, ctx.signal)
      this.learnSessions(r)
    }
    if (inScope && method === 'POST') {
      const id = PERMISSION_PATH_RES.map((re) => re.exec(path)?.[1]).find((x) => x !== undefined)
      const reply =
        typeof body === 'object' && body !== null
          ? ((body as Record<string, unknown>).reply ?? (body as Record<string, unknown>).response)
          : undefined
      if (id && reply === 'once' && k.permissionKind(id) === undefined) {
        const r = await this.internalGet(target, '/permission', { directory: dir as string }, ctx.signal)
        for (const p of Array.isArray(r) ? r : []) {
          const pr = p as Record<string, unknown>
          k.learnPermission(pr.id, pr.permission)
        }
      }
    }
    if (method === 'POST' && /(^\/session$|\/prompt_async$|\/command$|\/summarize$)/.test(path) && !k.modelsFresh()) {
      const r = await this.internalGet(target, '/provider', {}, ctx.signal)
      if (r !== undefined) k.setModels(modelsFromProviderList(r))
    }
  }

  private learnSessions(v: unknown): void {
    const list = Array.isArray(v) ? v : [v]
    for (const it of list) {
      const s = typeof it === 'object' && it !== null ? (it as Record<string, unknown>) : null
      if (!s || typeof s.id !== 'string' || typeof s.directory !== 'string') continue
      const real = realpathLoose(s.directory)
      if (real && this.s.scope.inScope(real)) this.s.knowledge.learnSession(s.id, real)
    }
  }

  private async internalGet(target: EngineTarget, path: string, query: Record<string, string>, signal: AbortSignal): Promise<unknown> {
    try {
      const r = await this.fetchEngine(target, 'GET', path, query, 'application/json', undefined, signal)
      return r.status >= 200 && r.status < 300 ? JSON.parse(r.body) : undefined
    } catch {
      return undefined
    }
  }

  private async fetchEngine(
    target: EngineTarget,
    method: string,
    path: string,
    query: Record<string, string>,
    accept: string | undefined,
    body: string | undefined,
    signal: AbortSignal
  ): Promise<HttpResult> {
    const base = new URL(target.baseUrl)
    const url = new URL(path, base)
    if (url.origin !== base.origin) throw forbidden('bad-url')
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
    const headers: Record<string, string> = { authorization: target.authorization }
    if (accept) headers.accept = accept
    if (body !== undefined) headers['content-type'] = 'application/json'
    const sig = AbortSignal.any([signal, AbortSignal.timeout(this.s.timeoutMs ?? TIMEOUT_MS)])
    const f = this.s.fetch ?? fetch
    let res: Response
    try {
      res = await f(url, { method, headers, body, signal: sig, redirect: 'manual' })
    } catch (err) {
      if (signal.aborted) throw new MuxError('cancelled')
      throw new MuxError('unavailable', (err as { name?: string }).name === 'TimeoutError' ? 'timeout' : 'engine')
    }
    const max = this.s.maxResponseBytes ?? MAX_RESPONSE
    const chunks: Buffer[] = []
    let total = 0
    if (res.body) {
      const reader = res.body.getReader()
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          total += value.byteLength
          if (total > max) {
            await reader.cancel().catch(() => undefined)
            throw new MuxError('too-large')
          }
          chunks.push(Buffer.from(value))
        }
      } catch (err) {
        if (err instanceof MuxError) throw err
        if (signal.aborted) throw new MuxError('cancelled')
        throw new MuxError('unavailable', 'engine')
      }
    }
    const buf = Buffer.concat(chunks)
    const contentType = res.headers.get('content-type') ?? undefined
    const text = !contentType || /json|text|xml|javascript|x-www-form/i.test(contentType)
    return {
      status: res.status,
      ...(contentType ? { contentType: contentType.split(';')[0]?.trim() } : {}),
      body: text ? buf.toString('utf8') : buf.toString('base64'),
      ...(text ? {} : { encoding: 'base64' as const })
    }
  }

  // ─────────────────────────────── filtro de respuestas ───────────────────────────────

  private filterResponse(method: string, path: string, dir: string | undefined, res: HttpResult): HttpResult {
    const reg = this.s.registry
    if (res.encoding === 'base64' || !res.contentType?.includes('json') || res.body === '') {
      return { ...res, body: res.encoding ? res.body : reg.scrub(res.body) }
    }
    let data: unknown
    try {
      data = JSON.parse(res.body)
    } catch {
      return { status: res.status, body: '', ...(res.contentType ? { contentType: res.contentType } : {}) }
    }
    if (res.status >= 200 && res.status < 300) data = this.filterData(method, path, dir, data)
    const out = reg.scrub(data)
    return { status: res.status, ...(res.contentType ? { contentType: res.contentType } : {}), body: JSON.stringify(out) }
  }

  private sessionsInScope(v: unknown): unknown {
    const keep = (x: unknown): boolean => {
      const s = typeof x === 'object' && x !== null ? (x as Record<string, unknown>) : null
      if (!s || typeof s.directory !== 'string') return false
      const real = realpathLoose(s.directory)
      return real !== null && this.s.scope.inScope(real)
    }
    if (Array.isArray(v)) {
      const out = v.filter(keep)
      this.learnSessions(out)
      return out
    }
    const o = typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null
    if (!o) return v
    if (typeof o.directory === 'string' && typeof o.id === 'string') {
      if (!keep(o)) throw forbidden('out-of-scope')
      this.learnSessions(o)
      return o
    }
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(o)) out[k] = Array.isArray(x) ? this.sessionsInScope(x) : x
    return out
  }

  private filterData(method: string, path: string, dir: string | undefined, data: unknown): unknown {
    const k = this.s.knowledge
    const key = `${method} ${path}`
    if (/^GET \/(experimental\/)?session$/.test(key) || /^GET \/session\/[^/]+\/children$/.test(key)) return this.sessionsInScope(data)
    if (/^(GET|POST) \/session(\/[^/]+(\/fork)?)?$/.test(key) || /^PATCH \/session\/[^/]+$/.test(key)) {
      if (
        typeof data === 'object' &&
        data !== null &&
        !Array.isArray(data) &&
        typeof (data as { directory?: unknown }).directory === 'string'
      ) {
        return this.sessionsInScope(data)
      }
      return data
    }
    if (key === 'GET /provider' || key === 'GET /config/providers') {
      if (key === 'GET /provider') k.setModels(modelsFromProviderList(data))
      return stripSecretKeys(data)
    }
    if (key === 'GET /permission') {
      for (const p of Array.isArray(data) ? data : []) {
        const pr = (p ?? {}) as Record<string, unknown>
        k.learnPermission(pr.id, pr.permission)
      }
      return data
    }
    if (key === 'GET /file' && Array.isArray(data) && dir !== undefined) {
      return data.filter((e) => {
        const ent = (e ?? {}) as Record<string, unknown>
        const p = typeof ent.absolute === 'string' ? ent.absolute : typeof ent.path === 'string' ? resolve(dir, ent.path) : null
        return p === null || !isSensitiveEither(p, null)
      })
    }
    if (key === 'GET /find/file' && Array.isArray(data) && dir !== undefined) {
      return data.filter((e) => typeof e !== 'string' || !isSensitiveEither(resolve(dir, e), null))
    }
    if (key === 'GET /find' && Array.isArray(data) && dir !== undefined) {
      return data.filter((e) => {
        const m = (e ?? {}) as { path?: { text?: unknown } }
        return typeof m.path?.text !== 'string' || !isSensitiveEither(resolve(dir, m.path.text), null)
      })
    }
    return data
  }
}

/** Quita claves de credenciales (`key`, `apiKey`, `token`, `headers`…) de la configuración de proveedores. */
export function stripSecretKeys(v: unknown, depth = 0): unknown {
  if (depth > 32) return null
  if (Array.isArray(v)) return v.map((x) => stripSecretKeys(x, depth + 1))
  if (v === null || typeof v !== 'object') return v
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (/^(api[_-]?key|key|token|secret|password|authorization|headers?|access[_-]?token|refresh[_-]?token)$/i.test(k)) continue
    out[k] = stripSecretKeys(x, depth + 1)
  }
  return out
}

/** `model-unknown:<proveedor/modelo>` para el registro (ids de modelo, nunca secretos; solo caracteres seguros). */
function modelDetail(body: unknown, reason: string): string {
  const m =
    typeof body === 'object' && body !== null ? ((body as Record<string, unknown>).model as Record<string, unknown> | undefined) : undefined
  const key = m && typeof m.providerID === 'string' && typeof m.modelID === 'string' ? `${m.providerID}/${m.modelID}` : ''
  return /^[A-Za-z0-9._/-]{1,70}$/.test(key) ? `${reason}:${key}` : reason
}
