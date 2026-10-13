/**
 * PRUEBA (rama `exp/craft-office-pruebas`): piezas de dibujo para DeckCraft (lienzo 960 × 540 pt), compartidas por la plantilla de la skill
 * (`deck-builder.ts`, siempre el diseño oscuro «dots») y la del Chat (`chat-deck.ts`, que además cambia de paleta según `theme` y de
 * decoración según `style`, como ya lo pide el agente de Chat). Cada función añade comandos `id={json}` a `c`.
 */
/** Tamaño de letra que cabe: reduce `base` en proporción al largo cuando el texto pasa de `fits` caracteres (mínimo 55 % de `base`). */
export function fitSize(text: string, base: number, fits: number): number {
  if (text.length <= fits) return base
  return Math.max(Math.round(base * 0.55), Math.floor((base * fits) / text.length))
}

export const BG = '07070C'
export const EDGE = '25253A'
export const VI = '8B5CF6'
export const VIL = 'C4B5FD'
export const WH = 'F5F5FA'
export const MU = 'A1A1B5'
export const GLOW = '1F1640'
export const BLUEG = '0F1A3A'
export const DOTS = ['3B82F6', '22C55E', 'F59E0B', 'EC4899', '8B5CF6']

/** Colores de una presentación. Los fondos claros usan texto oscuro; los brillos son muy suaves para no ensuciar el texto. */
export interface Palette {
  bg: string
  text: string
  muted: string
  accent: string
  /** Acento más suave (etiquetas y segundo plano de énfasis). */
  accent2: string
  panel: string
  edge: string
  glow: string
  glow2: string
  /** Colores de las viñetas, pasos y tarjetas (se reparten en orden). */
  marks: string[]
  dark: boolean
}
export type Look = 'classic' | 'editorial' | 'geometric' | 'minimal'

export const DARK: Palette = {
  bg: BG,
  text: WH,
  muted: MU,
  accent: VI,
  accent2: VIL,
  panel: '12121B',
  edge: EDGE,
  glow: GLOW,
  glow2: BLUEG,
  marks: DOTS,
  dark: true
}

const PALETTES: Record<string, Palette> = {
  dark: DARK,
  blue: {
    bg: 'F6F9FE',
    text: '0F172A',
    muted: '5B6B84',
    accent: '2563EB',
    accent2: '1D4ED8',
    panel: 'FFFFFF',
    edge: 'D9E2F1',
    glow: 'DCE8FF',
    glow2: 'E8F0FF',
    marks: ['2563EB', '0EA5E9', '6366F1', '0891B2', '3B82F6'],
    dark: false
  },
  green: {
    bg: 'F4FAF6',
    text: '10281C',
    muted: '5A7566',
    accent: '15803D',
    accent2: '166534',
    panel: 'FFFFFF',
    edge: 'D3E6DA',
    glow: 'D9F2E2',
    glow2: 'E6F7EC',
    marks: ['16A34A', '0D9488', '65A30D', '059669', '22C55E'],
    dark: false
  },
  warm: {
    bg: 'FFF8F0',
    text: '3B2417',
    muted: '8A6A55',
    accent: 'D9480F',
    accent2: 'B93A0A',
    panel: 'FFFFFF',
    edge: 'F0DDCB',
    glow: 'FFE3C8',
    glow2: 'FFEBD9',
    marks: ['D9480F', 'F59E0B', 'B45309', 'DC2626', 'EA580C'],
    dark: false
  },
  mono: {
    bg: 'FFFFFF',
    text: '111111',
    muted: '6B7280',
    accent: '111111',
    accent2: '374151',
    panel: 'F5F5F5',
    edge: 'E2E2E2',
    glow: 'EEEEEE',
    glow2: 'F4F4F4',
    marks: ['111111', '4B5563', '6B7280', '9CA3AF', '374151'],
    dark: false
  }
}

const rgb = (h: string): [number, number, number] => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
const toHex = (c: [number, number, number]): string =>
  c
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')
    .toUpperCase()
/** Mezcla `a` con `b` (t = 0 → a, t = 1 → b). Colores en hex de 6 dígitos sin `#`. */
export function mix(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)]
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t])
}
const luminance = (h: string): number => {
  const [r, g, b] = rgb(h)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}
export const stripHash = (h: string): string => h.replace(/^#/, '').toUpperCase()

/** Paleta propia que inventa la IA (`PptxPalette`, hex con `#`): lo que falte se deriva del fondo, el texto y el acento. */
export function customPalette(p: {
  bg: string
  text: string
  accent: string
  muted?: string
  accent2?: string
  panel?: string
  edge?: string
}): Palette {
  const bg = stripHash(p.bg)
  const text = stripHash(p.text)
  const accent = stripHash(p.accent)
  const dark = luminance(bg) < 0.45
  const muted = p.muted ? stripHash(p.muted) : mix(text, bg, 0.42)
  const accent2 = p.accent2 ? stripHash(p.accent2) : mix(accent, text, 0.25)
  return {
    bg,
    text,
    muted,
    accent,
    accent2,
    panel: p.panel ? stripHash(p.panel) : mix(bg, text, dark ? 0.07 : 0.035),
    edge: p.edge ? stripHash(p.edge) : mix(bg, text, 0.16),
    glow: mix(bg, accent, dark ? 0.28 : 0.16),
    glow2: mix(bg, accent2, dark ? 0.16 : 0.08),
    marks: [accent, accent2, mix(accent, text, 0.4), mix(accent, bg, 0.4), muted],
    dark
  }
}

export function paletteFor(theme: string | undefined): Palette {
  return PALETTES[theme ?? 'blue'] ?? PALETTES.blue
}

/**
 * `pal`/`look` por defecto = el diseño oscuro «dots» de siempre (los comandos que genera NO cambian: una prueba exige que sean los mismos
 * que los del script de Python de la skill). `accent` solo lo usa la skill para teñir las etiquetas.
 */
/**
 * Tamaño que cabe en una caja de `w × h` pt: estima las líneas con el ancho medio de Arial (0,5 × tamaño; 0,55 en negrita) y baja de a 1 pt
 * hasta que el alto estimado entra, sin pasar del 55 % del tamaño pedido. DeckCraft no mide ni autoajusta, y así un texto largo no se sale de la caja.
 */
export function autoFitSize(text: string, size: number, w: number, h: number, bold: boolean): number {
  const inner = Math.max(20, w - 14)
  const floor = Math.max(8, Math.round(size * 0.55))
  const cw = bold ? 0.55 : 0.5
  const lines = (sz: number): number => text.split('\n').reduce((n, ln) => n + Math.max(1, Math.ceil((ln.length * sz * cw) / inner)), 0)
  let sz = size
  while (sz > floor && lines(sz) * sz * 1.2 > h - 4) sz -= 1
  return sz
}

/** `autoFit` (solo el Chat): cada caja de texto se achica si su contenido no cabe; la plantilla de la skill (`deck-builder`) no lo usa para mantener la paridad con su script de Python. */
export function createKit(
  pal: Palette = DARK,
  look: Look = 'classic',
  accent: string = pal.accent,
  titleFontOverride?: string,
  autoFit = false
) {
  const c: string[] = []
  const a = (id: string, params?: Record<string, unknown>): void => {
    c.push(params ? `${id}=${JSON.stringify(params)}` : id)
  }
  /** Tipografía de títulos: el estilo editorial usa serif (Georgia existe en macOS y Windows). */
  const titleFont = titleFontOverride ?? (look === 'editorial' ? 'Georgia' : undefined)
  /** Fondo de la diapositiva en curso, si la IA pidió uno distinto al de la paleta (sin `#`). */
  let bgOverride: string | undefined
  const setBg = (c: string | undefined): void => {
    bgOverride = c
  }
  const bgslide = (glows: [number, number, number, string][] = []): void => {
    a('slide.new', { layout: 'blank' })
    const bgc = bgOverride ?? pal.bg
    a('design.background', { color: '#' + bgc })
    // Los estilos editorial y minimal no llevan brillos: la página queda limpia.
    if (look === 'editorial' || look === 'minimal') return
    for (const [x, y, d, col] of glows) {
      a('shape.insert', { preset: 'ellipse', rect: [x, y, d, d] })
      a('shape.fill', {
        gradient: {
          stops: [
            [0, '#' + col],
            [0.62, '#' + bgc],
            [1, '#' + bgc]
          ],
          kind: 'radial'
        }
      })
      a('shape.line', { none: true })
    }
    if (look === 'geometric') {
      // Barra diagonal de acento, muy suave, en la esquina superior derecha.
      a('shape.insert', { preset: 'rect', rect: [700, -120, 140, 760] })
      a('shape.fill', { color: '#' + pal.accent, transparency: pal.dark ? 0.86 : 0.9 })
      a('shape.line', { none: true })
      a('shape.rotate', { deg: 24 })
    }
  }
  const rect = (x: number, y: number, w: number, h: number, col: string): void => {
    a('shape.insert', { preset: 'rect', rect: [x, y, w, h] })
    a('shape.fill', { color: '#' + col })
    a('shape.line', { none: true })
  }
  const ring = (x: number, y: number, d: number, col: string): void => {
    a('shape.insert', { preset: 'ellipse', rect: [x, y, d, d] })
    a('shape.fill', { none: true })
    a('shape.line', { color: '#' + col, width: 2 })
  }
  const dot = (x: number, y: number, d: number, col: string): void => {
    a('shape.insert', { preset: look === 'minimal' || look === 'editorial' ? 'rect' : 'ellipse', rect: [x, y, d, d] })
    a('shape.fill', { color: '#' + col })
    a('shape.line', { none: true })
  }
  const dotrow = (x: number, y: number, d: number, gap: number): void => {
    // Editorial y minimal: una línea fina de acento en vez de los cinco puntos.
    if (look === 'editorial' || look === 'minimal') return rect(x, y + d / 2 - 1, d * 3 + gap * 2, 2, pal.accent)
    pal.marks.forEach((col, i) => dot(x + i * (d + gap), y, d, col))
  }
  const txt = (
    x: number,
    y: number,
    w: number,
    h: number,
    t: string,
    size: number,
    color = pal.text,
    bold = false,
    align = 'left',
    spacing?: number,
    font?: string
  ): void => {
    a('insert.textBox', { rect: [x, y, w, h], text: t })
    a('format.size', { size: autoFit ? autoFitSize(t, size, w, h, bold) : size })
    a('format.color', { color: '#' + color })
    a('format.bold', { on: bold })
    a('format.align', { align })
    if (spacing !== undefined) a('format.spacing', { pt: spacing })
    if (font) a('format.font', { family: font })
  }
  const pill = (x: number, y: number, w: number, h: number, t: string, size: number, fill?: string): void => {
    a('shape.insert', { preset: look === 'editorial' || look === 'minimal' ? 'rect' : 'roundRect', rect: [x, y, w, h], text: t })
    if (fill) a('shape.fill', { color: '#' + fill })
    else a('shape.fill', { none: true })
    a('shape.line', { color: '#' + accent, width: 1.5 })
    a('format.size', { size })
    a('format.color', { color: '#' + pal.text })
    a('format.bold', { on: true })
    a('format.align', { align: 'center' })
    a('format.anchor', { anchor: 'middle' })
  }
  /** Tarjeta/panel: relleno según el estilo (clásico y geométrico con relleno; editorial y minimal solo con borde fino). */
  const panel = (x: number, y: number, w: number, h: number): void => {
    a('shape.insert', { preset: look === 'geometric' ? 'roundRect' : 'rect', rect: [x, y, w, h] })
    if (look === 'editorial' || look === 'minimal') a('shape.fill', { none: true })
    else a('shape.fill', { color: '#' + pal.panel })
    a('shape.line', { color: '#' + pal.edge, width: 1 })
  }
  const header = (n: number, title: string, kicker: string | undefined): void => {
    bgslide([[680, -250, 500, pal.glow]])
    if (kicker) txt(60, 34, 600, 24, kicker.toUpperCase(), 13, accent, true, 'left', 3)
    txt(60, 62, 840, 64, title, fitSize(title, 40, 36), pal.text, true, 'left', -1, titleFont)
    dotrow(60, 506, 8, 6)
    txt(820, 500, 80, 24, String(n).padStart(2, '0'), 13, pal.muted, false, 'right')
  }
  return { c, a, bgslide, rect, ring, dot, dotrow, txt, pill, panel, header, titleFont, setBg }
}
