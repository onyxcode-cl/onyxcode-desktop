/**
 * Peso de los documentos del Chat (Excel/Word/PowerPoint) para la tarjeta de documento. El archivo no existe al pintar la tarjeta;
 * el peso real solo se conoce cuando main genera el archivo (al abrir el panel, que ocurre solo al terminar el bloque, o con «Abrir»).
 * Aquí se guarda ese dato por contenido (tipo + texto), sin regenerar nada, y la tarjeta lo lee con `useSyncExternalStore`.
 * Nunca se inventa un número: sin dato, no hay peso.
 */
import type { ChatDocBlockKind } from './chatDocPreview'

const MAX_ENTRIES = 200
const sizes = new Map<string, number>()
const listeners = new Set<() => void>()

/** Hash FNV-1a de 32 bits (suficiente como clave de caché; el texto completo no se guarda). */
function hashText(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

export function chatDocSizeKey(kind: ChatDocBlockKind, rawText: string): string {
  // El bloque llega con o sin salto de línea final según de dónde se lea (Markdown vs. registro de bloques): se normaliza.
  rawText = rawText.trim()
  return `${kind}:${rawText.length}:${hashText(rawText)}`
}

/** Guarda el peso conocido (en bytes). Ignora valores no válidos y el HTML (su PDF no es lo que se descarga tal cual). */
export function recordChatDocSize(kind: ChatDocBlockKind, rawText: string, bytes: unknown): void {
  if (kind === 'html') return
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return
  const key = chatDocSizeKey(kind, rawText)
  const value = Math.round(bytes)
  if (sizes.get(key) === value) return
  sizes.delete(key)
  sizes.set(key, value)
  if (sizes.size > MAX_ENTRIES) sizes.delete(sizes.keys().next().value as string)
  listeners.forEach((cb) => cb())
}

export function getChatDocSize(kind: ChatDocBlockKind, rawText: string): number | null {
  return sizes.get(chatDocSizeKey(kind, rawText)) ?? null
}

export function subscribeChatDocSize(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Solo para pruebas. */
export function resetChatDocSizes(): void {
  sizes.clear()
  listeners.forEach((cb) => cb())
}

/** «124 KB», «1,2 MB» (es) / «1.2 MB» (en). Base 1024, un decimal solo en MB. Cadena vacía si el valor no sirve. */
export function formatFileSize(bytes: number, lang: 'es' | 'en'): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  const nf = (max: number): Intl.NumberFormat => new Intl.NumberFormat(lang, { maximumFractionDigits: max })
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${nf(0).format(Math.max(1, Math.round(bytes / 1024)))} KB`
  return `${nf(1).format(bytes / (1024 * 1024))} MB`
}
