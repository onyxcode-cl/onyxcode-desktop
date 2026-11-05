/**
 * Protecciones de pptxgenjs (el plan B cuando no hay DeckCraft). Cuatro trampas conocidas que producen un .pptx que PowerPoint «repara» o que
 * se ve mal, convertidas en una corrección automática antes de que la opción llegue a la librería:
 *  1. colores con `#` (`"#FF0000"`): pptxgenjs los escribe tal cual y el archivo queda inválido → se quita el `#`, se pasa a mayúsculas y un
 *     valor que no es hex de 6 dígitos se descarta;
 *  2. sombras con desplazamiento (`offset`) negativo: corrompen el XML → se pasa a positivo girando el ángulo 180°;
 *  3. etiquetas `outEnd` en barras apiladas: PowerPoint no las admite en ese tipo de gráfico → se pasan a `ctr`;
 *  4. ejes secundarios sin declarar (`secondaryValAxis` sin `valAxes`/`catAxes` de dos ejes): el gráfico no abre → se declaran los dos ejes.
 * `protectSlide` envuelve addText/addShape/addChart/addTable de una diapositiva para que TODAS las llamadas pasen por aquí.
 */
type Opts = Record<string, unknown>

const COLOR_KEYS = new Set([
  'color',
  'fill',
  'highlight',
  'chartColors',
  'chartColorsOpacity',
  'dataLabelColor',
  'catAxisLabelColor',
  'valAxisLabelColor',
  'legendColor',
  'titleColor',
  'borderColor'
])

/** `#ff0000` → `FF0000`; `null` si no es un hex de 6 dígitos (tampoco se acepta un nombre de color: pptxgenjs no los entiende). */
export function safeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const m = /^#?([0-9a-fA-F]{6})$/.exec(value.trim())
  return m ? m[1].toUpperCase() : null
}

function cleanColors(node: unknown, key = ''): unknown {
  if (Array.isArray(node)) return node.map((x) => (COLOR_KEYS.has(key) ? cleanColor(x) : cleanColors(x, key)))
  if (node && typeof node === 'object') {
    const out: Opts = {}
    for (const [k, v] of Object.entries(node as Opts)) {
      if (COLOR_KEYS.has(k) && typeof v === 'string') {
        const c = safeHexColor(v)
        if (c) out[k] = c
      } else if (k === 'color' && v && typeof v === 'object') out[k] = cleanColors(v, 'fill')
      else out[k] = cleanColors(v, k)
    }
    return out
  }
  return COLOR_KEYS.has(key) ? cleanColor(node) : node
}
function cleanColor(x: unknown): unknown {
  return typeof x === 'string' ? (safeHexColor(x) ?? x) : x
}

/** Sombra con desplazamiento positivo y ángulo en 0–359; la opacidad se limita a 0–1 y el blur a ≥ 0. */
export function safeShadow(shadow: unknown): unknown {
  if (!shadow || typeof shadow !== 'object') return shadow
  const s = { ...(shadow as Opts) }
  let offset = typeof s.offset === 'number' ? s.offset : undefined
  let angle = typeof s.angle === 'number' ? s.angle : 0
  if (offset !== undefined && offset < 0) {
    offset = -offset
    angle += 180
  }
  if (offset !== undefined) s.offset = offset
  if (angle !== (s.angle ?? 0) || offset !== undefined) s.angle = ((angle % 360) + 360) % 360
  if (typeof s.opacity === 'number') s.opacity = Math.min(1, Math.max(0, s.opacity))
  if (typeof s.blur === 'number') s.blur = Math.max(0, s.blur)
  const c = safeHexColor(s.color)
  if (c) s.color = c
  else delete s.color
  return s
}

const STACKED = new Set(['stacked', 'percentStacked'])

/** Opciones de un gráfico ya corregidas (ver el encabezado). `typeOrCombo` es el tipo o la lista de tipos de un gráfico combinado. */
export function safeChartOptions(typeOrCombo: unknown, options: Opts): Opts {
  const o = cleanColors(options) as Opts
  if (o.shadow) o.shadow = safeShadow(o.shadow)
  if (STACKED.has(String(o.barGrouping)) && o.dataLabelPosition === 'outEnd') o.dataLabelPosition = 'ctr'
  const combo = Array.isArray(typeOrCombo) ? (typeOrCombo as Opts[]) : []
  for (const part of combo) {
    const po = (part.options ?? {}) as Opts
    if (STACKED.has(String(po.barGrouping)) && po.dataLabelPosition === 'outEnd') part.options = { ...po, dataLabelPosition: 'ctr' }
  }
  const secondary = combo.some(
    (p) => (p.options as Opts | undefined)?.secondaryValAxis || (p.options as Opts | undefined)?.secondaryCatAxis
  )
  if (secondary) {
    if (!Array.isArray(o.valAxes) || o.valAxes.length < 2) o.valAxes = [{}, {}]
    if (!Array.isArray(o.catAxes) || o.catAxes.length < 2) o.catAxes = [{}, { catAxisHidden: true }]
    for (const part of combo) {
      const po = (part.options ?? {}) as Opts
      if (po.secondaryValAxis && !po.secondaryCatAxis) part.options = { ...po, secondaryCatAxis: true }
    }
  }
  return o
}

/** Opciones de texto o forma corregidas (colores y sombra). */
export function safeShapeOptions(options: Opts | undefined): Opts | undefined {
  if (!options) return options
  const o = cleanColors(options) as Opts
  if (o.shadow) o.shadow = safeShadow(o.shadow)
  return o
}

interface SlideLike {
  addText: (...a: any[]) => unknown // eslint-disable-line @typescript-eslint/no-explicit-any
  addShape: (...a: any[]) => unknown // eslint-disable-line @typescript-eslint/no-explicit-any
  addChart: (...a: any[]) => unknown // eslint-disable-line @typescript-eslint/no-explicit-any
  addTable: (...a: any[]) => unknown // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Envuelve la diapositiva para que ninguna llamada llegue a pptxgenjs sin pasar por las correcciones. Devuelve la misma diapositiva. */
export function protectSlide<T extends SlideLike>(slide: T): T {
  const text = slide.addText.bind(slide)
  const shape = slide.addShape.bind(slide)
  const chart = slide.addChart.bind(slide)
  const table = slide.addTable.bind(slide)
  slide.addText = (t: unknown, o?: Opts) => text(cleanTextRuns(t), safeShapeOptions(o))
  slide.addShape = (s: unknown, o?: Opts) => shape(s, safeShapeOptions(o))
  slide.addChart = (type: unknown, data: unknown, o: Opts = {}) => chart(type, data, safeChartOptions(type, o))
  slide.addTable = (rows: unknown, o?: Opts) => table(rows, safeShapeOptions(o))
  return slide
}

/** Tramos de texto (`[{ text, options }]`) con sus colores corregidos. */
function cleanTextRuns(t: unknown): unknown {
  if (!Array.isArray(t)) return t
  return t.map((run) =>
    run && typeof run === 'object' && 'options' in run ? { ...run, options: safeShapeOptions((run as { options?: Opts }).options) } : run
  )
}
