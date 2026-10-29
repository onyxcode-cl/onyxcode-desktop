/**
 * Pistas de lo que falla cuando un JSON no cumple el esquema de Word o Excel del Chat. Módulo PURO (sin efectos al importarlo): lo usan
 * las líneas de comandos de las Tareas (`chat-docx-cli.ts`, `chat-xlsx-cli.ts`) y la herramienta `documentos` de la app. NO importar
 * desde esas líneas de comandos dentro de la app: al estar empaquetadas en el mismo archivo ejecutarían el CLI al arrancar.
 */
import { isDocxSpec, isXlsxSpec } from '@shared/chat-doc-spec'

/** Primer bloque inválido (el esquema es estricto: claves desconocidas, textos largos, filas de otro largo…). */
export function explainDocx(v: unknown): string {
  if (!v || typeof v !== 'object') return 'Debe ser un objeto con `blocks`.'
  const d = v as Record<string, unknown>
  const blocks = d.blocks
  if (!Array.isArray(blocks) || blocks.length === 0) return '`blocks` debe ser una lista con al menos un bloque.'
  const bad = blocks.findIndex((b) => !isDocxSpec({ blocks: [b] }))
  if (bad >= 0) {
    const t = (blocks[bad] as { type?: unknown } | null)?.type
    return `El bloque blocks[${bad}] (type ${JSON.stringify(t)}) no es válido: tipos permitidos heading, paragraph, bullets, numbered, table, page_break; sin claves extra; las filas de table con tantas celdas como columns.`
  }
  return 'Revisa los campos del documento (solo title, subtitle, author, date, header, footer, page_numbers, toc, blocks; textos de hasta 200 caracteres en esos campos).'
}

/** Primera hoja inválida (el Chat valida cada hoja: filas, formatos de columna, gráficos con rango A1). */
export function explainXlsx(v: unknown): string {
  if (!v || typeof v !== 'object') return 'Debe ser un objeto con `sheets`.'
  const sheets = (v as Record<string, unknown>).sheets
  if (!Array.isArray(sheets) || sheets.length === 0) return '`sheets` debe ser una lista con al menos una hoja (hasta 10).'
  const bad = sheets.findIndex((s) => !isXlsxSpec({ sheets: [s] }))
  if (bad >= 0)
    return `La hoja sheets[${bad}] no es válida: necesita name (texto) y rows (hasta 5000 filas de hasta 60 celdas: texto, número, null o {"formula":"SUM(B2:B5)","value":123}); columnFormats solo con currency, integer, decimal, percent o null; charts hasta 4, con type column/bar/line/pie/area, range tipo "A1:C7" y, opcionales, title, at, width y height (120 a 1200).`
  return 'Revisa que haya entre 1 y 10 hojas.'
}
