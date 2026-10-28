/**
 * Modo unificado, H4: ¿la sesión que dice traer una llamada del puente existe de verdad en el servidor aislado de origen?
 * Se pregunta al propio servidor de esa carpeta (`GET /session/{id}`, con sus credenciales internas, que solo conoce main). Un id
 * inventado o de otra carpeta no existe ahí (la base de datos de cada servidor aislado es propia) ⇒ 404 ⇒ 'dead'.
 * Cualquier otra cosa (servidor caído, timeout, 5xx, sin credenciales) ⇒ 'unknown' y quien llama falla cerrado.
 */
export type BridgeSessionState = 'live' | 'dead' | 'unknown'
export type BridgeSessionProbe = (server: string, session: string) => Promise<BridgeSessionState>

export interface BridgeServerRef {
  baseUrl: string
  authorization: string
  /** Carpeta tal como la ve OpenCode (`?directory=`). */
  directory: string
}

const PROBE_TIMEOUT_MS = 1500

export function createBridgeSessionProbe(opts: {
  /** Conexión del servidor AISLADO con esa `serverKey` (null si no existe o no arrancó con el puente). */
  server: (serverKey: string) => BridgeServerRef | null
  fetchImpl?: typeof fetch
}): BridgeSessionProbe {
  const doFetch = opts.fetchImpl ?? fetch
  return async (serverKey, session) => {
    const ref = opts.server(serverKey)
    if (!ref || !/^[A-Za-z0-9_-]{1,200}$/.test(session)) return 'unknown'
    try {
      const url = `${ref.baseUrl.replace(/\/+$/, '')}/session/${session}?directory=${encodeURIComponent(ref.directory)}`
      const res = await doFetch(url, {
        headers: { authorization: ref.authorization, accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
      })
      await res.body?.cancel().catch(() => undefined)
      if (res.status === 200) return 'live'
      if (res.status === 404) return 'dead'
      return 'unknown'
    } catch {
      return 'unknown'
    }
  }
}
