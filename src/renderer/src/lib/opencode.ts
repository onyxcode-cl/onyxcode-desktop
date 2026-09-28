/**
 * Cliente OpenCode en el renderer.
 *
 * - `createClient(conn)`: cliente SDK v2 con el header Authorization del sidecar.
 * - `startEventStream(client, onEvent)`: un único stream SSE global (`/global/event`) que
 *   entrega eventos de TODOS los directorios/instancias; se reconecta solo.
 */
import { createOpencodeClient, type GlobalEvent, type OpencodeClient } from '@opencode-ai/sdk/v2/client'
import type { OpencodeConnection } from '@shared/types'

export type { OpencodeClient }
/** Evento de OpenCode (payload de /global/event). */
export type OcEvent = GlobalEvent['payload']
export type OcEventHandler = (event: OcEvent, directory: string) => void

export function createClient(conn: OpencodeConnection): OpencodeClient {
  return createOpencodeClient({
    baseUrl: conn.baseUrl,
    headers: { Authorization: conn.authorization }
  })
}

/** Abre el stream global de eventos. Devuelve una función para cerrarlo. */
export function startEventStream(
  client: OpencodeClient,
  onEvent: OcEventHandler,
  hooks: { onOpen?: () => void; onError?: (err: unknown) => void } = {}
): () => void {
  const controller = new AbortController()
  let stopped = false

  const loop = async (): Promise<void> => {
    let attempt = 0
    while (!stopped) {
      try {
        const { stream } = await client.global.event({
          signal: controller.signal,
          sseMaxRetryAttempts: 0,
          onSseError: (err: unknown) => hooks.onError?.(err)
        })
        let opened = false
        for await (const ev of stream) {
          if (!opened) {
            opened = true
            attempt = 0
            hooks.onOpen?.()
          }
          if (ev && typeof ev === 'object' && 'payload' in ev) onEvent(ev.payload, ev.directory)
        }
      } catch (err) {
        if (stopped) return
        hooks.onError?.(err)
      }
      if (stopped) return
      attempt++
      await new Promise((r) => setTimeout(r, Math.min(500 * 2 ** attempt, 10_000)))
    }
  }
  void loop()

  return () => {
    stopped = true
    controller.abort()
  }
}

/** Extrae un mensaje legible de los errores del SDK / sesión. */
export function errorMessage(err: unknown): string {
  if (!err) return 'Error desconocido'
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message
  if (typeof err === 'object') {
    const o = err as { data?: { message?: unknown }; message?: unknown; name?: unknown }
    if (o.data && typeof o.data.message === 'string') return o.data.message
    if (typeof o.message === 'string') return o.message
    if (typeof o.name === 'string') return o.name
  }
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}
