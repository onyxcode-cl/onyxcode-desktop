/**
 * Documentos generados en Chat (PDF vía HTML, Excel/PowerPoint vía datos estructurados): Chat NO
 * tiene acceso a archivos del usuario ni carpeta propia (a diferencia de Tareas). Esto genera el
 * archivo real y lo guarda en una carpeta TEMPORAL descartable bajo `app.getPath('temp')` — nunca
 * bajo `userData`, que el perfil Seatbelt de Tareas deniega sin excepción (`sandbox-profile.ts`) —
 * y lo muestra con el MISMO visor nativo que usa Tareas (un solo modo de la app es visible a la vez,
 * así que no hay conflicto por compartir la vista, y el visor ya sabe pintar los cuatro formatos sin
 * que le importe cómo se generaron).
 */
import { app, dialog, type BrowserWindow } from 'electron'
import { t } from '@shared/i18n'
import { realpathSync } from 'node:fs'
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, sep } from 'node:path'
import type { DocKind } from '@shared/doc-kind'
import { renderHtmlToPdf, safeDocumentName } from './artifact-window'
import { craftService } from '../office/craft/service'
import { deckToPdf, renderChatDeck } from '../office/craft/chat-deck'
import { gridToPdf, renderChatGrid } from '../office/craft/chat-grid'
import { isPptxSpec, renderPptx, type PptxSpec } from './render-pptx'
import { isXlsxSpec, renderXlsx, type XlsxSpec } from './render-xlsx'
import { isDocxSpec, type DocxSpec } from '@shared/chat-doc-spec'
import { docxToPdf, renderChatDocx } from '../office/craft/chat-word'
import { issueToken } from '../viewer/tokens'
import { registerViewerPathValidator } from '../viewer/scheme'

const ROOT_NAME = 'lazunox-chat-docs'
const SESSION_ID_RE = /^[A-Za-z0-9_-]+$/

function chatDocsRoot(): string {
  return join(app.getPath('temp'), ROOT_NAME)
}

function sessionDir(sessionId: string): string {
  if (!SESSION_ID_RE.test(sessionId)) throw new Error('ID de sesión inválido')
  return join(chatDocsRoot(), sessionId)
}

/** Revalida (al SERVIR, igual que `tasks.assertInsideApproved`) que la ruta siga dentro de la carpeta de Chat. */
export function assertInsideChatDocs(path: string): string {
  const real = realpathSync(path)
  const root = realpathSync(chatDocsRoot())
  if (real !== root && !real.startsWith(root + sep)) throw new Error('Fuera de la carpeta de documentos de Chat')
  return real
}

let validatorRegistered = false
function ensureValidatorRegistered(): void {
  if (validatorRegistered) return
  validatorRegistered = true
  registerViewerPathValidator(assertInsideChatDocs)
}

export interface ChatDocument {
  token: string
  kind: DocKind
  /** Archivo real generado (el .xlsx/.pptx/.pdf), para quien quiera abrirlo en otro visor. */
  file: string
}

export type ChatDocInput =
  { kind: 'pdf'; html: string } | { kind: 'xlsx'; data: XlsxSpec } | { kind: 'pptx'; data: PptxSpec } | { kind: 'docx'; data: DocxSpec }

const EXT: Record<ChatDocInput['kind'], string> = { pdf: 'pdf', xlsx: 'xlsx', pptx: 'pptx', docx: 'docx' }

/** Genera el archivo real (PDF/Excel/PowerPoint) y lo guarda en la carpeta temporal de esta sesión, con un token del visor ya emitido. */
export async function generateChatDoc(input: ChatDocInput, title: string, sessionId: string): Promise<ChatDocument> {
  ensureValidatorRegistered()
  const dir = sessionDir(sessionId) // falla rápido con un ID raro, antes de gastar en generar el archivo
  const bytes = await renderBytes(input, title)
  await mkdir(dir, { recursive: true })
  const target = join(dir, `${randomUUID()}.${EXT[input.kind]}`)
  await writeFile(target, bytes)

  // PowerPoint: con DeckCraft instalado la VISTA PREVIA de respaldo es el PDF que genera DeckCraft (el panel prefiere la versión web del
  // programa; este PDF es el respaldo). El token apunta al PDF con `kind:'pdf'`. Esto SOLO cambia qué ve el panel: `downloadChatDoc`
  // (más abajo) vuelve a generar el `.pptx` real desde cero, siempre — lo que se descarga nunca es el PDF. Si no hay DeckCraft, o la
  // conversión falla por lo que sea, cae con gracia al `.pptx` de siempre (nunca rompe nada).
  if (input.kind === 'pptx') {
    const craft = craftBinary('deckcraft')
    const pdfPath = craft ? await deckToPdf(craft, target, target.replace(/\.pptx$/, '.pdf')) : null
    if (pdfPath) {
      const token = issueToken({ path: pdfPath, kind: 'pdf' })
      return { token, kind: 'pdf', file: target }
    }
  }

  // Word: la vista web de WordCraft va aparte (ver `web-open.ts`); aquí el respaldo es el PDF que genera WordCraft.
  if (input.kind === 'docx') {
    const word = craftBinary('wordcraft')
    const pdfPath = word ? await docxToPdf(word, target, target.replace(/\.docx$/, '.pdf')) : null
    if (pdfPath) return { token: issueToken({ path: pdfPath, kind: 'pdf' }), kind: 'pdf', file: target }
  }

  // Excel: el visor estructural del panel dibuja las hojas de forma aproximada y NO muestra los gráficos; con GridCraft instalado la vista
  // previa es el PDF que genera GridCraft (hojas con formato, números calculados y gráficos, como se ven al abrirlo en Excel). Igual que
  // con PowerPoint, solo cambia lo que ve el panel: lo que se descarga sigue siendo el .xlsx real. Si falla, cae al visor de siempre.
  if (input.kind === 'xlsx') {
    const grid = craftBinary('gridcraft')
    const pdfPath = grid ? await gridToPdf(grid, target, target.replace(/\.xlsx$/, '.pdf')) : null
    if (pdfPath) return { token: issueToken({ path: pdfPath, kind: 'pdf' }), kind: 'pdf', file: target }
  }

  const token = issueToken({ path: target, kind: input.kind })
  return { token, kind: input.kind, file: target }
}

/** Ruta de un programa de ArtCraft si está instalado (`null` si no, o si no es macOS). */
function craftBinary(tool: 'deckcraft' | 'wordcraft' | 'gridcraft'): string | null {
  const st = craftService().status()
  return st.state === 'installed' ? (st.bins[tool] ?? null) : null
}

async function renderBytes(input: ChatDocInput, title: string): Promise<Buffer> {
  if (input.kind === 'pdf') {
    const pdf = await renderHtmlToPdf(input.html, title || 'Documento')
    if (!pdf.subarray(0, 4).equals(Buffer.from('%PDF'))) throw new Error('No se pudo generar el PDF.')
    return pdf
  }
  if (input.kind === 'xlsx') {
    if (!isXlsxSpec(input.data)) throw new Error('Datos de Excel inválidos.')
    // Con GridCraft instalado el libro se arma con él (calcula las fórmulas); si falla, cae al generador de siempre.
    const grid = craftBinary('gridcraft')
    if (grid) {
      try {
        return await renderChatGrid(grid, input.data)
      } catch (e) {
        console.warn('[chat-docs] GridCraft falló, se usa el generador de siempre:', e instanceof Error ? e.message : e)
      }
    }
    return renderXlsx(input.data)
  }
  if (input.kind === 'docx') {
    if (!isDocxSpec(input.data)) throw new Error('Datos de Word inválidos.')
    // Word solo se arma con WordCraft (no hay generador de respaldo): sin el programa instalado, el panel avisa que falló.
    const word = craftBinary('wordcraft')
    if (!word) throw new Error('El diseñador de documentos (WordCraft) no está instalado.')
    return renderChatDocx(word, input.data)
  }
  if (!isPptxSpec(input.data)) throw new Error('Datos de PowerPoint inválidos.')
  // Con DeckCraft instalado la presentación se arma con él (diseño «dots»); si falla por lo que sea, cae al generador de siempre.
  const craft = craftBinary('deckcraft')
  if (craft) {
    try {
      return await renderChatDeck(craft, input.data)
    } catch (e) {
      console.warn('[chat-docs] DeckCraft falló, se usa el generador de siempre:', e instanceof Error ? e.message : e)
    }
  }
  return renderPptx(input.data)
}

/**
 * `data` (Excel/PowerPoint) → archivo real, con diálogo nativo "Guardar como": mismo patrón que
 * `downloadHtmlAsPdf` — vuelve a generar el archivo desde cero (no depende de que el panel lo haya
 * abierto antes, ni de ningún token), y el destino SIEMPRE lo elige la persona, nunca el agente.
 * `null` si cancela el diálogo.
 */
export async function downloadChatDoc(input: ChatDocInput, title: string, win: BrowserWindow | null): Promise<string | null> {
  const bytes = await renderBytes(input, title)
  const safe = safeDocumentName(title || 'documento', 'documento')
  const options: Electron.SaveDialogOptions = {
    title: t('merr.dialog.saveDoc'),
    defaultPath: join(app.getPath('downloads'), `${safe}.${EXT[input.kind]}`),
    filters: [{ name: EXT[input.kind].toUpperCase(), extensions: [EXT[input.kind]] }]
  }
  const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (res.canceled || !res.filePath) return null
  await writeFile(res.filePath, bytes)
  return res.filePath
}

/**
 * Genera el documento y lo deja en una carpeta temporal PROPIA (aparte de la del panel, que se borra al cerrarlo) para abrirlo en otro
 * programa. El nombre sale del título limpiado; la carpeta es única por apertura y la barre `sweepStaleChatDocuments`.
 */
export async function writeChatDocForExternal(input: ChatDocInput, title: string): Promise<string> {
  const bytes = await renderBytes(input, title)
  const dir = join(chatDocsRoot(), 'abiertos', randomUUID())
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const file = join(dir, `${safeDocumentName(title || 'documento', 'documento')}.${EXT[input.kind]}`)
  await writeFile(file, bytes, { mode: 0o600 })
  return file
}

/** Borra los documentos de una sesión de chat (al cerrarla o cambiar a otra). Nunca lanza. */
export async function cleanChatDocuments(sessionId: string): Promise<void> {
  try {
    await rm(sessionDir(sessionId), { recursive: true, force: true })
  } catch {
    /* no había nada que borrar */
  }
}

/** Barrido al arrancar la app: borra carpetas de sesión más viejas que `maxAgeMs` (por si la app se cerró de golpe). */
export async function sweepStaleChatDocuments(maxAgeMs = 24 * 60 * 60 * 1000): Promise<void> {
  const root = chatDocsRoot()
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch {
    return
  }
  const cutoff = Date.now() - maxAgeMs
  for (const name of entries) {
    const dir = join(root, name)
    try {
      const info = await stat(dir)
      if (info.mtimeMs < cutoff) await rm(dir, { recursive: true, force: true })
    } catch {
      /* lo que no se puede leer/borrar se deja: el próximo arranque lo reintenta */
    }
  }
}
