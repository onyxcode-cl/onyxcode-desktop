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
 *
 * PROTOCOLO v2 (F8-B51): además de las tramas anteriores (`req`/`res` con `m`/`evt`, que siguen sirviendo a la
 * lista blanca del prototipo), el canal transporta un multiplexor (`mux.ts`) con `call`, `http`, `res`, `chunk`,
 * `sub`, `ev`, `reset`, `cancel` y `credit`. Aquí solo están sus TIPOS, LÍMITES y VALIDADORES estrictos; el
 * despacho a IPC/HTTP lo inyecta quien use el multiplexor (por defecto no hay ninguno: todo se rechaza).
 * Un celular con la versión 1 recibe `error{code:'version'}` por señalización y nunca llega a abrir canal.
 */

export const PROTOCOL_VERSION = 2

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
  maxPermissionSummaryChars: 300,

  // --- Protocolo v2 (multiplexor) ---
  /** Datos de texto por trama `chunk` (ya escapados en JSON; la trama completa cabe de sobra en 64 KiB). */
  chunkBytes: 56 * 1024,
  /** Tope de un mensaje lógico ensamblado: subida (celular -> Mac, adjuntos) y bajada (Mac -> celular). */
  maxUploadBytes: 16 * 1024 * 1024,
  maxDownloadBytes: 8 * 1024 * 1024,
  /** Suma máxima de mensajes en ensamblado a la vez (por conexión). */
  maxAssemblingBytes: 32 * 1024 * 1024,
  /** Ventana de crédito por transferencia/stream, en bytes de trama. */
  creditWindowBytes: 256 * 1024,
  /** El receptor devuelve crédito en bloques de al menos esto. */
  creditGrantBytes: 32 * 1024,
  maxInFlightCalls: 32,
  maxStreams: 6,
  /** Búfer circular de eventos para reanudar con `since`. */
  eventRingMs: 30_000,
  eventRingBytes: 2 * 1024 * 1024,
  /** Lecturas por segundo sostenidas y ráfaga (`call`/`http`/`sub`); las mutaciones las acota la política. */
  callsPerSecond: 40,
  callBurst: 120,
  mutationsPerSecond: 5,
  confirmationsPending: 2,
  confirmationsPerMinute: 10,
  /** Tramas de transferencia (`chunk`/`credit`/`cancel`) por segundo: red de seguridad contra inundación. */
  frameFloodPerSecond: 1500,
  frameFloodBurst: 3000,
  maxChannelChars: 96,
  maxPathChars: 512,
  maxQueryEntries: 32,
  maxQueryValueChars: 2048,
  maxErrorMsgChars: 200,

  // --- Acceso (T6): PIN, bloqueo por inactividad y «recordar» la confirmación de conexión ---
  pinDigits: 6,
  /** Fallos de PIN seguidos tras los que se revoca el dispositivo. */
  pinMaxFails: 5,
  /** Inactividad (sin llamadas del celular) tras la que el Mac vuelve a pedir el PIN. */
  inactivityLockMs: 5 * 60_000,
  /** «Recordar 12 h»: la confirmación de conexión de ese dispositivo vale este tiempo. */
  rememberMs: 12 * 60 * 60_000
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

/** PIN de 6 dígitos (se fija al vincular y se verifica DENTRO del canal ya autenticado; el Mac solo guarda su hash). */
export const PIN_RE = /^[0-9]{6}$/

export type PinFrame = { t: 'pin-set'; pin: string } | { t: 'pin-verify'; pin: string }

/** Bloqueo manual desde el celular («Bloquear ahora»): el Mac vuelve a pedir el PIN y no atiende nada hasta verificarlo. */
export type LockFrame = { t: 'lock' }

export type ClientFrame =
  { t: 'auth'; deviceId: string; secret: string } | { t: 'ping' } | LockFrame | PinFrame | RequestFrame | MuxClientFrame

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
/**
 * Por qué el canal autenticado todavía no da acceso: `confirm` (esperando que el dueño apruebe esta conexión en el Mac),
 * `pin-set` (hay que fijar el PIN), `pin-verify` (hay que verificarlo) o `inactive` (bloqueo por inactividad; pide el PIN).
 */
export type LockWhy = 'confirm' | 'pin-set' | 'pin-verify' | 'inactive'
export const LOCK_WHY: readonly string[] = ['confirm', 'pin-set', 'pin-verify', 'inactive']

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
  /** Sin acceso por ahora. `retryMs` = espera antes de reintentar el PIN; `left` = intentos que quedan antes de revocar. */
  | { t: 'locked'; why: LockWhy; retryMs?: number; left?: number }
  | { t: 'unlocked' }
  | { t: 'evt'; ev: RemoteEvent }
  | MuxHostFrame
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
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
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
    case 'lock':
      return onlyKeys(o, ['t']) ? { ok: true, value: { t: 'lock' } } : fail('extra-keys')
    case 'pin-set':
    case 'pin-verify':
      if (!onlyKeys(o, ['t', 'pin'])) return fail('extra-keys')
      if (typeof o.pin !== 'string' || !PIN_RE.test(o.pin)) return fail('bad-pin')
      return { ok: true, value: { t: o.t, pin: o.pin } }
    case 'req':
      return parseRequest(o)
    case 'call':
    case 'http':
    case 'sub':
    case 'cancel':
    case 'credit':
    case 'chunk':
      return parseMuxClient(o)
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
    case 'unlocked':
      return onlyKeys(o, ['t']) ? { ok: true, value: { t: 'unlocked' } } : fail('extra-keys')
    case 'locked': {
      if (!onlyKeys(o, ['t', 'why', 'retryMs', 'left'])) return fail('extra-keys')
      if (typeof o.why !== 'string' || !LOCK_WHY.includes(o.why)) return fail('bad-why')
      const isNum = (v: unknown, max: number): boolean => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max
      if (o.retryMs !== undefined && !isNum(o.retryMs, 3_600_000)) return fail('bad-retry')
      if (o.left !== undefined && !isNum(o.left, 100)) return fail('bad-left')
      const v: HostFrame = { t: 'locked', why: o.why as LockWhy }
      if (o.retryMs !== undefined) v.retryMs = o.retryMs as number
      if (o.left !== undefined) v.left = o.left as number
      return { ok: true, value: v }
    }
    case 'evt':
      if (!onlyKeys(o, ['t', 'ev']) || !isEvent(o.ev)) return fail('bad-event')
      return { ok: true, value: { t: 'evt', ev: o.ev } }
    case 'res':
      // `m` solo existe en el `res` exitoso del protocolo anterior; el de v2 lleva `data`/`ck` o `error` (superconjunto).
      return o.ok === true && 'm' in o ? parseResponse(o) : parseMuxHost(o)
    case 'ev':
    case 'reset':
    case 'credit':
    case 'chunk':
      return parseMuxHost(o)
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

// ---------------------------------------------------------------------------------------------
// Protocolo v2: tramas del multiplexor (ver `mux.ts`)
// ---------------------------------------------------------------------------------------------

export type MuxErrorCode = RemoteErrorCode | 'disconnected' | 'cancelled' | 'too-large' | 'unsupported'
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export interface HttpHeaders {
  'content-type'?: string
  accept?: string
}

/** `ck` = bytes UTF-8 totales del campo de datos, que viaja aparte en tramas `chunk` con el mismo `id`. */
export interface CallFrame {
  t: 'call'
  id: number
  ch: string
  p?: unknown
  ck?: number
}
export interface HttpFrame {
  t: 'http'
  id: number
  eng: string
  method: HttpMethod
  path: string
  query?: Record<string, string>
  headers?: HttpHeaders
  body?: string
  ck?: number
}
/** `since` = último `seq` recibido (reanudar); sin `since` = solo eventos nuevos. */
export interface SubFrame {
  t: 'sub'
  id: number
  eng: string
  since?: number
}
export interface CancelFrame {
  t: 'cancel'
  id: number
}
export interface CreditFrame {
  t: 'credit'
  id: number
  bytes: number
}
export interface ChunkFrame {
  t: 'chunk'
  id: number
  n: number
  last: boolean
  d: string
}
export type MuxClientFrame = CallFrame | HttpFrame | SubFrame | CancelFrame | CreditFrame | ChunkFrame

export type MuxResFrame =
  | { t: 'res'; id: number; ok: true; data?: unknown; ck?: number }
  | { t: 'res'; id: number; ok: false; error: { code: MuxErrorCode; msg?: string } }
/** Evento de un stream: `ch` = canal IPC, `oc` = tipo de evento de OpenCode. `seq` crece de 1 en 1 por motor. */
export interface EvFrame {
  t: 'ev'
  s: number
  seq: number
  ch?: string
  oc?: string
  p?: unknown
}
/** Hay un hueco: el celular debe resincronizar (el `onOpen` del renderer) y sigue desde `seq`. */
export interface ResetFrame {
  t: 'reset'
  s: number
  seq: number
}
export type MuxHostFrame = MuxResFrame | EvFrame | ResetFrame | CreditFrame | ChunkFrame

export const MUX_CLIENT_TYPES: readonly string[] = ['call', 'http', 'sub', 'cancel', 'credit', 'chunk']

/** ¿Es una trama del multiplexor (y no del protocolo anterior)? */
export function isMuxHostFrame(f: HostFrame): f is MuxHostFrame {
  if (f.t === 'res') return !('m' in f && f.ok === true)
  return f.t === 'ev' || f.t === 'reset' || f.t === 'credit' || f.t === 'chunk'
}
export function isMuxClientFrame(f: ClientFrame): f is MuxClientFrame {
  return MUX_CLIENT_TYPES.includes(f.t)
}

const CHANNEL_RE = /^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/
const ENGINE_RE = /^[A-Za-z0-9][A-Za-z0-9_./:-]{0,95}$/
const PATH_RE = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/
const QUERY_KEY_RE = /^[A-Za-z0-9_.-]{1,64}$/
const MUX_ERR: readonly string[] = [...ERR, 'disconnected', 'cancelled', 'too-large', 'unsupported']
const HTTP_METHODS: readonly string[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

function isSeq(v: unknown, min: number): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= min
}

/** Ruta HTTP: absoluta, sin segmentos `.`/`..`, sin `//` y sin separadores codificados (`%2e`, `%2f`, `%5c`). */
export function isSafeHttpPath(path: unknown): path is string {
  if (typeof path !== 'string' || path.length > LIMITS.maxPathChars || !PATH_RE.test(path)) return false
  if (/%(2e|2f|5c|00)/i.test(path) || path.includes('//')) return false
  return !path.split('/').some((seg) => seg === '.' || seg === '..')
}

function parseMuxClient(o: Obj): Parsed<MuxClientFrame> {
  switch (o.t) {
    case 'call': {
      if (!onlyKeys(o, ['t', 'id', 'ch', 'p', 'ck'])) return fail('extra-keys')
      if (!isReqId(o.id)) return fail('bad-id')
      if (typeof o.ch !== 'string' || !CHANNEL_RE.test(o.ch)) return fail('bad-channel')
      if (o.ck !== undefined && (!isSeq(o.ck, 1) || o.ck > LIMITS.maxUploadBytes || 'p' in o)) return fail('bad-chunked')
      const f: CallFrame = { t: 'call', id: o.id, ch: o.ch }
      if ('p' in o) f.p = o.p
      if (o.ck !== undefined) f.ck = o.ck
      return { ok: true, value: f }
    }
    case 'http': {
      if (!onlyKeys(o, ['t', 'id', 'eng', 'method', 'path', 'query', 'headers', 'body', 'ck'])) return fail('extra-keys')
      if (!isReqId(o.id)) return fail('bad-id')
      if (typeof o.eng !== 'string' || !ENGINE_RE.test(o.eng)) return fail('bad-engine')
      if (typeof o.method !== 'string' || !HTTP_METHODS.includes(o.method)) return fail('bad-method')
      if (!isSafeHttpPath(o.path)) return fail('bad-path')
      const f: HttpFrame = { t: 'http', id: o.id, eng: o.eng, method: o.method as HttpMethod, path: o.path }
      if (o.query !== undefined) {
        if (!isObj(o.query)) return fail('bad-query')
        const keys = Object.keys(o.query)
        if (keys.length > LIMITS.maxQueryEntries) return fail('bad-query')
        const q: Record<string, string> = {}
        for (const k of keys) {
          const v = o.query[k]
          if (!QUERY_KEY_RE.test(k) || !isStr(v, LIMITS.maxQueryValueChars)) return fail('bad-query')
          q[k] = v
        }
        f.query = q
      }
      if (o.headers !== undefined) {
        if (!isObj(o.headers) || !onlyKeys(o.headers, ['content-type', 'accept'])) return fail('bad-headers')
        const h: HttpHeaders = {}
        for (const k of ['content-type', 'accept'] as const) {
          const v = o.headers[k]
          if (v === undefined) continue
          if (!isStr(v, 128, 1) || /[\u0000-\u001f\u007f]/.test(v)) return fail('bad-headers')
          h[k] = v
        }
        f.headers = h
      }
      if (o.body !== undefined) {
        if (typeof o.body !== 'string' || o.ck !== undefined) return fail('bad-body')
        f.body = o.body
      }
      if (o.ck !== undefined) {
        if (!isSeq(o.ck, 1) || o.ck > LIMITS.maxUploadBytes) return fail('bad-chunked')
        f.ck = o.ck
      }
      return { ok: true, value: f }
    }
    case 'sub': {
      if (!onlyKeys(o, ['t', 'id', 'eng', 'since'])) return fail('extra-keys')
      if (!isReqId(o.id)) return fail('bad-id')
      if (typeof o.eng !== 'string' || !ENGINE_RE.test(o.eng)) return fail('bad-engine')
      if (o.since !== undefined && !isSeq(o.since, 0)) return fail('bad-since')
      const f: SubFrame = { t: 'sub', id: o.id, eng: o.eng }
      if (o.since !== undefined) f.since = o.since
      return { ok: true, value: f }
    }
    case 'cancel':
      if (!onlyKeys(o, ['t', 'id']) || !isReqId(o.id)) return fail('bad-id')
      return { ok: true, value: { t: 'cancel', id: o.id } }
    case 'credit':
    case 'chunk':
      return parseTransfer(o) as Parsed<MuxClientFrame>
    default:
      return fail('unknown-type')
  }
}

function parseTransfer(o: Obj): Parsed<CreditFrame | ChunkFrame> {
  if (!isReqId(o.id)) return fail('bad-id')
  if (o.t === 'credit') {
    if (!onlyKeys(o, ['t', 'id', 'bytes']) || !isSeq(o.bytes, 1) || o.bytes > LIMITS.maxUploadBytes) return fail('bad-credit')
    return { ok: true, value: { t: 'credit', id: o.id, bytes: o.bytes } }
  }
  if (!onlyKeys(o, ['t', 'id', 'n', 'last', 'd'])) return fail('extra-keys')
  if (!isSeq(o.n, 0) || o.n > 1_000_000 || typeof o.last !== 'boolean') return fail('bad-chunk')
  if (typeof o.d !== 'string' || o.d.length < 1 || utf8Length(o.d) > LIMITS.chunkBytes) return fail('bad-chunk')
  return { ok: true, value: { t: 'chunk', id: o.id, n: o.n, last: o.last, d: o.d } }
}

function parseMuxHost(o: Obj): Parsed<MuxHostFrame> {
  switch (o.t) {
    case 'res': {
      if (!isReqId(o.id)) return fail('bad-id')
      if (o.ok === false) {
        if (!onlyKeys(o, ['t', 'id', 'ok', 'error'])) return fail('extra-keys')
        const e = o.error
        if (!isObj(e) || !onlyKeys(e, ['code', 'msg']) || typeof e.code !== 'string' || !MUX_ERR.includes(e.code)) return fail('bad-error')
        if (e.msg !== undefined && !isStr(e.msg, LIMITS.maxErrorMsgChars)) return fail('bad-error')
        const error: { code: MuxErrorCode; msg?: string } = { code: e.code as MuxErrorCode }
        if (e.msg !== undefined) error.msg = e.msg
        return { ok: true, value: { t: 'res', id: o.id, ok: false, error } }
      }
      if (o.ok !== true || !onlyKeys(o, ['t', 'id', 'ok', 'data', 'ck'])) return fail('bad-response')
      if (o.ck !== undefined && (!isSeq(o.ck, 1) || o.ck > LIMITS.maxDownloadBytes || 'data' in o)) return fail('bad-chunked')
      const f: MuxResFrame = { t: 'res', id: o.id, ok: true }
      if ('data' in o) f.data = o.data
      if (o.ck !== undefined) f.ck = o.ck
      return { ok: true, value: f }
    }
    case 'ev': {
      if (!onlyKeys(o, ['t', 's', 'seq', 'ch', 'oc', 'p'])) return fail('extra-keys')
      if (!isReqId(o.s) || !isSeq(o.seq, 1)) return fail('bad-seq')
      if ((o.ch === undefined) === (o.oc === undefined)) return fail('bad-event')
      const name = o.ch ?? o.oc
      if (typeof name !== 'string' || !CHANNEL_RE.test(name)) return fail('bad-event')
      const f: EvFrame = { t: 'ev', s: o.s, seq: o.seq }
      if (o.ch !== undefined) f.ch = o.ch as string
      else f.oc = o.oc as string
      if ('p' in o) f.p = o.p
      return { ok: true, value: f }
    }
    case 'reset':
      if (!onlyKeys(o, ['t', 's', 'seq']) || !isReqId(o.s) || !isSeq(o.seq, 0)) return fail('bad-seq')
      return { ok: true, value: { t: 'reset', s: o.s, seq: o.seq } }
    case 'credit':
    case 'chunk':
      return parseTransfer(o) as Parsed<MuxHostFrame>
    default:
      return fail('unknown-type')
  }
}
