import { classifyFile } from '@shared/attach-classify'
import { t } from '@shared/i18n'
import { toChatAttachment } from '../../../lib/attachments'
import type { FileAttachment } from './types'

let seq = 0

/** Adjuntos de escritorio: los archivos que necesitan herramientas se comparten por referencia, sin leer sus bytes. */
export async function toCodeAttachment(file: File): Promise<FileAttachment> {
  const classified = classifyFile(file)
  if (classified && classified.kind !== 'office') return toChatAttachment(file)
  const paths = (window as Window & { lzxPaths?: { forFile: (file: File) => string } }).lzxPaths
  const path = paths?.forFile(file) || undefined
  seq += 1
  return {
    id: `att-ref-${Date.now()}-${seq}`,
    name: file.name || t('code.composer.fileDefault'),
    mime: file.type || 'application/octet-stream',
    url: '',
    reference: { path }
  }
}

/** La referencia es texto normal: el motor abrirá la ruta solo si decide usar una herramienta. */
export function codeAttachmentPart(
  a: FileAttachment
): { type: 'text'; text: string } | { type: 'file'; mime: string; filename: string; url: string } {
  if (a.reference) {
    return {
      type: 'text',
      text: a.reference.path
        ? t('code.composer.fileReference', { name: a.name, path: a.reference.path })
        : t('code.composer.fileReferenceNoPath', { name: a.name })
    }
  }
  return { type: 'file', mime: a.mime, filename: a.name, url: a.url }
}
