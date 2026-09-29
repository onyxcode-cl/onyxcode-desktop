/**
 * Prompt de sistema extra de Cowork (módulo PURO: sin imports de Electron ni de Node; lo usan
 * tanto main —rutinas— como el renderer —tareas interactivas—).
 *
 * Combina, en este orden y separadas por `\n\n---\n\n`: instrucciones generales, instrucciones del
 * proyecto, enlaces de referencia, memoria (o el aviso de que está desactivada), carpetas
 * adicionales de la tarea y, si la ejecución es desatendida, el aviso de rutina programada.
 */
import type { FolderAccessMode } from './ipc-cowork'

/** Máximo de caracteres de las instrucciones (globales y de proyecto). */
export const COWORK_INSTRUCTIONS_MAX = 20_000

/** Separador entre secciones del prompt. */
const SECTION_SEPARATOR = '\n\n---\n\n'

/** Texto de las ejecuciones programadas (idéntico al que usaba el scheduler). */
const UNATTENDED_TEXT =
  'Esta es una ejecución PROGRAMADA y desatendida: nadie puede responder preguntas ni aprobar permisos. ' +
  'Completa la tarea con supuestos razonables y termina con un resumen breve del resultado.'

export interface CoworkPromptInput {
  /** Instrucciones generales de Cowork (Ajustes), válidas para todas las tareas. */
  globalInstructions?: string | null
  /** Proyecto de la carpeta. `memoryEnabled === false` desactiva la memoria. */
  project?: { name: string; instructions?: string; links?: string[]; memoryEnabled?: boolean } | null
  /** Contenido de `.onyxcode/memoria.md` (se ignora si la memoria está desactivada). */
  memory?: string | null
  /** Carpetas adicionales de la tarea (vinculadas o de confianza). */
  folders?: Array<{ path: string; mode: FolderAccessMode; trusted?: boolean }>
  /** Ejecución programada sin nadie delante (rutinas). */
  unattended?: boolean
}

/** Devuelve el texto recortado o `''` si es nulo/vacío. */
function clean(text: string | null | undefined): string {
  return typeof text === 'string' ? text.trim() : ''
}

/**
 * Construye el `system` extra del prompt de una tarea de Cowork.
 * Devuelve `undefined` si no hay nada que añadir.
 */
export function buildCoworkSystemPrompt(i: CoworkPromptInput): string | undefined {
  const parts: string[] = []

  const globalInstructions = clean(i.globalInstructions)
  if (globalInstructions) parts.push(`Instrucciones generales de Cowork (todas las tareas):\n${globalInstructions}`)

  const project = i.project
  const projectInstructions = clean(project?.instructions)
  if (project && projectInstructions) parts.push(`Instrucciones del proyecto "${project.name}":\n${projectInstructions}`)

  const links = (project?.links ?? []).map((l) => l.trim()).filter(Boolean)
  if (links.length > 0) {
    parts.push(`Enlaces de referencia del proyecto (consúltalos con webfetch si hace falta):\n${links.map((l) => `- ${l}`).join('\n')}`)
  }

  if (project?.memoryEnabled === false) {
    parts.push('La memoria del proyecto está desactivada: no leas ni escribas .onyxcode/memoria.md.')
  } else {
    const memory = clean(i.memory)
    if (memory) parts.push(`Memoria guardada de este proyecto (.onyxcode/memoria.md):\n${memory}`)
  }

  const folders = i.folders ?? []
  if (folders.length > 0) {
    const list = folders
      .map((f) => `- ${f.path} (${f.mode === 'ro' ? 'solo lectura: no intentes modificarla' : 'lectura y escritura'})`)
      .join('\n')
    parts.push(`Carpetas adicionales de esta tarea:\n${list}`)
  }

  if (i.unattended) parts.push(UNATTENDED_TEXT)

  return parts.length > 0 ? parts.join(SECTION_SEPARATOR) : undefined
}
