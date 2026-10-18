/**
 * Archivos del puente con Telegram (entrega 2). Dos sentidos, las mismas reglas que el Chat:
 *
 *  - SALIDA (`checkOutgoingFile`): un archivo que la IA creó se manda SOLO si `resolveChatFile` lo acepta (ruta real dentro de las carpetas
 *    de ESA sesión —nunca otra—, archivo regular, sin nombre de secreto, ni ejecutable ni lanzador), no está dentro de carpetas de
 *    credenciales (`.git`, `.ssh`, `.aws`…) y pesa ≤ 50 MB. Se revalida al pulsar el botón, no solo al ofrecerlo.
 *  - ENTRADA (`prepareIncoming`): un archivo o foto del dueño se clasifica con `classifyFile` (la misma función del compositor de la
 *    pantalla), pasa por los topes de tamaño, se comprueban los bytes iniciales contra el tipo declarado y nunca se aceptan
 *    ejecutables ni nombres de secretos. Word/Excel/PowerPoint pasan por la extracción a texto existente (`extractOffice`); imágenes y
 *    PDF viajan como `data:` igual que un adjunto normal; el texto se comprueba como UTF-8 sin bytes nulos.
 */
import { closeSync, openSync, readSync, readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { classifyFile } from '@shared/attach-classify'
import { OFFICE_MAX_BYTES, officeFamilyOf } from '@shared/attach-office'
import { TELEGRAM_LIMITS } from '@shared/telegram'
import { ChatFileError, isSensitiveName, resolveChatFile } from '../files/chat-files'
import { extractOffice } from '../files/office-extract'
import { BLOCKED_OPEN_EXTENSIONS } from '../tasks/open-policy'

export type OutgoingRefusal = 'invalid' | 'outside' | 'secret' | 'blocked' | 'too-big' | 'missing' | 'hidden-dir'

/** Carpetas que guardan credenciales o el historial interno: nunca se manda nada de dentro. */
const HIDDEN_DIRS = new Set(['.git', '.ssh', '.aws', '.gnupg', '.kube', '.docker', '.config', '.opencode', '.claude', 'node_modules'])

export type OutgoingCheck = { ok: true; real: string; name: string; bytes: number; ext: string } | { ok: false; reason: OutgoingRefusal }

export function checkOutgoingFile(
  roots: readonly string[],
  path: string,
  maxBytes: number = TELEGRAM_LIMITS.maxSendFileBytes
): OutgoingCheck {
  let info
  try {
    info = resolveChatFile(roots, path)
  } catch (err) {
    const msg = err instanceof ChatFileError ? err.message : ''
    if (msg.includes('fuera')) return { ok: false, reason: 'outside' }
    if (msg.includes('reservado')) return { ok: false, reason: 'secret' }
    if (msg.includes('existe')) return { ok: false, reason: 'missing' }
    return { ok: false, reason: 'invalid' }
  }
  if (info.kind === 'blocked') return { ok: false, reason: 'blocked' }
  if (isSensitiveName(info.path)) return { ok: false, reason: 'secret' }
  if (info.path.split(/[\\/]/).some((seg) => HIDDEN_DIRS.has(seg.toLowerCase()))) return { ok: false, reason: 'hidden-dir' }
  if (info.bytes > maxBytes) return { ok: false, reason: 'too-big' }
  return { ok: true, real: info.path, name: info.name, bytes: info.bytes, ext: extname(info.path).slice(1).toLowerCase() }
}

/** Lee el archivo ya validado (tope por si cambió de tamaño entre la comprobación y la lectura). */
export function readOutgoingFile(
  check: Extract<OutgoingCheck, { ok: true }>,
  maxBytes: number = TELEGRAM_LIMITS.maxSendFileBytes
): Buffer | null {
  try {
    const fd = openSync(check.real, 'r')
    try {
      const buf = Buffer.alloc(Math.min(check.bytes, maxBytes) + 1)
      const n = readSync(fd, buf, 0, buf.length, 0)
      if (n > maxBytes) return null
      return buf.subarray(0, n)
    } finally {
      closeSync(fd)
    }
  } catch {
    try {
      const all = readFileSync(check.real)
      return all.length > maxBytes ? null : all
    } catch {
      return null
    }
  }
}

// ---------------------------------------------------------------- entrada

export type IncomingRefusal = 'type' | 'size' | 'executable' | 'secret' | 'content' | 'empty' | OfficeRefusal
export type OfficeRefusal = 'encrypted' | 'legacy' | 'corrupt' | 'tooBig' | 'unsupported' | 'unreadable'

export interface IncomingPart {
  mime: string
  filename: string
  /** Siempre `data:` (nunca `file://`: el motor lo leería del disco sin pasar por permisos). */
  url: string
  kind: 'image' | 'pdf' | 'text' | 'office'
}

export type IncomingResult = { ok: true; part: IncomingPart } | { ok: false; reason: IncomingRefusal }

const startsWith = (b: Uint8Array, sig: number[], at = 0): boolean => sig.every((v, i) => b[at + i] === v)

/** Bytes iniciales de programas ejecutables (Windows, Linux, macOS), con cualquier nombre. */
function looksExecutable(b: Uint8Array): boolean {
  return (
    startsWith(b, [0x4d, 0x5a]) || // MZ
    startsWith(b, [0x7f, 0x45, 0x4c, 0x46]) || // ELF
    startsWith(b, [0xfe, 0xed, 0xfa, 0xce]) ||
    startsWith(b, [0xfe, 0xed, 0xfa, 0xcf]) ||
    startsWith(b, [0xce, 0xfa, 0xed, 0xfe]) ||
    startsWith(b, [0xcf, 0xfa, 0xed, 0xfe]) ||
    startsWith(b, [0xca, 0xfe, 0xba, 0xbe]) || // Mach-O universal / clase Java
    startsWith(b, [0x23, 0x21]) // #! (script con intérprete)
  )
}

function imageMimeOk(mime: string, b: Uint8Array): boolean {
  switch (mime) {
    case 'image/png':
      return startsWith(b, [0x89, 0x50, 0x4e, 0x47])
    case 'image/jpeg':
      return startsWith(b, [0xff, 0xd8, 0xff])
    case 'image/gif':
      return startsWith(b, [0x47, 0x49, 0x46, 0x38])
    case 'image/webp':
      return startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)
    default:
      return false
  }
}

function isPlainUtf8(b: Uint8Array): boolean {
  const sample = b.subarray(0, 64 * 1024)
  if (b.includes(0)) return false
  const dec = new TextDecoder('utf-8', { fatal: true })
  try {
    dec.decode(sample)
    return true
  } catch {
    // Si la muestra es solo el principio del archivo, el corte puede haber partido un carácter en los últimos bytes.
    if (b.length <= sample.length) return false
    try {
      dec.decode(sample.subarray(0, sample.length - 4))
      return true
    } catch {
      return false
    }
  }
}

const toDataUrl = (mime: string, bytes: Uint8Array): string => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`

/** Valida y prepara un archivo que el dueño mandó. `mime` y `name` los dice Telegram (no son de fiar: se comprueba el contenido). */
export async function prepareIncoming(f: { name: string; mime: string; bytes: Uint8Array }): Promise<IncomingResult> {
  const name = (basename(f.name.replace(/\\/g, '/')) || 'archivo').slice(0, 120)
  const ext = extname(name).toLowerCase()
  if (f.bytes.length === 0) return { ok: false, reason: 'empty' }
  if (f.bytes.length > TELEGRAM_LIMITS.maxIncomingFileBytes) return { ok: false, reason: 'size' }
  if (BLOCKED_OPEN_EXTENSIONS.has(ext) || looksExecutable(f.bytes)) return { ok: false, reason: 'executable' }
  if (isSensitiveName(name)) return { ok: false, reason: 'secret' }
  const cls = classifyFile({ name, type: f.mime })
  if (!cls) return { ok: false, reason: 'type' }
  if (f.bytes.length > cls.max) return { ok: false, reason: 'size' }
  switch (cls.kind) {
    case 'image':
      if (!imageMimeOk(cls.mime, f.bytes)) return { ok: false, reason: 'content' }
      return { ok: true, part: { kind: 'image', mime: cls.mime, filename: name, url: toDataUrl(cls.mime, f.bytes) } }
    case 'pdf':
      if (!startsWith(f.bytes, [0x25, 0x50, 0x44, 0x46])) return { ok: false, reason: 'content' }
      return { ok: true, part: { kind: 'pdf', mime: 'application/pdf', filename: name, url: toDataUrl('application/pdf', f.bytes) } }
    case 'text':
      if (!isPlainUtf8(f.bytes)) return { ok: false, reason: 'content' }
      return { ok: true, part: { kind: 'text', mime: 'text/plain', filename: name, url: toDataUrl('text/plain', f.bytes) } }
    case 'office': {
      if (!officeFamilyOf(name) || f.bytes.length > OFFICE_MAX_BYTES) return { ok: false, reason: 'type' }
      const r = await extractOffice({ name, base64: Buffer.from(f.bytes).toString('base64') })
      if (!r.ok) return { ok: false, reason: r.reason === 'empty' ? 'empty' : (r.reason as OfficeRefusal) }
      return {
        ok: true,
        part: { kind: 'office', mime: 'text/plain', filename: name, url: toDataUrl('text/plain', new TextEncoder().encode(r.text)) }
      }
    }
  }
}
