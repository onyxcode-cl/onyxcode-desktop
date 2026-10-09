/**
 * Detecta el tipo de documento del visor combinando la extensión con los bytes mágicos del
 * contenido: una extensión falsa (p. ej. un .pdf que no empieza con %PDF-) no pasa. docx/xlsx/pptx
 * son ZIP (firma PK\x03\x04): la extensión es la única forma de distinguirlos entre sí, pero la
 * firma ZIP igual se exige para descartar archivos corruptos o con la extensión mal puesta.
 * Módulo PURO: sin Electron, sin node:fs — recibe los bytes ya leídos por quien llama.
 */
import type { DocKind } from '@shared/doc-kind'

export type { DocKind }

/** Tope de tamaño (bytes) por tipo, según el plan del visor: PDF/PPTX hasta 100 MB, DOCX/XLSX hasta 25 MB. */
export const MAX_BYTES: Record<DocKind, number> = {
  pdf: 100 * 1024 * 1024,
  pptx: 100 * 1024 * 1024,
  docx: 25 * 1024 * 1024,
  xlsx: 25 * 1024 * 1024
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] // "%PDF-"
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] // "PK\x03\x04"

function startsWith(header: Uint8Array, magic: number[]): boolean {
  if (header.length < magic.length) return false
  for (let i = 0; i < magic.length; i++) if (header[i] !== magic[i]) return false
  return true
}

function extensionOf(filePath: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(filePath)
  return m ? m[1].toLowerCase() : ''
}

/**
 * `null` si no se reconoce el tipo, o si la extensión y los bytes mágicos no concuerdan (archivo
 * corrupto, extensión falsa, o formato no soportado por el visor).
 */
export function sniffDocKind(filePath: string, header: Uint8Array): DocKind | null {
  const ext = extensionOf(filePath)
  if (ext === 'pdf') return startsWith(header, PDF_MAGIC) ? 'pdf' : null
  if (ext === 'docx') return startsWith(header, ZIP_MAGIC) ? 'docx' : null
  if (ext === 'xlsx') return startsWith(header, ZIP_MAGIC) ? 'xlsx' : null
  if (ext === 'pptx') return startsWith(header, ZIP_MAGIC) ? 'pptx' : null
  return null
}
