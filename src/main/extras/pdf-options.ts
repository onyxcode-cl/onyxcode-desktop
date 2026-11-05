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
