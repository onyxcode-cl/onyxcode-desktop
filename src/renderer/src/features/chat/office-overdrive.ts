import type { OfficeExtractRequest } from '@shared/attach-office'
import { detectTranslateIntent } from '@shared/translate-intent'
import { DOCX_MIME, XLSX_MIME } from '@shared/translate-pdf'
import type { ChatAttachment } from '../../lib/attachments'
import type { MessageEntry } from '../../stores/sessions'
import { getDraft, setDraft } from '../../stores/drafts'
import { isRemoteSurface, platformCaps } from '../../lib/platform'
import { cw, hasTasksBridge } from '../tasks/impl/bridge'

export type OfficeOriginal = Pick<ChatAttachment, 'originalDocx' | 'originalXlsx' | 'originalPptx'>

/** Conserva los originales en la llamada local de envío; actions los separa de las partes del SDK. */
export function chatSendFiles(files: ChatAttachment[]): (OfficeOriginal & { mime: string; filename: string; url: string })[] {
  return files.map((f) => ({
    mime: f.mime,
    filename: f.name,
    url: f.url,
    originalDocx: f.originalDocx,
    originalXlsx: f.originalXlsx,
    originalPptx: f.originalPptx
  }))
}

/** Vinculado al id de la parte enviada, nunca al nombre, al modelo ni a una frase de su respuesta.
 * Reutiliza el presupuesto de memoria y la limpieza por sesión de los borradores. No persiste al cerrar la app.
 */
export function sentOfficeKey(sessionID: string, partID: string): string {
  return `chat-office:${sessionID}:${partID}`
}

export function rememberOfficeOriginal(sessionID: string, partID: string, file: ChatAttachment): void {
  setDraft(sentOfficeKey(sessionID, partID), [file])
}

export function sentOfficeAttachments(entry: MessageEntry): ChatAttachment[] {
  return entry.parts.flatMap((p) => {
    if (p.type !== 'file') return []
    return getDraft<ChatAttachment[]>(sentOfficeKey(entry.info.sessionID, p.id), [])
  })
}

/** Solo edición explícita: leer, resumir y la traducción con diseño conservan su flujo. */
export function officeEditFiles(text: string, attachments: ChatAttachment[]): OfficeExtractRequest[] | null {
  const value = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  // Una lectura que menciona cambios o formato sigue siendo lectura («resume sin cambiar el formato»).
  if (
    /^(?:(?:por favor|please|puedes|podrias|can you|could you)\s+)?(?:lee|leer|resume|resumir|explica|explicar|analiza|analizar|read|summari[sz]e|explain|analy[sz]e)\b/.test(
      value.trim()
    )
  )
    return null
  if (
    !/\b(edit(?:a|ar|e|ing)?|modific(?:a|ar)|cambi(?:a|ar)|corrig(?:e|ir)|corregir|reemplaz(?:a|ar)|agreg(?:a|ar)|anad(?:e|ir)|actualiz(?:a|ar)|ajust(?:a|ar)|elimin(?:a|ar)|quit(?:a|ar)|borr(?:a|ar)|resalt(?:a|ar)|reorden(?:a|ar)|formate(?:a|ar)|arregl(?:a|ar)|change|modify|correct|replace|add|update|adjust|delete|remove|highlight|reorder|format)(?:lo|la|los|las|le|les|me|nos)?\b/.test(
      value
    )
  )
    return null
  if (!attachments.length) return null
  if (
    detectTranslateIntent(
      text,
      attachments.map((f) => ({ mime: f.originalDocx ? DOCX_MIME : f.originalXlsx ? XLSX_MIME : f.mime })),
      'es'
    )
  )
    return null
  return officeOriginalFiles(attachments)
}

/** Originales copiables, independientemente del texto del pedido o de la respuesta del modelo. */
export function officeOriginalFiles(attachments: ChatAttachment[]): OfficeExtractRequest[] | null {
  if (!attachments.length) return null
  const files: OfficeExtractRequest[] = []
  for (const file of attachments) {
    const base64 = /\.docx$/i.test(file.name)
      ? file.originalDocx
      : /\.xlsx$/i.test(file.name)
        ? file.originalXlsx
        : /\.pptx$/i.test(file.name)
          ? file.originalPptx
          : undefined
    // Un lote mixto no se traslada a medias ni pierde sus otros adjuntos.
    if (!base64) return null
    files.push({ name: file.name, base64 })
  }
  return files
}

/** Disponibilidad efectiva, sin arrancar servidor ni modelo. La bandera de plataforma sola no basta. */
export async function chatOfficeAvailable(): Promise<boolean> {
  if (isRemoteSurface() || !platformCaps().tasks || !hasTasksBridge()) return false
  try {
    const info = await window.api.invoke('app:info')
    if (!info.ok || info.data.unifiedApps !== true) return false
    const status = await cw('tasks:sandbox:status', { force: true })
    return status.state === 'ready' && status.backend !== 'none' && !status.setup?.running
  } catch {
    return false
  }
}
