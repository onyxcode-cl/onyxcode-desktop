/**
 * Pistas de lo que falla cuando un JSON no cumple el esquema de Word o Excel del Chat. Módulo PURO (sin efectos al importarlo): lo usan
 * las líneas de comandos de las Tareas (`chat-docx-cli.ts`, `chat-xlsx-cli.ts`) y la herramienta `documentos` de la app. NO importar
 * desde esas líneas de comandos dentro de la app: al estar empaquetadas en el mismo archivo ejecutarían el CLI al arrancar.
 */
import { isDocxSpec, isPptxSpec, isXlsxSpec, PPTX_LAYOUTS, MAX_SLIDES, MAX_BULLETS_PER_SLIDE, MAX_TITLE_CHARS } from '@shared/chat-doc-spec'

/** Primer bloque inválido (el esquema es estricto: claves desconocidas, textos largos, filas de otro largo…). */
export function explainDocx(v: unknown): string {
  if (!v || typeof v !== 'object') return 'Debe ser un objeto con `blocks`. Ejemplo: {"blocks":[{"type":"paragraph","text":"Hola"}]}.'
  const d = v as Record<string, unknown>
  const blocks = d.blocks
  if (!Array.isArray(blocks) || blocks.length === 0)
    return '`blocks` debe ser una lista con al menos un bloque (no un objeto ni un texto). Ejemplo: {"blocks":[{"type":"heading","text":"Título"},{"type":"paragraph","text":"Texto"}]}.'
  const bad = blocks.findIndex((b) => !isDocxSpec({ blocks: [b] }))
  if (bad >= 0) {
    const t = (blocks[bad] as { type?: unknown } | null)?.type
    const tb = blocks[bad] as { columns?: unknown; rows?: unknown } | null
    if (t === 'table' && tb && Array.isArray(tb.columns) && Array.isArray(tb.rows)) {
      const r = tb.rows.findIndex((row) => !Array.isArray(row) || row.length !== (tb.columns as unknown[]).length)
      if (r >= 0)
        return `En blocks[${bad}] (table) la fila rows[${r}] no tiene ${tb.columns.length} celdas, como columns: cada fila debe ser una lista con tantas celdas como columns. Ejemplo: {"type":"table","columns":["A","B"],"rows":[["1","2"]]}.`
    }
    return `El bloque blocks[${bad}] (type ${JSON.stringify(t)}) no es válido: tipos permitidos heading, paragraph, bullets, numbered, table, page_break; sin claves extra; las filas de table con tantas celdas como columns.`
  }
  return 'Revisa los campos del documento (solo title, subtitle, author, date, header, footer, page_numbers, toc, blocks; textos de hasta 200 caracteres en esos campos).'
}

/** Primera hoja inválida (el Chat valida cada hoja: filas, formatos de columna, gráficos con rango A1). */
export function explainXlsx(v: unknown): string {
  if (!v || typeof v !== 'object') return 'Debe ser un objeto con `sheets`. Ejemplo: {"sheets":[{"name":"Hoja","rows":[["Nombre","Total"],["A",10]]}]}.'
  const sheets = (v as Record<string, unknown>).sheets
  if (!Array.isArray(sheets) || sheets.length === 0)
    return '`sheets` debe ser una lista con al menos una hoja (hasta 10), no un objeto ni un texto. Ejemplo: {"sheets":[{"name":"Hoja","rows":[["Nombre","Total"],["A",10]]}]}.'
  const bad = sheets.findIndex((s) => !isXlsxSpec({ sheets: [s] }))
  if (bad >= 0)
    return `La hoja sheets[${bad}] no es válida: necesita name (texto) y rows (hasta 5000 filas de hasta 60 celdas: texto, número, null o {"formula":"SUM(B2:B5)","value":123}); columnFormats solo con currency, integer, decimal, percent o null; charts hasta 4, con type column/bar/line/pie/area, range tipo "A1:C7" y, opcionales, title, at, width y height (120 a 1200).`
  return 'Revisa que haya entre 1 y 10 hojas.'
}

/** Primera lámina inválida y el campo que falla (el que, al quitarlo, deja la lámina válida). */
export function explainPptx(v: unknown): string {
  if (!v || typeof v !== 'object') return 'Debe ser un objeto con `slides`. Ejemplo: {"slides":[{"layout":"cover","title":"Título"}]}.'
  const spec = v as Record<string, unknown>
  const slides = spec.slides
  if (!Array.isArray(slides) || slides.length === 0) return `\`slides\` debe ser una lista con al menos una lámina (hasta ${MAX_SLIDES}), no un objeto ni un texto. Ejemplo: {"slides":[{"layout":"cover","title":"Título"}]}.`
  for (const key of ['theme', 'style', 'footer', 'transition', 'palette', 'fonts'])
    if (spec[key] !== undefined && !isPptxSpec({ slides: [{ title: 'x' }], [key]: spec[key] })) return `El campo \`${key}\` del documento no es válido.`
  const bad = slides.findIndex((sl) => !isPptxSpec({ slides: [sl] }))
  if (bad < 0) return `Revisa que haya como mucho ${MAX_SLIDES} láminas y pocas imágenes.`
  const sl = slides[bad] as Record<string, unknown> | null
  if (!sl || typeof sl !== 'object') return `slides[${bad}] debe ser un objeto.`
  const fields = Object.keys(sl).filter((k) => isPptxSpec({ slides: [Object.fromEntries(Object.entries(sl).filter(([n]) => n !== k))] }))
  if (fields.length)
    return `La lámina slides[${bad}] tiene un campo inválido: ${fields.map((f) => `\`${f}\``).join(', ')}. Layouts permitidos: ${PPTX_LAYOUTS.join(', ')}; título hasta ${MAX_TITLE_CHARS} caracteres; hasta ${MAX_BULLETS_PER_SLIDE} viñetas; sin claves que no estén en la skill pptx (la tabla va en \`table: {columns, rows}\` con el mismo número de celdas por fila).`
  return `La lámina slides[${bad}] no es válida (layout ${JSON.stringify(sl.layout)}): revisa los campos que exige ese layout (image necesita image; free necesita elements).`
}
