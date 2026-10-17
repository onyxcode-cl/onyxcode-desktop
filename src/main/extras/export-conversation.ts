/**
 * Exportar una conversación a `.md` o `.pdf` (Chat, Code y Tareas). Main recibe la conversación ya validada (`extras:exportConversation`),
 * la redacta de nuevo (defensa en profundidad: el renderer también lo hace al copiar), genera el archivo y lo guarda donde la PERSONA
 * elige en el diálogo nativo «Guardar como»: el renderer nunca manda una ruta de destino.
 * El PDF sale de un HTML estático (sin scripts, CSP estricta) impreso en la ventana oculta y sin red de `renderHtmlToPdf`.
 */
import { t } from '@shared/i18n'
import { app, dialog, type BrowserWindow } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import type { ConversationExportRequest, ConversationExportResult } from '@shared/ipc-extras'
import { buildConversationHtml, buildConversationMarkdown, sanitizeExportFileName } from '@shared/conversation-export'
import { renderHtmlToPdf } from './artifact-window'

export interface BuiltExport {
  data: Buffer | string
  /** Nombre sugerido, ya saneado y con la extensión forzada. */
  fileName: string
  ext: 'md' | 'pdf'
  redactions: number
}

/** Genera el contenido del archivo (sin tocar el disco ni abrir diálogos). */
export async function buildExport(req: ConversationExportRequest): Promise<BuiltExport> {
  const fileName = sanitizeExportFileName(req.doc.title, req.format, t('conv.export.fileName'))
  if (req.format === 'md') {
    const md = buildConversationMarkdown(req.doc, req.options)
    return { data: md.content, fileName, ext: 'md', redactions: md.redactions }
  }
  const html = buildConversationHtml(req.doc, req.options, req.lang)
  const pdf = await renderHtmlToPdf(html.content, req.doc.title || t('conv.export.untitled'))
  if (!pdf.subarray(0, 4).equals(Buffer.from('%PDF'))) throw new Error(t('merr.files.pdfInvalid'))
  return { data: pdf, fileName, ext: 'pdf', redactions: html.redactions }
}

/** Si la persona escribió otra extensión en el diálogo, se fuerza la del formato elegido. */
export function forceExtension(filePath: string, ext: 'md' | 'pdf'): string {
  return extname(filePath).toLowerCase() === `.${ext}` ? filePath : `${filePath}.${ext}`
}

export async function exportConversation(req: ConversationExportRequest, win: BrowserWindow | null): Promise<ConversationExportResult> {
  const built = await buildExport(req)
  const options: Electron.SaveDialogOptions = {
    title: t('merr.dialog.exportConversation'),
    defaultPath: join(app.getPath('downloads'), built.fileName),
    filters: [{ name: built.ext === 'md' ? 'Markdown' : 'PDF', extensions: [built.ext] }]
  }
  const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (res.canceled || !res.filePath) return { path: null, redactions: built.redactions }
  const target = forceExtension(res.filePath, built.ext)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, built.data, typeof built.data === 'string' ? 'utf8' : undefined)
  return { path: target, redactions: built.redactions }
}
