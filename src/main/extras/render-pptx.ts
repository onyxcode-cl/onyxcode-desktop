/**
 * Datos estructurados del chat → `.pptx` real (vía `pptxgenjs`, sin Python). Sistema de diseño en
 * `pptx-design.ts` (paleta de 14 tonos por tema, tipografía, ajuste de texto) — ver el comentario de
 * ese archivo para la investigación detrás (skill oficial de Anthropic leída entera, SOLO sus reglas
 * de diseño, nunca su código — licencia propietaria — más un `.pptx` de referencia real analizado byte
 * a byte). Reescrito de una sola vez tras esa investigación, no en rondas reactivas de "arreglar lo que
 * se vio feo": fondo a toda página en las diapositivas de impacto (portada/sección/cifra/cierre),
 * etiqueta y nota al pie como convención ESTRUCTURAL (nunca contenido inventado), gráficos nativos,
 * tarjetas, dos columnas, y el mismo círculo de textura en toda la familia de fondo a toda página.
 * Sigue sin imágenes externas ni el ciclo de revisión con visión de la skill oficial — eso
 * se investigó y se decidió dejarlo para una fase aparte, ver CHANGELOG.
 */
import PptxGenJS from 'pptxgenjs'
import type { PptxChartSpec, PptxColumnSpec, PptxLayout, PptxSlideSpec, PptxSpec } from '@shared/chat-doc-spec'
import { fitText, splitLabel, splitStatUnit, STYLES, THEMES, type Palette, type StyleParams } from './pptx-design'

export { isPptxSpec, type PptxSlideSpec, type PptxSpec } from '@shared/chat-doc-spec'

const BODY_FONT = 'Arial'
const PAGE_W = 10
const PAGE_H = 5.625
const MARGIN_X = 0.6
const CONTENT_W = 8.8
const CONTENT_TOP_WITH_EYEBROW = 1.75
const CONTENT_TOP = 1.5
const CONTENT_BOTTOM = 4.9
const FOOTER_Y = 5.1

function inferLayout(slide: PptxSlideSpec, index: number): PptxLayout {
  if (slide.layout) return slide.layout
  if (index === 0) return 'cover'
  if (slide.title && !slide.bullets?.length) return 'section'
  return 'bullets'
}

/**
 * Decoración de las diapositivas de fondo a toda página (cover/section/stat/closing) — la forma
 * depende de `s.bleedShape` (eje de ESTILO, F8-B134): `"circle"` es el círculo sutil de siempre
 * sangrando por una esquina; `"diagonal"` una barra angosta rotada 45° en la misma zona de esquina
 * (más gráfico/audaz); `"rule"` una línea fina a todo el ancho, pegada al borde superior/inferior
 * (más editorial); `"none"` no dibuja nada (minimalismo real). Las tres primeras ocupan la MISMA zona
 * ya probada que nunca pisa texto — nunca la matemática de posición del contenido, solo qué se dibuja.
 */
function addBleedDecoration(slide: PptxGenJS.Slide, p: Palette, s: StyleParams, corner: 'tr' | 'bl'): void {
  if (s.bleedShape === 'circle') {
    const [x, y] = corner === 'tr' ? [6.9, -1.6] : [-1.6, 3.0]
    slide.addShape('ellipse', { x, y, w: 4.2, h: 4.2, fill: { color: p.onDark, transparency: 90 }, line: { type: 'none' } })
  } else if (s.bleedShape === 'diagonal') {
    const [x, y] = corner === 'tr' ? [7.6, -0.9] : [-0.9, 3.9]
    slide.addShape('rect', { x, y, w: 3.4, h: 1.0, rotate: 45, fill: { color: p.onDark, transparency: 82 }, line: { type: 'none' } })
  } else if (s.bleedShape === 'rule') {
    const y = corner === 'tr' ? 0 : PAGE_H - 0.05
    slide.addShape('rect', { x: 0, y, w: PAGE_W, h: 0.05, fill: { color: p.onDark, transparency: 70 }, line: { type: 'none' } })
  }
}

/**
 * Etiqueta chica en mayúsculas con espaciado entre letras ("CIFRA DESTACADA") — PURAMENTE visual, nunca se llama si no hay texto real que mostrar (ver cada layout: `spec.eyebrow`, o un número de sección, nunca contenido inventado).
 * Con `tick: true` (estilo "editorial", F8-B134) agrega una marquita de color pegada a la izquierda del
 * texto — a propósito NUNCA una línea DEBAJO de la etiqueta: en "section"/"closing" el espacio entre la
 * etiqueta y el título ya es chico (ver sus propios `y`), y una línea ahí arriesgaba pisar el título.
 */
function addEyebrow(
  slide: PptxGenJS.Slide,
  text: string,
  y: number,
  color: string,
  opts: { x?: number; w?: number; align?: 'left' | 'center'; charSpacing?: number; tick?: boolean; tickColor?: string } = {}
): void {
  const x = opts.x ?? MARGIN_X
  const tickW = opts.tick ? 0.14 : 0
  if (opts.tick) {
    slide.addShape('rect', { x, y: y + 0.03, w: 0.09, h: 0.18, fill: { color: opts.tickColor ?? color }, line: { type: 'none' } })
  }
  slide.addText(text.toUpperCase(), {
    x: x + tickW,
    y,
    w: (opts.w ?? CONTENT_W) - tickW,
    h: 0.26,
    fontSize: 11,
    bold: true,
    color,
    fontFace: BODY_FONT,
    charSpacing: opts.charSpacing ?? 2,
    margin: 0,
    align: opts.align ?? 'left'
  })
}

/** Nota al pie (izquierda) + número de página (derecha) — la nota solo sale si hay una de verdad (`spec.note` o el `footer` del deck), nunca un "Datos ilustrativos" puesto en automático. */
function addFooterRow(
  slide: PptxGenJS.Slide,
  note: string | undefined,
  page: { current: number; total: number } | undefined,
  noteColor: string,
  pageColor: string
): void {
  if (note)
    slide.addText(note, { x: MARGIN_X, y: FOOTER_Y, w: 7.4, h: 0.24, fontSize: 9.5, color: noteColor, fontFace: BODY_FONT, margin: 0 })
  if (page) {
    slide.addText(`${page.current} / ${page.total}`, {
      x: 8.4,
      y: FOOTER_Y,
      w: 1.0,
      h: 0.24,
      fontSize: 9.5,
      color: pageColor,
      align: 'right',
      fontFace: BODY_FONT,
      margin: 0
    })
  }
}

/**
 * Forma de tarjeta a usar según `s.cardRadius` — NUNCA `addShape('roundRect', {rectRadius: 0, ...})`:
 * bug real de `pptxgenjs` (confirmado leyendo su fuente), `rectRadius` se chequea con `if (value)`, así
 * que `0` (falsy) nunca escribe el `adj` de la esquina — PowerPoint cae al radio PROPIO
 * del preset `roundRect` (visiblemente redondeado, no la esquina recta que pide "editorial"/"minimal").
 * Confirmado visualmente con un render real, no solo con el XML.
 */
function cardShape(s: StyleParams): 'rect' | 'roundRect' {
  return s.cardRadius > 0 ? 'roundRect' : 'rect'
}

interface SlideCtx {
  page: number
  total: number
  /** Número de esta diapositiva entre las de tipo "section" únicamente (1-based) — para la etiqueta "02" cuando no hay `eyebrow`. */
  sectionNumber: number
  footer?: string
}

function addCoverSlide(slide: PptxGenJS.Slide, spec: PptxSlideSpec, p: Palette, s: StyleParams, ctx: SlideCtx): void {
  slide.background = { color: p.primary }
  addBleedDecoration(slide, p, s, 'tr')
  if (spec.eyebrow) addEyebrow(slide, spec.eyebrow, 0.6, p.accentOnDark, { charSpacing: 3, tick: s.ruleUnderEyebrow })
  if (spec.title) {
    // El ancho de `fitText` tiene que ser EXACTAMENTE el mismo que el de la caja real de `addText`
    // (7.6, no `CONTENT_W`=8.8 — se angosta a propósito para no pisar el círculo de la esquina) — bug
    // real: con `CONTENT_W` `fitText` subestimaba cuántas líneas iba a necesitar, elegía una letra
    // más grande de la que entraba, el título pasaba a 2 líneas y (con `anchor:"b"`/altura fija) la
    // primera quedaba cortada arriba de la caja.
    const titleW = 7.6
    const size = fitText(spec.title, titleW, 2.1, [44, 40, 36, 32], p.headFont, { bold: p.titleBold, lineMult: 1.08 })
    slide.addText(spec.title, {
      x: MARGIN_X,
      y: 1.2,
      w: titleW,
      h: 2.1,
      fontSize: size,
      bold: p.titleBold,
      color: p.onDark,
      fontFace: p.headFont,
      valign: 'bottom',
      margin: 0
    })
  }
  if (spec.bullets?.length) {
    slide.addText(spec.bullets.join('   ·   '), {
      x: MARGIN_X,
      y: 3.45,
      w: 7.2,
      h: 0.7,
      fontSize: 16,
      color: p.onDarkBody,
      fontFace: BODY_FONT,
      margin: 0
    })
  }
  addFooterRow(slide, spec.note ?? ctx.footer, undefined, p.onDarkMuted, p.onDarkMuted)
}

function addSectionSlide(slide: PptxGenJS.Slide, spec: PptxSlideSpec, p: Palette, s: StyleParams, ctx: SlideCtx): void {
  slide.background = { color: p.primary2 }
  addBleedDecoration(slide, p, s, 'bl')
  const eyebrow = spec.eyebrow ?? String(ctx.sectionNumber).padStart(2, '0')
  addEyebrow(slide, eyebrow, 1.55, p.accentOnDark, { tick: s.ruleUnderEyebrow })
  if (spec.title) {
    const size = fitText(spec.title, CONTENT_W, 1.3, [36, 32, 28], p.headFont, { bold: p.titleBold })
    slide.addText(spec.title, {
      x: MARGIN_X,
      y: 1.9,
      w: CONTENT_W,
      h: 1.3,
      fontSize: size,
      bold: p.titleBold,
      color: p.onDark,
      fontFace: p.headFont,
      valign: 'bottom',
      margin: 0
    })
  }
  if (spec.bullets?.length) {
    slide.addText(spec.bullets.join('   ·   '), {
      x: MARGIN_X,
      y: 3.3,
      w: CONTENT_W,
      h: 0.6,
      fontSize: 16,
      color: p.onDarkBody,
      fontFace: BODY_FONT,
      margin: 0
    })
  }
}

function addClosingSlide(slide: PptxGenJS.Slide, spec: PptxSlideSpec, p: Palette, s: StyleParams): void {
  slide.background = { color: p.primary }
  addBleedDecoration(slide, p, s, 'bl')
  if (spec.eyebrow) addEyebrow(slide, spec.eyebrow, 1.0, p.accentOnDark, { tick: s.ruleUnderEyebrow })
  if (spec.title) {
    const size = fitText(spec.title, CONTENT_W, 1.1, [36, 32, 28], p.headFont, { bold: p.titleBold })
    slide.addText(spec.title, {
      x: MARGIN_X,
      y: 1.3,
      w: CONTENT_W,
      h: 1.1,
      fontSize: size,
      bold: p.titleBold,
      color: p.onDark,
      fontFace: p.headFont,
      valign: 'bottom',
      margin: 0
    })
  }
  if (spec.bullets?.length) {
    slide.addText(
      spec.bullets.map((text) => ({ text, options: { bullet: { code: '2022' }, breakLine: true, paraSpaceAfter: 10 } })),
      { x: MARGIN_X, y: 2.75, w: CONTENT_W, h: 1.9, fontSize: 16, color: p.onDarkBody, fontFace: BODY_FONT, valign: 'top', margin: 0 }
    )
  }
}

/** Una cifra grande como foco (`title` es la cifra, p.ej. "+27%" — la unidad, si se reconoce, sale más chica en la misma línea). El primer `bullet` la explica. Fondo a toda página, misma familia visual que cover/section/closing. */
function addStatSlide(slide: PptxGenJS.Slide, spec: PptxSlideSpec, p: Palette, s: StyleParams, ctx: SlideCtx): void {
  slide.background = { color: p.primary2 }
  addBleedDecoration(slide, p, s, 'tr')
  if (spec.eyebrow) addEyebrow(slide, spec.eyebrow, 1.15, p.onDarkBody, { tick: s.ruleUnderEyebrow })
  if (spec.title) {
    const unit = splitStatUnit(spec.title)
    const size = fitText(unit ? unit.number : spec.title, CONTENT_W, 1.9, [120, 104, 88, 72], p.headFont, { lineMult: 1.0 })
    const runs = unit
      ? [
          { text: unit.number, options: { fontSize: size } },
          { text: unit.unit, options: { fontSize: Math.round(size * 0.55) } }
        ]
      : [{ text: spec.title, options: { fontSize: size } }]
    slide.addText(
      runs.map((r) => ({ text: r.text, options: { ...r.options, color: p.onDark, fontFace: p.headFont, bold: false } })),
      { x: MARGIN_X, y: 1.45, w: CONTENT_W, h: 1.9, color: p.onDark, fontFace: p.headFont, valign: 'bottom', margin: 0 }
    )
  }
  if (spec.bullets?.length) {
    slide.addText(spec.bullets[0], {
      x: MARGIN_X,
      y: 3.5,
      w: 7.6,
      h: 0.9,
      fontSize: 18,
      color: p.onDarkBody,
      fontFace: BODY_FONT,
      valign: 'top',
      margin: 0
    })
  }
  addFooterRow(slide, spec.note ?? ctx.footer, { current: ctx.page, total: ctx.total }, p.onDarkBody, p.onDarkBody)
}

/** Título + etiqueta opcional, compartido por las diapositivas de CONTENIDO (bullets/two-col/cards/chart/steps) — devuelve el `y` donde arranca el área de contenido (1.75 con etiqueta, 1.50 sin ella). */
function addContentHeader(slide: PptxGenJS.Slide, spec: PptxSlideSpec, p: Palette, s: StyleParams): number {
  if (spec.eyebrow) addEyebrow(slide, spec.eyebrow, 0.5, p.accent, { tick: s.ruleUnderEyebrow })
  if (spec.title) {
    const size = fitText(spec.title, CONTENT_W, 0.75, [28, 24, 22], p.headFont, { bold: true })
    slide.addText(spec.title, {
      x: MARGIN_X,
      y: spec.eyebrow ? 0.78 : 0.55,
      w: CONTENT_W,
      h: 0.75,
      fontSize: size,
      bold: true,
      color: p.accent,
      fontFace: p.headFont,
      valign: 'top',
      align: s.titleAlign,
      margin: 0
    })
  }
  return spec.eyebrow ? CONTENT_TOP_WITH_EYEBROW : CONTENT_TOP
}

/** "Etiqueta: resto" sale con la etiqueta en negrita — si no calza, el texto entero tal cual. */
/**
 * Los runs de UNA viñeta con bullet — "Etiqueta: resto" se parte en dos runs (la etiqueta en negrita),
 * ambos EN LA MISMA línea/párrafo: el marcador de viñeta va en el primer run, `breakLine` solo en el
 * ÚLTIMO (cierra el párrafo) — así pptxgenjs no abre una viñeta nueva a mitad de una misma línea.
 */
function bulletRuns(text: string, labelColor: string, bodyColor: string): { text: string; options: Record<string, unknown> }[] {
  const split = splitLabel(text)
  const bulletOpt = { bullet: { code: '2022' } }
  if (!split) return [{ text, options: { ...bulletOpt, breakLine: true, paraSpaceAfter: 12 } }]
  return [
    { text: `${split.label}: `, options: { ...bulletOpt, bold: true, color: labelColor } },
    { text: split.rest, options: { color: bodyColor, breakLine: true, paraSpaceAfter: 12 } }
  ]
}

function addBulletsSlide(slide: PptxGenJS.Slide, spec: PptxSlideSpec, p: Palette, s: StyleParams, ctx: SlideCtx): void {
  slide.background = { color: p.bg }
  const top = addContentHeader(slide, spec, p, s)
  if (spec.bullets?.length) {
    slide.addText(
      spec.bullets.flatMap((text) => bulletRuns(text, p.ink, p.body)),
      {
        x: MARGIN_X,
        y: top,
        w: CONTENT_W,
        h: CONTENT_BOTTOM - top,
        fontSize: 16,
        color: p.body,
        fontFace: BODY_FONT,
        valign: 'top',
        margin: 0
      }
    )
  }
  addFooterRow(slide, spec.note ?? ctx.footer, { current: ctx.page, total: ctx.total }, p.muted, p.accent)
}

/** Viñetas como pasos numerados (círculo de acento + número), para una secuencia/proceso en vez de una lista plana. */
function addStepsSlide(slide: PptxGenJS.Slide, spec: PptxSlideSpec, p: Palette, s: StyleParams, ctx: SlideCtx): void {
  slide.background = { color: p.bg }
  const top = addContentHeader(slide, spec, p, s)
  const steps = (spec.bullets ?? []).slice(0, 6)
  const rowH = Math.min(0.78, (CONTENT_BOTTOM - top) / Math.max(steps.length, 1))
  steps.forEach((text, i) => {
    const y = top + i * rowH
    const d = 0.42
    if (s.numberBadge === 'circle') {
      slide.addShape('ellipse', { x: MARGIN_X, y: y + (rowH - d) / 2, w: d, h: d, fill: { color: p.accent }, line: { type: 'none' } })
      slide.addText(String(i + 1), {
        x: MARGIN_X,
        y: y + (rowH - d) / 2,
        w: d,
        h: d,
        fontSize: 16,
        bold: true,
        color: p.onDark,
        fontFace: BODY_FONT,
        align: 'center',
        valign: 'middle',
        margin: 0
      })
    } else {
      slide.addText(String(i + 1), {
        x: MARGIN_X,
        y: y + (rowH - d) / 2,
        w: d,
        h: d,
        fontSize: 18,
        bold: true,
        color: p.accent,
        fontFace: BODY_FONT,
        align: 'left',
        valign: 'middle',
        margin: 0
      })
    }
    const split = splitLabel(text)
    slide.addText(
      split
        ? [
            { text: `${split.label}: `, options: { bold: true, color: p.ink } },
            { text: split.rest, options: { color: p.body } }
          ]
        : [{ text, options: { color: p.body } }],
      { x: 1.25, y, w: 7.9, h: rowH, fontSize: 16, fontFace: BODY_FONT, valign: 'middle', margin: 0 }
    )
  })
  addFooterRow(slide, spec.note ?? ctx.footer, { current: ctx.page, total: ctx.total }, p.muted, p.accent)
}

function columnBullets(col: PptxColumnSpec, headingColor: string, bodyColor: string): { text: string; options: Record<string, unknown> }[] {
  const out: { text: string; options: Record<string, unknown> }[] = []
  if (col.heading)
    out.push({ text: col.heading, options: { bold: true, color: headingColor, breakLine: true, paraSpaceAfter: 8, bullet: false } })
  col.bullets.forEach((text, i) =>
    out.push({
      text,
      options: { color: bodyColor, breakLine: true, paraSpaceAfter: 10, bullet: i === 0 && !col.heading ? undefined : { code: '2022' } }
    })
  )
  return out
}

/** Dos paneles lado a lado — con `columns` (encabezado propio por columna, el derecho invertido en color para dar énfasis, como "antes/después") o, sin `columns`, las `bullets` repartidas mitad y mitad (compatibilidad con decks ya generados). */
function addTwoColSlide(slide: PptxGenJS.Slide, spec: PptxSlideSpec, p: Palette, s: StyleParams, ctx: SlideCtx): void {
  slide.background = { color: p.bg }
  const top = addContentHeader(slide, spec, p, s)
  const panelW = 4.25
  const gap = 0.3
  const panelH = CONTENT_BOTTOM - top
  const panelY = top
  if (spec.columns) {
    const [left, right] = spec.columns
    slide.addShape('roundRect', {
      x: MARGIN_X,
      y: panelY,
      w: panelW,
      h: panelH,
      rectRadius: 0.05,
      fill: { color: p.surface },
      line: { type: 'none' }
    })
    slide.addShape('roundRect', {
      x: MARGIN_X + panelW + gap,
      y: panelY,
      w: panelW,
      h: panelH,
      rectRadius: 0.05,
      fill: { color: p.primary2 },
      line: { type: 'none' }
    })
    slide.addText(columnBullets(left, p.ink, p.body), {
      x: MARGIN_X + 0.3,
      y: panelY + 0.25,
      w: panelW - 0.6,
      h: panelH - 0.5,
      fontSize: 13.5,
      fontFace: BODY_FONT,
      valign: 'top',
      margin: 0
    })
    slide.addText(columnBullets(right, p.accentOnDark, p.onDarkBody), {
      x: MARGIN_X + panelW + gap + 0.3,
      y: panelY + 0.25,
      w: panelW - 0.6,
      h: panelH - 0.5,
      fontSize: 13.5,
      fontFace: BODY_FONT,
      valign: 'top',
      margin: 0
    })
  } else {
    const bullets = spec.bullets ?? []
    const mid = Math.ceil(bullets.length / 2)
    const cols: [string[], number][] = [
      [bullets.slice(0, mid), MARGIN_X],
      [bullets.slice(mid), MARGIN_X + panelW + gap]
    ]
    for (const [items, x] of cols) {
      if (!items.length) continue
      slide.addText(
        items.map((text) => ({ text, options: { bullet: { code: '2022' }, breakLine: true, paraSpaceAfter: 12 } })),
        { x, y: panelY, w: panelW, h: panelH, fontSize: 15, color: p.body, fontFace: BODY_FONT, valign: 'top', margin: 0 }
      )
    }
  }
  addFooterRow(slide, spec.note ?? ctx.footer, { current: ctx.page, total: ctx.total }, p.muted, p.accent)
}

/** Cada `bullet` como una tarjeta, para un listado de ítems/ventajas sin orden de proceso — a diferencia de "steps". */
function addCardsSlide(slide: PptxGenJS.Slide, spec: PptxSlideSpec, p: Palette, s: StyleParams, ctx: SlideCtx): void {
  slide.background = { color: p.bg }
  const top = addContentHeader(slide, spec, p, s)
  const cards = (spec.bullets ?? []).slice(0, 6)
  const cols = cards.length <= 2 ? cards.length : cards.length <= 4 ? 2 : 3
  const rows = Math.ceil(cards.length / Math.max(cols, 1))
  const gap = 0.3
  const cardW = (CONTENT_W - gap * (cols - 1)) / Math.max(cols, 1)
  const cardH = Math.min(1.7, (CONTENT_BOTTOM - top - gap * (rows - 1)) / Math.max(rows, 1))
  cards.forEach((text, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = MARGIN_X + col * (cardW + gap)
    const y = top + row * (cardH + gap)
    slide.addShape(cardShape(s), {
      x,
      y,
      w: cardW,
      h: cardH,
      rectRadius: s.cardRadius,
      fill: s.cardFill ? { color: p.surface } : { type: 'none' },
      line: s.cardBorder ? { color: p.border, width: 0.75 } : { type: 'none' }
    })
    const d = 0.4
    if (s.numberBadge === 'circle') {
      slide.addShape('ellipse', { x: x + 0.25, y: y + 0.22, w: d, h: d, fill: { color: p.accent }, line: { type: 'none' } })
      slide.addText(String(i + 1), {
        x: x + 0.25,
        y: y + 0.22,
        w: d,
        h: d,
        fontSize: 14,
        bold: true,
        color: p.onDark,
        fontFace: BODY_FONT,
        align: 'center',
        valign: 'middle',
        margin: 0
      })
    } else {
      slide.addText(String(i + 1), {
        x: x + 0.22,
        y: y + 0.2,
        w: d,
        h: d,
        fontSize: 18,
        bold: true,
        color: p.accent,
        fontFace: BODY_FONT,
        align: 'left',
        valign: 'middle',
        margin: 0
      })
    }
    const split = splitLabel(text)
    slide.addText(split ? split.label : text, {
      x: x + 0.22,
      y: y + 0.72,
      w: cardW - 0.44,
      h: 0.3,
      fontSize: 15,
      bold: true,
      color: p.ink,
      fontFace: BODY_FONT,
      valign: 'top',
      margin: 0
    })
    if (split) {
      slide.addText(split.rest, {
        x: x + 0.22,
        y: y + 1.02,
        w: cardW - 0.44,
        h: cardH - 1.1,
        fontSize: 12.5,
        color: p.body,
        fontFace: BODY_FONT,
        valign: 'top',
        margin: 0
      })
    }
  })
  addFooterRow(slide, spec.note ?? ctx.footer, { current: ctx.page, total: ctx.total }, p.muted, p.accent)
}

/**
 * De 2 a 4 métricas EN FILA (etiqueta chica arriba, número grande al medio, variación chica abajo),
 * para un resumen tipo tablero — DISTINTO de "stat": "stat" es UNA cifra como foco de toda la
 * diapositiva; acá son VARIAS métricas juntas, más chicas cada una. Mismo patrón de tarjeta que
 * "cards" (fondo `surface`, borde `border`), sin círculo numerado — acá el número grande ES el foco.
 */
function addKpisSlide(slide: PptxGenJS.Slide, spec: PptxSlideSpec, p: Palette, s: StyleParams, ctx: SlideCtx): void {
  slide.background = { color: p.bg }
  const top = addContentHeader(slide, spec, p, s)
  const kpis = spec.kpis ?? []
  const cols = kpis.length
  const gap = 0.3
  const cardW = (CONTENT_W - gap * (cols - 1)) / Math.max(cols, 1)
  const cardH = Math.min(2.2, CONTENT_BOTTOM - top)
  kpis.forEach((kpi, i) => {
    const x = MARGIN_X + i * (cardW + gap)
    slide.addShape(cardShape(s), {
      x,
      y: top,
      w: cardW,
      h: cardH,
      rectRadius: s.cardRadius,
      fill: s.cardFill ? { color: p.surface } : { type: 'none' },
      line: s.cardBorder ? { color: p.border, width: 0.75 } : { type: 'none' }
    })
    slide.addText(kpi.label, {
      x: x + 0.22,
      y: top + 0.22,
      w: cardW - 0.44,
      h: 0.4,
      fontSize: 13,
      color: p.body,
      fontFace: BODY_FONT,
      valign: 'top',
      margin: 0
    })
    slide.addText(kpi.value, {
      x: x + 0.22,
      y: top + 0.68,
      w: cardW - 0.44,
      h: 0.8,
      fontSize: 32,
      bold: true,
      color: p.ink,
      fontFace: p.headFont,
      valign: 'top',
      margin: 0
    })
    if (kpi.delta) {
      slide.addText(kpi.delta, {
        x: x + 0.22,
        y: top + cardH - 0.5,
        w: cardW - 0.44,
        h: 0.4,
        fontSize: 12,
        bold: true,
        color: p.accent,
        fontFace: BODY_FONT,
        valign: 'bottom',
        margin: 0
      })
    }
  })
  addFooterRow(slide, spec.note ?? ctx.footer, { current: ctx.page, total: ctx.total }, p.muted, p.accent)
}

/** Un gráfico nativo de PowerPoint (editable ahí, no una imagen) a partir de `spec.chart`. */
function addChartSlide(slide: PptxGenJS.Slide, spec: PptxSlideSpec, p: Palette, s: StyleParams, ctx: SlideCtx): void {
  slide.background = { color: p.bg }
  const top = addContentHeader(slide, spec, p, s)
  const chart = spec.chart as PptxChartSpec
  const hasComment = !!spec.bullets?.length
  const chartW = hasComment ? 5.9 : CONTENT_W
  slide.addChart(chart.type, [{ name: spec.title ?? 'Datos', labels: chart.categories, values: chart.values }], {
    x: MARGIN_X,
    y: top,
    w: chartW,
    h: CONTENT_BOTTOM - top,
    chartColors: [...p.chart],
    showTitle: false,
    showLegend: chart.type === 'pie',
    legendPos: 'r',
    legendColor: p.body,
    legendFontSize: 11,
    catAxisLabelColor: p.body,
    catAxisLabelFontSize: 11,
    valAxisHidden: chart.type !== 'pie',
    valGridLine: { style: 'none' },
    catGridLine: { style: 'none' },
    dataLabelColor: p.ink,
    dataLabelFontSize: 11,
    showValue: true,
    showPercent: chart.type === 'pie',
    barGapWidthPct: 40,
    holeSize: chart.type === 'pie' ? 55 : undefined
  })
  if (hasComment) {
    slide.addText(spec.bullets![0], {
      x: 6.8,
      y: top,
      w: 2.6,
      h: CONTENT_BOTTOM - top,
      fontSize: 14,
      color: p.body,
      fontFace: BODY_FONT,
      valign: 'top',
      margin: 0
    })
  }
  addFooterRow(slide, spec.note ?? ctx.footer, { current: ctx.page, total: ctx.total }, p.muted, p.accent)
}

/**
 * Las diapositivas `layout:"free"` (lienzo libre) solo se dibujan fielmente con DeckCraft. Con este generador (el de respaldo, cuando
 * DeckCraft no está instalado o falló) se simplifican a una diapositiva normal: el texto más grande como título y el resto como viñetas,
 * en el orden en que estaban. Así nunca sale una diapositiva vacía.
 */
export function degradeFreeSlides(data: PptxSpec): PptxSpec {
  if (!data.slides.some((s) => s.layout === 'free')) return data
  return {
    ...data,
    slides: data.slides.map((s, i) => {
      if (s.layout !== 'free') return s
      const texts = (s.elements ?? []).flatMap((e) =>
        e.type === 'text' ? [{ t: e.text, size: e.size ?? 20 }] : e.type === 'shape' && e.text ? [{ t: e.text, size: e.size ?? 18 }] : []
      )
      const biggest = texts.reduce<{ t: string; size: number } | null>((m, x) => (!m || x.size > m.size ? x : m), null)
      const rest = texts.filter((x) => x !== biggest).map((x) => x.t.slice(0, 500))
      return {
        title: biggest?.t.slice(0, 200) ?? s.title,
        bullets: rest.slice(0, 20),
        layout: i === 0 ? 'cover' : rest.length ? 'bullets' : 'section'
      }
    })
  }
}

export async function renderPptx(rawData: PptxSpec): Promise<Buffer> {
  const data = degradeFreeSlides(rawData)
  const pres = new PptxGenJS()
  pres.defineLayout({ name: 'LAZUNOX', width: PAGE_W, height: PAGE_H })
  pres.layout = 'LAZUNOX'
  const palette = THEMES[data.theme ?? 'blue']
  const style = STYLES[data.style ?? 'classic']
  pres.theme = { headFontFace: palette.headFont, bodyFontFace: BODY_FONT }
  const total = data.slides.length

  let sectionCount = 0
  data.slides.forEach((spec, i) => {
    const slide = pres.addSlide()
    const layout = inferLayout(spec, i)
    if (layout === 'section') sectionCount += 1
    const ctx: SlideCtx = { page: i + 1, total, sectionNumber: sectionCount, footer: data.footer }
    if (layout === 'cover') addCoverSlide(slide, spec, palette, style, ctx)
    else if (layout === 'section') addSectionSlide(slide, spec, palette, style, ctx)
    else if (layout === 'closing') addClosingSlide(slide, spec, palette, style)
    else if (layout === 'stat') addStatSlide(slide, spec, palette, style, ctx)
    else if (layout === 'steps') addStepsSlide(slide, spec, palette, style, ctx)
    else if (layout === 'two-col') addTwoColSlide(slide, spec, palette, style, ctx)
    else if (layout === 'cards') addCardsSlide(slide, spec, palette, style, ctx)
    else if (layout === 'chart' && spec.chart) addChartSlide(slide, spec, palette, style, ctx)
    else if (layout === 'kpis' && spec.kpis && spec.kpis.length >= 2) addKpisSlide(slide, spec, palette, style, ctx)
    else addBulletsSlide(slide, spec, palette, style, ctx)
  })

  return (await pres.write({ outputType: 'nodebuffer' })) as Buffer
}
