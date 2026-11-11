/**
 * Carpetas con una ejecución de rutina en curso (nadie mirando). Lo marca el programador de rutinas (`scheduler/service.ts`) durante la
 * ejecución; lo consultan las puertas de main que necesitan a la persona (`equipo` y los conectores con «preguntar cada herramienta").
 *
 * Por qué por CARPETA y no por conversación: la llamada MCP no dice de qué sesión viene (cualquier id lo pondría quien llama) y la rutina
 * usa el mismo servidor de la carpeta que las tareas a mano. Mientras corre una rutina en esa carpeta, esas peticiones se niegan al
 * momento (sin esperar 5 min ni sacar un diálogo) y quedan anotadas en el resultado de la rutina. Una tarea a mano en la MISMA carpeta y
 * al mismo tiempo también recibe el rechazo: es el lado seguro.
 */
import { resolve } from 'node:path'

/** Anota en la ejecución de la rutina lo que se negó. */
export type UnattendedNote = (what: { permission: string; detail: string }) => void

const active = new Map<string, Set<UnattendedNote>>()
const keyOf = (folder: string): string => resolve(folder).replace(/[\\/]+$/, '') || folder

/** Marca la carpeta como desatendida mientras dure la ejecución. Devuelve la función que la desmarca. */
export function markUnattended(folder: string, note: UnattendedNote): () => void {
  const k = keyOf(folder)
  let set = active.get(k)
  if (!set) active.set(k, (set = new Set()))
  set.add(note)
  return () => {
    const s = active.get(k)
    if (!s) return
    s.delete(note)
    if (!s.size) active.delete(k)
  }
}

/** Si hay una rutina corriendo en esa carpeta: la función que lo anota en todas ellas; si no, null. */
export function unattendedFor(folder: string): UnattendedNote | null {
  const set = active.get(keyOf(folder))
  if (!set?.size) return null
  return (what) => {
    for (const n of set) {
      try {
        n(what)
      } catch {
        /* anotar nunca rompe */
      }
    }
  }
}

/** Texto para el agente. */
export const UNATTENDED_TEXT =
  'Esto necesita que la persona esté presente para aprobarlo, y esta ejecución es una rutina sin nadie mirando: no se hizo. No lo ' +
  'reintentes; termina sin ello y deja anotado en tu resumen qué hacía falta para que la persona lo haga después.'
