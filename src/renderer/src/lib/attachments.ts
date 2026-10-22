/**
 * Adjuntos del compositor de Chat (R2-B). Viajan SOLO como partes `file` con una URL `data:` dentro del mensaje:
 * el agente `chat` tiene `"*": deny` y no recibe ninguna herramienta nueva. Nunca se envía `file://` (el motor lo
 * lee del disco por su cuenta, sin pasar por los permisos del agente: verificado con opencode 1.18.33).
 */
import { t } from '@shared/i18n'
import {
  OFFICE_MAX_BYTES,
  type OfficeExtractResult,
  type OfficeFailReason,
  type OfficeFamily,
  type OfficeUnit
} from '@shared/attach-office'
import { call } from './api'

/** Lo que muestra la tarjeta de un documento de oficina adjunto (el contenido ya viaja como texto en `url`). */
export interface OfficeAttachmentInfo {
  family: OfficeFamily
  unit: OfficeUnit
  /** Páginas / hojas / diapositivas, si el formato lo dice. */
  units: number | null
  /** El contenido se recortó (el aviso va dentro del texto para la IA). */
  truncated: boolean
  /** Avisos de recorte para la persona. */
  notes: string[]
}

export interface ChatAttachment {
  id: string
  name: string
  mime: string
  /** Siempre `data:`. */
  url: string
  /** Solo en documentos de oficina convertidos a texto. */
  office?: OfficeAttachmentInfo
  /** Solo un Word (.docx): sus bytes originales en base64, para ofrecer «traducir sin cambiar el diseño». Nunca se envía al modelo. */
  originalDocx?: string
}

export {
  MAX_ATTACHMENTS,
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  MAX_TEXT_BYTES,
  MAX_TOTAL_BYTES,
  classifyFile,
  type AttachKind,
  type Classified
} from '@shared/attach-classify'
import { MAX_ATTACHMENTS, MAX_TOTAL_BYTES, classifyFile } from '@shared/attach-classify'

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

/** Mensaje (ya traducido) de por qué un documento de oficina no se pudo leer. */
export function officeFailMessage(reason: OfficeFailReason, name: string): string {
  return t(`chat.attach.office.err.${reason}`, { name, mb: Math.round(OFFICE_MAX_BYTES / 1024 / 1024) })
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** Texto UTF-8 → URL `data:text/plain` (lo que el motor decodifica en los adjuntos de texto). */
export function textToDataUrl(text: string): string {
  return `data:text/plain;base64,${bytesToBase64(new TextEncoder().encode(text))}`
}

async function officeToChatAttachment(file: File): Promise<ChatAttachment> {
  const name = file.name || t('chat.attach.defaultName')
  const base64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()))
  let res: OfficeExtractResult
  try {
    res = await call('attach:extractOffice', { name, base64 })
  } catch {
    throw new Error(officeFailMessage('unreadable', name))
  }
  if (!res.ok) throw new Error(officeFailMessage(res.reason, name))
  seq += 1
  return {
    id: `catt${Date.now()}${seq}`,
    name,
    mime: 'text/plain',
    url: textToDataUrl(res.text),
    office: { family: res.family, unit: res.unit, units: res.units, truncated: res.truncated, notes: res.notes },
    ...(/\.docx$/i.test(name) ? { originalDocx: base64 } : {})
  }
}

export async function toChatAttachment(file: File): Promise<ChatAttachment> {
  const c = classifyFile(file)
  if (!c) throw new Error(t('chat.attach.errType', { name: file.name }))
  if (c.kind === 'office') return officeToChatAttachment(file)
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

/** Segunda línea de la tarjeta de un documento de oficina: «hoja de cálculo · 3 hojas» (+ «· recortado»). */
export function officeCardLabel(o: OfficeAttachmentInfo): string {
  const kind = t(`attach.office.kind.${o.family}`)
  const parts = [kind]
  if (o.units) parts.push(t(`attach.office.units.${o.unit}.${o.units === 1 ? 'one' : 'other'}`, { n: o.units }))
  if (o.truncated) parts.push(t('chat.attach.office.cardTrunc'))
  return parts.join(' · ')
}
