/**
 * Índice de búsqueda por contenido de las conversaciones de Chat y Code. PURO (sin React ni stores) y solo en memoria:
 * nada se escribe en disco ni sale del equipo. Guarda, por conversación, el texto visible de los mensajes (el tuyo y el de
 * la IA; nunca el resultado de herramientas, el razonamiento ni los archivos) ya normalizado (minúsculas, sin tildes) para
 * que cada pulsación solo recorra cadenas ya preparadas, sin releer nada. Los secretos se tapan ANTES de guardar el texto
 * (`maskSecretPatterns` + bloques de llave privada), así ni se encuentran ni se muestran.
 */
import { maskSecretPatterns } from '@shared/redact-patterns'
import { visibleTextParts, type ConversationEntry } from '../../lib/conversation/entries'
import { splitAttachments } from '../tasks/impl/transcript'

export type SearchMode = 'chat' | 'code'

/** Largo máximo del texto guardado por mensaje (un texto pegado enorme no debe inflar la memoria). */
export const MAX_DOC_CHARS = 20_000
/** Tope de texto guardado por conversación. */
export const MAX_SESSION_CHARS = 400_000
/** Mínimo de caracteres de la consulta para buscar dentro de los mensajes. */
export const MIN_QUERY = 2
export const SNIPPET_MAX = 150

export interface IndexedDoc {
  messageId: string
  /** Mensaje al que se salta al abrir: en Chat el propio; en Code el mensaje del usuario del turno. */
  anchor: string
  role: 'user' | 'assistant'
  at: number
  /** Texto con espacios colapsados y secretos tapados. */
  text: string
  /** `text` en minúsculas y sin tildes (misma longitud que `text`). */
  folded: string
}

export interface IndexedSession {
  id: string
  mode: SearchMode
  directory: string
  title: string
  /** `time.updated` de la sesión cuando se leyó: si cambia, hay que releerla. */
  updated: number
  docs: IndexedDoc[]
  foldedTitle: string
}

export interface SearchHit {
  messageId: string
  anchor: string
  role: 'user' | 'assistant'
  at: number
  snippet: string
  /** Rangos [inicio, fin) a resaltar dentro de `snippet`. */
  ranges: Array<[number, number]>
}

export interface SearchGroup {
  sessionId: string
  mode: SearchMode
  directory: string
  title: string
  updated: number
  titleMatch: boolean
  hits: SearchHit[]
  /** Coincidencias totales en esa conversación (puede haber más que `hits`). */
  total: number
}

export interface SearchResult {
  groups: SearchGroup[]
  /** Coincidencias en mensajes (suma de `total`). */
  hitCount: number
}

const ASCII = /^[\x00-\x7f]*$/
const foldCache = new Map<string, string>()

/**
 * Minúsculas y sin tildes. Conserva la longitud (cada carácter da exactamente uno), así una posición en el texto
 * normalizado es la misma en el original y se puede resaltar sin tablas de equivalencia.
 */
export function fold(text: string): string {
  if (ASCII.test(text)) return text.toLowerCase()
  let out = ''
  for (const ch of text) {
    if (ch.length > 1) {
      out += '·'.repeat(ch.length) // emoji y similares: nunca coinciden con una consulta de texto
      continue
    }
    let f = foldCache.get(ch)
    if (f === undefined) {
      f = ch.normalize('NFD').charAt(0).toLowerCase().charAt(0) || ch
      if (foldCache.size < 4096) foldCache.set(ch, f)
    }
    out += f
  }
  return out
}

const PRIVATE_KEY_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g
const MEMORY_BLOCK_RE = /```lazunox-memoria[\s\S]*?(?:```|$)/g

/** Texto apto para indexar: sin bloques internos, sin secretos y con los espacios colapsados. */
export function cleanForIndex(raw: string): string {
  const text = raw
    .slice(0, MAX_DOC_CHARS * 2)
    .replace(MEMORY_BLOCK_RE, ' ')
    .replace(PRIVATE_KEY_RE, ' … ')
  // Los signos de formato (negritas, comillas de código) no aportan al buscar y ensucian el fragmento.
  return maskSecretPatterns(text.replace(/[`*]+/g, '')).replace(/\s+/g, ' ').trim().slice(0, MAX_DOC_CHARS)
}

/** Documentos buscables de una conversación. En Code las respuestas se anclan al mensaje del usuario de su turno. */
export function extractDocs(entries: ConversationEntry[], mode: SearchMode): IndexedDoc[] {
  const docs: IndexedDoc[] = []
  let budget = MAX_SESSION_CHARS
  for (const e of entries) {
    if (budget <= 0) break
    const role = e.info.role
    if (role !== 'user' && role !== 'assistant') continue
    const joined = visibleTextParts(e)
      .map((p) => p.text)
      .join('\n')
    const raw = role === 'user' ? splitAttachments(joined).text : joined
    const text = cleanForIndex(raw)
    if (!text) continue
    const parent = role === 'assistant' ? (e.info as { parentID?: string }).parentID : undefined
    docs.push({
      messageId: e.info.id,
      anchor: mode === 'code' && parent ? parent : e.info.id,
      role,
      at: e.info.time.created,
      text,
      folded: fold(text)
    })
    budget -= text.length
  }
  return docs
}

export function buildSession(meta: Omit<IndexedSession, 'docs' | 'foldedTitle'>, entries: ConversationEntry[]): IndexedSession {
  return { ...meta, docs: extractDocs(entries, meta.mode), foldedTitle: fold(meta.title) }
}

/** Palabras de la consulta, normalizadas y sin repetir. */
export function queryWords(query: string): string[] {
  return [...new Set(fold(query).split(/\s+/).filter(Boolean))]
}

/** Fragmento corto alrededor de la primera coincidencia, con los rangos a resaltar. */
function makeHit(doc: IndexedDoc, words: string[]): SearchHit {
  let first = -1
  for (const w of words) {
    const i = doc.folded.indexOf(w)
    if (i >= 0 && (first < 0 || i < first)) first = i
  }
  let start = Math.max(0, first - 40)
  if (start > 0 && doc.text.length - start <= SNIPPET_MAX) start = Math.max(0, doc.text.length - (SNIPPET_MAX - 1))
  // Empezar en una palabra entera, no a mitad de ella.
  if (start > 0) {
    const sp = doc.text.indexOf(' ', start)
    if (sp >= 0 && sp < first) start = sp + 1
  }
  const lead = start > 0 ? 1 : 0
  let end = Math.min(doc.text.length, start + SNIPPET_MAX - lead)
  const trail = end < doc.text.length ? 1 : 0
  if (trail) end -= 1
  const body = doc.text.slice(start, end)
  const foldedBody = doc.folded.slice(start, end)
  const ranges: Array<[number, number]> = []
  for (const w of words) {
    let from = 0
    for (;;) {
      const i = foldedBody.indexOf(w, from)
      if (i < 0) break
      ranges.push([i + lead, i + lead + w.length])
      from = i + w.length
    }
  }
  ranges.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([r[0], r[1]])
  }
  return {
    messageId: doc.messageId,
    anchor: doc.anchor,
    role: doc.role,
    at: doc.at,
    snippet: `${lead ? '…' : ''}${body}${trail ? '…' : ''}`,
    ranges: merged
  }
}

export interface SearchOptions {
  /** Conversaciones devueltas como máximo. */
  maxGroups?: number
  /** Coincidencias mostradas por conversación. */
  perGroup?: number
}

export class SearchIndex {
  private sessions = new Map<string, IndexedSession>()

  get size(): number {
    return this.sessions.size
  }
  get docCount(): number {
    let n = 0
    for (const s of this.sessions.values()) n += s.docs.length
    return n
  }
  has(id: string): boolean {
    return this.sessions.has(id)
  }
  /** `time.updated` con el que se indexó la conversación (undefined = no está). */
  updatedOf(id: string): number | undefined {
    return this.sessions.get(id)?.updated
  }
  ids(): string[] {
    return [...this.sessions.keys()]
  }
  upsert(s: IndexedSession): void {
    this.sessions.set(s.id, s)
  }
  /** Solo cambia el título de una conversación ya indexada (sin releer mensajes). */
  retitle(id: string, title: string): void {
    const s = this.sessions.get(id)
    if (s && s.title !== title) this.sessions.set(id, { ...s, title, foldedTitle: fold(title) })
  }
  remove(id: string): void {
    this.sessions.delete(id)
  }
  clear(): void {
    this.sessions.clear()
  }

  /**
   * Busca todas las palabras de `query` dentro de un mismo mensaje (o en el título). Recorre las conversaciones de la más
   * reciente a la más antigua y se detiene al llenar `maxGroups`.
   */
  search(query: string, opts: SearchOptions = {}): SearchResult {
    const maxGroups = opts.maxGroups ?? 20
    const perGroup = opts.perGroup ?? 3
    const words = queryWords(query)
    if (words.length === 0 || fold(query.trim()).length < MIN_QUERY) return { groups: [], hitCount: 0 }
    const ordered = [...this.sessions.values()].sort((a, b) => b.updated - a.updated)
    const groups: SearchGroup[] = []
    let hitCount = 0
    for (const s of ordered) {
      const titleMatch = words.every((w) => s.foldedTitle.includes(w))
      const hits: SearchHit[] = []
      let total = 0
      for (let i = s.docs.length - 1; i >= 0; i--) {
        const d = s.docs[i]
        if (!words.every((w) => d.folded.includes(w))) continue
        total++
        if (hits.length < perGroup) hits.push(makeHit(d, words))
      }
      if (total === 0 && !titleMatch) continue
      groups.push({
        sessionId: s.id,
        mode: s.mode,
        directory: s.directory,
        title: s.title,
        updated: s.updated,
        titleMatch,
        hits,
        total
      })
      hitCount += total
      if (groups.length >= maxGroups) break
    }
    return { groups, hitCount }
  }
}
