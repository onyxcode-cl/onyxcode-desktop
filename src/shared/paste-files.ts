/**
 * Pegado de archivos/imágenes desde el portapapeles del sistema (Finder, Explorador, capturas).
 * Tipos y topes compartidos entre main (que lee y valida) y el renderer (que traduce los rechazos).
 */

/** Topes del pegado: cantidad, tamaño por archivo y total. */
export const PASTE_MAX_FILES = 10
export const PASTE_MAX_FILE_BYTES = 25 * 1024 * 1024
export const PASTE_MAX_TOTAL_BYTES = 50 * 1024 * 1024

/** `images`: solo imágenes (Code); `any`: cualquier archivo regular no ejecutable (Chat, Tareas; luego cada compositor filtra por su lista). */
export type PasteScope = 'images' | 'any'

export type PasteRejectReason = 'tooBig' | 'tooMany' | 'tooBigTotal' | 'notRegular' | 'blockedType' | 'unreadable'

export interface PasteFile {
  name: string
  mime: string
  size: number
  base64: string
}

export interface PasteRejected {
  name: string
  reason: PasteRejectReason
}

export interface PasteResult {
  files: PasteFile[]
  rejected: PasteRejected[]
}
