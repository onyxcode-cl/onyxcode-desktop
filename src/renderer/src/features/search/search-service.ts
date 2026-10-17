/**
 * Servicio de la búsqueda por contenido: mantiene el índice en memoria (`SearchIndex`) al día, en segundo plano.
 *
 * Cómo funciona (y por qué es barato):
 *  - Se arranca la PRIMERA vez que se abre la paleta (no al iniciar la app) y de ahí en adelante se mantiene sola.
 *  - Solo mira las últimas `MAX_CONVERSATIONS` conversaciones de Chat y las de los proyectos de Code que están abiertos
 *    (las que ya conoce la lista lateral). Lee primero las más recientes, con poca concurrencia y una pausa entre lecturas
 *    para no competir con la app.
 *  - Es incremental: una conversación solo se vuelve a leer si cambió su fecha de actualización (y no mientras la IA está
 *    escribiendo en ella). Cada pulsación busca sobre texto ya preparado: nunca vuelve a leer el historial.
 *  - Todo vive en la memoria de la ventana: no se guarda nada en disco. «Vaciar» (`clearSearchIndex`) lo borra al instante y
 *    cerrar la app también.
 */
import { create } from 'zustand'
import type { Session } from '@opencode-ai/sdk/v2/client'
import { selectSessionsForDirectory } from '../../lib/session-reducer'
import { useServer } from '../../stores/server'
import { useSessions } from '../../stores/sessions'
import { useCode } from '../code/impl/store'
import { buildSession, SearchIndex, type SearchMode, type SearchResult, type SearchOptions } from './search-index'

/** Conversaciones indexadas como máximo (las más recientes). */
export const MAX_CONVERSATIONS = 300
const CONCURRENCY = 2
const PAUSE_MS = 20
const RESYNC_DEBOUNCE_MS = 4000

export interface SearchStatus {
  phase: 'idle' | 'building' | 'ready' | 'error'
  /** Conversaciones ya listas / conocidas. */
  done: number
  total: number
  /** Conversaciones que no se pudieron leer. */
  failed: number
  /** Sube con cada cambio del índice: quien muestra resultados vuelve a buscar. */
  version: number
}

export const useSearchStatus = create<SearchStatus>(() => ({ phase: 'idle', done: 0, total: 0, failed: 0, version: 0 }))

const index = new SearchIndex()
let generation = 0
let running = false
let again = false
let subscribed = false
/** Tras «Vaciar» no se vuelve a leer nada hasta que la persona abra la búsqueda otra vez. */
let active = false
let timer: ReturnType<typeof setTimeout> | null = null
const failedIds = new Map<string, number>()

interface Target {
  id: string
  mode: SearchMode
  directory: string
  title: string
  updated: number
  busy: boolean
}

function collectTargets(): Target[] {
  const out: Target[] = []
  const conn = useServer.getState().connection
  if (conn) {
    const st = useSessions.getState()
    for (const s of selectSessionsForDirectory(st, conn.chatDirectory)) {
      out.push({
        id: s.id,
        mode: 'chat',
        directory: s.directory,
        title: s.title,
        updated: s.time.updated,
        busy: (st.status[s.id] ?? 'idle') !== 'idle'
      })
    }
  }
  const code = useCode.getState()
  for (const s of Object.values(code.sessions) as Session[]) {
    if (s.parentID || s.time.archived) continue
    out.push({
      id: s.id,
      mode: 'code',
      directory: code.sessionProject[s.id] ?? s.directory,
      title: s.title,
      updated: s.time.updated,
      busy: (code.runState[s.id] ?? 'idle') !== 'idle'
    })
  }
  return out.sort((a, b) => b.updated - a.updated).slice(0, MAX_CONVERSATIONS)
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function bump(patch: Partial<SearchStatus> = {}): void {
  useSearchStatus.setState((s) => ({ ...s, ...patch, version: s.version + 1 }))
}

async function sync(gen: number): Promise<void> {
  const client = useServer.getState().client
  if (!client) {
    bump({ phase: 'error', done: index.size, total: index.size })
    return
  }
  const targets = collectTargets()
  const wanted = new Set(targets.map((t) => t.id))
  for (const id of index.ids()) if (!wanted.has(id)) index.remove(id)
  for (const t of targets) index.retitle(t.id, t.title)

  // Las que fallaron hace poco no se reintentan hasta que cambien (o pasen 2 min).
  const pending = targets.filter((t) => {
    if (index.updatedOf(t.id) === t.updated) return false
    if (t.busy && index.has(t.id)) return false
    const failedAt = failedIds.get(t.id)
    return !(failedAt !== undefined && Date.now() - failedAt < 120_000)
  })
  let done = targets.length - pending.length
  let failed = failedIds.size
  bump({ phase: pending.length ? 'building' : 'ready', done, total: targets.length, failed })
  if (pending.length === 0) return

  let next = 0
  const worker = async (): Promise<void> => {
    while (gen === generation) {
      const t = pending[next++]
      if (!t) return
      try {
        const res = await client.session.messages({ sessionID: t.id, directory: t.directory })
        if (gen !== generation) return
        if (res.error || !res.data) throw new Error('messages')
        const entries = res.data.map((m) => ({ info: m.info, parts: m.parts }))
        index.upsert(buildSession({ id: t.id, mode: t.mode, directory: t.directory, title: t.title, updated: t.updated }, entries))
        failedIds.delete(t.id)
      } catch {
        failedIds.set(t.id, Date.now())
      }
      done++
      failed = failedIds.size
      if (gen === generation) bump({ done, failed })
      await sleep(PAUSE_MS)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker))
  if (gen === generation)
    bump({ phase: failed > 0 && index.size === 0 ? 'error' : 'ready', done: index.size, total: targets.length, failed })
}

async function pump(): Promise<void> {
  if (running) {
    again = true
    return
  }
  running = true
  try {
    do {
      again = false
      await sync(generation)
    } while (again)
  } catch {
    bump({ phase: 'error' })
  } finally {
    running = false
  }
}

function scheduleResync(): void {
  if (!active) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void pump()
  }, RESYNC_DEBOUNCE_MS)
}

/** Arranca (o continúa) el índice. Seguro de llamar muchas veces: la primera lo construye; las demás solo ponen al día. */
export function ensureSearchIndex(): void {
  active = true
  if (!subscribed) {
    subscribed = true
    // Una conversación nueva, con otro título o con mensajes nuevos cambia estas referencias.
    useSessions.subscribe((s, prev) => {
      if (s.sessions !== prev.sessions || s.status !== prev.status) scheduleResync()
    })
    useCode.subscribe((s, prev) => {
      if (s.sessions !== prev.sessions || s.runState !== prev.runState) scheduleResync()
    })
  }
  void pump()
}

/** Busca en el índice (síncrono: el texto ya está preparado). */
export function searchContent(query: string, opts?: SearchOptions): SearchResult {
  return index.search(query, opts)
}

/** Borra todo el texto indexado de la memoria. La próxima vez que se abra la búsqueda se prepara de nuevo. */
export function clearSearchIndex(): void {
  active = false
  generation++
  if (timer) clearTimeout(timer)
  timer = null
  index.clear()
  failedIds.clear()
  running = false
  again = false
  useSearchStatus.setState((s) => ({ phase: 'idle', done: 0, total: 0, failed: 0, version: s.version + 1 }))
}

/** Solo pruebas. */
export function indexForTests(): SearchIndex {
  return index
}
