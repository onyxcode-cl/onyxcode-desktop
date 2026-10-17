/**
 * Memoria aprendida en Code: lo aprobado de alcance usuario (compartido con Chat y Overdrive, `userData/memoria/usuario.md`)
 * y del proyecto abierto (`userData/memoria/proyectos/…`, una por carpeta). Se relee justo antes de cada envío.
 */
import { create } from 'zustand'
import type { LearnedMemoryProposal } from '@shared/ipc-tasks'
import { loadPromptMemory, saveApprovedMemory } from '../../memory/memory-client'

interface CodeLearnedMemoryState {
  /** Texto corto listo para el prompt (sin metadatos), o `null` si no hay nada aprobado todavía. */
  learnedUser: string | null
  /** Lo mismo, del proyecto cuya memoria se leyó por última vez. */
  learnedProject: string | null
}

export const useCodeLearnedMemory = create<CodeLearnedMemoryState>(() => ({ learnedUser: null, learnedProject: null }))

/** Relee la memoria aprobada (de usuario y, con `folder`, del proyecto). */
export async function loadCodeLearnedMemory(folder?: string | null): Promise<void> {
  const m = await loadPromptMemory(folder)
  if (!m) return
  useCodeLearnedMemory.setState({ learnedUser: m.usuario, learnedProject: m.proyecto })
}

/** Guarda las propuestas aprobadas; las de «proyecto» solo si se da la carpeta. */
export async function acceptCodeLearnedMemory(proposals: LearnedMemoryProposal[], folder?: string | null): Promise<void> {
  const saved = await saveApprovedMemory(proposals, folder)
  if (saved) await loadCodeLearnedMemory(folder)
}
