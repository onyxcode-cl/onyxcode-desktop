// Servidor de cuentas FALSO (e2e/fake-auth/server.mjs) en el propio proceso del runner E2E. Las pruebas NUNCA hablan
// con un servidor real ni con Google/correo.
import { createFakeAuth } from '../fake-auth/server.mjs'

export interface RecordedAuthRequest {
  seq: number
  method: string
  path: string
  hasAuth: boolean
  origin: string | null
  cookie: string | null
  userAgent: string | null
  body: Record<string, unknown> | null
}

export interface FakeAuth {
  /** `http://127.0.0.1:<puerto>` */
  url: string
  setMode(mode: 'normal' | 'down' | '401' | '410'): Promise<void>
  /** Último código de 6 dígitos emitido (para ese correo, o el último de todos). */
  lastCode(email?: string): Promise<string | null>
  /** Crea usuario y sesión válida en el falso; devuelve el token. */
  seed(o?: { email?: string; provider?: 'google' | 'email'; token?: string }): Promise<{ token: string; email: string; provider: 'google' | 'email' }>
  expire(token: string): Promise<void>
  setGoogle(o: { mode?: 'auto' | 'manual' | 'deny'; email?: string }): Promise<void>
  requests(pathPrefix?: string, method?: string): Promise<RecordedAuthRequest[]>
  state(): Promise<{ mode: string; users: { email: string; provider: string; deleted: boolean }[]; sessions: number }>
  reset(): Promise<void>
  close(): Promise<void>
}

export async function startFakeAuth(): Promise<FakeAuth> {
  const fake = createFakeAuth()
  const addr = (await fake.listen(0, '127.0.0.1')) as { port: number }
  const url = `http://127.0.0.1:${addr.port}`
  const ctl = async <T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${url}/__e2e/${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    if (!res.ok) throw new Error(`fake-auth ${method} ${path} -> ${res.status}`)
    return (await res.json()) as T
  }
  return {
    url,
    setMode: (mode) => ctl('POST', 'mode', { mode }).then(() => undefined),
    lastCode: async (email) => (await ctl<{ code: string | null }>('GET', email ? `last-code?email=${encodeURIComponent(email)}` : 'last-code')).code,
    seed: (o = {}) => ctl('POST', 'seed', o),
    expire: (token) => ctl('POST', 'expire', { token }).then(() => undefined),
    setGoogle: (o) => ctl('POST', 'set', { googleMode: o.mode, googleEmail: o.email }).then(() => undefined),
    requests: (p = '', m) => ctl('GET', `requests?path=${encodeURIComponent(p)}${m ? `&method=${m}` : ''}`),
    state: () => ctl('GET', 'state'),
    reset: () => ctl('POST', 'reset').then(() => undefined),
    close: () => fake.close()
  }
}
