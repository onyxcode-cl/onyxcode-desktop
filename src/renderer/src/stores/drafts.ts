import { useCallback, useSyncExternalStore } from 'react'

/** Igual que el setter de `useState`: valor o función del valor actual. */
export type DraftSetter<T> = (next: T | ((cur: T) => T)) => void

/**
 * Borradores de los compositores (Chat y Code) por sesión (F8-B32). Viven FUERA de los componentes: al cambiar
 * de modo o abrir Ajustes la vista se desmonta y el texto escrito sigue aquí. Solo en memoria (no se persiste:
 * el texto sin enviar no sobrevive a cerrar la app) y solo guarda valores no vacíos, así que no crece.
 */
const drafts = new Map<string, unknown>()

/**
 * Tope de memoria de los adjuntos (data: URL) guardados en borradores (R3-A). Un borrador con adjuntos no puede
 * superar `DRAFT_ATTACH_MAX_BYTES` y, entre todos, `DRAFT_ATTACH_TOTAL_BYTES`: al pasarse, se descartan primero los
 * borradores con adjuntos más antiguos de OTRAS conversaciones (el actual nunca se descarta por el de otros).
 */
export const DRAFT_ATTACH_MAX_BYTES = 20 * 1024 * 1024
export const DRAFT_ATTACH_TOTAL_BYTES = 60 * 1024 * 1024

/** Bytes aproximados (caracteres de la URL) de una lista de adjuntos; 0 si el valor no lo es. */
function attachBytes(v: unknown): number {
  if (!Array.isArray(v)) return 0
  let n = 0
  for (const a of v) {
    const url = a && typeof a === 'object' ? (a as { url?: unknown }).url : null
    if (typeof url === 'string') n += url.length
  }
  return n
}
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
    const bytes = attachBytes(value)
    if (bytes > DRAFT_ATTACH_MAX_BYTES) return // demasiado grande para guardarlo: se conserva el valor anterior
    if (bytes > 0) {
      // Reinserta para que el borrador tocado sea el más reciente y libera lo más antiguo si se pasa del total.
      drafts.delete(key)
      drafts.set(key, value)
      let total = 0
      for (const v of drafts.values()) total += attachBytes(v)
      for (const [k, v] of [...drafts]) {
        if (total <= DRAFT_ATTACH_TOTAL_BYTES) break
        if (k === key) continue
        const b = attachBytes(v)
        if (b > 0) {
          drafts.delete(k)
          total -= b
        }
      }
    } else drafts.set(key, value)
  }
  for (const l of [...listeners]) l()
}

/** Bytes de adjuntos que guardan los borradores ahora mismo (pruebas y diagnóstico). */
export function draftAttachmentBytes(): number {
  let n = 0
  for (const v of drafts.values()) n += attachBytes(v)
  return n
}

/** Libera todos los borradores de una conversación (al borrarla o cerrarla): texto, menciones y adjuntos. */
export function clearSessionDrafts(sessionID: string): void {
  if (!sessionID) return
  let changed = false
  for (const k of [...drafts.keys()]) {
    if (k.endsWith(`:${sessionID}`) || k.includes(`:${sessionID}:`)) {
      drafts.delete(k)
      changed = true
    }
  }
  if (changed) for (const l of [...listeners]) l()
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
