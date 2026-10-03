/**
 * Contrato del control remoto desde el celular (prototipo, solo red local).
 *
 * Lo comparten el escritorio (`src/main/remote`) y la PWA (`pwa/`): TypeScript puro, sin Node ni DOM,
 * sin dependencias. Define tres cosas:
 *
 *  1. SEÑALIZACIÓN (WebSocket `ws://<ip>:<puerto>/ws`, tramas JSON de texto): solo sirve para
 *     intercambiar SDP/ICE. Nada de lo que viaja por aquí es confidencial salvo el secreto de un solo
 *     uso del QR (`hello` en modo `pair`).
 *  2. DATACHANNEL (cifrado DTLS, un canal ordenado y fiable llamado `onyx`, tramas JSON de texto de
 *     ≤ 64 KiB): autenticación, peticiones de la lista blanca, respuestas y eventos.
 *  3. LÍMITES y VALIDADORES estrictos: ambos lados validan todo lo que reciben; lo desconocido se
 *     rechaza (nunca se ignora en silencio).
 *
 * Flujo de vinculación (QR): el escritorio muestra `http://<ip-privada>:<puerto>/#s=<secreto 32 B base64url>`.
 * El secreto va en el fragmento (el navegador no lo envía al servidor). El celular abre el WebSocket de
 * señalización y manda `hello{mode:'pair', secret, deviceName}`; si es válido (un solo uso, 120 s) el
 * servidor responde `ready` y el celular manda `offer`. El escritorio responde `answer`. Cuando el canal
 * abre, ambos lados calculan el mismo código de 6 dígitos a partir de las huellas DTLS de los dos SDP
 * (`pairingCode` en `code.ts`); el escritorio pide confirmación local mostrando ese código y, al aceptar,
 * entrega `paired{deviceId, deviceSecret}` POR EL DATACHANNEL.
 *
 * Reconexión: `hello{mode:'resume', deviceId}` por señalización (sin ningún secreto) + `offer`/`answer`;
 * al abrir el canal, el celular manda `auth{deviceId, secret}` POR EL DATACHANNEL como primera trama.
 *
 * Lista blanca de operaciones (única superficie): `sessions.list`, `session.messages`, `session.prompt`,
 * `session.abort`, `permission.reply` (solo `once` o `reject`; `always` no existe).
 */

export const PROTOCOL_VERSION = 1

/** Etiqueta del DataChannel que crea el celular. */
export const DATACHANNEL_LABEL = 'onyx'
/** Ruta del WebSocket de señalización en el servidor local. */
export const SIGNALING_PATH = '/ws'

export const LIMITS = {
  /** Tamaño máximo de una trama del DataChannel, en bytes UTF-8 (entrante y saliente). */
  maxFrameBytes: 64 * 1024,
  /** Tamaño máximo de una trama de señalización (un SDP ronda 1–6 KB). */
  maxSignalFrameBytes: 32 * 1024,
  maxSdpChars: 24 * 1024,
  maxIceChars: 1024,
  maxMidChars: 64,
  /** Peticiones por segundo sostenidas y ráfaga (cubo de fichas). */
  requestsPerSecond: 10,
  requestBurst: 20,
  promptsPerMinute: 6,
  /** Violaciones (trama inválida, fuera de lista, límite excedido) tras las que se corta la conexión. */
  maxViolations: 3,
  maxPromptChars: 8000,
  maxMessagesPerRequest: 50,
  defaultMessagesPerRequest: 30,
  maxSessionsListed: 50,
  maxDeviceNameChars: 40,
  maxDevices: 3,
  /** Caducidad del secreto del QR. */
  pairingTtlMs: 120_000,
  /** Plazo para que el dueño confirme «¿Vincular este dispositivo?» en el escritorio. */
  confirmTtlMs: 60_000,
  /** Plazo para recibir `auth` tras abrir el canal en una reconexión. */
  authTimeoutMs: 10_000,
  /** El modo se apaga solo tras este tiempo sin conexiones. */
  idleShutdownMs: 30 * 60_000,
  /** Sockets de señalización simultáneos en el servidor local. */
  maxSignalSockets: 2,
  secretBytes: 32,
  /** Recortes de contenido que sale hacia el celular. */
  maxTextPartChars: 12_000,
  maxToolSummaryChars: 200,
  maxPartsPerMessage: 40,
  maxTitleChars: 120,
  maxPermissionSummaryChars: 300
} as const

// ---------------------------------------------------------------------------------------------
// Identificadores
// ---------------------------------------------------------------------------------------------

/** Ids de sesión/mensaje/permiso de OpenCode (`ses_…`, `msg_…`, `per_…`). */
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
/** Id de dispositivo vinculado: 16 bytes en hex. */
export const DEVICE_ID_RE = /^[0-9a-f]{32}$/
/** Secreto de 32 bytes en base64url sin relleno. */
export const SECRET_RE = /^[A-Za-z0-9_-]{43}$/

export type Reply = 'once' | 'reject'

// ---------------------------------------------------------------------------------------------
// Señalización
// ---------------------------------------------------------------------------------------------

export type SignalClientFrame =
  | { t: 'hello'; v: number; mode: 'pair'; secret: string; deviceName: string }
  | { t: 'hello'; v: number; mode: 'resume'; deviceId: string }
  | { t: 'offer'; sdp: string }
  | { t: 'ice'; candidate: string; mid: string }

export type SignalErrorCode =
  /** Secreto inválido/caducado/ya usado, dispositivo desconocido o modo apagado (no se distingue a propósito). */
  'invalid' | 'version' | 'busy' | 'frame'

export type SignalHostFrame =
  { t: 'ready' } | { t: 'answer'; sdp: string } | { t: 'ice'; candidate: string; mid: string } | { t: 'error'; code: SignalErrorCode }

// ---------------------------------------------------------------------------------------------
// DataChannel: celular -> escritorio
// ---------------------------------------------------------------------------------------------

export type RequestParams = {
  'sessions.list': Record<string, never>
  'session.messages': { sessionId: string; limit: number; before?: string }
  'session.prompt': { sessionId: string; text: string }
  'session.abort': { sessionId: string }
  'permission.reply': { requestId: string; reply: Reply }
}
export type RequestMethod = keyof RequestParams
export const REQUEST_METHODS: readonly RequestMethod[] = [
  'sessions.list',
  'session.messages',
  'session.prompt',
  'session.abort',
  'permission.reply'
]

export type RequestFrame = {
  [M in RequestMethod]: { t: 'req'; id: number; m: M; p: RequestParams[M] }
}[RequestMethod]

export type ClientFrame = { t: 'auth'; deviceId: string; secret: string } | { t: 'ping' } | RequestFrame

// ---------------------------------------------------------------------------------------------
// Datos que salen hacia el celular (ya recortados por el escritorio)
// ---------------------------------------------------------------------------------------------

export type SessionStatus = 'idle' | 'busy'

export interface RemoteSession {
  id: string
  title: string
  /** `chat` (conversaciones) o `code` (proyectos recientes). Las sesiones de Tareas nunca se exponen. */
  kind: 'chat' | 'code'
  /** Solo el NOMBRE de la carpeta del proyecto (nunca la ruta absoluta). */
  project?: string
  /** ms desde epoch de la última actividad. */
  updatedAt: number
  status: SessionStatus
}

export type RemotePart =
  { type: 'text'; text: string } | { type: 'tool'; name: string; summary: string; status: 'running' | 'done' | 'error' }

export interface RemoteMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  createdAt: number
  parts: RemotePart[]
  /** Mensaje del asistente aún en curso. */
  streaming?: boolean
}

export interface RemotePermission {
  requestId: string
  sessionId: string
  /** Texto corto ya localizado por el escritorio (p. ej. «Ejecutar un comando»). */
  title: string
  /** Resumen sin rutas absolutas ni secretos. */
  summary: string
  /** `false` = solo lectura en el celular: «Apruébalo en el Mac» (Control del Mac, plan-gate, carpetas). */
  actionable: boolean
}

export interface RequestResults {
  'sessions.list': { sessions: RemoteSession[]; permissions: RemotePermission[] }
  'session.messages': { sessionId: string; messages: RemoteMessage[]; hasMore: boolean }
  'session.prompt': { accepted: true }
  'session.abort': { aborted: true }
  'permission.reply': { replied: true }
}

export type RemoteErrorCode = 'bad-request' | 'rate-limited' | 'not-found' | 'forbidden' | 'busy' | 'unavailable' | 'failed'

export type RemoteEvent =
  | { e: 'session.updated'; session: RemoteSession }
  | { e: 'session.removed'; sessionId: string }
  | { e: 'message.updated'; message: RemoteMessage }
  | { e: 'permission.asked'; permission: RemotePermission }
  | { e: 'permission.resolved'; requestId: string }

export type ByeReason = 'revoked' | 'stopped' | 'violations' | 'idle' | 'other-device' | 'timeout'
export type DeniedReason = 'rejected' | 'timeout' | 'limit'

// ---------------------------------------------------------------------------------------------
// DataChannel: escritorio -> celular
// ---------------------------------------------------------------------------------------------

export type HostFrame =
  /** Vinculación: esperando que el dueño confirme en el escritorio. */
  | { t: 'pair-pending' }
  /** Vinculación aceptada: el celular guarda `deviceId` y `deviceSecret` (el escritorio solo guarda su hash). */
  | { t: 'paired'; deviceId: string; deviceSecret: string }
  | { t: 'denied'; reason: DeniedReason }
  | { t: 'authed' }
  | { t: 'auth-failed' }
  | { t: 'pong' }
  | { t: 'bye'; reason: ByeReason }
  | { t: 'evt'; ev: RemoteEvent }
  | {
      [M in RequestMethod]:
        | { t: 'res'; id: number; ok: true; m: M; result: RequestResults[M] }
        | { t: 'res'; id: number; ok: false; error: { code: RemoteErrorCode } }
    }[RequestMethod]

// ---------------------------------------------------------------------------------------------
// Validadores
// ---------------------------------------------------------------------------------------------

export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string }

type Obj = Record<string, unknown>

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason })

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** El objeto solo tiene estas claves (lo desconocido se rechaza). */
function onlyKeys(o: Obj, keys: readonly string[]): boolean {
  for (const k of Object.keys(o)) if (!keys.includes(k)) return false
  return true
}

function isStr(v: unknown, max: number, min = 0): v is string {
  return typeof v === 'string' && v.length >= min && v.length <= max
}

function isId(v: unknown): v is string {
  return typeof v === 'string' && ID_RE.test(v)
}

function isReqId(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 && v <= 0x7fffffff
}

/** Bytes UTF-8 de una cadena (sin `Buffer`, válido en navegador y en Node). */
export function utf8Length(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      n += 4
      i++
    } else n += 3
  }
  return n
}

/** Nombre del dispositivo: sin caracteres de control ni saltos; recortado y con espacios normalizados. */
export function sanitizeDeviceName(raw: string): string {
  let clean = ''
  for (const ch of raw) {
    const c = ch.codePointAt(0) as number
    const bad =
      c <= 0x1f || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029 || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)
    clean += bad ? ' ' : ch
  }
  return clean.replace(/\s+/g, ' ').trim().slice(0, LIMITS.maxDeviceNameChars)
}

function parseJson(raw: unknown, maxBytes: number): Parsed<Obj> {
  if (typeof raw !== 'string') return fail('not-text')
  if (raw.length > maxBytes || utf8Length(raw) > maxBytes) return fail('too-large')
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return fail('bad-json')
  }
  if (!isObj(v)) return fail('not-object')
  return { ok: true, value: v }
}

export function parseSignalClientFrame(raw: unknown): Parsed<SignalClientFrame> {
  const j = parseJson(raw, LIMITS.maxSignalFrameBytes)
  if (!j.ok) return j
  const o = j.value
  switch (o.t) {
    case 'hello': {
      if (typeof o.v !== 'number' || !Number.isInteger(o.v)) return fail('bad-version')
      if (o.mode === 'pair') {
        if (!onlyKeys(o, ['t', 'v', 'mode', 'secret', 'deviceName'])) return fail('extra-keys')
        if (typeof o.secret !== 'string' || !SECRET_RE.test(o.secret)) return fail('bad-secret')
        if (!isStr(o.deviceName, 200)) return fail('bad-name')
        const deviceName = sanitizeDeviceName(o.deviceName)
        return { ok: true, value: { t: 'hello', v: o.v, mode: 'pair', secret: o.secret, deviceName } }
      }
      if (o.mode === 'resume') {
        if (!onlyKeys(o, ['t', 'v', 'mode', 'deviceId'])) return fail('extra-keys')
        if (typeof o.deviceId !== 'string' || !DEVICE_ID_RE.test(o.deviceId)) return fail('bad-device')
        return { ok: true, value: { t: 'hello', v: o.v, mode: 'resume', deviceId: o.deviceId } }
      }
      return fail('bad-mode')
    }
    case 'offer': {
      if (!onlyKeys(o, ['t', 'sdp'])) return fail('extra-keys')
      if (!isStr(o.sdp, LIMITS.maxSdpChars, 10)) return fail('bad-sdp')
      return { ok: true, value: { t: 'offer', sdp: o.sdp } }
    }
    case 'ice': {
      if (!onlyKeys(o, ['t', 'candidate', 'mid'])) return fail('extra-keys')
      if (!isStr(o.candidate, LIMITS.maxIceChars, 1) || !isStr(o.mid, LIMITS.maxMidChars)) return fail('bad-ice')
      return { ok: true, value: { t: 'ice', candidate: o.candidate, mid: o.mid } }
    }
    default:
      return fail('unknown-type')
  }
}

export function parseSignalHostFrame(raw: unknown): Parsed<SignalHostFrame> {
  const j = parseJson(raw, LIMITS.maxSignalFrameBytes)
  if (!j.ok) return j
  const o = j.value
  switch (o.t) {
    case 'ready':
      return onlyKeys(o, ['t']) ? { ok: true, value: { t: 'ready' } } : fail('extra-keys')
    case 'answer':
      if (!onlyKeys(o, ['t', 'sdp']) || !isStr(o.sdp, LIMITS.maxSdpChars, 10)) return fail('bad-sdp')
      return { ok: true, value: { t: 'answer', sdp: o.sdp } }
    case 'ice':
      if (!onlyKeys(o, ['t', 'candidate', 'mid'])) return fail('extra-keys')
      if (!isStr(o.candidate, LIMITS.maxIceChars, 1) || !isStr(o.mid, LIMITS.maxMidChars)) return fail('bad-ice')
      return { ok: true, value: { t: 'ice', candidate: o.candidate, mid: o.mid } }
    case 'error': {
      const code = o.code
      if (!onlyKeys(o, ['t', 'code'])) return fail('extra-keys')
      if (code !== 'invalid' && code !== 'version' && code !== 'busy' && code !== 'frame') return fail('bad-code')
      return { ok: true, value: { t: 'error', code } }
    }
    default:
      return fail('unknown-type')
  }
}

/** Valida una trama del celular recibida por el DataChannel (lado escritorio). Estricta. */
export function parseClientFrame(raw: unknown): Parsed<ClientFrame> {
  const j = parseJson(raw, LIMITS.maxFrameBytes)
  if (!j.ok) return j
  const o = j.value
  switch (o.t) {
    case 'ping':
      return onlyKeys(o, ['t']) ? { ok: true, value: { t: 'ping' } } : fail('extra-keys')
    case 'auth': {
      if (!onlyKeys(o, ['t', 'deviceId', 'secret'])) return fail('extra-keys')
      if (typeof o.deviceId !== 'string' || !DEVICE_ID_RE.test(o.deviceId)) return fail('bad-device')
      if (typeof o.secret !== 'string' || !SECRET_RE.test(o.secret)) return fail('bad-secret')
      return { ok: true, value: { t: 'auth', deviceId: o.deviceId, secret: o.secret } }
    }
    case 'req':
      return parseRequest(o)
    default:
      return fail('unknown-type')
  }
}

function parseRequest(o: Obj): Parsed<RequestFrame> {
  if (!onlyKeys(o, ['t', 'id', 'm', 'p'])) return fail('extra-keys')
  if (!isReqId(o.id)) return fail('bad-id')
  const id = o.id
  const p = o.p
  if (!isObj(p)) return fail('bad-params')
  switch (o.m) {
    case 'sessions.list':
      if (Object.keys(p).length !== 0) return fail('extra-keys')
      return { ok: true, value: { t: 'req', id, m: 'sessions.list', p: {} } }
    case 'session.messages': {
      if (!onlyKeys(p, ['sessionId', 'limit', 'before'])) return fail('extra-keys')
      if (!isId(p.sessionId)) return fail('bad-session')
      const limit = p.limit === undefined ? LIMITS.defaultMessagesPerRequest : p.limit
      if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > LIMITS.maxMessagesPerRequest)
        return fail('bad-limit')
      if (p.before !== undefined && !isId(p.before)) return fail('bad-before')
      const params: RequestParams['session.messages'] = { sessionId: p.sessionId, limit }
      if (p.before !== undefined) params.before = p.before
      return { ok: true, value: { t: 'req', id, m: 'session.messages', p: params } }
    }
    case 'session.prompt': {
      if (!onlyKeys(p, ['sessionId', 'text'])) return fail('extra-keys')
      if (!isId(p.sessionId)) return fail('bad-session')
      if (typeof p.text !== 'string' || p.text.trim().length === 0 || p.text.length > LIMITS.maxPromptChars) return fail('bad-text')
      return { ok: true, value: { t: 'req', id, m: 'session.prompt', p: { sessionId: p.sessionId, text: p.text } } }
    }
    case 'session.abort': {
      if (!onlyKeys(p, ['sessionId'])) return fail('extra-keys')
      if (!isId(p.sessionId)) return fail('bad-session')
      return { ok: true, value: { t: 'req', id, m: 'session.abort', p: { sessionId: p.sessionId } } }
    }
    case 'permission.reply': {
      if (!onlyKeys(p, ['requestId', 'reply'])) return fail('extra-keys')
      if (!isId(p.requestId)) return fail('bad-request-id')
      if (p.reply !== 'once' && p.reply !== 'reject') return fail('bad-reply')
      return { ok: true, value: { t: 'req', id, m: 'permission.reply', p: { requestId: p.requestId, reply: p.reply } } }
    }
    default:
      return fail('method-not-allowed')
  }
}

// --- Validación de datos que salen (la usa la PWA al recibir y el escritorio en sus pruebas) ---

function isSession(v: unknown): v is RemoteSession {
  if (!isObj(v) || !onlyKeys(v, ['id', 'title', 'kind', 'project', 'updatedAt', 'status'])) return false
  return (
    isId(v.id) &&
    isStr(v.title, LIMITS.maxTitleChars) &&
    (v.kind === 'chat' || v.kind === 'code') &&
    (v.project === undefined || isStr(v.project, 200)) &&
    typeof v.updatedAt === 'number' &&
    Number.isFinite(v.updatedAt) &&
    (v.status === 'idle' || v.status === 'busy')
  )
}

function isPart(v: unknown): v is RemotePart {
  if (!isObj(v)) return false
  if (v.type === 'text') return onlyKeys(v, ['type', 'text']) && isStr(v.text, LIMITS.maxTextPartChars)
  if (v.type === 'tool')
    return (
      onlyKeys(v, ['type', 'name', 'summary', 'status']) &&
      isStr(v.name, 80) &&
      isStr(v.summary, LIMITS.maxToolSummaryChars) &&
      (v.status === 'running' || v.status === 'done' || v.status === 'error')
    )
  return false
}

function isMessage(v: unknown): v is RemoteMessage {
  if (!isObj(v) || !onlyKeys(v, ['id', 'sessionId', 'role', 'createdAt', 'parts', 'streaming'])) return false
  return (
    isId(v.id) &&
    isId(v.sessionId) &&
    (v.role === 'user' || v.role === 'assistant') &&
    typeof v.createdAt === 'number' &&
    Number.isFinite(v.createdAt) &&
    Array.isArray(v.parts) &&
    v.parts.length <= LIMITS.maxPartsPerMessage &&
    v.parts.every(isPart) &&
    (v.streaming === undefined || typeof v.streaming === 'boolean')
  )
}

function isPermission(v: unknown): v is RemotePermission {
  if (!isObj(v) || !onlyKeys(v, ['requestId', 'sessionId', 'title', 'summary', 'actionable'])) return false
  return (
    isId(v.requestId) &&
    isId(v.sessionId) &&
    isStr(v.title, LIMITS.maxTitleChars) &&
    isStr(v.summary, LIMITS.maxPermissionSummaryChars) &&
    typeof v.actionable === 'boolean'
  )
}

function isEvent(v: unknown): v is RemoteEvent {
  if (!isObj(v)) return false
  switch (v.e) {
    case 'session.updated':
      return onlyKeys(v, ['e', 'session']) && isSession(v.session)
    case 'session.removed':
      return onlyKeys(v, ['e', 'sessionId']) && isId(v.sessionId)
    case 'message.updated':
      return onlyKeys(v, ['e', 'message']) && isMessage(v.message)
    case 'permission.asked':
      return onlyKeys(v, ['e', 'permission']) && isPermission(v.permission)
    case 'permission.resolved':
      return onlyKeys(v, ['e', 'requestId']) && isId(v.requestId)
    default:
      return false
  }
}

const BYE: readonly string[] = ['revoked', 'stopped', 'violations', 'idle', 'other-device', 'timeout']
const DENIED: readonly string[] = ['rejected', 'timeout', 'limit']
const ERR: readonly string[] = ['bad-request', 'rate-limited', 'not-found', 'forbidden', 'busy', 'unavailable', 'failed']

/** Valida una trama del escritorio recibida por el DataChannel (lado PWA). */
export function parseHostFrame(raw: unknown): Parsed<HostFrame> {
  const j = parseJson(raw, LIMITS.maxFrameBytes)
  if (!j.ok) return j
  const o = j.value
  switch (o.t) {
    case 'pair-pending':
    case 'authed':
    case 'auth-failed':
    case 'pong':
      return onlyKeys(o, ['t']) ? { ok: true, value: { t: o.t } as HostFrame } : fail('extra-keys')
    case 'paired':
      if (!onlyKeys(o, ['t', 'deviceId', 'deviceSecret'])) return fail('extra-keys')
      if (typeof o.deviceId !== 'string' || !DEVICE_ID_RE.test(o.deviceId)) return fail('bad-device')
      if (typeof o.deviceSecret !== 'string' || !SECRET_RE.test(o.deviceSecret)) return fail('bad-secret')
      return { ok: true, value: { t: 'paired', deviceId: o.deviceId, deviceSecret: o.deviceSecret } }
    case 'denied':
      if (!onlyKeys(o, ['t', 'reason']) || typeof o.reason !== 'string' || !DENIED.includes(o.reason)) return fail('bad-reason')
      return { ok: true, value: { t: 'denied', reason: o.reason as DeniedReason } }
    case 'bye':
      if (!onlyKeys(o, ['t', 'reason']) || typeof o.reason !== 'string' || !BYE.includes(o.reason)) return fail('bad-reason')
      return { ok: true, value: { t: 'bye', reason: o.reason as ByeReason } }
    case 'evt':
      if (!onlyKeys(o, ['t', 'ev']) || !isEvent(o.ev)) return fail('bad-event')
      return { ok: true, value: { t: 'evt', ev: o.ev } }
    case 'res':
      return parseResponse(o)
    default:
      return fail('unknown-type')
  }
}

function parseResponse(o: Obj): Parsed<HostFrame> {
  if (!isReqId(o.id)) return fail('bad-id')
  const id = o.id
  if (o.ok === false) {
    if (!onlyKeys(o, ['t', 'id', 'ok', 'error'])) return fail('extra-keys')
    const e = o.error
    if (!isObj(e) || !onlyKeys(e, ['code']) || typeof e.code !== 'string' || !ERR.includes(e.code)) return fail('bad-error')
    return { ok: true, value: { t: 'res', id, ok: false, error: { code: e.code as RemoteErrorCode } } }
  }
  if (o.ok !== true || !onlyKeys(o, ['t', 'id', 'ok', 'm', 'result']) || !isObj(o.result)) return fail('bad-response')
  const r = o.result
  switch (o.m) {
    case 'sessions.list':
      if (!onlyKeys(r, ['sessions', 'permissions'])) return fail('extra-keys')
      if (!Array.isArray(r.sessions) || r.sessions.length > LIMITS.maxSessionsListed || !r.sessions.every(isSession))
        return fail('bad-sessions')
      if (!Array.isArray(r.permissions) || r.permissions.length > 50 || !r.permissions.every(isPermission)) return fail('bad-permissions')
      return {
        ok: true,
        value: { t: 'res', id, ok: true, m: 'sessions.list', result: { sessions: r.sessions, permissions: r.permissions } }
      }
    case 'session.messages':
      if (!onlyKeys(r, ['sessionId', 'messages', 'hasMore']) || !isId(r.sessionId) || typeof r.hasMore !== 'boolean')
        return fail('bad-messages')
      if (!Array.isArray(r.messages) || r.messages.length > LIMITS.maxMessagesPerRequest || !r.messages.every(isMessage))
        return fail('bad-messages')
      return {
        ok: true,
        value: {
          t: 'res',
          id,
          ok: true,
          m: 'session.messages',
          result: { sessionId: r.sessionId, messages: r.messages, hasMore: r.hasMore }
        }
      }
    case 'session.prompt':
      if (!onlyKeys(r, ['accepted']) || r.accepted !== true) return fail('bad-result')
      return { ok: true, value: { t: 'res', id, ok: true, m: 'session.prompt', result: { accepted: true } } }
    case 'session.abort':
      if (!onlyKeys(r, ['aborted']) || r.aborted !== true) return fail('bad-result')
      return { ok: true, value: { t: 'res', id, ok: true, m: 'session.abort', result: { aborted: true } } }
    case 'permission.reply':
      if (!onlyKeys(r, ['replied']) || r.replied !== true) return fail('bad-result')
      return { ok: true, value: { t: 'res', id, ok: true, m: 'permission.reply', result: { replied: true } } }
    default:
      return fail('method-not-allowed')
  }
}

/** Serializa una trama saliente y comprueba el límite de tamaño (devuelve `null` si no cabe). */
export function encodeFrame(frame: HostFrame | ClientFrame | SignalHostFrame | SignalClientFrame): string | null {
  const s = JSON.stringify(frame)
  return utf8Length(s) <= LIMITS.maxFrameBytes ? s : null
}
