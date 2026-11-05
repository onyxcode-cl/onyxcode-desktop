/**
 * Opciones de impresión del PDF (Electron `printToPDF`). `generateTaggedPDF` y `generateDocumentOutline` (PDF etiquetado y con marcadores)
 * son EXPERIMENTALES en Electron: van tras un interruptor (`LAZUNOX_PDF_TAGGED=0` los apaga) y, si la impresión con ellas falla, el
 * llamador reintenta con `basePdfOptions` (sin ellas), de modo que nunca se pierde el PDF.
 */
export const basePdfOptions = { printBackground: true, pageSize: 'A4', preferCSSPageSize: true } as const

export function pdfPrintOptions(env: Record<string, string | undefined> = process.env): typeof basePdfOptions & {
  generateTaggedPDF?: boolean
  generateDocumentOutline?: boolean
} {
  if (env.LAZUNOX_PDF_TAGGED === '0') return { ...basePdfOptions }
  return { ...basePdfOptions, generateTaggedPDF: true, generateDocumentOutline: true }
}

/** Páginas de un PDF de Chromium (nodo `/Type /Pages` con su `/Count`); 0 si no se puede leer. */
export function pdfPageCount(pdf: Buffer): number {
  const m = /\/Type\s*\/Pages\s*\/Count\s+(\d+)/.exec(pdf.toString('latin1'))
  return m ? Number(m[1]) : 0
}

/** Escalas que se prueban, de la más suave a la más chica, cuando la última página queda casi vacía. El piso (0,9) mantiene legible la letra. */
export const PDF_SHRINK_SCALES = [0.95, 0.92, 0.9] as const
/** Solo un PDF de 2 páginas se prueba: si baja a 1, la última ya no existe. En 3 o más, bajar una página puede dejar la nueva última casi vacía (medido en el set dorado). */
export const PDF_SHRINK_MAX_PAGES = 2
export const PDF_MIN_FONT_PT = 6.75 // 9 px: la guía pide 10 px al escribir; al achicar un 5-10 % se tolera hasta 9 px

/**
 * Imprime y, si salen exactamente 2 páginas, prueba escalas suaves: se queda con la primera que baja el número de páginas (señal de que la
 * última tenía muy poco) y NUNCA con una que no lo baje, de modo que un documento bien lleno no se achica en vano.
 */
export async function printWithoutOrphanPage(print: (scale: number) => Promise<Buffer>, minFontPt: number | null = null): Promise<Buffer> {
  const first = await print(1)
  const pages = pdfPageCount(first)
  if (pages < 2 || pages > PDF_SHRINK_MAX_PAGES) return first
  for (const scale of PDF_SHRINK_SCALES) {
    // Nunca se achica hasta dejar la letra más chica del documento por debajo de 9 px (6,75 pt).
    if (minFontPt !== null && minFontPt * scale < PDF_MIN_FONT_PT) break
    try {
      const smaller = await print(scale)
      const n = pdfPageCount(smaller)
      if (n > 0 && n < pages) return smaller
    } catch {
      return first
    }
  }
  return first
}

/** Tamaños de letra (en puntos) declarados en el HTML: px × 0,75; rem/em se cuentan sobre 12 pt. */
export function htmlFontSizesPt(html: string): number[] {
  const out: number[] = []
  for (const m of html.matchAll(/font-size\s*:\s*([0-9]*\.?[0-9]+)\s*(px|pt|rem|em)\b/gi)) {
    const n = Number(m[1])
    const u = m[2].toLowerCase()
    out.push(u === 'pt' ? n : u === 'px' ? n * 0.75 : n * 12)
  }
  return out
}
