/**
 * Adjuntar documentos de oficina al Chat (Word, Excel, PowerPoint, OpenDocument y RTF).
 * Main convierte el archivo a texto (Markdown) y el renderer lo adjunta como una parte de texto del mensaje: no depende
 * de ningún proveedor ni modelo. Tipos y topes compartidos entre main (que extrae) y el renderer (que clasifica y avisa).
 */

/** Tope del archivo original (mismo que el PDF). */
export const OFFICE_MAX_BYTES = 10 * 1024 * 1024
/** Tope del texto que sale de un archivo (≈ 25 000 palabras); lo que pase se recorta y se avisa. */
export const OFFICE_MAX_CHARS = 100_000
/** Topes de las hojas de cálculo. */
export const OFFICE_MAX_ROWS = 200
export const OFFICE_MAX_COLS = 30
export const OFFICE_MAX_SHEETS = 20
export const OFFICE_MAX_CELL_CHARS = 500
/** Tope de diapositivas. */
export const OFFICE_MAX_SLIDES = 150

export type OfficeFamily = 'document' | 'spreadsheet' | 'presentation'
export type OfficeUnit = 'pages' | 'sheets' | 'slides'

/** Extensión (sin punto, en minúscula) → familia. `doc` y `ppt` (formato binario antiguo) se reconocen para dar un error claro. */
export const OFFICE_FAMILY_BY_EXT: Readonly<Record<string, OfficeFamily>> = {
  docx: 'document',
  docm: 'document',
  odt: 'document',
  rtf: 'document',
  doc: 'document',
  xlsx: 'spreadsheet',
  xlsm: 'spreadsheet',
  xlsb: 'spreadsheet',
  xls: 'spreadsheet',
  ods: 'spreadsheet',
  pptx: 'presentation',
  pptm: 'presentation',
  odp: 'presentation',
  ppt: 'presentation'
}

export const OFFICE_UNIT_BY_FAMILY: Readonly<Record<OfficeFamily, OfficeUnit>> = {
  document: 'pages',
  spreadsheet: 'sheets',
  presentation: 'slides'
}

export function officeExt(name: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(name.trim())
  return m ? m[1].toLowerCase() : ''
}

export function officeFamilyOf(name: string): OfficeFamily | null {
  return OFFICE_FAMILY_BY_EXT[officeExt(name)] ?? null
}

export type OfficeFailReason = 'encrypted' | 'legacy' | 'corrupt' | 'tooBig' | 'unsupported' | 'empty' | 'unreadable'

export interface OfficeExtractRequest {
  name: string
  /** Bytes del archivo en base64 (≤ `OFFICE_MAX_BYTES`). */
  base64: string
}

export type OfficeExtractResult =
  | {
      ok: true
      /** Texto listo para adjuntar: marco de «datos, no instrucciones» + contenido en Markdown + avisos de recorte. */
      text: string
      family: OfficeFamily
      /** Páginas / hojas / diapositivas; `null` si el formato no lo dice (p. ej. páginas de un documento sin metadatos). */
      units: number | null
      unit: OfficeUnit
      truncated: boolean
      /** Avisos de recorte ya traducidos (los mismos que lleva `text` para la IA). */
      notes: string[]
    }
  | { ok: false; reason: OfficeFailReason }
