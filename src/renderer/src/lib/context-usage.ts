/**
 * Uso real del contexto de una sesión, para el medidor de «Contexto». Los tokens los declara el proveedor en cada mensaje del asistente
 * (entrada + caché leída + caché escrita = lo que ocupó el contexto en esa llamada) y la ventana sale del catálogo de modelos conectado:
 * nada se inventa. Mientras el modelo trabaja, el último mensaje todavía no trae tokens (se rellenan al terminar cada paso): se usa el
 * último mensaje que ya los tiene, y el límite es el del modelo que lo respondió (la persona pudo cambiar de modelo a mitad).
 */
import type { AssistantMessage, Message } from '@opencode-ai/sdk/v2/client'
import type { ModelRef } from '@shared/types'

interface CatalogModel {
  name?: string
  limit?: { context?: number }
}
export interface CatalogProvider {
  id: string
  models: Record<string, CatalogModel | undefined>
}

export type ContextUsage =
  | { kind: 'ready'; used: number; limit: number; pct: number; name: string; tone: 'ok' | 'warn' | 'danger'; model: ModelRef }
  /** Hay uso pero el catálogo no declara la ventana de ese modelo. */
  | { kind: 'unknown'; used: number }
  /** Aún no terminó ninguna respuesta del modelo. */
  | { kind: 'waiting' }

/** Ámbar desde 70 %, rojo desde 90 %. */
export function contextTone(pct: number): 'ok' | 'warn' | 'danger' {
  return pct > 90 ? 'danger' : pct > 70 ? 'warn' : 'ok'
}

export function contextUsage(
  messages: readonly { info: Message }[],
  selected: ModelRef,
  providers: readonly CatalogProvider[]
): ContextUsage {
  const assistants = messages.map((m) => m.info).filter((i): i is AssistantMessage => i.role === 'assistant')
  let last: AssistantMessage | undefined
  let used = 0
  for (let i = assistants.length - 1; i >= 0; i--) {
    const a = assistants[i]
    const u = (a.tokens?.input ?? 0) + (a.tokens?.cache?.read ?? 0) + (a.tokens?.cache?.write ?? 0)
    if (u > 0) {
      last = a
      used = u
      break
    }
  }
  if (!last) return { kind: 'waiting' }
  const model: ModelRef = { providerID: last.providerID ?? selected.providerID, modelID: last.modelID ?? selected.modelID }
  const info = providers.find((p) => p.id === model.providerID)?.models[model.modelID]
  const limit = info?.limit?.context ?? 0
  if (!info || !(limit > 0)) return { kind: 'unknown', used }
  const pct = Math.min(100, Math.round((used / limit) * 100))
  return { kind: 'ready', used, limit, pct, name: info.name ?? model.modelID, tone: contextTone(pct), model }
}
