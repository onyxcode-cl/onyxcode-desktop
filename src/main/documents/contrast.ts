/**
 * Contraste de color según WCAG 2.2 (criterio 1.4.3): 4,5 a 1 para el texto normal y 3 a 1 para el texto grande (desde 18 pt, o 14 pt en
 * negrita). Solo colores hex de 6 dígitos con valor conocido: lo que no se puede saber (colores de tema, degradados, imágenes) no se juzga.
 */

export const MIN_CONTRAST_NORMAL = 4.5
export const MIN_CONTRAST_LARGE = 3

/** `RRGGBB` (con o sin `#`) → [r, g, b] de 0 a 255, o `null` si no es un hex de 6 dígitos. */
export function parseHex(hex: string | undefined | null): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function channel(v: number): number {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

/** Luminancia relativa de WCAG (0 negro, 1 blanco). */
export function luminance(rgb: [number, number, number]): number {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])
}

/** Razón de contraste entre dos colores hex (1 a 21), o `null` si alguno no se conoce. */
export function contrastRatio(fg: string | undefined | null, bg: string | undefined | null): number | null {
  const a = parseHex(fg)
  const b = parseHex(bg)
  if (!a || !b) return null
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** ¿Es «texto grande» para WCAG? `sizePt` en puntos. */
export function isLargeText(sizePt: number | null, bold: boolean): boolean {
  if (sizePt == null) return false
  return sizePt >= 18 || (bold && sizePt >= 14)
}

/** Razón mínima exigida para ese texto. */
export function requiredContrast(sizePt: number | null, bold: boolean): number {
  return isLargeText(sizePt, bold) ? MIN_CONTRAST_LARGE : MIN_CONTRAST_NORMAL
}
