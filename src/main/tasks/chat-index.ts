/**
 * Modo unificado: índice de chats (carpeta, id de sesión, título, fecha) para listar el historial sin arrancar los servidores de
 * cada carpeta. Archivo propio `chat-index.json` en `userData`, guardado atómico (`.tmp` + `rename`, como tasks-folders.json).
 *
 * PRIVACIDAD: el título viene del contenido del chat. Se guarda en claro, como ya guarda el motor sus sesiones; no sale al
 * celular (canales de clase X). No se guarda nada más (ni mensajes, ni rutas de archivos).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ChatIndexEntry } from '@shared/ipc-tasks'

export const MAX_CHAT_INDEX = 2000
export const MAX_CHAT_TITLE = 300
const MAX_FUTURE_MS = 24 * 60 * 60 * 1000

/** Título de una línea, sin controles ni saltos, recortado. */
export function cleanChatTitle(title: string): string {
  return title
    .replace(/[\p{Cc}\u2028\u2029]+/gu, ' ')
    .trim()
    .slice(0, MAX_CHAT_TITLE)
}

export class ChatIndexStore {
  private entries: ChatIndexEntry[] | null = null

  constructor(private readonly file: () => string) {}

  private load(): ChatIndexEntry[] {
    if (this.entries) return this.entries
    let out: ChatIndexEntry[] = []
    try {
      const f = this.file()
      if (existsSync(f)) {
        const raw = JSON.parse(readFileSync(f, 'utf8')) as unknown
        const list = Array.isArray(raw) ? raw : []
        const seen = new Set<string>()
        for (const e of list) {
          const x = e as Partial<ChatIndexEntry> | null
          if (!x || typeof x.folder !== 'string' || typeof x.sessionId !== 'string' || typeof x.title !== 'string') continue
          if (typeof x.updatedAt !== 'number' || !Number.isFinite(x.updatedAt)) continue
          const k = `${x.folder}\0${x.sessionId}`
          if (seen.has(k)) continue
          seen.add(k)
          out.push({
            folder: x.folder,
            sessionId: x.sessionId,
            title: cleanChatTitle(x.title),
            updatedAt: Math.min(x.updatedAt, Date.now() + 86_400_000)
          })
        }
        out = this.trim(out)
      }
    } catch (err) {
      console.error('[tasks] chat-index.json inválido:', err instanceof Error ? err.name : 'error')
      out = []
    }
    this.entries = out
    return out
  }

  private trim(list: ChatIndexEntry[]): ChatIndexEntry[] {
    if (list.length <= MAX_CHAT_INDEX) return list
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CHAT_INDEX)
  }

  private save(): void {
    const file = this.file()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(`${file}.tmp`, JSON.stringify(this.load(), null, 2), 'utf8')
    renameSync(`${file}.tmp`, file)
  }

  /** Todas las entradas guardadas (sin filtrar), orden descendente por fecha. */
  all(): ChatIndexEntry[] {
    return [...this.load()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  upsert(e: ChatIndexEntry, now = Date.now()): void {
    const entry: ChatIndexEntry = {
      folder: e.folder,
      sessionId: e.sessionId,
      title: cleanChatTitle(e.title),
      updatedAt: Math.min(Math.max(0, e.updatedAt), now + MAX_FUTURE_MS)
    }
    const list = this.load().filter((x) => !(x.folder === entry.folder && x.sessionId === entry.sessionId))
    list.push(entry)
    this.entries = this.trim(list)
    this.save()
  }

  /** Quita una entrada (con `sessionId`) o todas las de la carpeta. true si cambió algo. */
  remove(folder: string, sessionId?: string): boolean {
    const before = this.load()
    const next = before.filter((x) => !(x.folder === folder && (sessionId === undefined || x.sessionId === sessionId)))
    if (next.length === before.length) return false
    this.entries = next
    this.save()
    return true
  }
}
