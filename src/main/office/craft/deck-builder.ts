/**
 * PRUEBA (rama `exp/craft-office-pruebas`, no integrada): convierte el CONTENIDO de una presentación (JSON que escribe el modelo) en la
 * lista de comandos de `deckcraft-cli` con un diseño fijo («dots»: fondo casi negro, acento violeta, cinco puntos de colores).
 *
 * Por qué: un modelo que descubre los comandos de la herramienta por su cuenta tarda minutos (346 s medidos) y el diseño es impredecible;
 * con esta plantilla el modelo solo escribe texto y la presentación sale en milésimas de segundo con la misma estética siempre.
 * Ver `docs/GUIA-CRAFT.md`. El lienzo es 960 × 540 pt.
 *
 * Seguridad: el contenido es DATO, nunca se interpreta como comando (cada texto va como valor JSON dentro de un parámetro), no hay rutas
 * ni formatos de archivo en el JSON del modelo y todo texto tiene tope de largo.
 */

export type DeckSlide =
  | { type: 'cover'; title: string; subtitle?: string; note?: string; badge?: string }
  | { type: 'stat'; kicker?: string; title: string; stat: string; statLabel: string; items: DeckItem[] }
  | { type: 'timeline'; kicker?: string; title: string; items: DeckItem[]; callout?: string }
  | { type: 'grid'; kicker?: string; title: string; items: DeckItem[]; footnote?: string }
  | { type: 'steps'; kicker?: string; title: string; items: { title: string }[] }
  | { type: 'compare'; kicker?: string; title: string; left: DeckPanel; right: DeckPanel }
  | { type: 'rows'; kicker?: string; title: string; rows: { label: string; value: string; note?: string }[] }
  | { type: 'quad'; kicker?: string; title: string; items: DeckItem[] }
  | { type: 'stats'; kicker?: string; title: string; stat: string; statLabel: string; items: { value: string; label: string }[] }
  | { type: 'closing'; title: string; text?: string; sources?: string }

export interface DeckItem {
  title: string
  body?: string
}
export interface DeckPanel {
  label?: string
  text: string
  foot?: string
}
export interface DeckSpec {
  slides: DeckSlide[]
}

export const DECK_LIMITS = { slides: 30, text: 400, short: 80, items: 4 } as const
const KINDS = ['cover', 'stat', 'timeline', 'grid', 'steps', 'compare', 'rows', 'quad', 'stats', 'closing'] as const

const BG = '07070C'
const EDGE = '25253A'
const VI = '8B5CF6'
const VIL = 'C4B5FD'
const WH = 'F5F5FA'
const MU = 'A1A1B5'
const GLOW = '1F1640'
const BLUEG = '0F1A3A'
const DOTS = ['3B82F6', '22C55E', 'F59E0B', 'EC4899', '8B5CF6']

/** Tamaño de letra que cabe: reduce `base` en proporción al largo cuando el texto pasa de `fits` caracteres (mínimo 55 % de `base`). */
export function fitSize(text: string, base: number, fits: number): number {
  if (text.length <= fits) return base
  return Math.max(Math.round(base * 0.55), Math.floor((base * fits) / text.length))
}

class SpecError extends Error {}
const bad = (path: string, why: string): never => {
  throw new SpecError(`${path}: ${why}`)
}
function str(v: unknown, path: string, max: number, required = true): string {
  if (v === undefined || v === null || v === '') {
    if (required) bad(path, 'falta el texto')
    return ''
  }
  if (typeof v !== 'string') return bad(path, 'debe ser texto')
  if (v.length > max) return bad(path, `demasiado largo (${v.length} > ${max} caracteres)`)
  return v
}
function items(v: unknown, path: string, min: number, max: number): Record<string, unknown>[] {
  if (!Array.isArray(v)) return bad(path, 'debe ser una lista')
  if (v.length < min || v.length > max) bad(path, `debe tener entre ${min} y ${max} elementos (tiene ${v.length})`)
  return v.map((x, i) => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) bad(`${path}[${i}]`, 'debe ser un objeto')
    return x as Record<string, unknown>
  })
}
function obj(v: unknown, path: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return bad(path, 'debe ser un objeto')
  return v as Record<string, unknown>
}
const itemList = (v: unknown, path: string, min: number, max: number, body = true): DeckItem[] =>
  items(v, path, min, max).map((o, i) => ({
    title: str(o.title, `${path}[${i}].title`, DECK_LIMITS.short),
    body: body ? str(o.body, `${path}[${i}].body`, DECK_LIMITS.text, false) : undefined
  }))

/** Valida el JSON del modelo y devuelve un `DeckSpec` limpio (solo los campos conocidos). Lanza `Error` con la ruta del problema. */
export function validateDeckSpec(input: unknown): DeckSpec {
  const root = obj(input, 'spec')
  const slides = items(root.slides, 'slides', 1, DECK_LIMITS.slides)
  return {
    slides: slides.map((s, i): DeckSlide => {
      const p = `slides[${i}]`
      const type = s.type
      if (typeof type !== 'string' || !(KINDS as readonly string[]).includes(type))
        return bad(`${p}.type`, `debe ser uno de: ${KINDS.join(', ')}`)
      const title = str(s.title, `${p}.title`, DECK_LIMITS.short)
      const kicker = str(s.kicker, `${p}.kicker`, 40, false)
      switch (type) {
        case 'cover':
          return {
            type,
            title,
            subtitle: str(s.subtitle, `${p}.subtitle`, 120, false),
            note: str(s.note, `${p}.note`, 120, false),
            badge: str(s.badge, `${p}.badge`, 40, false)
          }
        case 'stat':
          return {
            type,
            kicker,
            title,
            stat: str(s.stat, `${p}.stat`, 10),
            statLabel: str(s.statLabel, `${p}.statLabel`, 120),
            items: itemList(s.items, `${p}.items`, 2, 2)
          }
        case 'timeline':
          return { type, kicker, title, items: itemList(s.items, `${p}.items`, 3, 3), callout: str(s.callout, `${p}.callout`, 90, false) }
        case 'grid':
          return {
            type,
            kicker,
            title,
            items: itemList(s.items, `${p}.items`, 4, 4),
            footnote: str(s.footnote, `${p}.footnote`, 120, false)
          }
        case 'steps':
          return { type, kicker, title, items: itemList(s.items, `${p}.items`, 4, 4, false).map((x) => ({ title: x.title })) }
        case 'compare': {
          const panel = (v: unknown, pp: string): DeckPanel => {
            const o = obj(v, pp)
            return {
              label: str(o.label, `${pp}.label`, 40, false),
              text: str(o.text, `${pp}.text`, 160),
              foot: str(o.foot, `${pp}.foot`, 140, false)
            }
          }
          return { type, kicker, title, left: panel(s.left, `${p}.left`), right: panel(s.right, `${p}.right`) }
        }
        case 'rows':
          return {
            type,
            kicker,
            title,
            rows: items(s.rows, `${p}.rows`, 2, 4).map((o, k) => ({
              label: str(o.label, `${p}.rows[${k}].label`, 60),
              value: str(o.value, `${p}.rows[${k}].value`, 40),
              note: str(o.note, `${p}.rows[${k}].note`, 70, false)
            }))
          }
        case 'quad':
          return { type, kicker, title, items: itemList(s.items, `${p}.items`, 4, 4) }
        case 'stats':
          return {
            type,
            kicker,
            title,
            stat: str(s.stat, `${p}.stat`, 10),
            statLabel: str(s.statLabel, `${p}.statLabel`, 80),
            items: items(s.items, `${p}.items`, 3, 3).map((o, k) => ({
              value: str(o.value, `${p}.items[${k}].value`, 5),
              label: str(o.label, `${p}.items[${k}].label`, 60)
            }))
          }
        default:
          return { type: 'closing', title, text: str(s.text, `${p}.text`, 160, false), sources: str(s.sources, `${p}.sources`, 120, false) }
      }
    })
  }
}

/** Genera los comandos `id={json}` para `deckcraft-cli run --cmd …`. */
export function buildDeckCommands(spec: DeckSpec): string[] {
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
    a('shape.line', { color: '#' + VI, width: 1.5 })
    a('format.size', { size })
    a('format.color', { color: '#' + WH })
    a('format.bold', { on: true })
    a('format.align', { align: 'center' })
    a('format.anchor', { anchor: 'middle' })
  }
  const header = (n: number, title: string, kicker: string | undefined): void => {
    bgslide([[680, -250, 500, GLOW]])
    if (kicker) txt(60, 34, 600, 24, kicker.toUpperCase(), 13, VI, true, 'left', 3)
    txt(60, 62, 840, 64, title, fitSize(title, 40, 36), WH, true, 'left', -1)
    dotrow(60, 506, 8, 6)
    txt(820, 500, 80, 24, String(n).padStart(2, '0'), 13, MU, false, 'right')
  }

  a('file.new')
  spec.slides.forEach((s, idx) => {
    const n = idx + 1
    switch (s.type) {
      case 'cover':
        bgslide([
          [380, -300, 900, '4A2C96'],
          [-220, 300, 560, '14285E']
        ])
        dotrow(60, 88, 34, 20)
        txt(44, 146, 860, 230, s.title, s.title.length > 8 ? 110 : 190, WH, true, 'left', -8)
        if (s.subtitle) txt(64, 384, 760, 50, s.subtitle, 28)
        if (s.note) txt(64, 430, 760, 30, s.note, 18, MU)
        if (s.badge) pill(64, 476, Math.min(420, 40 + s.badge.length * 9), 36, s.badge, 14)
        break
      case 'stat':
        header(n, s.title, s.kicker)
        txt(52, 150, 480, 180, s.stat, fitSize(s.stat, 128, 6), VI, true, 'left', -4)
        txt(64, 344, 380, 70, s.statLabel, 20, MU)
        rect(510, 150, 1, 300, EDGE)
        s.items.forEach((it, i) => {
          const y = 160 + i * 170
          dot(546, y + 12, 16, DOTS[i])
          txt(578, y, 340, 40, it.title, fitSize(it.title, 26, 20), WH, true)
          if (it.body) txt(578, y + 44, 340, 100, it.body, 19, MU)
          if (i === 0) rect(546, y + 150, 354, 1, EDGE)
        })
        break
      case 'timeline':
        header(n, s.title, s.kicker)
        rect(60, 250, 840, 2, EDGE)
        s.items.forEach((it, i) => {
          const x = 60 + i * 300
          const col = DOTS[2 + i]
          ring(x - 9, 241, 38, col)
          dot(x, 250, 20, col)
          txt(x, 206, 240, 30, `0${i + 1}`, 15, col, true, 'left', 2)
          txt(x, 290, 260, 40, it.title, fitSize(it.title, 26, 18), WH, true)
          if (it.body) txt(x, 336, 250, 90, it.body, 18, MU)
        })
        if (s.callout) pill(60, 432, 840, 56, s.callout, 18, '1A1332')
        break
      case 'grid':
        header(n, s.title, s.kicker)
        s.items.forEach((it, i) => {
          const x = 60 + (i % 2) * 440
          const y = 146 + Math.floor(i / 2) * 150
          const col = DOTS[[0, 2, 1, 3][i]]
          rect(x, y, 400, 1, EDGE)
          ring(x, y + 24, 72, col)
          dot(x + 22, y + 46, 28, col)
          txt(x + 102, y + 22, 300, 40, it.title, fitSize(it.title, 28, 17), WH, true)
          if (it.body) txt(x + 102, y + 66, 300, 60, it.body, 19, MU)
        })
        if (s.footnote) txt(60, 448, 840, 34, s.footnote, 18, MU)
        break
      case 'steps':
        header(n, s.title, s.kicker)
        rect(60, 286, 840, 2, EDGE)
        s.items.forEach((it, i) => {
          const x = 60 + i * 220
          txt(x - 4, 160, 200, 100, String(i + 1).padStart(2, '0'), 72, DOTS[i], true, 'left', -2)
          dot(x, 279, 16, DOTS[i])
          txt(x, 326, 200, 30, `Paso ${i + 1}`, 14, MU, true, 'left', 1)
          txt(x, 352, 200, 100, it.title, fitSize(it.title, 24, 26), WH, true)
        })
        break
      case 'compare':
        header(n, s.title, s.kicker)
        if (s.left.label) txt(60, 150, 400, 30, s.left.label.toUpperCase(), 13, MU, true, 'left', 2)
        txt(60, 184, 410, 190, s.left.text, 32, WH, true, 'left', -0.5)
        if (s.left.foot) txt(60, 392, 400, 60, s.left.foot, 18, MU)
        rect(500, 150, 1, 300, EDGE)
        a('shape.insert', { preset: 'roundRect', rect: [530, 150, 370, 320] })
        a('shape.fill', {
          gradient: {
            stops: [
              [0, '#' + VI],
              [1, '#' + DOTS[0]]
            ],
            angle: 45
          }
        })
        a('shape.line', { none: true })
        a('shape.insert', { preset: 'roundRect', rect: [532, 152, 366, 316] })
        a('shape.fill', { color: '#150E28' })
        a('shape.line', { none: true })
        if (s.right.label) txt(566, 180, 310, 30, s.right.label.toUpperCase(), 13, VIL, true, 'left', 2)
        txt(566, 214, 310, 170, s.right.text, 26, WH, true)
        if (s.right.foot) txt(566, 396, 310, 60, s.right.foot, 17, 'D8D0F5')
        break
      case 'rows':
        header(n, s.title, s.kicker)
        s.rows.forEach((r, i) => {
          const y = 146 + i * 84
          rect(60, y, 840, 1, EDGE)
          dot(60, y + 30, 14, DOTS[i])
          txt(90, y + 20, 350, 44, r.label, 21, WH, true)
          txt(460, y + 20, 200, 50, r.value, 20, VIL, true)
          if (r.note) txt(680, y + 20, 220, 56, r.note, 16, MU)
        })
        rect(60, 146 + s.rows.length * 84, 840, 1, EDGE)
        break
      case 'quad':
        header(n, s.title, s.kicker)
        s.items.forEach((it, i) => {
          const x = 60 + (i % 2) * 440
          const y = 150 + Math.floor(i / 2) * 170
          rect(x, y, 5, 130, DOTS[i])
          txt(x + 28, y + 4, 395, 40, it.title, fitSize(it.title, 24, 28), WH, true)
          if (it.body) txt(x + 28, y + 52, 380, 80, it.body, 19, MU)
        })
        break
      case 'stats':
        header(n, s.title, s.kicker)
        txt(56, 150, 460, 170, s.stat, fitSize(s.stat, 120, 6), VI, true, 'left', -4)
        txt(64, 326, 420, 40, s.statLabel, 22)
        rect(520, 150, 1, 300, EDGE)
        s.items.forEach((it, i) => {
          const y = 146 + i * 108
          txt(556, y, 140, 100, it.value, fitSize(it.value, 76, 2), DOTS[1 + i], true, 'left', -2)
          txt(716, y + 26, 200, 70, it.label, 19, MU)
          if (i < 2) rect(556, y + 100, 344, 1, EDGE)
        })
        break
      case 'closing':
        bgslide([
          [120, -40, 720, '2E1D66'],
          [-200, 380, 420, BLUEG]
        ])
        dotrow(364, 116, 32, 22)
        txt(60, 184, 840, 100, s.title, fitSize(s.title, 62, 26), WH, true, 'center', -2)
        if (s.text) txt(120, 298, 720, 60, s.text, 22, MU, false, 'center')
        if (s.sources) txt(60, 468, 840, 30, s.sources, 14, MU, false, 'center')
        break
    }
  })
  a('slide.delete', { index: 0 }) // `file.new` deja una diapositiva vacía al inicio
  return c
}
