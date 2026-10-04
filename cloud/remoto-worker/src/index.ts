/**
 * Entrada del servicio de conexión de OnyxCode (remoto fuera de casa). Solo atiende `/v1/*` (los estáticos de la PWA los sirve
 * Cloudflare sin invocar este Worker: `run_worker_first: ["/v1/*"]`). Valida formato y `Origin` y aplica un límite por IP ANTES
 * de tocar el Durable Object: lo que no es válido nunca despierta una sala.
 *
 * No guarda datos ni imprime nada. Los secretos (TURN) llegan como secretos del Worker, no están en el repositorio.
 */
import { parseAllowedOrigins, routeEdge } from '../../../src/shared/remote/cloud-edge'
import { CLOUD_HOST_HEADER } from '../../../src/shared/remote/cloud'
import type { TurnEnv } from '../../../src/shared/remote/cloud-turn'
import { ROLE_HEADER, ROOM_HEADER } from './room'

export { Room } from './room'

interface Env extends TurnEnv {
  ROOM: DurableObjectNamespace
  ALLOWED_ORIGINS?: string
  /** Límite por IP (binding de rate limiting). Opcional: sin él solo vale la regla del panel. */
  LIMITER?: RateLimit
  ASSETS?: { fetch(request: Request): Promise<Response> }
}

const reject = (status: number): Response => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } })

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const decision = await routeEdge(
      {
        method: request.method,
        pathname: url.pathname,
        upgrade: request.headers.get('Upgrade'),
        origin: request.headers.get('Origin'),
        hostToken: request.headers.get(CLOUD_HOST_HEADER)
      },
      { allowedOrigins: parseAllowedOrigins(env.ALLOWED_ORIGINS) }
    )
    if (decision.kind === 'pass') return env.ASSETS ? env.ASSETS.fetch(request) : reject(404)
    if (decision.kind === 'reject') return reject(decision.status)

    // Límite por IP antes de despertar ninguna sala. Falla CERRADO: si el limitador da error, no se atiende.
    if (env.LIMITER) {
      const ip = request.headers.get('CF-Connecting-IP') ?? 'sin-ip'
      try {
        if (!(await env.LIMITER.limit({ key: ip })).success) return reject(429)
      } catch {
        return reject(503)
      }
    }

    const headers = new Headers(request.headers)
    // Las cabeceras internas las pone SOLO este Worker; las que mande el cliente no cuentan.
    headers.delete(ROLE_HEADER)
    headers.delete(ROOM_HEADER)
    headers.set(ROLE_HEADER, decision.kind)
    headers.set(ROOM_HEADER, decision.room)
    if (decision.kind === 'peer') headers.delete(CLOUD_HOST_HEADER)
    const stub = env.ROOM.get(env.ROOM.idFromName(decision.room))
    return stub.fetch(new Request(request, { headers }))
  }
}
