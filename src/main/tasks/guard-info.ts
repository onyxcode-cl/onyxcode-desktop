/**
 * Canal de SOLO LECTURA para `lazunox-subagent-guard` en los servidores de Tareas con sandbox (F8-B208).
 *
 * Problema (comprobado con el binario 1.19 y Seatbelt real): el cliente interno de los plugins habla con el propio
 * `opencode serve` por HTTP, y el perfil Seatbelt NO permite salir hacia el puerto del motor. Abrir ese puerto (commit
 * 53901267, revertido) daba a cualquier proceso del sandbox la API COMPLETA del motor: la contraseña se lee por
 * `sysctl(KERN_PROCARGS2)`, que Seatbelt no puede denegar. En su lugar, main responde por el agente:
 *
 *  - `GET <base>/session?id=<ses_…>` → `{ id, parentID, agent, permission }` de UNA sesión. `agent` ya resuelto con la
 *    misma precedencia que el guardián (hija: el agente de la sesión; raíz: el del último mensaje de usuario, si no el
 *    de la sesión). Nada del contenido de los mensajes sale de main.
 *  - `GET <base>/agents` → `[{ name, permission }]`.
 *
 * Main consulta al servidor de ESA tarea con su `authorization` y su `?directory=`. El canal se sirve en el puerto del
 * proxy MCP de ese servidor (`McpProxy.setLocalHandler`, ya permitido por Seatbelt y ligado a 127.0.0.1) con un token
 * propio por servidor, aleatorio, en memoria y comparado en tiempo constante. Solo GET, sin escrituras, id validado,
 * respuesta del motor acotada en tamaño y en tiempo. Cualquier fallo → error (el guardián bloquea).
 */

/** Ids de sesión del motor 1.19 (`ses_` + base62). Cualquier otra cosa se rechaza sin consultar al motor. */
export const GUARD_SESSION_ID_RE = /^ses_[A-Za-z0-9]{8,64}$/
/** Tamaño máximo de una respuesta del motor que main acepta leer (sesión y agentes). */
export const GUARD_MAX_UPSTREAM_BYTES = 1024 * 1024
/** Para la lista de mensajes (puede traer salidas de herramientas largas); si se pasa, se usa el agente de la sesión. */
export const GUARD_MAX_MESSAGES_BYTES = 8 * 1024 * 1024
export const GUARD_UPSTREAM_TIMEOUT_MS = 3000
/** Prefijo de las rutas del canal dentro del puerto del proxy. */
export const GUARD_PATH_PREFIX = '/__lazunox-guard'

export interface GuardServerRef {
  baseUrl: string
  authorization: string
  /** Carpeta tal como la ve OpenCode (`?directory=`). */
  directory: string
}

export interface GuardReply {
  status: number
  body: unknown
}

type Rule = { permission: string; pattern: string; action: 'allow' | 'ask' | 'deny' }
const ACTIONS = new Set(['allow', 'ask', 'deny'])

function rulesOf(v: unknown): Rule[] | null {
  if (!Array.isArray(v)) return null
  const out: Rule[] = []
  for (const r of v) {
    if (!r || typeof r !== 'object') return null
    const { permission, pattern, action } = r as Record<string, unknown>
    if (typeof permission !== 'string' || typeof pattern !== 'string' || typeof action !== 'string' || !ACTIONS.has(action)) return null
    out.push({ permission, pattern, action: action as Rule['action'] })
  }
  return out
}

async function readJson(res: Response, max: number): Promise<unknown> {
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (Number.isFinite(declared) && declared > max) throw new Error('too large')
  const reader = res.body?.getReader()
  if (!reader) throw new Error('no body')
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel().catch(() => undefined)
      throw new Error('too large')
    }
    chunks.push(value)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * Crea el manejador del canal. `server()` devuelve el servidor de la tarea si ya está listo (null mientras arranca o
 * tras parar: 503, el guardián bloquea). `fetchImpl` solo para pruebas.
 */
export function createGuardInfoHandler(opts: {
  server: () => GuardServerRef | null
  fetchImpl?: typeof fetch
}): (path: string, query: URLSearchParams) => Promise<GuardReply> {
  const doFetch = opts.fetchImpl ?? fetch
  const get = async (
    ref: GuardServerRef,
    path: string,
    extra = '',
    max = GUARD_MAX_UPSTREAM_BYTES
  ): Promise<{ status: number; json: unknown }> => {
    const url = `${ref.baseUrl.replace(/\/+$/, '')}${path}?directory=${encodeURIComponent(ref.directory)}${extra}`
    const res = await doFetch(url, {
      headers: { authorization: ref.authorization, accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(GUARD_UPSTREAM_TIMEOUT_MS)
    })
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined)
      return { status: res.status, json: null }
    }
    return { status: res.status, json: await readJson(res, max) }
  }

  return async (path, query) => {
    const ref = opts.server()
    if (!ref) return { status: 503, body: { error: 'unavailable' } }
    try {
      if (path === '/agents') {
        if ([...query.keys()].length) return { status: 400, body: { error: 'bad request' } }
        const r = await get(ref, '/agent')
        if (r.status !== 200 || !Array.isArray(r.json)) return { status: 502, body: { error: 'upstream' } }
        const agents: Array<{ name: string; permission: Rule[] }> = []
        for (const a of r.json) {
          const name = a && typeof a === 'object' ? (a as Record<string, unknown>).name : undefined
          const permission = a && typeof a === 'object' ? rulesOf((a as Record<string, unknown>).permission) : null
          if (typeof name === 'string' && name && permission) agents.push({ name, permission })
        }
        return { status: 200, body: agents }
      }
      if (path === '/session') {
        const ids = query.getAll('id')
        if (ids.length !== 1 || [...query.keys()].some((k) => k !== 'id') || !GUARD_SESSION_ID_RE.test(ids[0]!)) {
          return { status: 400, body: { error: 'bad session' } }
        }
        const id = ids[0]!
        const r = await get(ref, `/session/${id}`)
        if (r.status === 404) return { status: 404, body: { error: 'unknown session' } }
        const info = r.json as Record<string, unknown> | null
        if (r.status !== 200 || !info || typeof info !== 'object' || info.id !== id) return { status: 502, body: { error: 'upstream' } }
        const parentID = typeof info.parentID === 'string' && info.parentID ? info.parentID : undefined
        let agent = typeof info.agent === 'string' && info.agent ? info.agent : undefined
        if (!parentID) {
          // Raíz: el agente del último mensaje de usuario (como el guardián con el cliente del motor). Solo se lee
          // `info.role/agent/time`; el contenido de los mensajes nunca sale de main. Si falla, queda el agente de la
          // sesión (lo mismo que hace el guardián con el cliente del motor): no relaja nada, solo cambia la fuente.
          const m = await get(ref, `/session/${id}/message`, '&limit=30', GUARD_MAX_MESSAGES_BYTES).catch(() => ({ status: 0, json: null }))
          if (m.status === 200 && Array.isArray(m.json)) {
            let best: { at: number; agent: string } | null = null
            for (const msg of m.json) {
              const mi =
                msg && typeof msg === 'object' ? ((msg as Record<string, unknown>).info as Record<string, unknown> | undefined) : undefined
              if (!mi || mi.role !== 'user' || typeof mi.agent !== 'string' || !mi.agent) continue
              const t = mi.time && typeof mi.time === 'object' ? Number((mi.time as Record<string, unknown>).created) || 0 : 0
              if (!best || t > best.at) best = { at: t, agent: mi.agent }
            }
            if (best) agent = best.agent
          }
        }
        const permission = info.permission === undefined ? [] : rulesOf(info.permission)
        if (!permission) return { status: 502, body: { error: 'upstream' } }
        return { status: 200, body: { id, ...(parentID ? { parentID } : {}), ...(agent ? { agent } : {}), permission } }
      }
      return { status: 404, body: { error: 'not found' } }
    } catch {
      return { status: 502, body: { error: 'upstream' } }
    }
  }
}
