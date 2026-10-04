/**
 * Credenciales TURN efímeras (8 h) del servicio de conexión. Puro: el `fetch` se inyecta (las pruebas nunca tocan la red).
 *
 * Solo se piden DESPUÉS de que el Mac aceptó el `hello` de un celular (`grant`), y están apagadas si `TURN_ENABLED` no es
 * «true» o faltan los secretos: entonces todo sigue funcionando con STUN y conexión directa. Cualquier fallo (red, estado,
 * forma de la respuesta) devuelve `null` y se degrada a solo STUN; nunca rompe la conexión ni se registra nada.
 */
import { CLOUD_LIMITS } from './cloud'
import { parseIceServers, type IceServerSpec } from './protocol'

export interface TurnEnv {
  TURN_ENABLED?: string
  TURN_KEY_ID?: string
  TURN_KEY_API_TOKEN?: string
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }
) => Promise<{
  ok: boolean
  json(): Promise<unknown>
}>

const TURN_API = 'https://rtc.live.cloudflare.com/v1/turn/keys'
const TURN_TIMEOUT_MS = 3_000
const KEY_ID_RE = /^[A-Za-z0-9-]{8,64}$/

export function turnConfigured(env: TurnEnv): boolean {
  return env.TURN_ENABLED === 'true' && KEY_ID_RE.test(env.TURN_KEY_ID ?? '') && (env.TURN_KEY_API_TOKEN ?? '').length >= 16
}

export async function fetchTurnServers(env: TurnEnv, doFetch: FetchLike): Promise<IceServerSpec[] | null> {
  if (!turnConfigured(env)) return null
  const ctl = typeof AbortController === 'function' ? new AbortController() : null
  const timer = ctl ? setTimeout(() => ctl.abort(), TURN_TIMEOUT_MS) : null
  try {
    const res = await doFetch(`${TURN_API}/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: CLOUD_LIMITS.turnTtlSeconds }),
      ...(ctl ? { signal: ctl.signal } : {})
    })
    if (!res.ok) return null
    const body = (await res.json()) as { iceServers?: unknown } | null
    const raw = body?.iceServers
    // La API actual devuelve una lista; la anterior, un solo objeto.
    return parseIceServers(Array.isArray(raw) ? raw : raw ? [raw] : null)
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}
