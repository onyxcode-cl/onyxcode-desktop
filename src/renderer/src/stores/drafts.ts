import { useCallback, useSyncExternalStore } from 'react'

/** Igual que el setter de `useState`: valor o función del valor actual. */
export type DraftSetter<T> = (next: T | ((cur: T) => T)) => void

/**
 * Borradores de los compositores (Chat y Code) por sesión (F8-B32). Viven FUERA de los componentes: al cambiar
 * de modo o abrir Ajustes la vista se desmonta y el texto escrito sigue aquí. Solo en memoria (no se persiste:
 * el texto sin enviar no sobrevive a cerrar la app) y solo guarda valores no vacíos, así que no crece.
 */
const drafts = new Map<string, unknown>()
const listeners = new Set<() => void>()

function isEmpty(v: unknown): boolean {
  return v === '' || v === undefined || v === null || (Array.isArray(v) && v.length === 0)
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function getDraft<T>(key: string, empty: T): T {
  return drafts.has(key) ? (drafts.get(key) as T) : empty
}

export function setDraft<T>(key: string, value: T): void {
  const had = drafts.has(key)
  if (isEmpty(value)) {
    if (!had) return
    drafts.delete(key)
  } else {
    if (had && drafts.get(key) === value) return
    drafts.set(key, value)
  }
  for (const l of [...listeners]) l()
}

/** Solo pruebas. */
export function clearDrafts(): void {
  drafts.clear()
  for (const l of [...listeners]) l()
}

/**
 * Como `useState`, pero el valor vive en el almacén de borradores bajo `key` (p. ej. `chat:<sesión>`).
 * El setter queda atado a la `key` del render que lo creó: un `restore` tardío vuelve a SU sesión.
 * `empty` debe ser una constante estable (p. ej. `''` o un array hoisted).
 */
export function useDraft<T>(key: string, empty: T): [T, DraftSetter<T>] {
  const value = useSyncExternalStore(
    subscribe,
    () => getDraft(key, empty),
    () => empty
  )
  const set = useCallback<DraftSetter<T>>(
    (next) => {
      const cur = getDraft(key, empty)
      setDraft(key, typeof next === 'function' ? (next as (c: T) => T)(cur) : next)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]
  )
  return [value, set]
}
