/**
 * Cliente de la memoria de Chat y Code (canales `tasks:mem:*`). Un solo punto para leer lo aprobado, guardarlo y
 * armar el texto que va al `system`. Nunca lanza al leer para el prompt: sin memoria el mensaje sale igual.
 */
import { formatForPrompt } from '@shared/memory-format'
import type { LearnedMemoryBundle, LearnedMemoryProposal } from '@shared/ipc-tasks'
import { cw, hasTasksBridge } from '../tasks/impl/bridge'

export interface PromptMemory {
  /** Memoria de usuario lista para el prompt (o `null` si no hay). */
  usuario: string | null
  /** Memoria del proyecto lista para el prompt (o `null`). */
  proyecto: string | null
}

/** Lee la memoria aprobada y la deja en formato de prompt. Un fallo = sin memoria; sin puente con el proceso principal = `null` (no se sabe). */
export async function loadPromptMemory(folder?: string | null): Promise<PromptMemory | null> {
  if (!hasTasksBridge()) return null
  try {
    const b = await cw('tasks:mem:get', folder ? { folder } : {})
    return { usuario: formatForPrompt(b.usuario) || null, proyecto: formatForPrompt(b.proyecto) || null }
  } catch {
    return { usuario: null, proyecto: null }
  }
}

/** Guarda lo que la persona aprobó. Sin carpeta, las propuestas de alcance «proyecto» se descartan antes de salir. */
export async function saveApprovedMemory(proposals: LearnedMemoryProposal[], folder?: string | null): Promise<LearnedMemoryBundle | null> {
  const usable = folder ? proposals : proposals.filter((p) => p.alcance === 'usuario')
  if (usable.length === 0) return null
  return cw('tasks:mem:accept', folder ? { folder, proposals: usable } : { proposals: usable })
}
