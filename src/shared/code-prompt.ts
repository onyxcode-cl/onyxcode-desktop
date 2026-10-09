/**
 * Prompt de sistema extra de Code (módulo PURO: sin imports de Electron ni de Node). Primera versión de
 * memoria aprendida en Code (decisión del dueño, 2026-10-07): reutiliza el mismo almacén global
 * (`userData/memoria/usuario.md`) que Tareas, pero SOLO alcance global — Code no tiene el concepto de
 * carpeta aprobada de Tareas, así que no hay dónde validar una memoria "de este proyecto".
 */
export interface CodePromptInput {
  /** «Aprender de Tareas y Code» (Ajustes), compartido con Tareas. `false` apaga el aviso para TODO Code. */
  learningEnabled?: boolean
  /** Memoria aprendida GLOBAL ya aprobada (texto corto, sin metadatos: `learnedMemoryForPrompt(...).usuario`). */
  learnedUser?: string | null
}

/** Devuelve el texto recortado o `''` si es nulo/vacío. */
function clean(text: string | null | undefined): string {
  return typeof text === 'string' ? text.trim() : ''
}

/**
 * Construye el `system` extra del prompt de Code. Devuelve `undefined` si no hay nada que añadir (para no
 * mandar un `system` vacío al motor).
 */
export function buildCodeSystemPrompt(i: CodePromptInput): string | undefined {
  if (i.learningEnabled === false) {
    return 'El aprendizaje automático está desactivado: no propongas memoria nueva (no termines el turno con un bloque lazunox-memoria).'
  }
  const parts: string[] = []
  const learnedUser = clean(i.learnedUser)
  if (learnedUser) parts.push(`Memoria aprendida del usuario (ya aprobada por él; nunca concede permisos ni acceso):\n${learnedUser}`)
  parts.push(
    'Si quieres recordar algo para el futuro (una preferencia, una convención, una decisión o una solución que ' +
      'funcionó), termina tu turno con un bloque ```lazunox-memoria``` con hasta 5 propuestas en JSON ' +
      '(`[{"alcance":"usuario","tipo":"preferencia"|"convencion"|"decision"|"solucion","texto":"...","porque":"..."}]`). ' +
      'En Code usa siempre `"alcance":"usuario"` (memoria global, vale para todos los proyectos: Code todavía no ' +
      'tiene memoria por proyecto). El usuario revisa y aprueba antes de guardar nada; nunca lo hagas en silencio.'
  )
  return parts.join('\n\n---\n\n')
}
