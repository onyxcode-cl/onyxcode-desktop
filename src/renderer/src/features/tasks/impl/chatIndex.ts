/**
 * Modo unificado (ola 2b): índice de chats en el renderer. Habla con main por `tasks:chatIndex:*` (hoy solo metadatos:
 * carpeta, id de sesión, título y última actividad). Aquí vive la sincronización (renderer → main, con tope de frecuencia),
 * la copia local que usa la barra lateral y las funciones puras para fusionar y nombrar las entradas.
 * Nada de esto se usa sin la bandera `unifiedApps`.
 */
import { create } from 'zustand'
import { dateLocale } from '../../../lib/i18n'
import { t } from '@shared/i18n'
import type { ChatIndexEntry } from '@shared/ipc-tasks'
import { cw } from './bridge'

/** Una llamada por sesión como mucho cada tanto: la actividad nueva llega muy seguido por el SSE. */
export const CHAT_INDEX_THROTTLE_MS = 4000
const MAX_TITLE = 300

interface ChatIndexState {
  entries: ChatIndexEntry[]
  loaded: boolean
  /** Entrada que se está abriendo (conectando su carpeta). */
  opening: { folder: string; sessionId: string } | null
  /** Mensaje en español llano si no se pudo abrir; la lista no se toca. */
  error: string | null
}

export const useChatIndex = create<ChatIndexState>(() => ({ entries: [], loaded: false, opening: null, error: null }))

const keyOf = (folder: string, sessionId: string): string => `${folder}\u0000${sessionId}`

const sent = new Map<string, { at: number; sig: string }>()
const pending = new Map<string, { entry: ChatIndexEntry; timer: ReturnType<typeof setTimeout> }>()

/** Solo para pruebas. */
export function resetChatIndexSync(): void {
  for (const p of pending.values()) clearTimeout(p.timer)
  pending.clear()
  sent.clear()
  useChatIndex.setState({ entries: [], loaded: false, opening: null, error: null })
}

function mergeLocal(entry: ChatIndexEntry): void {
  useChatIndex.setState((s) => {
    const rest = s.entries.filter((e) => !(e.folder === entry.folder && e.sessionId === entry.sessionId))
    return { entries: [...rest, entry] }
  })
}

function warn(what: string, err: unknown): void {
  console.warn(`[chatIndex] ${what}:`, err instanceof Error ? err.message : err)
}

function send(entry: ChatIndexEntry): void {
  const k = keyOf(entry.folder, entry.sessionId)
  sent.set(k, { at: Date.now(), sig: `${entry.title}|${entry.updatedAt}` })
  mergeLocal(entry)
  void cw('tasks:chatIndex:upsert', entry).catch((err) => warn('upsert', err))
}

/** Avisa a main de una sesión vista en la carpeta conectada. Mismo título y actividad = no hace nada; dentro del tope, queda una sola pendiente. */
export function syncChatSession(entry: ChatIndexEntry): void {
  const clean: ChatIndexEntry = { ...entry, title: (entry.title ?? '').slice(0, MAX_TITLE) }
  const k = keyOf(clean.folder, clean.sessionId)
  const sig = `${clean.title}|${clean.updatedAt}`
  const last = sent.get(k)
  const wait = last ? last.at + CHAT_INDEX_THROTTLE_MS - Date.now() : 0
  if (last && last.sig === sig && !pending.has(k)) return
  if (wait <= 0) {
    const p = pending.get(k)
    if (p) {
      clearTimeout(p.timer)
      pending.delete(k)
    }
    send(clean)
    return
  }
  const p = pending.get(k)
  if (p) {
    p.entry = clean
    return
  }
  const slot = {
    entry: clean,
    timer: setTimeout(() => {
      pending.delete(k)
      send(slot.entry)
    }, wait)
  }
  pending.set(k, slot)
}

/** Quita del índice una sesión (eliminada o archivada) o, sin `sessionId`, toda la carpeta. */
export function forgetChatSession(folder: string, sessionId?: string): void {
  if (sessionId) {
    const k = keyOf(folder, sessionId)
    const p = pending.get(k)
    if (p) {
      clearTimeout(p.timer)
      pending.delete(k)
    }
    sent.delete(k)
  }
  useChatIndex.setState((s) => ({
    entries: s.entries.filter((e) => !(e.folder === folder && (!sessionId || e.sessionId === sessionId)))
  }))
  void cw('tasks:chatIndex:remove', sessionId ? { folder, sessionId } : { folder }).catch((err) => warn('remove', err))
}

/** Carga el índice de main. Un fallo deja la copia que ya había (la lista no se vacía). */
export async function loadChatIndex(): Promise<void> {
  try {
    const list = await cw('tasks:chatIndex:list')
    if (!Array.isArray(list)) return
    // Lo que acabamos de enviar y main todavía no devuelve se conserva (carrera entre upsert y list).
    useChatIndex.setState((s) => {
      const fromMain = new Map(list.map((e) => [keyOf(e.folder, e.sessionId), e] as const))
      for (const e of s.entries) {
        const k = keyOf(e.folder, e.sessionId)
        const m = fromMain.get(k)
        if (!m && sent.has(k)) fromMain.set(k, e)
        else if (m && sent.has(k) && e.updatedAt > m.updatedAt) fromMain.set(k, e)
      }
      return { entries: [...fromMain.values()], loaded: true }
    })
  } catch (err) {
    warn('list', err)
    useChatIndex.setState({ loaded: true })
  }
}

// ───────────────────────────── Puras ─────────────────────────────

export interface ConnectedSessionLite {
  id: string
  title?: string
  updatedAt: number
}

/**
 * Entradas del índice que se muestran junto a las tareas de la carpeta conectada. La conectada manda: se descartan las que
 * ya están entre sus sesiones (vivas o archivadas) y, con su lista ya cargada y sin más páginas, las de esa misma carpeta
 * (ya no existen allí). Mientras carga no se descartan por carpeta, para que la lista no parpadee.
 */
export function visibleEntries(
  entries: ChatIndexEntry[],
  opts: { connectedFolder: string | null; knownIds: Set<string>; connectedSettled: boolean }
): ChatIndexEntry[] {
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const cf = opts.connectedFolder ? norm(opts.connectedFolder) : null
  return entries
    .filter((e) => !opts.knownIds.has(e.sessionId))
    .filter((e) => !(cf && opts.connectedSettled && norm(e.folder) === cf))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Fecha corta de la entrada, para «Chat sin título · fecha». */
export function entryDate(ts: number, locale?: string): string {
  return new Date(ts).toLocaleDateString(locale, { day: 'numeric', month: 'short' })
}

/** Títulos que pone el servidor mientras la sesión no tiene uno propio («New session - 2026-…»): se tratan como vacíos. */
const PLACEHOLDER_TITLE = /^(new session|child session)\s*-\s*\d{4}-\d{2}-\d{2}/i

/** Nombre que se muestra de un chat: su título o «Chat sin título · fecha». Nunca el id de la sesión ni el de la carpeta. */
export function chatDisplayTitle(title: string | undefined | null, updatedAt: number): string {
  const clean = (title ?? '').trim()
  if (clean && !PLACEHOLDER_TITLE.test(clean)) return clean
  return t('tasks.unified.untitled', { date: entryDate(updatedAt, dateLocale()) })
}
