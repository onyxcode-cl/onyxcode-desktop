/**
 * Exportar / copiar una conversación: convierte las entradas del motor (`{info, parts}`) al formato neutro de
 * `@shared/conversation-export` y guarda las opciones elegidas. Compartido por Chat, Code y Tareas.
 */
import type { ExportDoc, ExportOptions, ExportPart, ExportTurn } from '@shared/conversation-export'
import { DEFAULT_EXPORT_OPTIONS, EXPORT_LIMITS } from '@shared/conversation-export'
import { visibleTextParts, type ConversationEntry } from './entries'

type AnyPart = ConversationEntry['parts'][number]

const LS_KEY = 'conv.export.opts'

export function loadExportOptions(): ExportOptions {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null') as Partial<ExportOptions> | null
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_EXPORT_OPTIONS }
    return {
      reasoning: typeof raw.reasoning === 'boolean' ? raw.reasoning : DEFAULT_EXPORT_OPTIONS.reasoning,
      tools: typeof raw.tools === 'boolean' ? raw.tools : DEFAULT_EXPORT_OPTIONS.tools,
      attachments: typeof raw.attachments === 'boolean' ? raw.attachments : DEFAULT_EXPORT_OPTIONS.attachments
    }
  } catch {
    return { ...DEFAULT_EXPORT_OPTIONS }
  }
}

export function saveExportOptions(opts: ExportOptions): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(opts))
  } catch {
    // sin almacenamiento: las opciones valen solo para esta sesión
  }
}

/** Resumen de una línea de una herramienta: su descripción, comando, archivo o consulta (nunca su salida). */
export function toolDetail(input: unknown): string {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  for (const k of ['description', 'command', 'filePath', 'path', 'url', 'query', 'pattern']) {
    const v = o[k]
    if (typeof v === 'string' && v.trim()) return v.replace(/\s+/g, ' ').trim().slice(0, EXPORT_LIMITS.detail)
  }
  return ''
}

function baseName(p: string): string {
  const clean = p.split(/[?#]/)[0]
  return clean.split(/[\\/]/).filter(Boolean).pop() ?? ''
}

export interface ExportMeta {
  title: string
  createdAt: number
  /** Separa el bloque de adjuntos que Tareas añade al texto del usuario. */
  splitAttachments?: (raw: string) => { text: string; files: string[] }
}

export function entriesToExportDoc(entries: ConversationEntry[], meta: ExportMeta): ExportDoc {
  const turns: ExportTurn[] = []
  let model = ''
  for (const e of entries) {
    const role = e.info.role === 'user' ? 'user' : 'assistant'
    const parts: ExportPart[] = []
    const files: string[] = []
    if (role === 'user') {
      let text = visibleTextParts(e)
        .map((p) => p.text)
        .join('\n')
      if (meta.splitAttachments) {
        const s = meta.splitAttachments(text)
        text = s.text
        files.push(...s.files.map(baseName))
      }
      if (text.trim()) parts.push({ kind: 'text', text: text.slice(0, EXPORT_LIMITS.text) })
      for (const p of e.parts as AnyPart[]) {
        if (p.type === 'file') {
          const name = (p as { filename?: string; url?: string }).filename || baseName((p as { url?: string }).url ?? '')
          if (name && !name.startsWith('data:')) files.push(name)
        }
      }
    } else {
      const info = e.info as { modelID?: string }
      if (info.modelID) model = info.modelID
      for (const p of e.parts as AnyPart[]) {
        if (p.type === 'text') {
          if (!p.synthetic && !p.ignored && p.text.trim()) parts.push({ kind: 'text', text: p.text.slice(0, EXPORT_LIMITS.text) })
        } else if (p.type === 'reasoning') {
          if (p.text.trim()) parts.push({ kind: 'reasoning', text: p.text.slice(0, EXPORT_LIMITS.text) })
        } else if (p.type === 'tool') {
          parts.push({ kind: 'tool', tool: String(p.tool).slice(0, 100), detail: toolDetail((p.state as { input?: unknown }).input) })
        }
      }
    }
    if (parts.length === 0 && files.length === 0) continue
    turns.push({
      role,
      at: e.info.time.created,
      parts: parts.slice(0, EXPORT_LIMITS.parts),
      files: files.slice(0, EXPORT_LIMITS.files).map((f) => f.slice(0, EXPORT_LIMITS.name))
    })
  }
  return {
    title: meta.title.slice(0, 500),
    createdAt: meta.createdAt,
    model: model.slice(0, 200),
    turns: turns.slice(-EXPORT_LIMITS.turns)
  }
}
