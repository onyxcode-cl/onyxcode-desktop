/**
 * Sistema de diseño de `render-pptx.ts`: paleta de 14 tonos por tema (no 1 solo acento), tipografía y
 * funciones puras de ajuste de texto/contraste. Separado del renderer para poder probarlo sin generar
 * ningún `.pptx` (los 14 tonos, el contraste de cada par texto/fondo, el ajuste de tamaño de letra).
 *
 * Basado en una investigación a fondo (no en prueba-y-error contra la app en vivo, por pedido
 * explícito del dueño tras varias rondas reactivas): se leyó entera la skill oficial `pptx` de
 * Anthropic (sus reglas de diseño, NUNCA su código — tiene licencia propietaria que prohíbe copiarlo,
 * y esta app se va a publicar) y se analizó byte a byte un `.pptx` de referencia real que generó Chat
 * con el modelo Haiku. Los 14 tonos de cada tema están relacionados con los 5 temas que ya existían
 * (mismo acento base), no son una paleta nueva de cero.
 */
import type { PptxStyle, PptxTheme } from '@shared/chat-doc-spec'

export interface Palette {
  /** Fondo de portada y cierre. */
  primary: string
  /** Fondo de separador de sección y de la cifra destacada. */
  primary2: string
  /** Fondo de las diapositivas de contenido. */
  bg: string
  /** Tarjetas y paneles. */
  surface: string
  /** Líneas finas (bordes de tarjeta, conectores). */
  border: string
  /** Títulos (sobre `bg`/`surface`). */
  ink: string
  /** Texto de cuerpo (sobre `bg`/`surface`). */
  body: string
  /** Pie de página y notas (sobre `bg`/`surface`). */
  muted: string
  /** Etiquetas, marcadores, destacados (sobre `bg`/`surface`). */
  accent: string
  /** Etiquetas sobre fondos oscuros (`primary`/`primary2`). */
  accentOnDark: string
  /** Texto principal sobre `primary`/`primary2`. */
  onDark: string
  /** Texto secundario sobre `primary`/`primary2`. */
  onDarkBody: string
  /** Pie sobre `primary` — OJO: nunca usar sobre `primary2`, ahí el contraste no alcanza. */
  onDarkMuted: string
  /** 5 tonos para series/puntos de gráfico. */
  chart: [string, string, string, string, string]
  /** El punto/barra que se quiere destacar en un gráfico de un solo valor fuerte. */
  chartHi: string
  /** El resto de los puntos/barras de ese mismo gráfico. */
  chartSoft: string
  /** Tipografía de TÍTULOS — el cuerpo siempre va en `FONT` (Arial), ver `render-pptx.ts`. */
  headFont: string
  /** Si los títulos de este tema van en negrita (los temas serif quedan mejor sin negrita, como la referencia). */
  titleBold: boolean
}

export const THEMES: Record<PptxTheme, Palette> = {
  blue: {
    primary: '1E2761',
    primary2: '2D4A9A',
    bg: 'FFFFFF',
    surface: 'EEF2FA',
    border: 'D9E0EE',
    ink: '1E2761',
    body: '4A5468',
    muted: '6B7488',
    accent: '2D4A9A',
    accentOnDark: 'CADCFC',
    onDark: 'FFFFFF',
    onDarkBody: 'CADCFC',
    onDarkMuted: '97A6CF',
    chart: ['1E2761', '2D4A9A', '5B7BC9', '97B0E3', 'CADCFC'],
    chartHi: '2D4A9A',
    chartSoft: '97B0E3',
    headFont: 'Georgia',
    titleBold: false
  },
  green: {
    primary: '173A2C',
    primary2: '1F6D4C',
    bg: 'FFFFFF',
    surface: 'EDF4EF',
    border: 'D5E3D9',
    ink: '173A2C',
    body: '4A5A50',
    muted: '6A786F',
    accent: '1F6D4C',
    accentOnDark: 'A8D5B9',
    onDark: 'FFFFFF',
    onDarkBody: 'CFE6D7',
    onDarkMuted: '9DBFA9',
    chart: ['173A2C', '1F6D4C', '4E9A6F', '97BC62', 'C9DFB4'],
    chartHi: '1F6D4C',
    chartSoft: 'A9CDB6',
    headFont: 'Georgia',
    titleBold: false
  },
  dark: {
    primary: '0E1014',
    primary2: '1E2A44',
    bg: '15171C',
    surface: '1F232B',
    border: '2C313B',
    ink: 'F2F4F8',
    body: 'B8C0CC',
    muted: '8A93A2',
    accent: '8FB8FF',
    accentOnDark: '8FB8FF',
    onDark: 'F2F4F8',
    onDarkBody: 'C9D3E3',
    onDarkMuted: '8A93A2',
    chart: ['8FB8FF', '5C86D6', '3D5A99', 'C9DBFF', '2C3E66'],
    chartHi: '8FB8FF',
    chartSoft: '3D5A99',
    headFont: 'Arial',
    titleBold: true
  },
  warm: {
    primary: '5A2318',
    primary2: 'A63A27',
    bg: 'FFFFFF',
    surface: 'FBF1EA',
    border: 'EEDCD0',
    ink: '2B1E14',
    body: '5A4A40',
    muted: '7D6B60',
    accent: 'B8432F',
    accentOnDark: 'F6B8A8',
    onDark: 'FFFFFF',
    onDarkBody: 'FBE8E1',
    onDarkMuted: 'D9A99A',
    chart: ['A63A27', 'E25C4C', 'F2A28F', '5A2318', 'F6D2C4'],
    chartHi: 'E25C4C',
    chartSoft: 'F2C1B4',
    headFont: 'Georgia',
    titleBold: false
  },
  mono: {
    primary: '1A1A1A',
    primary2: '3A3A3A',
    bg: 'FFFFFF',
    surface: 'F2F2F2',
    border: 'DDDDDD',
    ink: '1A1A1A',
    body: '4D4D4D',
    muted: '707070',
    accent: '3A3A3A',
    accentOnDark: 'BDBDBD',
    onDark: 'FFFFFF',
    onDarkBody: 'D6D6D6',
    onDarkMuted: 'A3A3A3',
    chart: ['1A1A1A', '4D4D4D', '808080', 'B3B3B3', 'D9D9D9'],
    chartHi: '1A1A1A',
    chartSoft: 'BDBDBD',
    headFont: 'Arial',
    titleBold: true
  }
}

/**
 * Eje de ESTILO (forma/decoración/tipografía), independiente de `THEMES` (que es solo color) — por
 * qué existe este archivo aparte, ver `render-pptx.ts` (F8-B134): el dueño pidió variedad visual de
 * verdad ("cambiame la estética total") y hasta ahora solo había un tema de color, nunca forma.
 */
export interface StyleParams {
  /** Decoración de las diapositivas a toda página (cover/section/stat/closing). */
  bleedShape: 'circle' | 'diagonal' | 'rule' | 'none'
  /** Radio de esquina de tarjetas (cards/kpis), 0 a 1 — ver `rectRadius` de pptxgenjs. */
  cardRadius: number
  /** Si las tarjetas llevan borde fino visible. */
  cardBorder: boolean
  /** Si las tarjetas llevan relleno de color (`surface`) — sin esto, transparentes. */
  cardFill: boolean
  /** Alineación del título en diapositivas de contenido. */
  titleAlign: 'left' | 'center'
  /** Línea fina bajo la etiqueta/eyebrow de diapositivas de contenido y de sección/cifra. */
  ruleUnderEyebrow: boolean
  /** Forma del número en "steps"/"cards": círculo de acento, o solo el numeral en negrita. */
  numberBadge: 'circle' | 'none'
}

export const STYLES: Record<PptxStyle, StyleParams> = {
  classic: {
    bleedShape: 'circle',
    cardRadius: 0.08,
    cardBorder: true,
    cardFill: true,
    titleAlign: 'left',
    ruleUnderEyebrow: false,
    numberBadge: 'circle'
  },
  editorial: {
    bleedShape: 'rule',
    cardRadius: 0,
    cardBorder: false,
    cardFill: false,
    titleAlign: 'left',
    ruleUnderEyebrow: true,
    numberBadge: 'none'
  },
  geometric: {
    bleedShape: 'diagonal',
    cardRadius: 0.2,
    cardBorder: false,
    cardFill: true,
    titleAlign: 'left',
    ruleUnderEyebrow: false,
    numberBadge: 'circle'
  },
  minimal: {
    bleedShape: 'none',
    cardRadius: 0,
    cardBorder: true,
    cardFill: false,
    titleAlign: 'left',
    ruleUnderEyebrow: false,
    numberBadge: 'none'
  }
}

/** Ancho medio de un carácter, en "em" (fracción del tamaño de letra) — Arial/Georgia, redondo/negrita. Fuente: la propia skill de Anthropic documenta este tipo de estimación para que el texto no se salga de su caja sin tener que medirlo de verdad (no hay DOM/canvas disponible en el proceso main). */
const CHAR_WIDTH_EM: Record<string, number> = { Arial: 0.52, 'Arial-bold': 0.56, Georgia: 0.55, 'Georgia-bold': 0.58 }

function charWidthEm(font: string, bold: boolean): number {
  return CHAR_WIDTH_EM[bold ? `${font}-bold` : font] ?? (bold ? 0.56 : 0.52)
}

/** Ancho estimado (en pulgadas) de `text` a `sizePt`, UNA sola línea — para `fitText`, que lo usa para estimar en cuántas líneas envuelve. */
export function estimateTextWidthIn(text: string, sizePt: number, font: string, bold = false): number {
  return (text.length * charWidthEm(font, bold) * sizePt) / 72
}

/**
 * El tamaño más grande de `sizes` (pt) que entra en `maxWidthIn`×`maxHeightIn` sin desbordar — estimado
 * por ancho de carácter, no medido de verdad (no hay DOM en main). Nunca devuelve un tamaño que no esté
 * en `sizes`: si ni el más chico entra, igual lo devuelve (nunca recorta el texto en silencio, eso lo
 * decide el límite de caracteres del prompt del agente, no este fallback).
 */
export function fitText(
  text: string,
  maxWidthIn: number,
  maxHeightIn: number,
  sizes: number[],
  font: string,
  opts: { bold?: boolean; lineMult?: number } = {}
): number {
  const bold = opts.bold ?? false
  const lineMult = opts.lineMult ?? 1.1
  const sorted = [...sizes].sort((a, b) => b - a)
  for (const size of sorted) {
    const totalWidthIn = estimateTextWidthIn(text, size, font, bold)
    const lines = Math.max(1, Math.ceil(totalWidthIn / maxWidthIn))
    const heightIn = (lines * size * lineMult) / 72
    if (heightIn <= maxHeightIn) return size
  }
  return sorted[sorted.length - 1]
}

/** Si `text` tiene la forma "Etiqueta: resto" (la etiqueta de 40 caracteres o menos), separa ambas partes — para poner la etiqueta en negrita en viñetas/tarjetas/pasos. `null` si no calza. */
export function splitLabel(text: string): { label: string; rest: string } | null {
  const i = text.indexOf(': ')
  if (i < 0 || i > 40) return null
  return { label: text.slice(0, i), rest: text.slice(i + 2) }
}

/** Si `title` es un número con su unidad pegada (p.ej. "+27%", "3.2x", "80 pts"), separa ambos — para que la unidad salga más chica, en la misma línea, sin inventar un divisor. `null` si no calza (el título queda como un solo texto). */
export function splitStatUnit(title: string): { number: string; unit: string } | null {
  const m = /^([+\-−]?[\d.,]+)\s*(%|[A-Za-z]{1,3})$/.exec(title.trim())
  if (!m) return null
  return { number: m[1], unit: m[2] }
}

function srgbToLinear(c: number): number {
  const cs = c / 255
  return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4)
}

function relativeLuminance(hex: string): number {
  const n = hex.replace('#', '')
  const r = parseInt(n.slice(0, 2), 16)
  const g = parseInt(n.slice(2, 4), 16)
  const b = parseInt(n.slice(4, 6), 16)
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}

/** Contraste WCAG entre dos colores (1 a 21) — 4.5 es el mínimo recomendado para texto de cuerpo. */
export function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA)
  const lB = relativeLuminance(hexB)
  const lighter = Math.max(lA, lB)
  const darker = Math.min(lA, lB)
  return (lighter + 0.05) / (darker + 0.05)
}
