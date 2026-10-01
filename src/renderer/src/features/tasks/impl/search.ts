/**
 * Búsqueda dentro del contenido de las tareas de Tareas (barra lateral). La parte pura
 * (`searchEntries`) ignora mayúsculas y tildes; el hook `useTranscriptSearch` recorre las tareas de la
 * carpeta actual leyendo sus mensajes con poca concurrencia y una caché de texto por sesión.
 */
import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { MAIN_SOURCE, useSessions, type MessageEntry } from '../../../stores/sessions'
import { selectSessionsForDirectory } from '../../../lib/session-reducer'
import { splitAttachments, visibleTextParts } from './transcript'
import { useTasks } from './store'

export interface TranscriptHit {
  sessionId: string
  title: string
  partId: string
  snippet: string
  at: number
}

/** Máximo de caracteres de un fragmento (incluidos los puntos suspensivos). */
export const SNIPPET_MAX = 160
/** Mínimo de caracteres para buscar dentro de las conversaciones. */
export const MIN_QUERY_LENGTH = 3

/** Minúsculas y sin tildes (NFD), conservando para cada carácter normalizado su índice en el original. */
function foldWithMap(text: string): { folded: string; map: number[] } {
  let folded = ''
  const map: number[] = []
  for (let i = 0; i < text.length; i++) {
    const piece = text[i].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    for (let k = 0; k < piece.length; k++) map.push(i)
    folded += piece
  }
  return { folded, map }
}

/** Texto normalizado para comparar (minúsculas, sin tildes, espacios colapsados). */
export function foldText(text: string): string {
  return foldWithMap(text).folded.replace(/\s+/g, ' ').trim()
}

/** Fragmento de ≤ `SNIPPET_MAX` caracteres que empieza poco antes de `at` en `text` (ya con espacios colapsados). */
function makeSnippet(text: string, at: number): string {
  let start = Math.max(0, at - 40)
  // Si el texto restante cabe entero, se recuesta hacia atrás para mostrar más contexto previo.
  if (start > 0 && text.length - start <= SNIPPET_MAX) start = Math.max(0, text.length - (SNIPPET_MAX - 1))
  const lead = start > 0 ? 1 : 0
  let end = Math.min(text.length, start + SNIPPET_MAX - lead)
  if (end < text.length) end -= 1 // hueco para los puntos suspensivos finales
  return `${lead ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}

/** Texto buscable de una tarea: una entrada por parte de texto visible (el usuario sin su bloque de adjuntos). */
export interface SearchableText {
  partId: string
  text: string
  at: number
}

export function extractSearchable(entries: MessageEntry[]): SearchableText[] {
  const out: SearchableText[] = []
  for (const e of entries) {
    for (const p of visibleTextParts(e)) {
      const raw = e.info.role === 'user' ? splitAttachments(p.text).text : p.text
      const text = raw.replace(/\s+/g, ' ').trim()
      if (text) out.push({ partId: p.id, text, at: e.info.time.created })
    }
  }
  return out
}

/**
 * Mensajes de una sesión SOLO si su historial completo ya se cargó (`loaded`). Una lista parcial (eventos
 * sueltos de una rutina) o ausente devuelve `undefined`, y quien llama la pide al servidor (F6-B14).
 */
export function loadedTranscript(
  st: { loaded: Record<string, boolean>; messages: Record<string, MessageEntry[]> },
  sessionId: string
): MessageEntry[] | undefined {
  return st.loaded[sessionId] ? st.messages[sessionId] : undefined
}

/** Busca `query` en textos ya extraídos. Devuelve como máximo `max` coincidencias (una por parte). */
export function searchTexts(sessionId: string, title: string, texts: SearchableText[], query: string, max = 3): TranscriptHit[] {
  const q = foldText(query)
  if (!q) return []
  const hits: TranscriptHit[] = []
  for (const t of texts) {
    const { folded, map } = foldWithMap(t.text)
    const idx = folded.indexOf(q)
    if (idx < 0) continue
    const orig = map[idx] ?? 0
    hits.push({ sessionId, title, partId: t.partId, snippet: makeSnippet(t.text, orig), at: t.at })
    if (hits.length >= max) break
  }
  return hits
}

/**
 * Coincidencias de `query` en los mensajes de una tarea (usuario y agente), sin tildes ni mayúsculas.
 * Cada parte de texto aporta como máximo un fragmento.
 */
export function searchEntries(sessionId: string, title: string, entries: MessageEntry[], query: string, max = 3): TranscriptHit[] {
  return searchTexts(sessionId, title, extractSearchable(entries), query, max)
}

// ───────────────────────────── Hook ─────────────────────────────

/** Tareas recorridas como máximo por búsqueda (las más recientes). */
const MAX_SESSIONS = 100
const CONCURRENCY = 3
const DEBOUNCE_MS = 250
const HITS_PER_SESSION = 3

/** Caché de texto por sesión; se invalida si cambia `time.updated`. */
const textCache = new Map<string, { updated: number; texts: SearchableText[] }>()
const CACHE_LIMIT = 300

function cacheSet(key: string, value: { updated: number; texts: SearchableText[] }): void {
  if (textCache.size >= CACHE_LIMIT) {
    const oldest = textCache.keys().next().value
    if (oldest !== undefined) textCache.delete(oldest)
  }
  textCache.set(key, value)
}

/** Texto en caché de la sesión si sigue vigente (`updated` igual al de la sesión). */
export function cachedTranscriptTexts(sessionId: string, updated: number): SearchableText[] | undefined {
  const cached = textCache.get(sessionId)
  return cached && cached.updated === updated ? cached.texts : undefined
}

// Al desalojar una tarea de Tareas su texto se conserva aquí: buscarlo no obliga a pedir su historial (D4).
useSessions.getState().addEvictionListener((evicted, st) => {
  for (const { id, entries } of evicted) {
    const src = st.sessionSource[id]
    const session = st.sessions[id]
    if (!session || !src || src === MAIN_SOURCE) continue // solo sesiones de Tareas
    cacheSet(id, { updated: session.time.updated, texts: extractSearchable(entries) })
  }
})

interface SearchState {
  hits: TranscriptHit[]
  loading: boolean
  scanned: number
  total: number
}

const EMPTY: SearchState = { hits: [], loading: false, scanned: 0, total: 0 }

/**
 * Busca `query` (≥ 3 caracteres) dentro de las conversaciones de las tareas de `folder` (debe ser la
 * carpeta conectada). Los resultados llegan de forma progresiva, ordenados por la recencia de la tarea.
 */
export function useTranscriptSearch(folder: string | null, query: string): SearchState {
  const [state, setState] = useState<SearchState>(EMPTY)
  const client = useTasks((s) => s.client)
  const connectedFolder = useTasks((s) => s.folder)
  const q = query.trim()

  useEffect(() => {
    if (!folder || folder !== connectedFolder || !client || q.length < MIN_QUERY_LENGTH) {
      setState(EMPTY)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      const st = useSessions.getState()
      const list = selectSessionsForDirectory(st, folder).slice(0, MAX_SESSIONS)
      const results: Array<TranscriptHit[] | undefined> = new Array(list.length)
      let scanned = 0
      let next = 0
      const publish = (loading: boolean): void => {
        if (cancelled) return
        setState({ hits: results.flatMap((r) => r ?? []), loading, scanned, total: list.length })
      }
      publish(list.length > 0)

      const textsFor = async (i: number): Promise<SearchableText[]> => {
        const s = list[i]
        const loaded = loadedTranscript(useSessions.getState(), s.id)
        if (loaded) return extractSearchable(loaded)
        const cached = cachedTranscriptTexts(s.id, s.time.updated)
        if (cached) return cached
        const res = await client.session.messages({ sessionID: s.id, directory: folder })
        const entries: MessageEntry[] = (res.data ?? []).map((m) => ({ info: m.info, parts: m.parts }))
        const texts = extractSearchable(entries)
        cacheSet(s.id, { updated: s.time.updated, texts })
        return texts
      }

      const worker = async (): Promise<void> => {
        while (!cancelled) {
          const i = next++
          if (i >= list.length) return
          const s = list[i]
          try {
            const texts = await textsFor(i)
            const hits = searchTexts(s.id, s.title || t('tasks.ws.untitled'), texts, q, HITS_PER_SESSION)
            results[i] = hits
          } catch {
            results[i] = []
          }
          scanned++
          publish(scanned < list.length)
        }
      }
      void Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker)).then(() => publish(false))
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [folder, connectedFolder, client, q])

  return state
}
