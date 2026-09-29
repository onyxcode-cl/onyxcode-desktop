/**
 * Reductor común de eventos de sesión/mensajes (Fase 6.4). Lo comparten `useSessions`
 * (Chat/Tareas) y `useCode`: funciones puras + `Buffers` como instancia por store (antes eran
 * Map/Set globales de módulo). Sin Zustand: los efectos secundarios (notificaciones, no leído,
 * auto-envío, fsVersion) los aplica quien llama a partir de `Effect`.
 *
 * Extraído SIN cambios de comportamiento de `stores/sessions.ts` y `features/code/impl/store.ts`
 * (6.6 añade correcciones declaradas F6-B2..B5, ver CHANGELOG-FASE6.md).
 */
import type { Message, Part, Session } from '@opencode-ai/sdk/v2/client'
import type { OcEvent } from './opencode'
import { errorMessage } from './opencode'

export interface MessageEntry {
  info: Message
  parts: Part[]
}

export type RunState = 'idle' | 'busy' | 'retry'

export interface ConvSlice {
  messages: Record<string, MessageEntry[]>
  status: Record<string, RunState>
  errors: Record<string, string | null>
  sessions: Record<string, Session>
}

/** Eventos registrados mientras se carga el snapshot de mensajes de una sesión. */
export interface LoadTracker {
  /** Mensajes creados/actualizados durante la carga. */
  messages: Set<string>
  /** Partes creadas/actualizadas durante la carga (messageID → partIDs). */
  parts: Map<string, Set<string>>
  /** Deltas recibidos durante la carga: `${partID}\u0000${field}` → trozos en orden. */
  deltas: Map<string, string[]>
  /** Mensajes borrados durante la carga: un snapshot anterior al borrado no debe resucitarlos (F7-B13). */
  removedMessages: Set<string>
  /** Partes borradas durante la carga (messageID → partIDs), idem (F7-B13). */
  removedParts: Map<string, Set<string>>
}

/** Tracker vacío para una carga de mensajes que empieza. */
export function createLoadTracker(): LoadTracker {
  return { messages: new Set(), parts: new Map(), deltas: new Map(), removedMessages: new Set(), removedParts: new Map() }
}

/** Conjunto de ids de evento ya vistos, con expulsión de los más antiguos. */
export interface SeenSet {
  ids: Set<string>
  order: string[]
  max: number
}

export interface Buffers {
  /** Partes que llegan antes que su mensaje (message.updated). Clave = messageID. */
  orphanParts: Map<string, Part[]>
  /**
   * Deltas que llegan antes que su parte (F6-B2). Clave = `${partID}\u0000${field}`, valor = trozos
   * en orden. Caducan (TTL) y tienen tope de claves, igual que `orphanParts`.
   */
  orphanDeltas: Map<string, string[]>
  /** Instante (ms) del último alta de cada clave de `orphanParts` / `orphanDeltas`, para el TTL. */
  orphanAt: { parts: Map<string, number>; deltas: Map<string, number> }
  loading: Map<string, LoadTracker>
  seen: SeenSet
  /** Reloj inyectable (tests); por defecto `Date.now`. */
  now: () => number
}

/** TTL y tope de claves de los buffers huérfanos (F6-B2/B6). */
export const ORPHAN_TTL_MS = 60_000
export const ORPHAN_MAX_KEYS = 500

/** Al superar `seenMax` ids se expulsan los 500 más antiguos (comportamiento original). */
const SEEN_EVICT = 500

export function createBuffers(opts?: { seenMax?: number; now?: () => number }): Buffers {
  return {
    orphanParts: new Map(),
    orphanDeltas: new Map(),
    orphanAt: { parts: new Map(), deltas: new Map() },
    loading: new Map(),
    seen: { ids: new Set(), order: [], max: opts?.seenMax ?? 2000 },
    now: opts?.now ?? Date.now
  }
}

/** Quita las entradas caducadas y, si sigue habiendo más de `ORPHAN_MAX_KEYS`, las más antiguas. */
function pruneOrphans<V>(data: Map<string, V>, at: Map<string, number>, now: number): void {
  for (const [k, t] of at) {
    if (now - t > ORPHAN_TTL_MS) {
      data.delete(k)
      at.delete(k)
    }
  }
  // Map conserva el orden de inserción: las primeras claves son las más antiguas.
  while (data.size > ORPHAN_MAX_KEYS) {
    const oldest = data.keys().next().value as string
    data.delete(oldest)
    at.delete(oldest)
  }
}

function addOrphan<V>(data: Map<string, V>, at: Map<string, number>, key: string, value: V, now: number): void {
  data.delete(key) // reinserta al final: el orden de eliminación por tope sigue al último alta
  data.set(key, value)
  at.set(key, now)
  pruneOrphans(data, at, now)
}

/** true si el id es nuevo (y lo registra); false si ya se había visto. */
export function markSeen(seen: SeenSet, id: string): boolean {
  if (seen.ids.has(id)) return false
  seen.ids.add(id)
  seen.order.push(id)
  if (seen.order.length > seen.max) {
    const old = seen.order.splice(0, SEEN_EVICT)
    for (const o of old) seen.ids.delete(o)
  }
  return true
}

export const byId = <T extends { id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

export function upsertSorted<T extends { id: string }>(list: T[], item: T): T[] {
  const idx = list.findIndex((x) => x.id === item.id)
  if (idx >= 0) {
    const next = list.slice()
    next[idx] = item
    return next
  }
  const next = [...list, item]
  // Casi siempre llega al final; solo ordenar si hace falta.
  if (next.length > 1 && byId(next[next.length - 2], item) > 0) next.sort(byId)
  return next
}

/**
 * `base` + los trozos de delta recibidos durante la carga, sin repetir los que el snapshot ya
 * incluía: se busca el mayor prefijo de trozos COMPLETOS con el que termina `base`
 * (solo en fronteras de trozo, para no comerse caracteres por coincidencias casuales).
 *
 * LÍMITE CONOCIDO (F7-B15): es ambiguo cuando el trozo repetido coincide con el final de `base`. Por ejemplo
 * `('text\n', ['\n', 'Next'])` devuelve `'text\nNext'`: no se puede distinguir «el snapshot ya incluía ese `\n`»
 * de «el `\n` es nuevo». No existe una señal fiable y barata (el delta no lleva offset ni versión), así que se
 * conserva la heurística: perder un carácter repetido en una carga concurrente es menos grave que duplicar texto
 * en cada recarga. `session-reducer.fase7.test.ts` fija este comportamiento.
 */
export function appendWithoutOverlap(base: string, chunks: string[]): string {
  let prefix = chunks.join('')
  for (let i = chunks.length; i > 0; i--) {
    if (prefix && base.endsWith(prefix)) return base + chunks.slice(i).join('')
    prefix = prefix.slice(0, prefix.length - chunks[i - 1].length)
  }
  return base + chunks.join('')
}

/** Fusiona el snapshot de `session.messages` con lo recibido por el stream durante la carga. */
export function mergeSnapshot(snapshot: MessageEntry[], current: MessageEntry[], t: LoadTracker): MessageEntry[] {
  const currentById = new Map(current.map((m) => [m.info.id, m]))
  const out = new Map<string, MessageEntry>()
  for (const snap of snapshot) {
    if (t.removedMessages.has(snap.info.id)) continue // borrado durante la carga (F7-B13)
    const live = currentById.get(snap.info.id)
    let parts = snap.parts
    const removedParts = t.removedParts.get(snap.info.id)
    if (removedParts) parts = parts.filter((p) => !removedParts.has(p.id))
    const touchedParts = t.parts.get(snap.info.id)
    const fromLive = new Set<string>()
    if (live && touchedParts) {
      // Partes creadas/actualizadas durante la carga: la versión del stream es más reciente
      // (y ya lleva sus deltas aplicados).
      for (const p of live.parts) {
        if (!touchedParts.has(p.id)) continue
        parts = upsertSorted(parts, p)
        fromLive.add(p.id)
      }
    }
    // Deltas recibidos durante la carga sobre partes del snapshot.
    parts = parts.map((p) => {
      if (fromLive.has(p.id)) return p
      let next = p
      for (const [key, delta] of t.deltas) {
        const [partID, field] = key.split('\u0000')
        if (partID !== p.id) continue
        const cur = (next as unknown as Record<string, unknown>)[field]
        if (cur !== undefined && typeof cur !== 'string') continue
        next = { ...next, [field]: appendWithoutOverlap(cur ?? '', delta) } as Part
      }
      return next
    })
    const info = live && t.messages.has(snap.info.id) ? live.info : snap.info
    out.set(snap.info.id, { info, parts })
  }
  // Mensajes nuevos que llegaron por el stream durante la carga y no están en el snapshot.
  for (const id of t.messages) {
    if (!out.has(id)) {
      const live = currentById.get(id)
      if (live) out.set(id, live)
    }
  }
  return [...out.values()].sort((a, b) => byId(a.info, b.info))
}

export type Effect =
  | { type: 'became-idle'; sessionID: string; prev: RunState | undefined }
  | { type: 'fs-touched'; directory: string }
  | { type: 'error'; sessionID: string }

export interface ReduceOptions {
  /** ¿Se procesan los eventos de esta sesión? (Code: solo sesiones conocidas). */
  accept: (sessionID: string) => boolean
  /** Descarta ids de evento ya vistos (`Buffers.seen`). */
  dedupe: boolean
}

/** sessionID de un evento `message.*` (info.sessionID / part.sessionID / sessionID), o undefined. */
export function messageEventSessionID(ev: OcEvent): string | undefined {
  const p = (ev as { properties?: { sessionID?: unknown; info?: { sessionID?: unknown }; part?: { sessionID?: unknown } } }).properties
  const sid = p?.sessionID ?? p?.info?.sessionID ?? p?.part?.sessionID
  return typeof sid === 'string' ? sid : undefined
}

/** Aplica (y consume) los deltas huérfanos de `part`; devuelve la misma parte si no había ninguno. */
function applyOrphanDeltas(b: Buffers, part: Part): Part {
  if (b.orphanDeltas.size === 0) return part
  pruneOrphans(b.orphanDeltas, b.orphanAt.deltas, b.now())
  let next = part
  for (const [key, chunks] of b.orphanDeltas) {
    const [partID, field] = key.split('\u0000')
    if (partID !== part.id) continue
    b.orphanDeltas.delete(key)
    b.orphanAt.deltas.delete(key)
    const cur = (next as unknown as Record<string, unknown>)[field]
    if (cur !== undefined && typeof cur !== 'string') continue
    next = { ...next, [field]: appendWithoutOverlap(cur ?? '', chunks) } as Part
  }
  return next
}

/**
 * Aplica un evento `session.status|idle|error` o `message.*` sobre `slice`. Devuelve la MISMA
 * referencia de `slice` si no hubo cambio. Los demás eventos (session.created/updated/deleted,
 * todo, permission, question, file.*) los maneja cada store. Los efectos se devuelven, no se aplican.
 */
export function reduceEvent(slice: ConvSlice, ev: OcEvent, b: Buffers, opt: ReduceOptions): { slice: ConvSlice; effects: Effect[] } {
  const none = { slice, effects: [] as Effect[] }
  if (opt.dedupe && ev.id && !markSeen(b.seen, ev.id)) return none

  const track = (sessionID: string, fn: (t: LoadTracker) => void): void => {
    const t = b.loading.get(sessionID)
    if (t) fn(t)
  }
  const updateMessages = (s: ConvSlice, sessionID: string, fn: (list: MessageEntry[]) => MessageEntry[]): ConvSlice => ({
    ...s,
    messages: { ...s.messages, [sessionID]: fn(s.messages[sessionID] ?? []) }
  })
  /** null si el mensaje no existe (nada que actualizar). */
  const updatePart = (s: ConvSlice, sessionID: string, messageID: string, fn: (parts: Part[]) => Part[]): ConvSlice | null => {
    const list = s.messages[sessionID]
    const idx = list?.findIndex((m) => m.info.id === messageID) ?? -1
    if (!list || idx < 0) return null
    const entry = list[idx]
    const next = list.slice()
    next[idx] = { info: entry.info, parts: fn(entry.parts) }
    return { ...s, messages: { ...s.messages, [sessionID]: next } }
  }

  switch (ev.type) {
    case 'session.status': {
      const { sessionID, status } = ev.properties
      if (!opt.accept(sessionID)) return none
      const next: RunState = status.type === 'busy' || status.type === 'retry' ? status.type : 'idle'
      const prev = slice.status[sessionID]
      const out: ConvSlice = { ...slice, status: { ...slice.status, [sessionID]: next } }
      const effects: Effect[] = prev !== 'idle' && next === 'idle' ? [{ type: 'became-idle', sessionID, prev }] : []
      return { slice: out, effects }
    }
    case 'session.idle': {
      const { sessionID } = ev.properties
      if (!opt.accept(sessionID)) return none
      const prev = slice.status[sessionID]
      const out: ConvSlice = { ...slice, status: { ...slice.status, [sessionID]: 'idle' } }
      return { slice: out, effects: prev !== 'idle' ? [{ type: 'became-idle', sessionID, prev }] : [] }
    }
    case 'session.error': {
      const { sessionID, error } = ev.properties
      if (sessionID && opt.accept(sessionID) && error && error.name !== 'MessageAbortedError') {
        return {
          slice: { ...slice, errors: { ...slice.errors, [sessionID]: errorMessage(error) } },
          effects: [{ type: 'error', sessionID }]
        }
      }
      return none
    }
    case 'message.updated': {
      const info = ev.properties.info
      if (!opt.accept(info.sessionID)) return none
      track(info.sessionID, (t) => {
        t.messages.add(info.id)
        t.removedMessages.delete(info.id) // vuelto a crear tras un borrado durante la carga
      })
      const out = updateMessages(slice, info.sessionID, (list) => {
        const existing = list.find((m) => m.info.id === info.id)
        pruneOrphans(b.orphanParts, b.orphanAt.parts, b.now())
        const orphans = b.orphanParts.get(info.id) ?? []
        b.orphanParts.delete(info.id)
        b.orphanAt.parts.delete(info.id)
        let parts = existing?.parts ?? []
        for (const p of orphans) parts = upsertSorted(parts, applyOrphanDeltas(b, p)) // F7-B12: deltas llegados después de la parte huérfana
        const entry: MessageEntry = { info, parts }
        const idx = list.findIndex((m) => m.info.id === info.id)
        if (idx >= 0) return list.map((m, i) => (i === idx ? entry : m))
        return [...list, entry].sort((a, c) => byId(a.info, c.info))
      })
      return { slice: out, effects: [] }
    }
    case 'message.removed': {
      const { sessionID, messageID } = ev.properties
      if (!opt.accept(sessionID)) return none
      track(sessionID, (t) => {
        t.removedMessages.add(messageID)
        t.messages.delete(messageID)
        t.parts.delete(messageID)
      })
      return { slice: updateMessages(slice, sessionID, (list) => list.filter((m) => m.info.id !== messageID)), effects: [] }
    }
    case 'message.part.updated': {
      const part = ev.properties.part
      if (!opt.accept(part.sessionID)) return none
      track(part.sessionID, (t) => {
        const set = t.parts.get(part.messageID) ?? new Set<string>()
        set.add(part.id)
        t.parts.set(part.messageID, set)
        t.removedParts.get(part.messageID)?.delete(part.id)
      })
      // Deltas que llegaron antes que la parte (F6-B2): sin repetir lo que la parte ya incluye.
      const withDeltas = applyOrphanDeltas(b, part)
      const out = updatePart(slice, part.sessionID, part.messageID, (parts) => upsertSorted(parts, withDeltas))
      if (!out) {
        addOrphan(
          b.orphanParts,
          b.orphanAt.parts,
          part.messageID,
          upsertSorted(b.orphanParts.get(part.messageID) ?? [], withDeltas),
          b.now()
        )
        return none
      }
      return { slice: out, effects: [] }
    }
    case 'message.part.removed': {
      const { sessionID, messageID, partID } = ev.properties
      if (!opt.accept(sessionID)) return none
      track(sessionID, (t) => {
        const set = t.removedParts.get(messageID) ?? new Set<string>()
        set.add(partID)
        t.removedParts.set(messageID, set)
        t.parts.get(messageID)?.delete(partID)
      })
      const out = updatePart(slice, sessionID, messageID, (parts) => parts.filter((p) => p.id !== partID))
      return out ? { slice: out, effects: [] } : none
    }
    case 'message.part.delta': {
      const { sessionID, messageID, partID, field, delta } = ev.properties
      if (!opt.accept(sessionID)) return none
      track(sessionID, (t) => {
        const key = `${partID}\u0000${field}`
        const chunks = t.deltas.get(key) ?? []
        chunks.push(delta)
        t.deltas.set(key, chunks)
      })
      const exists = slice.messages[sessionID]?.find((m) => m.info.id === messageID)?.parts.some((p) => p.id === partID)
      if (!exists) {
        // Parte (o mensaje) aún desconocida: guardar el delta hasta que llegue su part.updated (F6-B2).
        const key = `${partID}\u0000${field}`
        addOrphan(b.orphanDeltas, b.orphanAt.deltas, key, [...(b.orphanDeltas.get(key) ?? []), delta], b.now())
        return none
      }
      const out = updatePart(slice, sessionID, messageID, (parts) =>
        parts.map((p) => {
          if (p.id !== partID) return p
          const current = (p as unknown as Record<string, unknown>)[field]
          if (current !== undefined && typeof current !== 'string') return p
          return { ...p, [field]: (current ?? '') + delta } as Part
        })
      )
      return out ? { slice: out, effects: [] } : none
    }
    default:
      return none
  }
}

/**
 * Reconcilia `session.status` del servidor con el mapa local de estados (F6-B5). El servidor solo
 * lista las sesiones NO idle: lo `busy`/`retry` del mapa `server` se aplica tal cual, y en el ámbito
 * `scope` (ids que este llamador administra) lo que no está ocupado en el servidor pasa a `idle`
 * (evita el spinner "pegado" cuando se perdió el evento de fin). Fuera de ámbito no se toca nada
 * salvo lo que el servidor reporte ocupado. Devuelve un mapa nuevo, o `null` si no hay cambios.
 */
export function reconcileRunStatus(
  cur: Record<string, RunState>,
  server: Record<string, { type: string }>,
  scope: Iterable<string>
): Record<string, RunState> | null {
  const next = { ...cur }
  let changed = false
  const busy = (id: string): 'busy' | 'retry' | null => {
    const t = server[id]?.type
    return t === 'busy' || t === 'retry' ? t : null
  }
  for (const id of Object.keys(server)) {
    const run = busy(id)
    if (run && next[id] !== run) {
      next[id] = run
      changed = true
    }
  }
  for (const id of scope) {
    if (!busy(id) && next[id] && next[id] !== 'idle') {
      next[id] = 'idle'
      changed = true
    }
  }
  return changed ? next : null
}

/**
 * Ámbito (ids) que un llamador administra al reconciliar `session.status` (F7-B10): las sesiones de `sessions`
 * del `directory` cuyo origen cumple `isSource`, MÁS las claves de `status` sin entrada en `sessions` cuyo origen
 * (`sessionSource`, ausente = 'main') cumple `isSource`. Lo segundo cubre las huérfanas: tras reiniciar el sidecar
 * `loadSessions` ya vació `sessions`, pero `status[id]` seguía `busy` para siempre. Pura.
 */
export function runStatusScope(
  s: { sessions: Record<string, Session>; sessionSource: Record<string, string>; status: Record<string, RunState> },
  directory: string,
  isSource: (source: string) => boolean
): string[] {
  const out: string[] = []
  for (const [id, sess] of Object.entries(s.sessions)) {
    if (sess.directory === directory && isSource(s.sessionSource[id] ?? 'main')) out.push(id)
  }
  for (const id of Object.keys(s.status)) {
    if (!(id in s.sessions) && isSource(s.sessionSource[id] ?? 'main')) out.push(id)
  }
  return out
}

/**
 * De `ids`, solo los que NO cambiaron de estado entre `before` (antes de pedir `session.status` al servidor) y
 * `now` (al aplicar la respuesta) (F7-B10). La respuesta es una foto anterior: una sesión que pasó a `busy` por
 * un evento mientras tanto no debe degradarse a `idle` por no aparecer en ella. Pura.
 */
export function unchangedSince(ids: string[], before: Record<string, RunState>, now: Record<string, RunState>): string[] {
  return ids.filter((id) => before[id] === now[id])
}

/**
 * Reconstruye un mapa de pendientes (permisos/preguntas) desde la lista del servidor en vez de solo acumular
 * (F7-B16). Se conservan: los ajenos al ámbito (`inScope` falso, p. ej. otro proyecto) y los que llegaron por
 * evento MIENTRAS se pedía la lista (no estaban en `before`). Se descartan los del ámbito que el servidor ya no
 * lista (respondidos desde otro cliente). No se resucita lo que un evento eliminó durante la petición
 * (estaba en `before` y ya no está en `cur`). Pura.
 */
export function reconcilePending<T extends { id: string }>(opts: {
  cur: Record<string, T>
  before: Record<string, T>
  server: T[]
  inScope: (item: T) => boolean
}): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [id, item] of Object.entries(opts.cur)) {
    if (!opts.inScope(item) || !(id in opts.before)) out[id] = item
  }
  for (const item of opts.server) {
    if (item.id in opts.before && !(item.id in opts.cur)) continue
    out[item.id] = item
  }
  return out
}

/**
 * ¿`id` es una sesión hija (subagente) cuya cadena de `parentID` llega a una raíz de `roots`?
 * `list(roots:true)` no devuelve hijas: un resync no debe borrarlas mientras su raíz siga (F6-B4).
 */
export function isChildOfAny(sessions: Record<string, Session>, id: string, roots: ReadonlySet<string>): boolean {
  let cur = sessions[id]
  for (let depth = 0; cur?.parentID && depth < 20; depth++) {
    if (roots.has(cur.parentID)) return true
    cur = sessions[cur.parentID]
  }
  return false
}

/**
 * Sesiones raíz (no hijas, no archivadas) de un directorio, más recientes primero.
 * Solo las del origen visible de ese directorio (`directorySource`). Pura: recibe el estado.
 */
export function selectSessionsForDirectory(
  s: {
    sessions: Record<string, Session>
    sessionSource: Record<string, string>
    directorySource: Record<string, string>
  },
  directory: string
): Session[] {
  const source = s.directorySource[directory] ?? 'main'
  return Object.values(s.sessions)
    .filter(
      (x) =>
        x.directory === directory &&
        !x.parentID &&
        // Archivada, salvo que se restaurara después (respaldo `metadata.unarchivedAt`).
        !(x.time.archived && !(typeof x.metadata?.unarchivedAt === 'number' && x.metadata.unarchivedAt > x.time.archived)) &&
        (s.sessionSource[x.id] ?? 'main') === source
    )
    .sort((a, b) => b.time.updated - a.time.updated)
}

// ───────────────────────────── LRU de `messages` (docs/LRU-PLAN.md) ─────────────────────────────

/** Contenido desalojable de una sesión: se limpia siempre junto (un único `set`). */
export interface EvictSlice {
  messages: Record<string, MessageEntry[]>
  loaded: Record<string, boolean>
  loadingMessages: Record<string, boolean>
}

/**
 * Fijadas + raíz e hijas de cada fijada: sube por `parentID` desde cada semilla (raíz y ancestros) y baja a
 * todas las sesiones cuya cadena de `parentID` llega a una semilla (hijas/nietas). Pura.
 */
export function pinClosure(sessions: Record<string, Session>, seeds: Iterable<string>): Set<string> {
  const seedSet = new Set(seeds)
  const out = new Set(seedSet)
  for (const id of seedSet) {
    let cur = sessions[id]
    for (let depth = 0; cur?.parentID && depth < 20; depth++) {
      out.add(cur.parentID)
      cur = sessions[cur.parentID]
    }
  }
  for (const id of Object.keys(sessions)) {
    let cur = sessions[id]
    for (let depth = 0; cur?.parentID && depth < 20; depth++) {
      if (seedSet.has(cur.parentID)) {
        out.add(id)
        break
      }
      cur = sessions[cur.parentID]
    }
  }
  return out
}

/**
 * Ids a desalojar: `candidates` (sesiones con contenido) sin las `pinned`; si quedan más de `max`, las que
 * sobran, empezando por la de menor `lastAccess` (sin registro = 0, las nunca abiertas salen primero; a igual
 * valor, el orden de `candidates`). Nunca devuelve una fijada. Pura.
 */
export function pickEvictions(opts: {
  candidates: Iterable<string>
  pinned: ReadonlySet<string>
  lastAccess: ReadonlyMap<string, number>
  max: number
}): string[] {
  const free = [...opts.candidates].filter((id) => !opts.pinned.has(id))
  const extra = free.length - Math.max(0, opts.max)
  if (extra <= 0) return []
  const order = new Map(free.map((id, i) => [id, i]))
  const at = (id: string): number => opts.lastAccess.get(id) ?? 0
  return free.sort((a, b) => at(a) - at(b) || (order.get(a) ?? 0) - (order.get(b) ?? 0)).slice(0, extra)
}

/** Quita `messages`/`loaded`/`loadingMessages` de `ids`. Devuelve la MISMA referencia si no hay nada que quitar. */
export function evictMessages<S extends EvictSlice>(s: S, ids: Iterable<string>): S {
  const list = [...ids].filter((id) => id in s.messages || id in s.loaded || id in s.loadingMessages)
  if (list.length === 0) return s
  const messages = { ...s.messages }
  const loaded = { ...s.loaded }
  const loadingMessages = { ...s.loadingMessages }
  for (const id of list) {
    delete messages[id]
    delete loaded[id]
    delete loadingMessages[id]
  }
  return { ...s, messages, loaded, loadingMessages }
}

/**
 * Olvida las partes huérfanas de las sesiones `ids` (por `part.sessionID`). Los deltas huérfanos no guardan
 * sesión (caducan solos por TTL) y `loading` no se toca: una carga en vuelo fija la sesión.
 */
export function forgetOrphansOf(b: Buffers, ids: ReadonlySet<string>): void {
  if (ids.size === 0) return
  for (const [key, parts] of b.orphanParts) {
    const keep = parts.filter((p) => !ids.has(p.sessionID))
    if (keep.length === parts.length) continue
    if (keep.length === 0) {
      b.orphanParts.delete(key)
      b.orphanAt.parts.delete(key)
    } else b.orphanParts.set(key, keep)
  }
}
