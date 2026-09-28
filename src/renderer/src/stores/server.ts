import { create } from 'zustand'
import type { OpencodeConnection, ServerStatus } from '@shared/types'
import { api, call } from '../lib/api'
import { createClient, errorMessage, startEventStream, type OcEvent, type OpencodeClient } from '../lib/opencode'

type EventListener = (event: OcEvent, directory: string) => void

interface ServerState {
  status: ServerStatus
  connection: OpencodeConnection | null
  client: OpencodeClient | null
  /** true mientras el stream SSE global está conectado. */
  streaming: boolean
  error: string | null
  init: () => () => void
  restart: () => Promise<void>
}

const listeners = new Set<EventListener>()

/** Suscribe a todos los eventos de OpenCode (cualquier directorio). */
export function onOpencodeEvent(listener: EventListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Llamados cada vez que el stream (re)conecta: útil para resincronizar estado. */
const reconnectListeners = new Set<() => void>()
export function onStreamReconnect(listener: () => void): () => void {
  reconnectListeners.add(listener)
  return () => reconnectListeners.delete(listener)
}

let stopStream: (() => void) | null = null

export const useServer = create<ServerState>((set, get) => {
  const applyConnection = (conn: OpencodeConnection): void => {
    const prev = get().connection
    if (prev && prev.baseUrl === conn.baseUrl && prev.authorization === conn.authorization && get().client) return
    stopStream?.()
    const client = createClient(conn)
    stopStream = startEventStream(
      client,
      (event, directory) => {
        for (const l of listeners) l(event, directory)
      },
      {
        onOpen: () => {
          set({ streaming: true })
          for (const l of reconnectListeners) l()
        },
        onError: () => set({ streaming: false })
      }
    )
    set({ connection: conn, client, error: null })
  }

  return {
    status: { state: 'starting', restarts: 0 },
    connection: null,
    client: null,
    streaming: false,
    error: null,

    init: () => {
      const offStatus = api.on('opencode:status', (status) => {
        set({ status })
        if (status.state !== 'ready') set({ streaming: false })
      })
      const offConn = api.on('opencode:connection', applyConnection)
      void api.invoke('opencode:status').then((r) => r.ok && set({ status: r.data }))
      call('opencode:connection')
        .then(applyConnection)
        .catch((err: unknown) => set({ error: errorMessage(err) }))
      return () => {
        offStatus()
        offConn()
        stopStream?.()
        stopStream = null
      }
    },

    restart: async () => {
      set({ error: null })
      try {
        applyConnection(await call('opencode:restart'))
      } catch (err) {
        set({ error: errorMessage(err) })
      }
    }
  }
})
