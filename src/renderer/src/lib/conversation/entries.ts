/**
 * Utilidades puras sobre entradas de conversación (`{info, parts}`), compartidas por Tareas y Code: sus
 * tipos (`MessageEntry`/`CodeMessage`) tienen la misma forma. Antes vivían en `tasks/impl/transcript.ts`
 * y `tasks/impl/EscalateCard.tsx`; se movieron acá para que Code las use sin importar de `tasks/impl`.
 */
import type { Message, Part } from '@opencode-ai/sdk/v2/client'

export interface ConversationEntry {
  info: Message
  parts: Part[]
}

type TextPart = Extract<Part, { type: 'text' }>

/** Partes de texto visibles (sin sintéticas ni ignoradas) de una entrada. */
export function visibleTextParts(entry: ConversationEntry): TextPart[] {
  return entry.parts.filter((p): p is TextPart => p.type === 'text' && !p.synthetic && !p.ignored)
}

/** Última entrada del asistente (undefined si no hay). */
export function lastAssistantEntry<T extends ConversationEntry>(entries: T[]): T | undefined {
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i].info.role === 'assistant') return entries[i]
  return undefined
}

/** Texto del último mensaje del asistente (une sus partes de texto). '' si no hay. */
export function lastAssistantText(entries: ConversationEntry[]): string {
  const last = lastAssistantEntry(entries)
  return last
    ? visibleTextParts(last)
        .map((p) => p.text)
        .join('\n')
        .trim()
    : ''
}
