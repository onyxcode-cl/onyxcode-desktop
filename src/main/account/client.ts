/**
 * Cliente HTTP del servidor de cuentas. SOLO main (con `net.fetch` de Electron, inyectado): el
 * renderer tiene una CSP que no permite salir a internet y nunca ve el token. Sin cookies
 * (`credentials: 'omit'`), sin redirecciones, sin cabecera `Origin`, con tiempo máximo y tope de
 * tamaño de respuesta. El token viaja solo como `Authorization: Bearer` desde aquí.
 *
 * Contrato del servidor: docs/CUENTAS-SERVIDOR.md.
 */
import type { AccountProvider, ServerResult } from '@shared/account'

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

const MAX_BODY_BYTES = 256 * 1024
export const DEFAULT_TIMEOUT_MS = 10_000

export type ApiErrorKind = 'unreachable' | 'http' | 'invalid'

export class AccountApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
    readonly status?: number,
    /** Código del cuerpo `{ "error": "<código>" }`, si vino. */
    readonly code?: string,
    /** Segundos de `Retry-After`, si vino. */
    readonly retryAfterSec?: number
  ) {
    super(message)
  }
}

export interface SessionGrant {
  token: string
  email: string
  provider: AccountProvider
}

export interface MeResult {
  result: ServerResult
  /** Token rotado por el servidor (sesión con poca vida restante); reemplaza al actual. */
  rotatedToken?: string
  email?: string
  provider?: AccountProvider
}

export interface AccountClient {
  emailStart(email: string): Promise<void>
  emailVerify(email: string, code: string): Promise<SessionGrant>
  googleStart(p: { redirectUri: string; state: string; challenge: string }): Promise<{ authUrl: string }>
  exchange(p: { code: string; verifier: string; redirectUri: string }): Promise<SessionGrant>
  me(token: string): Promise<MeResult>
  /** Datos completos de la cuenta tal como el servidor los guarda (JSON tal cual, para «Descargar mis datos»). */
  exportMe(token: string): Promise<unknown>
  logout(token: string): Promise<void>
  deleteMe(token: string): Promise<void>
}

export interface ClientOptions {
  baseUrl: string | null
  fetch: FetchLike
  userAgent: string
  timeoutMs?: number
}

async function readJson(res: Response): Promise<unknown> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new AccountApiError('invalid', 'respuesta demasiado grande')
  const reader = res.body?.getReader()
  let text: string
  if (!reader) {
    text = await res.text()
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new AccountApiError('invalid', 'respuesta demasiado grande')
  } else {
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new AccountApiError('invalid', 'respuesta demasiado grande')
      }
      chunks.push(value)
    }
    text = Buffer.concat(chunks).toString('utf8')
  }
  if (text.length === 0) return null
  try {
    return JSON.parse(text)
  } catch {
    throw new AccountApiError('invalid', 'respuesta no es JSON')
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= max ? v : null
}

function provider(v: unknown): AccountProvider | null {
  return v === 'google' || v === 'email' ? v : null
}

export function createAccountClient(o: ClientOptions): AccountClient {
  const timeout = o.timeoutMs ?? DEFAULT_TIMEOUT_MS

  /** Petición cruda: lanza `unreachable` si no hay respuesta (red, DNS, TLS, tiempo agotado). */
  async function raw(method: string, path: string, opts: { token?: string; body?: unknown } = {}): Promise<Response> {
    if (!o.baseUrl) throw new AccountApiError('unreachable', 'servidor de cuentas no configurado')
    const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': o.userAgent }
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`
    try {
      return await o.fetch(`${o.baseUrl}${path}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal: AbortSignal.timeout(timeout)
      })
    } catch {
      throw new AccountApiError('unreachable', 'sin conexión con el servidor de cuentas')
    }
  }

  /** Convierte una respuesta no exitosa en un `AccountApiError` con estado y código. */
  async function fail(res: Response): Promise<never> {
    let code: string | undefined
    try {
      const b = await readJson(res)
      if (isObj(b) && typeof b.error === 'string' && b.error.length <= 64) code = b.error
    } catch {
      /* cuerpo no legible: basta el estado */
    }
    const ra = Number(res.headers.get('retry-after'))
    throw new AccountApiError('http', `HTTP ${res.status}`, res.status, code, Number.isFinite(ra) && ra >= 0 ? ra : undefined)
  }

  async function grant(res: Response): Promise<SessionGrant> {
    const b = await readJson(res)
    const token = isObj(b) ? str(b.token, 4096) : null
    const email = isObj(b) ? str(b.email, 254) : null
    const prov = isObj(b) ? provider(b.provider) : null
    if (!token || !email || !prov) throw new AccountApiError('invalid', 'respuesta de sesión inválida')
    return { token, email, provider: prov }
  }

  return {
    async emailStart(email) {
      const res = await raw('POST', '/v1/auth/email/start', { body: { email } })
      if (res.status !== 202 && res.status !== 200 && res.status !== 204) await fail(res)
      await res.body?.cancel().catch(() => undefined)
    },

    async emailVerify(email, code) {
      const res = await raw('POST', '/v1/auth/email/verify', { body: { email, code } })
      if (res.status !== 200) return fail(res)
      return grant(res)
    },

    async googleStart({ redirectUri, state, challenge }) {
      const res = await raw('POST', '/v1/auth/google/start', {
        body: { redirect_uri: redirectUri, state, code_challenge: challenge, code_challenge_method: 'S256' }
      })
      if (res.status !== 200) return fail(res)
      const b = await readJson(res)
      const authUrl = isObj(b) ? str(b.auth_url, 4096) : null
      if (!authUrl) throw new AccountApiError('invalid', 'respuesta de inicio inválida')
      return { authUrl }
    },

    async exchange({ code, verifier, redirectUri }) {
      const res = await raw('POST', '/v1/auth/exchange', { body: { code, code_verifier: verifier, redirect_uri: redirectUri } })
      if (res.status !== 200) return fail(res)
      return grant(res)
    },

    async me(token) {
      let res: Response
      try {
        res = await raw('GET', '/v1/me', { token })
      } catch (err) {
        if (err instanceof AccountApiError && err.kind === 'unreachable') return { result: { kind: 'unreachable' } }
        throw err
      }
      if (res.status !== 200) {
        await res.body?.cancel().catch(() => undefined)
        return { result: { kind: 'http', status: res.status } }
      }
      try {
        const b = await readJson(res)
        if (!isObj(b)) return { result: { kind: 'http', status: 502 } }
        const rotated = str(b.session_token, 4096) ?? undefined
        return {
          result: { kind: 'ok' },
          rotatedToken: rotated,
          email: str(b.email, 254) ?? undefined,
          provider: provider(b.provider) ?? undefined
        }
      } catch {
        // Un 200 ilegible no prueba que la sesión sea válida: cuenta como servidor que no responde bien.
        return { result: { kind: 'http', status: 502 } }
      }
    },

    async exportMe(token) {
      const res = await raw('GET', '/v1/me', { token })
      if (res.status !== 200) return fail(res)
      return readJson(res)
    },

    async logout(token) {
      const res = await raw('POST', '/v1/logout', { token, body: {} })
      // 204 = cerrada; 401 = ya no valía. Ambos dejan la sesión sin efecto en el servidor.
      if (res.status !== 204 && res.status !== 200 && res.status !== 401) await fail(res)
      await res.body?.cancel().catch(() => undefined)
    },

    async deleteMe(token) {
      const res = await raw('DELETE', '/v1/me', { token })
      if (res.status !== 204 && res.status !== 200) await fail(res)
      await res.body?.cancel().catch(() => undefined)
    }
  }
}
