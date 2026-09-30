// Cliente de la API de control `/__e2e/*` del OpenCode falso (misma auth Basic que el sidecar).
export interface FakeRequest {
  seq: number
  at: number
  method: string
  path: string
  query: Record<string, string>
  directory: string | null
  body: unknown
}

export interface FakeConnection {
  baseUrl: string
  authorization: string
}

export class FakeClient {
  constructor(readonly conn: FakeConnection) {}

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.conn.baseUrl}/__e2e/${path}`, {
      method,
      headers: { authorization: this.conn.authorization, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    if (!res.ok) throw new Error(`fake ${method} ${path} -> ${res.status}`)
    return (await res.json()) as T
  }

  emit(body: unknown): Promise<unknown> {
    return this.call('POST', 'emit', body)
  }
  script(body: unknown): Promise<unknown> {
    return this.call('POST', 'script', body)
  }
  status(): Promise<Record<string, unknown>> {
    return this.call('GET', 'status')
  }
  dropSse(blockMs?: number): Promise<unknown> {
    return this.call('POST', 'drop-sse', blockMs === undefined ? {} : { blockMs })
  }
  requests(q: { limit?: number; path?: string; method?: string; since?: number } = {}): Promise<FakeRequest[]> {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(q)) if (v !== undefined) p.set(k, String(v))
    return this.call('GET', `requests?${p}`)
  }
  config(): Promise<{ raw: string | null; content: unknown; config: unknown }> {
    return this.call('GET', 'config')
  }
  /** Entorno que recibió el falso (nunca valores secretos): XDG_DATA_HOME y los ids de OPENCODE_AUTH_CONTENT. */
  env(): Promise<{ xdgDataHome: string | null; authContent: { providers: string[]; allPlaceholder: boolean } }> {
    return this.call('GET', 'env')
  }
  unknownRoutes(): Promise<unknown[]> {
    return this.call('GET', 'unknown-routes')
  }
  set(body: unknown): Promise<unknown> {
    return this.call('POST', 'set', body)
  }
  reset(): Promise<unknown> {
    return this.call('POST', 'reset', {})
  }

  /** Espera (polling) a que aparezca una petición que cumpla `pred`. */
  async waitForRequest(pred: (r: FakeRequest) => boolean, timeoutMs = 15_000): Promise<FakeRequest> {
    const t0 = Date.now()
    for (;;) {
      const hit = (await this.requests({ limit: 1000 })).find(pred)
      if (hit) return hit
      if (Date.now() - t0 > timeoutMs) throw new Error('waitForRequest: tiempo agotado')
      await new Promise((r) => setTimeout(r, 150))
    }
  }
}
