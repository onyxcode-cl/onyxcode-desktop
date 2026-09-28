/**
 * Kill-switch, parte "abortar": desde el PROCESO PRINCIPAL (no depende de qué vista muestre el
 * renderer ni de que la ventana exista) aborta toda sesión en curso de cada servidor de acceso
 * total. `session.abort` de OpenCode cancela el bucle del agente y mata el árbol de procesos de
 * la herramienta bash en curso (verificado con OpenCode 1.18.32: un `sleep 60`, también con
 * `nohup … &`, muere ~120 ms después del abort).
 *
 * Si un servidor no responde (colgado), se detiene el servidor entero (`onUnresponsive`).
 */
import { createOpencodeClient } from '@opencode-ai/sdk/v2/client'
import type { AbortReport } from './service'

export interface FullAccessServer {
  folder: string
  baseUrl: string
  authorization: string
}

const REQUEST_TIMEOUT_MS = 4_000

function timedFetch(req: Request): Promise<Response> {
  return fetch(req, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
}

/** Aborta las sesiones no inactivas de un servidor. Lanza si el servidor no responde. */
async function abortServer(srv: FullAccessServer): Promise<number> {
  const client = createOpencodeClient({
    baseUrl: srv.baseUrl,
    headers: { Authorization: srv.authorization },
    fetch: timedFetch
  })
  const st = await client.session.status({ directory: srv.folder })
  if (st.error || !st.data) throw new Error(`session.status: ${JSON.stringify(st.error ?? 'sin datos')}`)
  const busy = Object.entries(st.data)
    .filter(([, s]) => s && s.type !== 'idle')
    .map(([id]) => id)
  const results = await Promise.all(
    busy.map(async (sessionID) => {
      const r = await client.session.abort({ sessionID, directory: srv.folder })
      if (r.error) throw new Error(`session.abort ${sessionID}: ${JSON.stringify(r.error)}`)
      return 1
    })
  )
  return results.length
}

export async function abortFullAccessSessions(
  servers: FullAccessServer[],
  onUnresponsive: (srv: FullAccessServer) => Promise<void>
): Promise<AbortReport> {
  const report: AbortReport = { aborted: 0, failed: 0 }
  await Promise.all(
    servers.map(async (srv) => {
      try {
        report.aborted += await abortServer(srv)
      } catch (err) {
        report.failed++
        console.error(`[computer] no se pudo abortar en ${srv.baseUrl}; se detiene el servidor:`, err)
        await onUnresponsive(srv).catch((e: unknown) => console.error('[computer] detener servidor:', e))
      }
    })
  )
  return report
}
