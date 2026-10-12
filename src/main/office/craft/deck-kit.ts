/**
 * PRUEBA (rama `exp/craft-office-pruebas`): piezas de dibujo del diseño «dots» para DeckCraft (lienzo 960 × 540 pt), compartidas por la
 * plantilla de la skill (`deck-builder.ts`) y la del Chat (`chat-deck.ts`). Cada función añade comandos `id={json}` a `c`.
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

export function createKit(accent: string = VI) {
  const c: string[] = []
  const a = (id: string, params?: Record<string, unknown>): void => {
    c.push(params ? `${id}=${JSON.stringify(params)}` : id)
  }
  const bgslide = (glows: [number, number, number, string][] = []): void => {
    a('slide.new', { layout: 'blank' })
    a('design.background', { color: '#' + BG })
    for (const [x, y, d, col] of glows) {
      a('shape.insert', { preset: 'ellipse', rect: [x, y, d, d] })
      a('shape.fill', {
        gradient: {
          stops: [
            [0, '#' + col],
            [0.62, '#' + BG],
            [1, '#' + BG]
          ],
          kind: 'radial'
        }
      })
      a('shape.line', { none: true })
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
    a('shape.insert', { preset: 'ellipse', rect: [x, y, d, d] })
    a('shape.fill', { color: '#' + col })
    a('shape.line', { none: true })
  }
  const dotrow = (x: number, y: number, d: number, gap: number): void => DOTS.forEach((col, i) => dot(x + i * (d + gap), y, d, col))
  const txt = (
    x: number,
    y: number,
    w: number,
    h: number,
    t: string,
    size: number,
    color = WH,
    bold = false,
    align = 'left',
    spacing?: number
  ): void => {
    a('insert.textBox', { rect: [x, y, w, h], text: t })
    a('format.size', { size })
    a('format.color', { color: '#' + color })
    a('format.bold', { on: bold })
    a('format.align', { align })
    if (spacing !== undefined) a('format.spacing', { pt: spacing })
  }
  const pill = (x: number, y: number, w: number, h: number, t: string, size: number, fill?: string): void => {
    a('shape.insert', { preset: 'roundRect', rect: [x, y, w, h], text: t })
    if (fill) a('shape.fill', { color: '#' + fill })
    else a('shape.fill', { none: true })
    a('shape.line', { color: '#' + accent, width: 1.5 })
    a('format.size', { size })
    a('format.color', { color: '#' + WH })
    a('format.bold', { on: true })
    a('format.align', { align: 'center' })
    a('format.anchor', { anchor: 'middle' })
  }
  const header = (n: number, title: string, kicker: string | undefined): void => {
    bgslide([[680, -250, 500, GLOW]])
    if (kicker) txt(60, 34, 600, 24, kicker.toUpperCase(), 13, accent, true, 'left', 3)
    txt(60, 62, 840, 64, title, fitSize(title, 40, 36), WH, true, 'left', -1)
    dotrow(60, 506, 8, 6)
    txt(820, 500, 80, 24, String(n).padStart(2, '0'), 13, MU, false, 'right')
  }

  return { c, a, bgslide, rect, ring, dot, dotrow, txt, pill, header }
}
