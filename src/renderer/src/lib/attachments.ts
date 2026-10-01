/**
 * Adjuntos del compositor de Chat (R2-B). Viajan SOLO como partes `file` con una URL `data:` dentro del mensaje:
 * el agente `chat` tiene `"*": deny` y no recibe ninguna herramienta nueva. Nunca se envía `file://` (el motor lo
 * lee del disco por su cuenta, sin pasar por los permisos del agente: verificado con opencode 1.18.33).
 */
import { t } from '@shared/i18n'

export interface ChatAttachment {
  id: string
  name: string
  mime: string
  /** Siempre `data:`. */
  url: string
}

export const MAX_ATTACHMENTS = 5
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_PDF_BYTES = 10 * 1024 * 1024
export const MAX_TEXT_BYTES = 1024 * 1024
export const MAX_TOTAL_BYTES = 15 * 1024 * 1024

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|html?|css|ya?ml|toml|ini|log|sql|sh|py|js|jsx|ts|tsx|java|c|h|cpp|go|rs|rb|php|swift|kt)$/i

export type AttachKind = 'image' | 'pdf' | 'text'
export interface Classified {
  kind: AttachKind
  /** MIME que se envía al motor (los textos se normalizan a `text/plain`, que es lo que el motor decodifica). */
  mime: string
  max: number
}

/** Clasifica un archivo por tipo; `null` si no se admite. */
export function classifyFile(f: { name: string; type: string }): Classified | null {
  const type = f.type.toLowerCase()
  if (IMAGE_MIMES.has(type)) return { kind: 'image', mime: type, max: MAX_IMAGE_BYTES }
  if (type === 'application/pdf') return { kind: 'pdf', mime: type, max: MAX_PDF_BYTES }
  const isText = type.startsWith('text/') || type === 'application/json' || type === 'application/xml' || ((!type || type === 'application/octet-stream') && TEXT_EXT.test(f.name))
  if (isText) return { kind: 'text', mime: 'text/plain', max: MAX_TEXT_BYTES }
  return null
}

function mb(n: number): string {
  return String(Math.round(n / 1024 / 1024))
}

/** Valida el lote contra los límites; devuelve los aceptados y un mensaje (ya traducido) por cada rechazo. */
export function validateFiles(
  files: { name: string; type: string; size: number }[],
  existing: { count: number; bytes: number }
): { accepted: number[]; errors: string[] } {
  const accepted: number[] = []
  const errors: string[] = []
  let count = existing.count
  let bytes = existing.bytes
  files.forEach((f, i) => {
    const name = f.name || t('chat.attach.defaultName')
    const c = classifyFile(f)
    if (!c) return void errors.push(t('chat.attach.errType', { name }))
    if (f.size > c.max) return void errors.push(t('chat.attach.errSize', { name, mb: mb(c.max) }))
    if (count >= MAX_ATTACHMENTS) return void errors.push(t('chat.attach.errCount', { max: MAX_ATTACHMENTS }))
    if (bytes + f.size > MAX_TOTAL_BYTES) return void errors.push(t('chat.attach.errTotal', { mb: mb(MAX_TOTAL_BYTES) }))
    count += 1
    bytes += f.size
    accepted.push(i)
  })
  return { accepted, errors }
}

/** Tamaño aproximado (bytes) de un adjunto ya leído, a partir de su URL `data:` base64. */
export function attachmentBytes(a: { url: string }): number {
  const i = a.url.indexOf(',')
  return i < 0 ? 0 : Math.floor(((a.url.length - i - 1) * 3) / 4)
}

function readAsDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error ?? new Error(t('chat.attach.readFailed')))
    r.readAsDataURL(file)
  })
}

let seq = 0
export async function toChatAttachment(file: File): Promise<ChatAttachment> {
  const c = classifyFile(file)
  if (!c) throw new Error(t('chat.attach.errType', { name: file.name }))
  let url = await readAsDataURL(file)
  // El navegador pone `data:;base64,` (o un tipo vacío) en archivos sin tipo: se fija el MIME normalizado.
  url = url.replace(/^data:[^,]*,/, `data:${c.mime};base64,`)
  seq += 1
  return { id: `catt${Date.now()}${seq}`, name: file.name || t('chat.attach.defaultName'), mime: c.mime, url }
}

/** Solo URLs `data:` pueden salir hacia el motor desde Chat. */
export function isSafeAttachmentUrl(url: string): boolean {
  return /^data:/i.test(url)
}
