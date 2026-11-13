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
import { createHash, randomUUID } from 'node:crypto'
import { join, sep } from 'node:path'
import type { DocKind } from '@shared/doc-kind'
import { safeDocumentName } from './artifact-window'
import { deckToPdf } from '../office/craft/chat-deck'
import { gridToPdf } from '../office/craft/chat-grid'
import { docxToPdf } from '../office/craft/chat-word'
import { DOC_EXT, craftBinary, renderBytes } from '../documents/engine'
import { issueToken } from '../viewer/tokens'
import { registerViewerPathValidator } from '../viewer/scheme'

export { ChatDocError, type ChatDocInput } from '../documents/engine'
import type { ChatDocInput } from '../documents/engine'

const ROOT_NAME = 'lazunox-chat-docs'
const SESSION_ID_RE = /^[A-Za-z0-9_-]+$/

export function chatDocsRoot(): string {
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

const EXT = DOC_EXT

// Solo bytes propios en memoria, nunca rutas o tokens del visor ni archivos editados por otra app.
// El título también puede alterar el PDF. Se comparten trabajos simultáneos y se descartan fallos.
const MAX_CACHED_BYTES = 64 * 1024 * 1024
const MAX_CACHED_DOCUMENTS = 16
const generatedBytes = new Map<string, { promise: Promise<Buffer>; size: number }>()
let cachedBytes = 0

function documentKey(input: ChatDocInput, title: string): string {
  const json = JSON.stringify([title, input], (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, value[key]])
        )
      : value
  )
  return createHash('sha256').update(json).digest('hex')
}

function trimGeneratedBytes(): void {
  while (generatedBytes.size > MAX_CACHED_DOCUMENTS || cachedBytes > MAX_CACHED_BYTES) {
    const key = generatedBytes.keys().next().value!
    cachedBytes -= generatedBytes.get(key)!.size
    generatedBytes.delete(key)
  }
}

function bytesFor(input: ChatDocInput, title: string): Promise<Buffer> {
  const key = documentKey(input, title)
  const hit = generatedBytes.get(key)
  if (hit) {
    generatedBytes.delete(key)
    generatedBytes.set(key, hit)
    return hit.promise
  }
  const entry = { promise: renderBytes(input, title), size: 0 }
  generatedBytes.set(key, entry)
  trimGeneratedBytes()
  entry.promise = entry.promise.then(
    (bytes) => {
      if (generatedBytes.get(key) === entry) {
        entry.size = bytes.length
        cachedBytes += entry.size
        trimGeneratedBytes()
      }
      return bytes
    },
    (error: unknown) => {
      if (generatedBytes.get(key) === entry) generatedBytes.delete(key)
      throw error
    }
  )
  return entry.promise
}

/** Genera el archivo real (PDF/Excel/PowerPoint) y lo guarda en la carpeta temporal de esta sesión, con un token del visor ya emitido. */
export async function generateChatDoc(input: ChatDocInput, title: string, sessionId: string): Promise<ChatDocument> {
  ensureValidatorRegistered()
  const dir = sessionDir(sessionId) // falla rápido con un ID raro, antes de gastar en generar el archivo
  const bytes = await bytesFor(input, title)
  await mkdir(dir, { recursive: true })
  const target = join(dir, `${randomUUID()}.${EXT[input.kind]}`)
  await writeFile(target, bytes)
  return { token: issueToken({ path: target, kind: input.kind }), kind: input.kind, file: target }
}

/** Solo tras fallar la vista web: convierte a PDF para el visor clásico, conservando el archivo original. */
export async function prepareChatDocPreview(doc: ChatDocument): Promise<ChatDocument> {
  const target = doc.file
  if (doc.kind === 'pptx') {
    const craft = craftBinary('deckcraft')
    const pdfPath = craft ? await deckToPdf(craft, target, target.replace(/\.pptx$/, '.pdf')) : null
    if (pdfPath) {
      const token = issueToken({ path: pdfPath, kind: 'pdf' })
      return { token, kind: 'pdf', file: target }
    }
  }

  // Word: la vista web de WordCraft va aparte (ver `web-open.ts`); aquí el respaldo es el PDF que genera WordCraft.
  if (doc.kind === 'docx') {
    const word = craftBinary('wordcraft')
    const pdfPath = word ? await docxToPdf(word, target, target.replace(/\.docx$/, '.pdf')) : null
    if (pdfPath) return { token: issueToken({ path: pdfPath, kind: 'pdf' }), kind: 'pdf', file: target }
  }

  // Excel: el visor estructural del panel dibuja las hojas de forma aproximada y NO muestra los gráficos; con GridCraft instalado la vista
  // previa es el PDF que genera GridCraft (hojas con formato, números calculados y gráficos, como se ven al abrirlo en Excel). Igual que
  // con PowerPoint, solo cambia lo que ve el panel: lo que se descarga sigue siendo el .xlsx real. Si falla, cae al visor de siempre.
  if (doc.kind === 'xlsx') {
    const grid = craftBinary('gridcraft')
    const pdfPath = grid ? await gridToPdf(grid, target, target.replace(/\.xlsx$/, '.pdf')) : null
    if (pdfPath) return { token: issueToken({ path: pdfPath, kind: 'pdf' }), kind: 'pdf', file: target }
  }

  return doc
}

/**
 * `data` (Excel/PowerPoint) → archivo real, con diálogo nativo "Guardar como": mismo patrón que
 * `downloadHtmlAsPdf` — reutiliza los bytes del mismo contenido o los genera si aún no están
 * (sin depender de tokens). El destino SIEMPRE lo elige la persona, nunca el agente.
 * `null` si cancela el diálogo.
 */
export async function downloadChatDoc(input: ChatDocInput, title: string, win: BrowserWindow | null): Promise<string | null> {
  const safe = safeDocumentName(title || 'documento', 'documento')
  const options: Electron.SaveDialogOptions = {
    title: t(input.kind === 'pdf' ? 'merr.dialog.savePdf' : 'merr.dialog.saveDoc'),
    defaultPath: join(app.getPath('downloads'), `${safe}.${EXT[input.kind]}`),
    filters: [{ name: EXT[input.kind].toUpperCase(), extensions: [EXT[input.kind]] }]
  }
  const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (res.canceled || !res.filePath) return null
  const bytes = await bytesFor(input, title)
  await writeFile(res.filePath, bytes)
  return res.filePath
}

/**
 * Genera el documento y lo deja en una carpeta temporal PROPIA (aparte de la del panel, que se borra al cerrarlo) para abrirlo en otro
 * programa. El nombre sale del título limpiado; la carpeta es única por apertura y la barre `sweepStaleChatDocuments`.
 */
export async function writeChatDocForExternal(input: ChatDocInput, title: string): Promise<string> {
  const bytes = await bytesFor(input, title)
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
