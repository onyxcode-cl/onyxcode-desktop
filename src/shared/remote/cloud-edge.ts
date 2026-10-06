/**
 * Enrutado de la entrada del servicio de conexión (puro, sin APIs de Workers): decide qué se hace con una petición ANTES de
 * tocar ningún Durable Object. Un nombre de sala mal formado o un `Origin` ajeno se rechazan aquí, sin despertar a nadie.
 *
 *  - `GET /v1/host` (WebSocket) con la cabecera `x-lazunox-host: <hostToken>`: la sala sale de `sha256(token)`. Un navegador no puede
 *    hacer de Mac: si la petición trae `Origin`, se rechaza.
 *  - `GET /v1/peer/<room>` (WebSocket): `room` de 43 caracteres base64url y `Origin` exactamente en la lista permitida.
 *  - Cualquier otra ruta `/v1/*` es 404. Fuera de `/v1/` no es asunto de este módulo (`pass`: sirve los estáticos).
 */
import { CLOUD_HOST_PATH, CLOUD_ORIGIN, CLOUD_PEER_PREFIX, isHostToken, isRoom, roomOfTokenAsync } from './cloud'

export interface EdgeRequest {
  method: string
  pathname: string
  /** Valor de la cabecera `Upgrade`. */
  upgrade: string | null
  origin: string | null
  /** Valor de la cabecera `x-lazunox-host`. */
  hostToken: string | null
}

export interface EdgeConfig {
  /** Orígenes que pueden abrir un celular (por defecto solo el sitio oficial). */
  allowedOrigins: readonly string[]
}

export type EdgeDecision =
  | { kind: 'host'; room: string; token: string }
  | { kind: 'peer'; room: string }
  | { kind: 'reject'; status: 400 | 401 | 403 | 404 | 405 | 426 }
  | { kind: 'pass' }

/** `ALLOWED_ORIGINS` del Worker: lista separada por comas; vacía o ausente = solo el sitio oficial. */
export function parseAllowedOrigins(v: string | undefined): string[] {
  const list = (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/.test(s))
  return list.length > 0 ? list : [CLOUD_ORIGIN]
}

export async function routeEdge(r: EdgeRequest, cfg: EdgeConfig): Promise<EdgeDecision> {
  const p = r.pathname
  if (!p.startsWith('/v1/') && p !== '/v1') return { kind: 'pass' }
  if (p === CLOUD_HOST_PATH) {
    if (r.method !== 'GET') return { kind: 'reject', status: 405 }
    if (r.origin !== null) return { kind: 'reject', status: 403 }
    if (!isHostToken(r.hostToken)) return { kind: 'reject', status: 401 }
    if ((r.upgrade ?? '').toLowerCase() !== 'websocket') return { kind: 'reject', status: 426 }
    return { kind: 'host', room: await roomOfTokenAsync(r.hostToken), token: r.hostToken }
  }
  if (p.startsWith(CLOUD_PEER_PREFIX)) {
    const room = p.slice(CLOUD_PEER_PREFIX.length)
    if (!isRoom(room)) return { kind: 'reject', status: 404 }
    if (r.method !== 'GET') return { kind: 'reject', status: 405 }
    if (r.origin === null || !cfg.allowedOrigins.includes(r.origin)) return { kind: 'reject', status: 403 }
    if ((r.upgrade ?? '').toLowerCase() !== 'websocket') return { kind: 'reject', status: 426 }
    return { kind: 'peer', room }
  }
  return { kind: 'reject', status: 404 }
}
