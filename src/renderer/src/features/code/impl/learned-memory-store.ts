/**
 * Memoria aprendida en Code (decisión del dueño, 2026-10-07): primera versión, SOLO alcance global
 * (`userData/memoria/usuario.md`, el mismo almacén que Tareas). Code no tiene el concepto de carpeta
 * aprobada de Tareas, así que no hay dónde validar una memoria "de este proyecto" todavía.
 */
import { create } from 'zustand'
import { formatForPrompt } from '@shared/memory-format'
import type { LearnedMemoryProposal } from '@shared/ipc-tasks'
import { cw, hasTasksBridge } from '../../tasks/impl/bridge'

interface CodeLearnedMemoryState {
  /** Texto corto listo para el prompt (sin metadatos), o `null` si no hay nada aprobado todavía. */
  learnedUser: string | null
}

export const useCodeLearnedMemory = create<CodeLearnedMemoryState>(() => ({ learnedUser: null }))

/** Relee la memoria global aprobada (p. ej. al abrir Code, o tras aprobar una propuesta nueva). */
export async function loadCodeLearnedMemory(): Promise<void> {
  if (!hasTasksBridge()) return
  try {
    const bundle = await cw('tasks:learn:get', {})
    useCodeLearnedMemory.setState({ learnedUser: formatForPrompt(bundle.usuario) || null })
  } catch {
    useCodeLearnedMemory.setState({ learnedUser: null })
  }
}

/** Solo guarda las propuestas de alcance `usuario` (Code v1 no valida carpetas de proyecto). */
export async function acceptCodeLearnedMemory(proposals: LearnedMemoryProposal[]): Promise<void> {
  const globalOnly = proposals.filter((p) => p.alcance === 'usuario')
  if (globalOnly.length === 0) return
  await cw('tasks:learn:accept', { proposals: globalOnly })
  await loadCodeLearnedMemory()
}
