import type { Todo } from '@opencode-ai/sdk/v2/client'

/**
 * Lista de tareas (`todowrite`) a partir de un valor arbitrario: descarta lo que no sea un objeto
 * con `content` de tipo string. `null` si no es un arreglo (quien la quiera vacía usa `?? []`).
 */
export function parseTodos(v: unknown): Todo[] | null {
  if (!Array.isArray(v)) return null
  return v.filter((t): t is Todo => !!t && typeof t === 'object' && typeof (t as Todo).content === 'string')
}
