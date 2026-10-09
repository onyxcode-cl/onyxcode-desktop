/**
 * Qué mostrar en el HUD de progreso de Chat: las únicas dos señales reales que tiene el modo Chat
 * (sin herramientas, sin archivos/terminal) de "qué está haciendo el agente ahora" — generando un
 * documento, o razonando/escribiendo la respuesta. `chatDocPreview.ts` ya trae la del documento
 * (con su propia hora de inicio); para la otra se usa `turnTiming` (mismo patrón que el cronómetro
 * de Tareas, `TasksWorkspace.tsx`'s `Elapsed`).
 */
import { useSyncExternalStore } from 'react'
import { t } from '@shared/i18n'
import { getCreatingDoc, subscribeCreatingDoc } from '../../lib/chatDocPreview'
import { turnTiming } from '../../lib/turn-timing'
import type { MessageEntry } from '../../stores/sessions'

function noCreatingDoc(): null {
  return null
}

export interface ChatProgress {
  visible: boolean
  label: string
  startedAt: number | null
}

/** Hora de inicio de la parte `reasoning` en vivo del último mensaje del agente, si hay una. */
export function liveReasoningStart(entries: MessageEntry[]): number | null {
  const last = entries[entries.length - 1]
  if (!last || last.info.role !== 'assistant') return null
  for (const part of last.parts) {
    if (part.type === 'reasoning' && !part.time.end) return part.time.start
  }
  return null
}

export function useChatProgress(entries: MessageEntry[], busy: boolean): ChatProgress {
  const creatingDoc = useSyncExternalStore(subscribeCreatingDoc, getCreatingDoc, noCreatingDoc)
  if (creatingDoc) return { visible: true, label: creatingDoc.title, startedAt: creatingDoc.startedAt }
  if (!busy) return { visible: false, label: '', startedAt: null }
  const reasoningStart = liveReasoningStart(entries)
  if (reasoningStart !== null) return { visible: true, label: t('chat.reasoning.live'), startedAt: reasoningStart }
  return { visible: true, label: t('chat.msg.thinking'), startedAt: turnTiming(entries).start }
}
