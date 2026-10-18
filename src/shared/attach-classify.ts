/**
 * Qué adjuntos admite el Chat y con qué topes. Lógica pura compartida entre el compositor (renderer) y el puente con Telegram
 * (`main`), para que un archivo que llega por el celular pase exactamente por las mismas reglas que uno adjuntado en la pantalla.
 */
import { OFFICE_MAX_BYTES, officeFamilyOf } from './attach-office'

export const MAX_ATTACHMENTS = 5
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_PDF_BYTES = 10 * 1024 * 1024
export const MAX_TEXT_BYTES = 1024 * 1024
export const MAX_TOTAL_BYTES = 15 * 1024 * 1024

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const TEXT_EXT =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|html?|css|ya?ml|toml|ini|log|sql|sh|py|js|jsx|ts|tsx|java|c|h|cpp|go|rs|rb|php|swift|kt)$/i

export type AttachKind = 'image' | 'pdf' | 'text' | 'office'
export interface Classified {
  kind: AttachKind
  /** MIME que se envía al motor (los textos se normalizan a `text/plain`, que es lo que el motor decodifica). */
  mime: string
  max: number
}

/** Clasifica un archivo por tipo; `null` si no se admite. */
export function classifyFile(f: { name: string; type: string }): Classified | null {
  const type = f.type.toLowerCase()
  // Word/Excel/PowerPoint/OpenDocument/RTF se reconocen por la extensión (el MIME del sistema suele faltar o ser genérico).
  // Se convierten a texto en main y viajan como `text/plain`: sin depender de ningún proveedor ni modelo.
  if (officeFamilyOf(f.name)) return { kind: 'office', mime: 'text/plain', max: OFFICE_MAX_BYTES }
  if (IMAGE_MIMES.has(type)) return { kind: 'image', mime: type, max: MAX_IMAGE_BYTES }
  if (type === 'application/pdf') return { kind: 'pdf', mime: type, max: MAX_PDF_BYTES }
  const isText =
    type.startsWith('text/') ||
    type === 'application/json' ||
    type === 'application/xml' ||
    ((!type || type === 'application/octet-stream') && TEXT_EXT.test(f.name))
  if (isText) return { kind: 'text', mime: 'text/plain', max: MAX_TEXT_BYTES }
  return null
}
