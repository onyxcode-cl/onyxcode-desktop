/**
 * Instrucciones «solo para esta conversación» de Chat. Se guardan por sesión en este computador (localStorage del
 * renderer; no se envía nada fuera) y `sendChatMessage` las pone en el `system` de ESA conversación (marco de datos de
 * `personal-context.ts`: son preferencias, no cambian reglas ni permisos).
 */
import { useSyncExternalStore } from 'react'
import { MAX_CONVERSATION_INSTRUCTIONS } from '@shared/personal-context'

const KEY = 'chat.conversationInstructions.v1'
/** Cuántas conversaciones recuerdan instrucciones como máximo (las más antiguas se sueltan). */
export const MAX_CONVERSATIONS_WITH_INSTRUCTIONS = 200

type Store = Record<string, string>

let cache: Store | null = null
const listeners = new Set<() => void>()

function read(): Store {
  if (cache) return cache
  const out: Store = {}
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) if (typeof v === 'string' && v.trim()) out[id] = v
    }
  } catch {
    // sin storage o contenido dañado: empieza vacío
  }
  cache = out
  return out
}

function write(next: Store): void {
  cache = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // sin storage: vale mientras la app siga abierta
  }
  for (const l of listeners) l()
}

/** Instrucciones de la conversación (`''` si no hay). */
export function getConversationInstructions(sessionID: string | null | undefined): string {
  return sessionID ? (read()[sessionID] ?? '') : ''
}

/** Guarda (o borra, con texto vacío) las instrucciones de una conversación; recorta al tope. */
export function setConversationInstructions(sessionID: string, text: string): void {
  const clean = text.slice(0, MAX_CONVERSATION_INSTRUCTIONS)
  const cur = read()
  const next: Store = { ...cur }
  delete next[sessionID] // reinserta al final: la más reciente se conserva al recortar
  if (clean.trim()) next[sessionID] = clean
  else if (!(sessionID in cur)) return
  const ids = Object.keys(next)
  for (const id of ids.slice(0, Math.max(0, ids.length - MAX_CONVERSATIONS_WITH_INSTRUCTIONS))) delete next[id]
  write(next)
}

/** Olvida las de una conversación borrada. */
export function clearConversationInstructions(sessionID: string): void {
  setConversationInstructions(sessionID, '')
}

/** Solo para pruebas: olvida la caché en memoria. */
export function resetConversationInstructionsCache(): void {
  cache = null
  for (const l of listeners) l()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useConversationInstructions(sessionID: string | null | undefined): string {
  return useSyncExternalStore(
    subscribe,
    () => getConversationInstructions(sessionID),
    () => ''
  )
}
