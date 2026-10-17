/**
 * Prompt de sistema extra de Code (módulo PURO: sin imports de Electron ni de Node). Lleva las instrucciones
 * personalizadas de la persona, la memoria aprendida ya aprobada (de usuario y del proyecto) y la invitación a
 * proponer más. El marco de seguridad vive en `personal-context.ts`.
 */
import { buildPersonalContext, memoryProposalInvite } from './personal-context'

export interface CodePromptInput {
  /** «Memoria» (Ajustes), compartida con Tareas. `false` apaga la memoria para TODO Code (las instrucciones siguen). */
  learningEnabled?: boolean
  /** Instrucciones personalizadas globales (Ajustes > Instrucciones). */
  instructions?: string | null
  /** Memoria aprendida GLOBAL ya aprobada (texto corto, sin metadatos: `formatForPrompt(...)`). */
  learnedUser?: string | null
  /** Memoria aprendida del PROYECTO abierto, ya aprobada. */
  learnedProject?: string | null
  /** Nombre de la carpeta del proyecto (solo rotula el bloque). */
  projectName?: string | null
}

/** Siempre devuelve texto (al menos el aviso de memoria encendida/apagada). */
export function buildCodeSystemPrompt(i: CodePromptInput): string {
  const on = i.learningEnabled !== false
  const ctx = buildPersonalContext({
    instructions: i.instructions,
    memoryUser: on ? i.learnedUser : null,
    memoryProject: on ? i.learnedProject : null,
    projectName: i.projectName
  })
  const parts: string[] = []
  if (ctx) parts.push(ctx)
  parts.push(
    on
      ? memoryProposalInvite(true)
      : 'El aprendizaje automático está desactivado: no propongas memoria nueva (no termines el turno con un bloque lazunox-memoria).'
  )
  return parts.join('\n\n---\n\n')
}
