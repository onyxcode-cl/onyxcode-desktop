/**
 * `fetch` del SDK v2 de OpenCode sobre el puente del celular.
 *
 * El renderer recibe `baseUrl = onyx://engine/main` (o `onyx://engine/task/<token>`, sin credenciales: las pone el Mac). El
 * SDK construye un `Request` normal y llama a `fetch(request)`. Este `fetch`:
 *  - reescribe `onyx://engine/<motor>/<ruta>?<query>` a una trama `http{eng,method,path,query,headers,body}` (el Mac valida,
 *    pone la contraseña y devuelve `{status,contentType?,body,encoding?}`) y la rehace en un `Response` normal;
 *  - sirve el SSE (`GET /global/event` y `/event`) con `sub`/`ev` (ver `events-hub.ts`) como un `Response` con
 *    `ReadableStream` en formato SSE; al abrir emite `server.connected`, que dispara el `onOpen` de `lib/opencode.ts` y con él la
 *    resincronización de `stores/server.ts`;
 *  - propaga el `AbortSignal` al multiplexor (`cancel`); los chunks de subida/bajada y el base64 son transparentes;
 *  - falla con errores tipados (`RemoteLinkError`: `disconnected`, `forbidden`, `locked`, `unavailable`, `busy`…);
 *  - NUNCA reintenta: un fallo es definitivo (una mutación repetida por su cuenta podría ejecutarse dos veces).
 * Cualquier otra URL se delega en el `fetch` original (en el celular el navegador solo habla con su propio origen).
 */
import {
  RemoteLinkError,
  abortError,
  isAbortError,
  toLinkError,
  type HttpResult,
  type LinkErrorCode,
  type RemoteLink
} from '@shared/remote/link'
import type { HttpHeaders, HttpMethod } from '@shared/remote/protocol'
import type { EventsHub, OcEventIn } from './events-hub'

export const ENGINE_SCHEME = 'onyx://engine/'
const ENGINE_RE = /^(main|task\/[A-Za-z0-9_-]{8,64})(\/[^?#]*)?(?:\?([^#]*))?/
const METHODS: ReadonlySet<string> = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const NO_BODY_STATUS: ReadonlySet<number> = new Set([101, 204, 205, 304])
const SSE_PATH = /^\/(global\/)?event$/

export interface EngineFetchOptions {
  link: RemoteLink
  events: EventsHub
  /** Texto legible de un código de error (idioma de la interfaz). */
  text: (code: LinkErrorCode) => string
  /** `fetch` para todo lo que no sea del motor. */
  fallback?: typeof fetch
}

export interface EngineTarget {
  eng: string
  path: string
  query: Record<string, string>
}

/** `onyx://engine/main/session?directory=%2Fx` → `{eng:'main', path:'/session', query:{directory:'/x'}}` (`null` si no es del motor). */
export function parseEngineUrl(url: string): EngineTarget | null {
  if (!url.startsWith(ENGINE_SCHEME)) return null
  const m = ENGINE_RE.exec(url.slice(ENGINE_SCHEME.length))
  if (!m) return null
  const query: Record<string, string> = {}
  if (m[3]) for (const [k, v] of new URLSearchParams(m[3])) query[k] = v
  return { eng: m[1] as string, path: m[2] ?? '/', query }
}

export function isEngineUrl(input: RequestInfo | URL): boolean {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  return url.startsWith(ENGINE_SCHEME)
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function isHttpResult(v: unknown): v is HttpResult {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    typeof r.status === 'number' &&
    Number.isInteger(r.status) &&
    r.status >= 200 &&
    r.status <= 599 &&
    typeof r.body === 'string' &&
    (r.encoding === undefined || r.encoding === 'base64') &&
    (r.contentType === undefined || typeof r.contentType === 'string')
  )
}

/** Respuesta HTTP normal a partir de lo que devolvió el Mac. */
export function toResponse(r: HttpResult): Response {
  const headers = new Headers()
  if (r.contentType) headers.set('content-type', r.contentType)
  if (NO_BODY_STATUS.has(r.status) || r.body === '') return new Response(null, { status: r.status, headers })
  return new Response(r.encoding === 'base64' ? fromBase64(r.body) : r.body, { status: r.status, headers })
}

const enc = new TextEncoder()
const sseFrame = (id: number | null, data: unknown): Uint8Array =>
  enc.encode(`${id === null ? '' : `id: ${id}\n`}data: ${JSON.stringify(data)}\n\n`)

/** Evento del Mac (`oc`/`p`) → `GlobalEvent` del SDK (`{directory, payload:{id?, type, properties}}`). */
export function globalEvent(ev: OcEventIn): unknown {
  const p = typeof ev.p === 'object' && ev.p !== null ? (ev.p as { directory?: unknown; id?: unknown; properties?: unknown }) : {}
  return {
    directory: typeof p.directory === 'string' ? p.directory : 'global',
    payload: { ...(typeof p.id === 'string' ? { id: p.id } : {}), type: ev.oc, properties: p.properties ?? {} }
  }
}

export function createEngineFetch(o: EngineFetchOptions): typeof fetch {
  const orig = o.fallback ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined)
  const fail = (e: unknown): never => {
    throw toLinkError(e, o.text)
  }

  const openSse = async (eng: string, signal: AbortSignal): Promise<Response> => {
    let ctrl!: ReadableStreamDefaultController<Uint8Array>
    let closed = false
    let unsub: (() => void) | null = null
    const finish = (err?: Error): void => {
      if (closed) return
      closed = true
      unsub?.()
      signal.removeEventListener('abort', onAbort)
      try {
        if (err) ctrl.error(err)
        else ctrl.close()
      } catch {
        /* ya cerrado por el lector */
      }
    }
    const onAbort = (): void => finish()
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        ctrl = c
        // Igual que el servidor real: lo primero que llega es `server.connected` (dispara `onOpen` → resincronización).
        c.enqueue(sseFrame(null, { directory: 'global', payload: { type: 'server.connected', properties: {} } }))
      },
      cancel() {
        closed = true
        unsub?.()
        signal.removeEventListener('abort', onAbort)
      }
    })
    try {
      unsub = await o.events.openStream(
        eng,
        {
          onEvent: (ev) => {
            if (!closed) ctrl.enqueue(sseFrame(ev.seq, globalEvent(ev)))
          },
          // Hueco o reinicio del Mac: se cierra y el cliente vuelve a abrir (y resincroniza con `onOpen`).
          onReset: () => finish(),
          onEnd: (why) => finish(toLinkError({ code: why === 'disconnected' ? 'offline' : why }, o.text))
        },
        signal
      )
    } catch (e) {
      if (signal.aborted) throw abortError()
      const why = e instanceof Error ? e.message : ''
      return fail({ code: why === 'offline' ? 'offline' : why })
    }
    if (closed) {
      // Terminó mientras se devolvía (p. ej. el canal cayó justo después del acuse).
      unsub()
    } else signal.addEventListener('abort', onAbort, { once: true })
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } })
  }

  return async (input, init) => {
    const isReq = typeof Request !== 'undefined' && input instanceof Request
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const target = parseEngineUrl(url)
    if (!target) {
      if (url.startsWith(ENGINE_SCHEME)) return fail(new RemoteLinkError('bad-request', o.text('bad-request')))
      if (!orig) throw new TypeError('fetch no disponible')
      return orig(input, init)
    }
    const method = (init?.method ?? (isReq ? (input as Request).method : 'GET')).toUpperCase()
    const signal: AbortSignal | undefined = init?.signal ?? (isReq ? (input as Request).signal : undefined) ?? undefined
    if (signal?.aborted) throw abortError()
    if (!METHODS.has(method)) return fail(new RemoteLinkError('unsupported', o.text('unsupported')))

    if (method === 'GET' && SSE_PATH.test(target.path)) return openSse(target.eng, signal ?? new AbortController().signal)

    const hdrs = new Headers(init?.headers ?? (isReq ? (input as Request).headers : undefined))
    const headers: HttpHeaders = {}
    const ct = hdrs.get('content-type')
    const accept = hdrs.get('accept')
    if (ct) headers['content-type'] = ct
    if (accept) headers.accept = accept
    let body: string | undefined
    if (method !== 'GET') {
      try {
        if (isReq && init?.body === undefined) body = await (input as Request).clone().text()
        else if (typeof init?.body === 'string') body = init.body
        else if (init?.body != null) body = await new Response(init.body).text()
      } catch {
        return fail(new RemoteLinkError('bad-request', o.text('bad-request')))
      }
      if (body === '') body = undefined
      if (body !== undefined && !headers['content-type']) headers['content-type'] = 'application/json'
    }
    let result: unknown
    try {
      result = await o.link.http(
        {
          eng: target.eng,
          method: method as HttpMethod,
          path: target.path,
          ...(Object.keys(target.query).length ? { query: target.query } : {}),
          ...(Object.keys(headers).length ? { headers } : {}),
          ...(body !== undefined ? { body } : {})
        },
        signal
      )
    } catch (e) {
      if (isAbortError(e)) throw e
      return fail(e)
    }
    if (!isHttpResult(result)) return fail(new RemoteLinkError('failed', o.text('failed')))
    return toResponse(result)
  }
}
