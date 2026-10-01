/**
 * Estado de sesiones/mensajes de OpenCode alimentado por eventos SSE.
 * Es genérico (no depende del modo): Chat y Tareas lo reutilizan filtrando por directorio.
 *
 * ORIGEN (AUDIT.md B2): lo alimentan varios servidores (sidecar principal = Chat/Code y un
 * servidor por carpeta/modo de Tareas, cada uno con su propio almacenamiento). Cada sesión
 * guarda de qué servidor vino (`sessionSource`, clave = `MAIN_SOURCE` o el baseUrl del servidor
 * de Tareas) y cada directorio puede fijar qué origen se muestra (`directorySource`, lo pone
 * Tareas al conectar su carpeta). Así una misma carpeta abierta en Code y en Tareas no mezcla
 * listas, y `loadSessions` solo reemplaza las sesiones del origen que recarga.
 *
 * CARGA vs. STREAM (AUDIT.md B4): mientras `loadMessages` espera el snapshot, los eventos de esa
 * sesión se registran; al llegar el snapshot se fusiona conservando mensajes/partes creados
 * durante la carga y aplicando los deltas recibidos sin duplicar lo que el snapshot ya incluye.
 */
import { create } from 'zustand'
import type { Session } from '@opencode-ai/sdk/v2/client'
import type { OcEvent, OpencodeClient } from '../lib/opencode'
import { errorMessage } from '../lib/opencode'
import { lruMax } from '../lib/lru'
import { createFrameQueue } from '../lib/frame-queue'
import { nextSessionsLimit, SESSIONS_PAGE, sessionsMayHaveMore } from '../lib/session-paging'
import {
  appendWithoutOverlap,
  byId,
  createBuffers,
  createLoadTracker,
  evictMessages,
  forgetOrphansOf,
  isChildOfAny,
  markSeen,
  messageEventSessionID,
  mergeSnapshot,
  pickEvictions,
  pinClosure,
  reduceEvent,
  selectSessionsForDirectory as selectSessionsPure,
  upsertSorted,
  type Buffers,
  type ConvError,
  type ConvSlice,
  type LoadTracker,
  type MessageEntry
} from '../lib/session-reducer'

export type { MessageEntry }
// Re-exportadas: viven en lib/session-reducer (6.4); se mantienen aquí por compatibilidad.
export { appendWithoutOverlap, upsertSorted }

export type SessionRunState = 'idle' | 'busy' | 'retry'

/** Origen del sidecar principal (Chat/Code). */
export const MAIN_SOURCE = 'main'

interface SessionsState {
  sessions: Record<string, Session>
  /** sessionID → origen (servidor) del que vino. Ausente = MAIN_SOURCE. */
  sessionSource: Record<string, string>
  /** directorio → origen que se muestra para ese directorio. Ausente = MAIN_SOURCE. */
  directorySource: Record<string, string>
  /** Mensajes por sessionID, ordenados por id (ascendente = cronológico). */
  messages: Record<string, MessageEntry[]>
  status: Record<string, SessionRunState>
  errors: Record<string, ConvError | null>
  loadingMessages: Record<string, boolean>
  /** sessionID → el historial completo ya se cargó (F6-B12; `messages[id]` puede ser parcial por eventos sueltos). */
  loaded: Record<string, boolean>

  /** `sessionsKey(directory, source)` → puede haber más sesiones en el servidor que las cargadas (límite alcanzado). */
  moreSessions: Record<string, boolean>
  loadSessions: (client: OpencodeClient, directory: string, source?: string) => Promise<void>
  /** «Cargar más» (o todas con `all`): sube el límite del directorio y recarga la lista. */
  loadMoreSessions: (client: OpencodeClient, directory: string, source?: string, all?: boolean) => Promise<void>
  loadMessages: (client: OpencodeClient, sessionID: string, directory: string) => Promise<void>
  /** Sin `source`: conserva el origen conocido o usa el del directorio de la sesión. */
  upsertSession: (session: Session, source?: string) => void
  removeSession: (sessionID: string) => void
  setStatus: (sessionID: string, status: SessionRunState) => void
  setError: (sessionID: string, error: ConvError | null) => void
  /** Fija (o quita con null) el origen visible de un directorio. */
  setDirectorySource: (directory: string, source: string | null) => void
  applyEvent: (event: OcEvent, source?: string) => void
  /**
   * LRU: marca la sesión como usada ahora. NO hace `set` (el registro es un Map de
   * módulo); solo puede desalojar las más antiguas. Recibir un evento NO cuenta como acceso.
   */
  touchSession: (sessionID: string) => void
  /** Registra una guarda: ids de sesiones que no se pueden desalojar (más su raíz e hijas). Devuelve la baja. */
  addEvictionGuard: (guard: () => Iterable<string>) => () => void
  /**
   * Avisa (antes de desalojar) con las listas cargadas (`loaded`) de cada sesión que se va: permite sembrar cachés
   * derivadas (búsqueda de Tareas). Devuelve la baja.
   */
  addEvictionListener: (fn: EvictionListener) => () => void
  /** Desaloja `messages`/`loaded`/`loadingMessages` de las sesiones no fijadas que sobran del tope (un solo `set`). */
  evictIdle: () => void
  /**
   * F7-B14: marca `loaded=false` en las sesiones cargadas cuyo origen cumple `isSource` (salvo `keep`): tras
   * reconectar/reiniciar un servidor su historial pudo cambiar sin que llegaran los eventos. `messages` no se
   * toca (se sigue mostrando hasta que se reabra la sesión y se recargue).
   */
  invalidateLoaded: (isSource: (source: string) => boolean, keep?: Iterable<string>) => void
}

export type EvictionListener = (evicted: Array<{ id: string; entries: MessageEntry[] }>, state: SessionsState) => void

/** Tope de sesiones con contenido no fijadas en `useSessions` (Chat + Tareas). */
export const SESSIONS_LRU_MAX = 40

/** Límite de la lista de sesiones por directorio+origen (sube con «Cargar más»). */
const sessionLimits = new Map<string, number>()
export function sessionsKey(directory: string, source: string = MAIN_SOURCE): string {
  return `${source}\u0000${directory}`
}

/** Último acceso por sesión (contador monótono; sin registro = nunca abierta). Estado de módulo, sin `set`. */
const lastAccess = new Map<string, number>()
let accessTick = 0
const evictionGuards = new Set<() => Iterable<string>>()
const evictionListeners = new Set<EvictionListener>()
let evictScheduled = false

/**
 * Buffers de este store (partes huérfanas, cargas en curso, ids de evento vistos). Instancia propia,
 * no compartida con Code, y UNA por origen (F6-B3): dos servidores pueden emitir el mismo `event.id`.
 */
const buffersBySource = new Map<string, Buffers>()
/** Tope de orígenes con buffers (F7-B19): cada reinicio de un servidor de Tareas trae un baseUrl nuevo. */
const BUFFERS_MAX_SOURCES = 8
let lastSource: string | null = null
function buffersFor(source: string): Buffers {
  let b = buffersBySource.get(source)
  if (b) {
    // Más recientemente usado al final (solo reinserta al cambiar de origen: el caso normal es el mismo seguido).
    if (source !== lastSource) {
      buffersBySource.delete(source)
      buffersBySource.set(source, b)
      lastSource = source
    }
    return b
  }
  b = createBuffers()
  buffersBySource.set(source, b)
  lastSource = source
  // Acota: descarta los orígenes más antiguos (nunca el principal ni uno con una carga en curso).
  for (const [key, old] of buffersBySource) {
    if (buffersBySource.size <= BUFFERS_MAX_SOURCES) break
    if (key === MAIN_SOURCE || key === source || old.loading.size > 0) continue
    buffersBySource.delete(key)
  }
  return b
}

/** Cargas de `loadMessages` en vuelo por sesión (F7-B11): una segunda llamada reutiliza la promesa. */
const inflightLoads = new Map<string, Promise<void>>()

/** Quita todo el estado derivado de `sessionID` de los buffers (cargas y partes huérfanas). */
function forgetInBuffers(sessionID: string): void {
  const ids = new Set([sessionID])
  for (const b of buffersBySource.values()) {
    b.loading.delete(sessionID)
    forgetOrphansOf(b, ids)
  }
  inflightLoads.delete(sessionID)
}

/**
 * Deltas de texto pendientes (F7-B43): `applyEvent` los encola y se aplican en lote una vez por frame con un solo
 * `set`. Cualquier otro evento, `loadMessages`, `removeSession` y el desalojo vacían la cola ANTES de actuar, así el
 * orden relativo con el resto de eventos es el mismo que aplicando uno a uno. El dedupe se hizo al encolar.
 */
const deltaQueue = createFrameQueue<{ event: OcEvent; source: string }>((items) => {
  const cur = useSessions.getState()
  let slice: ConvSlice = cur
  for (const { event, source } of items) {
    slice = reduceEvent(slice, event, buffersFor(source), { accept: () => true, dedupe: false }).slice
  }
  if (slice !== cur) useSessions.setState(slicePatch(cur, slice))
})

/** Aplica ya los deltas encolados (uso interno y de tests). */
export function flushPendingDeltas(): void {
  deltaQueue.flush()
}

/** Cambios de `slice` respecto de `cur` como parche de Zustand (solo las claves con referencia nueva). */
function slicePatch(cur: SessionsState, slice: ConvSlice): Partial<SessionsState> {
  const patch: Partial<SessionsState> = {}
  if (slice.messages !== cur.messages) patch.messages = slice.messages
  if (slice.status !== cur.status) patch.status = slice.status
  if (slice.errors !== cur.errors) patch.errors = slice.errors
  return patch
}

export const useSessions = create<SessionsState>((set, get) => {
  /** Desalojo agrupado: varios eventos en el mismo tick producen un único `evictIdle`. */
  const scheduleEvict = (): void => {
    if (evictScheduled) return
    evictScheduled = true
    queueMicrotask(() => {
      evictScheduled = false
      get().evictIdle()
    })
  }

  return {
    sessions: {},
    sessionSource: {},
    directorySource: {},
    messages: {},
    status: {},
    errors: {},
    loadingMessages: {},
    loaded: {},
    moreSessions: {},

    loadSessions: async (client, directory, source = MAIN_SOURCE) => {
      const key = sessionsKey(directory, source)
      const limit = sessionLimits.get(key) ?? SESSIONS_PAGE
      const res = await client.session.list({ directory, roots: true, limit })
      if (res.error || !res.data) throw new Error(errorMessage(res.error))
      const list = res.data
      set((s) => {
        const sessions = { ...s.sessions }
        const sessionSource = { ...s.sessionSource }
        // Reemplaza las sesiones de este directorio Y de este origen por la lista fresca, salvo las
        // hijas (subagentes) cuya raíz sigue en la lista: la lista es `roots:true` y no las incluye (F6-B4).
        const rootIds = new Set(list.map((x) => x.id))
        const before = s.sessions
        for (const [id, sess] of Object.entries(before)) {
          if (sess.directory !== directory || (sessionSource[id] ?? MAIN_SOURCE) !== source) continue
          if (isChildOfAny(before, id, rootIds)) continue
          delete sessions[id]
        }
        for (const sess of list) {
          sessions[sess.id] = sess
          if (source === MAIN_SOURCE) delete sessionSource[sess.id]
          else sessionSource[sess.id] = source
        }
        const more = sessionsMayHaveMore(list.length, limit)
        return { sessions, sessionSource, moreSessions: s.moreSessions[key] === more ? s.moreSessions : { ...s.moreSessions, [key]: more } }
      })
    },

    loadMoreSessions: async (client, directory, source = MAIN_SOURCE, all = false) => {
      const key = sessionsKey(directory, source)
      sessionLimits.set(key, nextSessionsLimit(sessionLimits.get(key) ?? SESSIONS_PAGE, all))
      await get().loadSessions(client, directory, source)
    },

    loadMessages: (client, sessionID, directory) => {
      // F7-B11: si ya hay una carga de esta sesión en vuelo se reutiliza. Antes cada llamada abría su propio
      // tracker (el segundo pisaba al primero en `buffers.loading`) y el `finally` de la que terminaba antes
      // apagaba `loadingMessages` de la otra.
      const running = inflightLoads.get(sessionID)
      if (running) {
        lastAccess.set(sessionID, ++accessTick)
        return running
      }
      const p: Promise<void> = (async () => {
        lastAccess.set(sessionID, ++accessTick) // cargar es acceder: no debe salir desalojada al terminar
        deltaQueue.flush() // los deltas anteriores a la carga no deben registrarse en el tracker
        set((s) => ({ loadingMessages: { ...s.loadingMessages, [sessionID]: true } }))
        const tracker: LoadTracker = createLoadTracker()
        const buffers = buffersFor(get().sessionSource[sessionID] ?? MAIN_SOURCE)
        buffers.loading.set(sessionID, tracker)
        // Si `removeSession` retiró el tracker mientras se esperaba, la sesión ya no existe: no resucitarla.
        const dropped = (): boolean => buffers.loading.get(sessionID) !== tracker
        try {
          const res = await client.session.messages({ sessionID, directory })
          if (res.error || !res.data) throw new Error(errorMessage(res.error))
          if (dropped()) return
          deltaQueue.flush() // los deltas de la carga ya están en `messages` y en el tracker
          const entries = res.data.map((m) => ({ info: m.info, parts: [...m.parts].sort(byId) })).sort((a, b) => byId(a.info, b.info))
          set((s) => ({
            messages: { ...s.messages, [sessionID]: mergeSnapshot(entries, s.messages[sessionID] ?? [], tracker) },
            loaded: { ...s.loaded, [sessionID]: true }
          }))
          scheduleEvict()
        } finally {
          if (!dropped()) {
            buffers.loading.delete(sessionID)
            set((s) => ({ loadingMessages: { ...s.loadingMessages, [sessionID]: false } }))
          }
        }
      })().finally(() => {
        if (inflightLoads.get(sessionID) === p) inflightLoads.delete(sessionID)
      })
      inflightLoads.set(sessionID, p)
      return p
    },

    upsertSession: (session, source) =>
      set((s) => {
        const src = source ?? s.sessionSource[session.id] ?? s.directorySource[session.directory] ?? MAIN_SOURCE
        const sessionSource = { ...s.sessionSource }
        if (src === MAIN_SOURCE) delete sessionSource[session.id]
        else sessionSource[session.id] = src
        return { sessions: { ...s.sessions, [session.id]: session }, sessionSource }
      }),

    removeSession: (sessionID) => {
      deltaQueue.flush()
      set((s) => {
        const sessions = { ...s.sessions }
        const messages = { ...s.messages }
        const sessionSource = { ...s.sessionSource }
        const loaded = { ...s.loaded }
        const status = { ...s.status }
        const errors = { ...s.errors }
        const loadingMessages = { ...s.loadingMessages }
        delete sessions[sessionID]
        delete messages[sessionID]
        delete sessionSource[sessionID]
        delete loaded[sessionID]
        // F7-B10: antes quedaban `status` (busy para siempre), `errors` y `loadingMessages` de la sesión borrada.
        delete status[sessionID]
        delete errors[sessionID]
        delete loadingMessages[sessionID]
        lastAccess.delete(sessionID)
        return { sessions, messages, sessionSource, loaded, status, errors, loadingMessages }
      })
      forgetInBuffers(sessionID)
    },

    setStatus: (sessionID, status) => set((s) => ({ status: { ...s.status, [sessionID]: status } })),
    setError: (sessionID, error) => set((s) => ({ errors: { ...s.errors, [sessionID]: error } })),

    setDirectorySource: (directory, source) =>
      set((s) => {
        const directorySource = { ...s.directorySource }
        if (source && source !== MAIN_SOURCE) directorySource[directory] = source
        else delete directorySource[directory]
        return { directorySource }
      }),

    applyEvent: (event, source = MAIN_SOURCE) => {
      if (event.type === 'message.part.delta') {
        // Dedupe por event.id y origen al ENCOLAR (mismo criterio que antes); se aplica en el siguiente frame.
        if (event.id && !markSeen(buffersFor(source).seen, event.id)) return
        deltaQueue.push({ event, source })
        return
      }
      deltaQueue.flush() // orden: lo encolado va antes que este evento
      switch (event.type) {
        case 'session.created':
        case 'session.updated':
          get().upsertSession(event.properties.info, source)
          break
        case 'session.deleted':
          // Solo si la sesión es de este origen (IDs de otro servidor no deben borrarse).
          if ((get().sessionSource[event.properties.info.id] ?? MAIN_SOURCE) === source) {
            get().removeSession(event.properties.info.id)
          }
          break
        default: {
          // session.status/idle/error y message.*: reductor común (sin filtro; dedupe por event.id y origen, F6-B3).
          const cur = get()
          const { slice } = reduceEvent(cur, event, buffersFor(source), { accept: () => true, dedupe: true })
          if (slice === cur) break
          const patch = slicePatch(cur, slice)
          set(patch)
          // Clave nueva en `messages` (sesión que empieza a tener contenido): puede pasarse del tope.
          // F7-B19: `in` sobre la sesión del evento en vez de contar las claves de `messages` en cada delta.
          const sid = messageEventSessionID(event)
          if (patch.messages && sid && !(sid in cur.messages)) scheduleEvict()
          break
        }
      }
    },

    touchSession: (sessionID) => {
      lastAccess.set(sessionID, ++accessTick)
      get().evictIdle()
    },

    addEvictionGuard: (guard) => {
      evictionGuards.add(guard)
      return () => {
        evictionGuards.delete(guard)
      }
    },

    addEvictionListener: (fn) => {
      evictionListeners.add(fn)
      return () => {
        evictionListeners.delete(fn)
      }
    },

    evictIdle: () => {
      if (Object.keys(get().messages).length <= lruMax(SESSIONS_LRU_MAX)) return // atajo: ni con todas sin fijar hay exceso
      deltaQueue.flush() // un delta encolado de una sesión que se desaloja debe aplicarse antes, como uno a uno
      const cur = get()
      const seeds = new Set<string>()
      for (const [id, run] of Object.entries(cur.status)) if (run === 'busy' || run === 'retry') seeds.add(id)
      for (const [id, on] of Object.entries(cur.loadingMessages)) if (on) seeds.add(id)
      for (const b of buffersBySource.values()) for (const id of b.loading.keys()) seeds.add(id)
      try {
        for (const guard of evictionGuards) for (const id of guard()) seeds.add(id)
      } catch {
        return // una guarda rota nunca debe llevar a desalojar de más
      }
      const ids = pickEvictions({
        candidates: Object.keys(cur.messages),
        pinned: pinClosure(cur.sessions, seeds),
        lastAccess,
        max: lruMax(SESSIONS_LRU_MAX)
      })
      if (ids.length === 0) return
      if (evictionListeners.size > 0) {
        const gone = ids.filter((id) => cur.loaded[id] && cur.messages[id]).map((id) => ({ id, entries: cur.messages[id] }))
        if (gone.length > 0) {
          for (const fn of evictionListeners) {
            // F7-B19: un listener que lanza no debe impedir el desalojo ni romper `touchSession`.
            try {
              fn(gone, cur)
            } catch (err) {
              console.error('[sessions] listener de desalojo falló', err)
            }
          }
        }
      }
      const next = evictMessages(cur, ids)
      set({ messages: next.messages, loaded: next.loaded, loadingMessages: next.loadingMessages })
      const gone = new Set(ids)
      for (const b of buffersBySource.values()) forgetOrphansOf(b, gone)
    },

    invalidateLoaded: (isSource, keep = []) => {
      const cur = get()
      const keepSet = new Set(keep)
      const ids = Object.keys(cur.loaded).filter(
        (id) => cur.loaded[id] && !keepSet.has(id) && isSource(cur.sessionSource[id] ?? MAIN_SOURCE)
      )
      if (ids.length === 0) return
      const loaded = { ...cur.loaded }
      for (const id of ids) loaded[id] = false
      set({ loaded })
    }
  }
})

/**
 * Borra TODO el estado de una sesión en `useSessions` (sesión, mensajes, `loaded`, `status`, `errors`,
 * `loadingMessages`, origen, acceso LRU, cargas y partes huérfanas). Para quien borra una sesión por su cuenta
 * (p. ej. `deleteTask` de Tareas): equivale a `removeSession`.
 */
export function purgeSessionState(sessionID: string): void {
  useSessions.getState().removeSession(sessionID)
}

/**
 * Sesiones raíz (no hijas, no archivadas) de un directorio, más recientes primero.
 * Solo las del origen visible de ese directorio (ver `directorySource`).
 */
export function selectSessionsForDirectory(sessions: Record<string, Session>, directory: string): Session[] {
  const { sessionSource, directorySource } = useSessions.getState()
  return selectSessionsPure({ sessions, sessionSource, directorySource }, directory)
}

/**
 * ¿Hay que mostrar el loader de la conversación `id`? Solo mientras se recarga un
 * historial que todavía no está cargado (`!loaded && loadingMessages`): en cualquier otro caso el render no cambia.
 */
export function isTranscriptLoading(s: Pick<SessionsState, 'loaded' | 'loadingMessages'>, id: string | null | undefined): boolean {
  return !!id && !s.loaded[id] && !!s.loadingMessages[id]
}
