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
import { convertToPdf } from './office-render'
import { craftService } from '../office/craft/service'
import { deckToPdf, renderChatDeck } from '../office/craft/chat-deck'
import { isPptxSpec, renderPptx, type PptxSpec } from './render-pptx'
import { isXlsxSpec, renderXlsx, type XlsxSpec } from './render-xlsx'
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
}

export type ChatDocInput = { kind: 'pdf'; html: string } | { kind: 'xlsx'; data: XlsxSpec } | { kind: 'pptx'; data: PptxSpec }

const EXT: Record<ChatDocInput['kind'], string> = { pdf: 'pdf', xlsx: 'xlsx', pptx: 'pptx' }

/** Genera el archivo real (PDF/Excel/PowerPoint) y lo guarda en la carpeta temporal de esta sesión, con un token del visor ya emitido. */
export async function generateChatDoc(input: ChatDocInput, title: string, sessionId: string): Promise<ChatDocument> {
  ensureValidatorRegistered()
  const dir = sessionDir(sessionId) // falla rápido con un ID raro, antes de gastar en generar el archivo
  const bytes = await renderBytes(input, title)
  await mkdir(dir, { recursive: true })
  const target = join(dir, `${randomUUID()}.${EXT[input.kind]}`)
  await writeFile(target, bytes)

  // PowerPoint: si hay LibreOffice instalado (nunca empaquetado, nunca se descarga solo — ver
  // `office-render.ts`), la VISTA PREVIA usa el PDF real que convierte (pixel a pixel igual a
  // PowerPoint, confirmado) en vez del visor estructural aproximado — el token apunta al PDF, con
  // `kind:'pdf'`. Esto SOLO cambia qué ve el panel: `downloadChatDoc` (más abajo) vuelve a generar el
  // `.pptx` real desde cero, siempre — lo que se descarga nunca es el PDF. Si no hay LibreOffice, o la
  // conversión falla por lo que sea, cae con gracia al `.pptx` de siempre (nunca rompe nada).
  if (input.kind === 'pptx') {
    // Con DeckCraft instalado, el PDF de la vista previa sale de DeckCraft (rápido y sin LibreOffice); si no, LibreOffice como siempre.
    const craft = craftBinary('deckcraft')
    const pdfPath =
      (craft ? await deckToPdf(craft, target, target.replace(/\.pptx$/, '.pdf')) : null) ??
      (await convertToPdf(target, dir).catch(() => null))
    if (pdfPath) {
      const token = issueToken({ path: pdfPath, kind: 'pdf' })
      return { token, kind: 'pdf' }
    }
  }

  const token = issueToken({ path: target, kind: input.kind })
  return { token, kind: input.kind }
}

/** Ruta de un programa de ArtCraft si está instalado (`null` si no, o si no es macOS). */
function craftBinary(tool: 'deckcraft' | 'wordcraft'): string | null {
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
    return renderXlsx(input.data)
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
