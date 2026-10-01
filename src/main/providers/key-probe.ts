/**
 * «Probar clave»: comprueba en main la clave YA guardada de un proveedor con una petición GET gratuita
 * (listado de modelos o información de la clave), sin generar tokens.
 *
 * - La clave se lee de `auth.json` aquí y solo sale hacia el host del proveedor: no cruza el IPC ni vuelve al
 *   renderer. Del cuerpo de la respuesta solo se usa el código HTTP (ni siquiera se lee).
 * - `fetch` es inyectable (en la app, `net.fetch`); `redirect: 'manual'` para que la clave no siga a otro host.
 * - Los errores se construyen a mano: nunca se reenvía un `Error` ajeno (podría llevar cabeceras o URL con claves).
 * - No importa `electron`: todo entra por `KeyProbeDeps`.
 *
 * Cada entrada de `PROBES` se verificó con curl y una clave inválida (debe responder 401/400, no 200).
 * NO están: `opencode` y `opencode-go` (su listado de modelos es público: daría un falso «funciona»), ni
 * proveedores sin endpoint gratuito (→ `unsupported`).
 */
import { readFileSync } from 'node:fs'
import { appAuthFile } from '../opencode/data-dir'
import type { KeyTestResult, KeyTestStatus } from '@shared/key-test'

export const KEY_PROBE_TIMEOUT_MS = 10_000
export const KEY_PROBE_MIN_INTERVAL_MS = 5_000

interface ProbeDef {
  url: string
  headers: (key: string) => Record<string, string>
  /** Códigos HTTP que este proveedor usa para «clave no válida» además de 401. */
  invalidStatuses?: readonly number[]
}

const bearer = (key: string): Record<string, string> => ({ authorization: `Bearer ${key}` })

/** Por id de proveedor de OpenCode (el id de models.dev). Todos GET gratuitos y autenticados. */
export const PROBES: Readonly<Record<string, ProbeDef>> = {
  anthropic: {
    url: 'https://api.anthropic.com/v1/models',
    headers: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' })
  },
  openai: { url: 'https://api.openai.com/v1/models', headers: bearer },
  // La clave de Google va SIEMPRE en cabecera: en la URL quedaría en registros y mensajes de error.
  google: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models',
    headers: (key) => ({ 'x-goog-api-key': key }),
    invalidStatuses: [400]
  },
  // /api/v1/models de OpenRouter es público; /api/v1/key exige la clave.
  openrouter: { url: 'https://openrouter.ai/api/v1/key', headers: bearer },
  groq: { url: 'https://api.groq.com/openai/v1/models', headers: bearer },
  mistral: { url: 'https://api.mistral.ai/v1/models', headers: bearer },
  deepseek: { url: 'https://api.deepseek.com/models', headers: bearer },
  xai: { url: 'https://api.x.ai/v1/models', headers: bearer, invalidStatuses: [400] }
}

/** Datos del catálogo del motor (`GET /provider`) para el caso genérico OpenAI-compatible. */
export interface ProviderApiMeta {
  url: string
  npm: string
}

/** Sonda genérica: proveedores `@ai-sdk/openai-compatible` con API https → `GET {api}/models` con Bearer. */
export function genericProbe(meta: ProviderApiMeta | null): ProbeDef | null {
  if (!meta || meta.npm !== '@ai-sdk/openai-compatible') return null
  let u: URL
  try {
    u = new URL(meta.url)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return null
  return { url: `${u.origin}${u.pathname.replace(/\/+$/, '')}/models`, headers: bearer }
}

/** Qué hay guardado en `auth.json` para un proveedor. La clave solo existe dentro de main. */
export type StoredCredential = { kind: 'api'; key: string } | { kind: 'oauth' } | { kind: 'none' }

export function readStoredCredential(userData: string, providerID: string): StoredCredential {
  try {
    const raw = JSON.parse(readFileSync(appAuthFile(userData), 'utf8')) as unknown
    if (!raw || typeof raw !== 'object') return { kind: 'none' }
    const entry = (raw as Record<string, unknown>)[providerID]
    if (!entry || typeof entry !== 'object') return { kind: 'none' }
    const e = entry as Record<string, unknown>
    if (e.type === 'api' && typeof e.key === 'string' && e.key.length > 0) return { kind: 'api', key: e.key }
    if (e.type === 'oauth' || e.type === 'wellknown') return { kind: 'oauth' }
  } catch {
    /* sin archivo o ilegible: no hay clave */
  }
  return { kind: 'none' }
}

export interface ProbeResponse {
  status: number
  body?: { cancel?: () => Promise<void> | void } | null
}

export interface KeyProbeDeps {
  userData: string
  fetch: (
    url: string,
    init: { method: 'GET'; headers: Record<string, string>; redirect: 'manual'; signal: AbortSignal }
  ) => Promise<ProbeResponse>
  isOnline: () => boolean
  now: () => number
  /** Metadatos del catálogo del motor para el caso genérico (null/ausente = no disponibles). */
  providerMeta?: (providerID: string) => Promise<ProviderApiMeta | null>
  /** Solo pruebas E2E: origen `http://127.0.0.1:<puerto>` que sustituye al del proveedor (ver `resolveE2eKeyProbeBase`). */
  baseOverride?: string | null
  timeoutMs?: number
  minIntervalMs?: number
}

/** Hay otra prueba en curso del mismo proveedor o se hizo una hace menos de 5 s. */
export class KeyProbeBusyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KeyProbeBusyError'
  }
}

export interface E2eProbeEnvInput {
  isPackaged: boolean
  env: Record<string, string | undefined>
}

/** Origen de pruebas, o null (siempre null empaquetada o si no es exactamente `http://127.0.0.1:<puerto>`). */
export function resolveE2eKeyProbeBase(i: E2eProbeEnvInput): string | null {
  const base = !i.isPackaged ? i.env.ONYXCODE_E2E_KEY_PROBE_BASE : undefined
  return base && /^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(base) ? base : null
}

/** Familias de errores de red: Node/undici (`ENOTFOUND`…) y Chromium (`net::ERR_…`). */
const NETWORK_CODE_RE =
  /\b(ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ETIMEDOUT|EPIPE|UND_ERR_[A-Z_]+|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_[A-Z_]+|ERR_TIMED_OUT|ERR_NETWORK_[A-Z_]+|ERR_ADDRESS_[A-Z_]+|ERR_PROXY_[A-Z_]+|ERR_TUNNEL_[A-Z_]+|ERR_CERT_[A-Z_]+|ERR_SSL_[A-Z_]+|ERR_FAILED|ERR_EMPTY_RESPONSE)\b/

/** Texto interno para clasificar (nunca se devuelve ni se registra). */
function errorFingerprint(err: unknown): string {
  const parts: string[] = []
  let cur: unknown = err
  for (let depth = 0; depth < 4 && cur && typeof cur === 'object'; depth++) {
    const o = cur as { code?: unknown; message?: unknown; cause?: unknown }
    if (typeof o.code === 'string') parts.push(o.code)
    if (typeof o.message === 'string') parts.push(o.message.slice(0, 300))
    cur = o.cause
  }
  return parts.join(' ')
}

function isAbort(err: unknown): boolean {
  const name = err && typeof err === 'object' ? (err as { name?: unknown }).name : undefined
  return name === 'AbortError' || name === 'TimeoutError'
}

/** HTTP → estado. 2xx ok; 401 inválida; 403; 402; 429; 408/504 timeout; 5xx/529 proveedor caído; resto inesperado. */
export function classifyHttp(status: number, invalidStatuses: readonly number[] = []): KeyTestStatus {
  if (status >= 200 && status < 300) return 'ok'
  if (status === 401 || invalidStatuses.includes(status)) return 'invalid'
  if (status === 403) return 'forbidden'
  if (status === 402) return 'no-credit'
  if (status === 429) return 'rate-limited'
  if (status === 408 || status === 504) return 'timeout'
  if (status >= 500 && status <= 599) return 'provider-down'
  return 'unexpected'
}

/** Cabeceras HTTP no admiten CR/LF ni caracteres fuera de latin1: la clave no se puede ni enviar. */
const SENDABLE_KEY_RE = /^[\x21-\x7e]+$/

export class KeyProber {
  private readonly inFlight = new Set<string>()
  private readonly lastStart = new Map<string, number>()

  constructor(private readonly deps: KeyProbeDeps) {}

  async test(providerID: string): Promise<KeyTestResult> {
    const { deps } = this
    const done = (status: KeyTestStatus, httpStatus: number | null = null, latencyMs: number | null = null): KeyTestResult => ({
      providerID,
      status,
      httpStatus,
      latencyMs,
      checkedAt: deps.now()
    })

    if (this.inFlight.has(providerID)) throw new KeyProbeBusyError('Ya hay una prueba en curso para este proveedor.')
    const minInterval = deps.minIntervalMs ?? KEY_PROBE_MIN_INTERVAL_MS
    const last = this.lastStart.get(providerID)
    if (last !== undefined && deps.now() - last < minInterval)
      throw new KeyProbeBusyError('Espera unos segundos antes de volver a probar este proveedor.')
    this.inFlight.add(providerID)
    this.lastStart.set(providerID, deps.now())
    try {
      const cred = readStoredCredential(deps.userData, providerID)
      if (cred.kind === 'none') return done('not-stored')
      if (cred.kind === 'oauth') return done('oauth')

      let probe: ProbeDef | null = PROBES[providerID] ?? null
      if (!probe && deps.providerMeta) probe = genericProbe(await deps.providerMeta(providerID).catch(() => null))
      if (!probe) return done('unsupported')

      if (!SENDABLE_KEY_RE.test(cred.key)) return done('invalid')

      let url = probe.url
      if (deps.baseOverride) url = deps.baseOverride + new URL(probe.url).pathname

      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), deps.timeoutMs ?? KEY_PROBE_TIMEOUT_MS)
      const t0 = deps.now()
      try {
        const res = await deps.fetch(url, { method: 'GET', headers: probe.headers(cred.key), redirect: 'manual', signal: ctl.signal })
        const latency = Math.max(0, deps.now() - t0)
        // El cuerpo no se lee: se cancela para liberar la conexión.
        try {
          await res.body?.cancel?.()
        } catch {
          /* da igual */
        }
        return done(classifyHttp(res.status, probe.invalidStatuses), res.status, latency)
      } catch (err) {
        if (ctl.signal.aborted || isAbort(err)) return done('timeout')
        // Sin conexión del sistema → offline; red conocida caída con internet → unreachable; otro fallo → unexpected.
        if (!deps.isOnline()) return done('offline')
        return done(NETWORK_CODE_RE.test(errorFingerprint(err)) ? 'unreachable' : 'unexpected')
      } finally {
        clearTimeout(timer)
      }
    } finally {
      this.inFlight.delete(providerID)
    }
  }
}
