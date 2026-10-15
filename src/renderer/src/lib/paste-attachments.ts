/**
 * Pegado de adjuntos en los compositores de escritorio (Chat, Code, Tareas).
 *
 * 1) Vía estándar: archivos/imágenes que Chromium expone en `clipboardData` (`files` o items `kind: 'file'`).
 * 2) Respaldo: un archivo copiado en Finder/Explorador, o una imagen que solo está en el portapapeles del sistema, a
 *    menudo NO llega como `File` al evento. Entonces, dentro del propio evento paste (gesto del usuario), se pide a main
 *    que lo lea y valide (`clipboard:readFilesForPaste`). El renderer nunca manda rutas.
 *
 * El respaldo cancela el pegado nativo para decidir después; si main no encontró archivos, el texto que traía el
 * portapapeles se inserta tal cual (así el pegado de texto sigue funcionando). Solo se activa con un texto corto de
 * una línea y sin HTML (el nombre del archivo que Finder deja como texto) o sin texto.
 */
import { t } from '@shared/i18n'
import {
  PASTE_MAX_FILE_BYTES,
  PASTE_MAX_FILES,
  PASTE_MAX_TOTAL_BYTES,
  type PasteFile,
  type PasteRejected,
  type PasteResult,
  type PasteScope
} from '@shared/paste-files'
import { call } from './api'

/** Lo mínimo de `DataTransfer` que usa el helper (permite probar con eventos simulados). */
export interface PasteData {
  files?: ArrayLike<File> | null
  items?: ArrayLike<{ kind: string; type: string; getAsFile(): File | null }> | null
  types?: ArrayLike<string> | readonly string[] | null
  getData(format: string): string
}

export interface PasteEventLike {
  clipboardData: PasteData | null
  preventDefault(): void
}

export interface PasteFallbackResult {
  files: File[]
  rejected: PasteRejected[]
  /** `true` si el propio lector ya añadió los archivos (Tareas los guarda en la carpeta): no se inserta el texto. */
  handled?: boolean
}

export interface PasteOptions {
  scope: PasteScope
  addFiles: (files: File[]) => void
  /** Mensajes (ya traducidos) de lo que no se pudo pegar. */
  onErrors?: (messages: string[]) => void
  /** Falso en el celular: allí solo vale la vía estándar. */
  fallback?: boolean
  /** Sustituye la lectura de respaldo (Tareas guarda en su carpeta). Por defecto: `clipboard:readFilesForPaste`. */
  readFallback?: () => Promise<PasteFallbackResult>
  /** Inserta el texto del portapapeles cuando el respaldo no encontró archivos. Por defecto, `execCommand('insertText')`. */
  insertText?: (text: string) => void
}

function hasType(types: PasteData['types'], name: string): boolean {
  return !!types && Array.from(types as ArrayLike<string>).includes(name)
}

/** Archivos que Chromium dejó en el evento, filtrados por ámbito (Code: solo imágenes). */
export function collectClipboardFiles(cd: PasteData | null, scope: PasteScope): File[] {
  if (!cd) return []
  let list: File[] = Array.from(cd.items ?? [])
    .filter((it) => it.kind === 'file')
    .map((it) => it.getAsFile())
    .filter((f): f is File => !!f)
  if (list.length === 0) list = Array.from(cd.files ?? [])
  return scope === 'images' ? list.filter((f) => f.type.startsWith('image/')) : list
}

/** ¿Merece la pena preguntar a main? Texto largo, con saltos de línea o HTML = pegado de texto de verdad. */
export function shouldTryFallback(cd: PasteData | null): boolean {
  if (!cd) return false
  if (hasType(cd.types, 'text/html')) return false
  let text = ''
  try {
    text = cd.getData('text/plain')
  } catch {
    text = ''
  }
  return text.length <= 260 && !/[\r\n]/.test(text)
}

export function pasteFilesToFileObjects(files: PasteFile[]): File[] {
  const out: File[] = []
  for (const f of files) {
    const bin = atob(f.base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    out.push(new File([bytes], f.name, { type: f.mime }))
  }
  return out
}

/** Mensajes traducidos de los rechazos de main. */
export function pasteRejectedMessages(rejected: PasteRejected[]): string[] {
  const mb = (n: number): string => String(Math.round(n / 1024 / 1024))
  return rejected.map((r) => {
    switch (r.reason) {
      case 'tooBig':
        return t('chat.paste.errTooBig', { name: r.name, mb: mb(PASTE_MAX_FILE_BYTES) })
      case 'tooMany':
        return t('chat.paste.errTooMany', { name: r.name, max: PASTE_MAX_FILES })
      case 'tooBigTotal':
        return t('chat.paste.errTotal', { name: r.name, mb: mb(PASTE_MAX_TOTAL_BYTES) })
      case 'notRegular':
        return t('chat.paste.errNotRegular', { name: r.name })
      case 'blockedType':
        return t('chat.paste.errBlocked', { name: r.name })
      default:
        return t('chat.paste.errUnreadable', { name: r.name })
    }
  })
}

function defaultInsertText(text: string): void {
  if (!text) return
  if (typeof document !== 'undefined' && typeof document.execCommand === 'function') document.execCommand('insertText', false, text)
}

/**
 * Maneja un evento paste. Devuelve `true` si lo tomó (canceló el pegado nativo), `false` si debe seguir el pegado normal.
 * Cualquier fallo del respaldo se ignora (queda el comportamiento anterior).
 */
export function handlePaste(e: PasteEventLike, opts: PasteOptions): boolean {
  const cd = e.clipboardData
  const std = collectClipboardFiles(cd, opts.scope)
  if (std.length > 0) {
    e.preventDefault()
    opts.addFiles(std)
    return true
  }
  if (opts.fallback === false || !shouldTryFallback(cd)) return false
  let text = ''
  try {
    text = cd?.getData('text/plain') ?? ''
  } catch {
    text = ''
  }
  e.preventDefault()
  const insert = opts.insertText ?? defaultInsertText
  const read =
    opts.readFallback ??
    (async (): Promise<PasteFallbackResult> => {
      const r: PasteResult = await call('clipboard:readFilesForPaste', { scope: opts.scope })
      return { files: pasteFilesToFileObjects(r.files), rejected: r.rejected }
    })
  void read().then(
    (r) => {
      const messages = pasteRejectedMessages(r.rejected)
      if (r.files.length > 0) opts.addFiles(r.files)
      else if (!r.handled && messages.length === 0) insert(text)
      if (messages.length > 0) opts.onErrors?.(messages)
    },
    () => insert(text)
  )
  return true
}
