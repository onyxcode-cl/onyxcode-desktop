/**
 * Lógica pura de Code en la pantalla del celular (superficie `remote`): sin React ni DOM, para probarla con vitest.
 *  - ruta abreviada con `~` para nombres de archivo en espacios estrechos,
 *  - qué acciones piden confirmación en el Mac (`@shared/remote/mac-confirm`, espejo de `main/remote/policy.ts`),
 *  - validación de adjuntos del celular (límites de `lib/attachments.ts`; solo `data:`, NUNCA `file://`).
 */
import { attachmentBytes, isSafeAttachmentUrl, validateFiles } from '../../../lib/attachments'
import { tildify } from '../../../lib/paths'

/** Une la carpeta del proyecto con una ruta relativa del repo (acepta `/` y `\`) y la muestra con `~`. */
export function displayPath(directory: string, rel: string): string {
  const sep = directory.includes('\\') && !directory.includes('/') ? '\\' : '/'
  const base = directory.replace(/[/\\]+$/, '')
  const tail = rel.replace(/^[/\\]+/, '')
  return tildify(tail ? `${base}${sep}${tail}` : base)
}

/**
 * Abrevia una ruta para que quepa en `max` caracteres: conserva el comienzo (`~` o la raíz) y los últimos tramos, y pone `…`
 * en medio. Si ni el último tramo cabe, lo recorta por la izquierda (`…nombre-muy-largo.ts`). Siempre conserva el final.
 */
export function abbreviatePath(path: string, max = 34): string {
  const full = tildify(path)
  if (full.length <= max) return full
  const sep = full.includes('\\') && !full.includes('/') ? '\\' : '/'
  const parts = full.split(/[/\\]+/)
  const name = parts[parts.length - 1] ?? full
  const head = parts[0] ?? ''
  const ell = `${head === '' ? sep : `${head}${sep}`}…`
  let out = `${ell}${sep}${name}`
  if (out.length > max) return `…${name.slice(-Math.max(1, max - 1))}`
  // Suma tramos por la derecha mientras quepan.
  for (let i = parts.length - 2; i > 0; i--) {
    const next = `${ell}${sep}${parts.slice(i).join(sep)}`
    if (next.length > max) break
    out = next
  }
  return out
}

export { MAX_DISCARD_WITHOUT_MAC, ONCE_SAFE_PERMISSIONS, needsMacConfirm, phoneReplies, type MacAction } from '@shared/remote/mac-confirm'

export interface AttachCandidate {
  name: string
  type: string
  size: number
}

/**
 * Valida los archivos elegidos en el celular contra los límites de siempre (cantidad, tamaño por tipo y total), contando lo ya
 * adjuntado. Devuelve los índices aceptados y un mensaje (ya traducido) por rechazo.
 */
export function validatePhoneAttachments(
  files: AttachCandidate[],
  existing: Array<{ url: string }>
): { accepted: number[]; errors: string[] } {
  return validateFiles(files, { count: existing.length, bytes: existing.reduce((n, a) => n + attachmentBytes(a), 0) })
}

/** Solo viajan adjuntos `data:` desde el celular. */
export const phoneSafeAttachments = <T extends { url: string }>(list: T[]): T[] => list.filter((a) => isSafeAttachmentUrl(a.url))
