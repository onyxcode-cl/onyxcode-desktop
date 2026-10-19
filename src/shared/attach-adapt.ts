/**
 * Cómo viaja un PDF según lo que el modelo elegido sabe leer (lo declara el catálogo: `capabilities.input`).
 * Lógica pura: la usan el compositor del Chat (renderer) y, a futuro, el puente con Telegram.
 *
 *  - `direct`: el modelo acepta PDF → se envía el PDF tal cual (ve el diseño, las tablas, las figuras).
 *  - `images`: no acepta PDF pero sí imágenes → se envían las páginas como imágenes.
 *  - `text`: solo texto → se envía el texto extraído (se pierde el diseño; el PDF escaneado no se puede leer).
 */
export interface InputCapabilities {
  text?: boolean
  image?: boolean
  pdf?: boolean
}

export type PdfRoute = 'direct' | 'images' | 'text'

/** `null` = no se sabe qué lee el modelo (no encontrado en el catálogo): se envía como siempre, sin transformar. */
export function pdfRoute(caps: InputCapabilities | null | undefined): PdfRoute | null {
  if (!caps) return null
  if (caps.pdf) return 'direct'
  if (caps.image) return 'images'
  return 'text'
}

/** Tope de páginas que se convierten a imagen (cada una pesa y gasta contexto del modelo). */
export const PDF_IMAGE_MAX_PAGES = 20
/** Lado mayor (px) de cada página convertida: legible sin salirse del tope de tamaño de imagen. */
export const PDF_IMAGE_MAX_SIDE = 1600
/** Tope de caracteres del texto extraído de un PDF para un modelo que solo lee texto. */
export const PDF_TEXT_MAX_CHARS = 200_000

/** Nombre de la página `n` de un PDF convertido a imágenes: «informe.pdf» → «informe-p3.jpg». */
export function pageImageName(pdfName: string, n: number): string {
  return `${pdfName.replace(/\.pdf$/i, '') || 'documento'}-p${n}.jpg`
}
