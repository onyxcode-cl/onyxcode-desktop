/** Avisos anclados al turno original; el historial sintético del motor permite reconstruirlos al reabrir. */
import type { Part, Message } from '@opencode-ai/sdk/v2/client'
import type { ModelChanged } from '@shared/model-change'
import { shellBgWakeOf } from '@shared/shell-bg-wake-marker'

type Entry = { info: Message; parts: Part[] }
export type ModelChangeNotice = ModelChanged & { afterUserID?: string; eventID?: string }

const visibleUser = (e: Entry): boolean =>
  e.info.role === 'user' && e.parts.some((p) => p.type === 'file' || (p.type === 'text' && !p.synthetic && !p.ignored && !!p.text))
export function modelChangeAnchor(entries: readonly Entry[]): string {
  return [...entries].reverse().find(visibleUser)?.info.id ?? ''
}

export function modelChangeNotes(entries: readonly Entry[], events: readonly ModelChangeNotice[] = []): Map<string, ModelChanged[]> {
  const notes = new Map<string, ModelChanged[]>()
  const seen = new Set<string>()
  const add = (anchor: string, change: ModelChanged): void => {
    const key = `${anchor}:${change.nuevo.providerID}/${change.nuevo.modelID}`
    if (seen.has(key)) return
    seen.add(key)
    notes.set(anchor, [...(notes.get(anchor) ?? []), change])
  }
  let anchor = ''
  let previous: Extract<Message, { role: 'user' }> | undefined
  for (const entry of entries) {
    if (visibleUser(entry)) anchor = entry.info.id
    if (entry.info.role !== 'user') continue
    const next = entry.info
    const synthetic = entry.parts.some((p) => p.type === 'text' && p.synthetic) && !visibleUser(entry) && !shellBgWakeOf(entry.parts)
    if (
      synthetic &&
      previous?.model &&
      next.model &&
      (previous.model.providerID !== next.model.providerID || previous.model.modelID !== next.model.modelID)
    ) {
      add(anchor, { sessionID: next.sessionID, anterior: previous.model, nuevo: next.model, motivo: '' })
    }
    previous = next
  }
  for (const event of events) add(event.afterUserID ?? '', event)
  return notes
}
