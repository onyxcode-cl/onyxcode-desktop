/**
 * Contratos del «Modo viaje» (túnel rápido de Cloudflare, sin cuenta). Código PURO compartido entre el Mac, la interfaz de
 * Ajustes y la PWA: constantes, tipos del estado, formato del enlace y esquemas ESTRICTOS de los canales IPC nuevos
 * (`remote:travelInstall`, `remote:setTravelKeep`; los registra la interfaz de Ajustes en `main/ipc/schemas.ts`).
 *
 * Nada de aquí abre red ni procesos. Las reglas de seguridad que fija:
 *  - el nombre público del túnel solo vale si casa EXACTAMENTE con `https://<palabras>.trycloudflare.com` (sin puerto ni ruta);
 *  - la puerta previa `/k/<T>` y su galleta `__Host-` (T = 128 bits por túnel, solo en memoria);
 *  - el keepalive del WebSocket (Cloudflare corta a ~125 s sin tráfico);
 *  - el vínculo de viaje vale solo para ese túnel: se borra al cerrarlo.
 */
import type { RemoteState } from '../ipc-remote'

/** Servidores STUN públicos sin cuenta (dos proveedores; ambos ven las IP públicas, nada más). Sin TURN: exigiría cuenta. */
export const TRAVEL_STUN_URLS: readonly string[] = ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302']

const WORDS = '[a-z0-9]+(?:-[a-z0-9]+){1,7}'
/** Host público de un túnel rápido: 2–8 palabras separadas por guion. Sin puerto, sin ruta. */
export const TUNNEL_HOST_RE = new RegExp(`^(${WORDS})\\.trycloudflare\\.com$`)
/** Origen público exacto (`Origin` de la PWA y base del QR). */
export const TUNNEL_ORIGIN_RE = new RegExp(`^https://(${WORDS})\\.trycloudflare\\.com$`)
/**
 * Busca la URL en una línea de `stderr` de `cloudflared`. Estricta: el esquema es obligatorio (el aviso legal nombra
 * «trycloudflare.com» sin esquema y `https://www.cloudflare.com/…`, que NO casan) y tras el dominio solo puede venir un
 * espacio, `|` (el recuadro del banner) o el fin de la línea.
 */
export const TUNNEL_URL_SCAN_RE = new RegExp(`https://(${WORDS})\\.trycloudflare\\.com(?=$|[\\s|])`)

/** Ruta de la puerta previa: `GET /k/<T>` pone la galleta y redirige a `/`. */
export const TRAVEL_GATE_PREFIX = '/k/'
/** Nombre de la galleta de la puerta: el prefijo `__Host-` obliga a `Secure`, `Path=/` y sin `Domain`. */
export const TRAVEL_GATE_COOKIE = '__Host-onyxk'
/** Ruta de la autocomprobación del Mac (solo vale con un `nonce` recién generado, de un solo uso). */
export const TRAVEL_PROBE_PREFIX = '/__onyx/probe/'
/** Cloudflare sirve `/cdn-cgi/` en el mismo origen: no se usa ni se coloca nada bajo esa ruta. */
export const TRAVEL_RESERVED_PREFIX = '/cdn-cgi/'
/** `T`: 16 bytes en base64url (22 caracteres). */
export const TRAVEL_TOKEN_RE = /^[A-Za-z0-9_-]{22}$/
/** `nonce` de la autocomprobación: 16 bytes en base64url. */
export const TRAVEL_NONCE_RE = TRAVEL_TOKEN_RE

/** Enlace del QR de vinculación en modo viaje: `https://<host>/k/<T>#s=<q>` (el fragmento no viaja a ningún servidor). */
export function travelPairUrl(origin: string, token: string, secret: string): string {
  return `${origin}${TRAVEL_GATE_PREFIX}${token}#s=${secret}`
}

/**
 * Keepalive del WebSocket de señalización por el túnel: el borde de Cloudflare lo corta a ~125 s sin tráfico (medido en T0).
 * El Mac manda un `ping` cada `pingMs` y cierra el socket si en `deadMs` (< 100 s) no llegó NADA del celular (pong o trama).
 */
export const TRAVEL_KEEPALIVE = { pingMs: 25_000, deadMs: 90_000 } as const

/** Reintento del celular ante un 522 intermitente al abrir el WebSocket (1 de ~6 en T0, a ~20 s de crear el túnel). */
export const TRAVEL_WS_RETRY = { maxAttempts: 3, delaysMs: [500, 1500, 4000] } as const

/** Límites de internet del servidor del túnel (todas las peticiones llegan desde 127.0.0.1: la IP real viene de `Cf-Connecting-Ip`). */
export const TRAVEL_LIMITS = {
  /** Upgrades de WebSocket por minuto: por visitante (pista, falsificable en local) y global. */
  upgradesPerMinPerIp: 10,
  upgradesPerMinGlobal: 30,
  /** Peticiones HTTP por ventana de 10 s: por visitante y global (Cloudflare corta a 200 en vuelo). */
  httpPer10sPerIp: 60,
  httpPer10sGlobal: 200,
  /** `/k/<T>` erróneos por minuto (global) a partir de los cuales la puerta responde 429 a `/k/*` durante `gateLockMs`. */
  gateFailuresPerMin: 20,
  gateLockMs: 60_000,
  /** Vida de un `nonce` de autocomprobación. */
  probeTtlMs: 30_000,
  /** Cabeceras y galleta. */
  cookieMaxAgeSec: 86_400
} as const

/** Plazos del proceso `cloudflared`. */
export const TRAVEL_PROCESS = {
  /** URL + conexión registrada. */
  startTimeoutMs: 30_000,
  /** Sin conexión registrada con el proceso vivo → `offline` en Ajustes (no se mata: puede volver). */
  offlineAfterMs: 120_000,
  /** Reintentos tras una muerte del proceso: espera exponencial con azar de 2 s a 60 s; `rate` empieza en 60 s. */
  maxRestarts: 6,
  backoffMinMs: 2_000,
  backoffMaxMs: 60_000,
  /** Autocomprobación: reintentos 1 s → 30 s (el nombre puede tardar en resolver). */
  selfCheckMaxMs: 45_000,
  /** Parada ordenada antes del SIGKILL. */
  stopGraceMs: 3_000
} as const

/** Cuánto se mantiene abierto el túnel: `idle30` = se cierra a los 30 min sin conexiones (predeterminado). */
export const TRAVEL_KEEPS = ['idle30', 'h4', 'h12', 'h24'] as const
export type TravelKeep = (typeof TRAVEL_KEEPS)[number]
export const DEFAULT_TRAVEL_KEEP: TravelKeep = 'idle30'

export function isTravelKeep(v: unknown): v is TravelKeep {
  return typeof v === 'string' && (TRAVEL_KEEPS as readonly string[]).includes(v)
}

const KEEP_HOURS: Record<TravelKeep, number | null> = { idle30: null, h4: 4, h12: 12, h24: 24 }

/**
 * Horas de vida máxima del túnel: lo elegido recortado por `travelMaxHours` de la política (1–24). `idle30` no pide horas, pero
 * el tope de la política también rige (vida absoluta = `maxHours`).
 */
export function travelLifetimeHours(keep: TravelKeep, maxHours: number): number {
  const cap = Math.max(1, Math.min(24, Math.trunc(maxHours) || 1))
  const h = KEEP_HOURS[keep]
  return h === null ? cap : Math.min(h, cap)
}

export type TravelStatus = 'idle' | 'downloading' | 'starting' | 'checking' | 'online' | 'connecting' | 'retrying' | 'failed'
export type TravelBinaryState = 'missing' | 'ready' | 'outdated' | 'bad-hash'
export type TravelBlocked = 'policy' | 'confirm-required' | 'passkey-required'
/** Código de error visible (Ajustes lo traduce). `exited:<código de salida>` si el proceso murió. */
export type TravelError =
  | 'rate'
  | 'edge-unreachable'
  | 'config-conflict'
  | 'timeout'
  | 'bad-url'
  | 'unreachable'
  | 'site-mismatch'
  | 'no-binary'
  | 'download'
  | `exited:${number}`

const ERR_RE = /^(?:rate|edge-unreachable|config-conflict|timeout|bad-url|unreachable|site-mismatch|no-binary|download|exited:\d{1,3})$/
export function isTravelError(v: unknown): v is TravelError {
  return typeof v === 'string' && ERR_RE.test(v)
}

/** Estado del modo viaje que ve Ajustes (`RemoteState.travel`). Nunca incluye `T`, `q` ni secretos. */
export interface TravelState {
  status: TravelStatus
  /** Origen público del túnel (`https://<palabras>.trycloudflare.com`), sin `T` ni ruta. */
  url?: string
  /** ms desde epoch en que el túnel se corta aunque haya alguien conectado (tope de «Mantener abierto» y de la política). */
  expiresAt?: number
  keep: TravelKeep
  binary: TravelBinaryState
  error?: TravelError
  blocked?: TravelBlocked
  /** Conexiones directas que no llegaron a abrir canal (diagnóstico «tu red no permite conexión directa»). */
  directFailures?: number
}

/** Por qué el modo viaje no se puede usar ahora (`null` = se puede). Puro. */
export function travelBlockedReason(p: {
  allowTravelMode: boolean
  requireConnectionConfirm: boolean
  requirePasskey: boolean
  confirmEach: boolean
}): TravelBlocked | null {
  if (!p.allowTravelMode) return 'policy'
  if (p.requirePasskey) return 'passkey-required'
  if (p.requireConnectionConfirm || p.confirmEach) return 'confirm-required'
  return null
}

// ── contratos IPC (los registra la interfaz de Ajustes; el celular NUNCA los invoca: clase X) ──

export interface TravelInstallRequest {
  /** Siempre `true`: lo pone el diálogo de consentimiento del Mac tras «Descargar». Sin consentimiento no hay petición de red. */
  consent: true
}
export interface TravelInstallResult {
  ok: boolean
  /** Código corto: `policy` | `consent` | `unsupported` | `bad-hash` | `bad-signature` | `download` | `extract` | `busy`. */
  error?: string
}
export interface SetTravelKeepRequest {
  keep: TravelKeep
}

export interface TravelInvokeContract {
  /** Descarga y verifica `cloudflared` (con consentimiento ya dado en el Mac). */
  'remote:travelInstall': { req: TravelInstallRequest; res: TravelInstallResult }
  /** «Cerrar a los 30 min sin uso» / «Mantener abierto» 4/12/24 h. */
  'remote:setTravelKeep': { req: SetTravelKeepRequest; res: RemoteState }
}
export const TRAVEL_INVOKE_CHANNELS = ['remote:travelInstall', 'remote:setTravelKeep'] as const

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Valida `remote:travelInstall`: solo `{ consent: true }` exacto (cualquier clave extra = inválido). */
export function parseTravelInstallRequest(raw: unknown): TravelInstallRequest | null {
  if (!isObj(raw)) return null
  const keys = Object.keys(raw)
  if (keys.length !== 1 || keys[0] !== 'consent' || raw.consent !== true) return null
  return { consent: true }
}

/** Valida `remote:setTravelKeep`: solo `{ keep }` con un valor de la lista. */
export function parseSetTravelKeepRequest(raw: unknown): SetTravelKeepRequest | null {
  if (!isObj(raw)) return null
  const keys = Object.keys(raw)
  if (keys.length !== 1 || keys[0] !== 'keep' || !isTravelKeep(raw.keep)) return null
  return { keep: raw.keep }
}
