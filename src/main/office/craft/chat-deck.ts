/**
 * PRUEBA (rama `exp/craft-office-pruebas`): el bloque ```pptx del Chat (`PptxSpec`, el mismo que lee `render-pptx.ts`) → comandos de
 * `deckcraft-cli` con el diseño «dots». El Chat no tiene herramientas ni MCP: el modelo solo escribe el JSON y la APP arma el archivo,
 * así que aquí es donde ArtCraft se conecta al Chat. Si DeckCraft no está instalado o algo falla, `chat-docs.ts` cae al generador de siempre.
 *
 * Mismo criterio que `deck-builder.ts`: el contenido es DATO (va como valor JSON de cada parámetro), nada del JSON del modelo se interpreta
 * como comando o ruta, y el tamaño de letra se ajusta al largo del texto porque la herramienta no mide ni autoajusta.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PptxChartType, PptxSlideSpec, PptxSpec } from '@shared/chat-doc-spec'
import type { ImageMap } from '../../documents/image-files'
import { runCraft } from './craft-run'
import { ensureTitlePlaceholders } from './pptx-titles'
import { autoFitSize, contrastRatio, createKit, customPalette, fitSize, legibleInk, paletteFor, stripHash } from './deck-kit'

const CHART_TYPE: Record<PptxChartType, string> = { bar: 'column', line: 'line', pie: 'pie' }

/** Título de portada del Chat: enorme si es corto y, si es largo, en hasta dos líneas grandes (la caja deja sitio para dos). */
export function chatCoverSize(title: string): number {
  if (title.length <= 8) return 190
  if (title.length <= 14) return 110
  if (title.length <= 44) return 76
  return 56
}

/** Torta: «Norte · 46 %» en la leyenda (DeckCraft no ofrece etiqueta de porcentaje): cada porción con su parte del total. */
export function pieCategories(categories: string[], values: number[]): string[] {
  const total = values.reduce((n, v) => n + (Number.isFinite(v) ? Math.max(v, 0) : 0), 0)
  if (total <= 0) return categories
  return categories.map((c, i) => `${c} · ${Math.round((Math.max(values[i] ?? 0, 0) / total) * 1000) / 10}`.replace(/\.0$/, '') + ' %')
}

export function layoutOf(s: PptxSlideSpec, index: number): NonNullable<PptxSlideSpec['layout']> {
  if (s.layout) return s.layout
  if (s.chart) return 'chart'
  if (s.table) return 'table'
  if (s.kpis?.length) return 'kpis'
  if (s.columns?.length) return 'two-col'
  if (index === 0) return 'cover'
  if (s.image && index > 0) return 'image'
  if (s.title && !s.bullets?.length) return 'section'
  return 'bullets'
}

/**
 * El subtítulo de la portada es la primera viñeta de la primera diapositiva (así lo documenta el esquema del Chat). Un modelo que escribe
 * `subtitle` (en la diapositiva o en la presentación entera) lo esperaría ver: se pasa a viñeta aquí, en el motor, para que valga en TODAS las
 * rutas (bloque del Chat, `documentos_crear` y los scripts de las skills), no solo en la que pasa por `chat-doc-sanitize`.
 */
export function foldSubtitles(spec: PptxSpec): PptxSpec {
  const raw = spec as unknown as { subtitle?: unknown; slides: Array<PptxSlideSpec & { subtitle?: unknown }> }
  const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 500) : null)
  const slides = raw.slides.map((sl, i) => {
    // Solo la portada: en otra diapositiva `{title, subtitle}` es un separador de sección y no debe volverse una de viñetas.
    if (i !== 0) return sl
    const sub = text(sl.subtitle) ?? text(raw.subtitle)
    if (!sub || (sl.bullets && sl.bullets.length > 0)) return sl
    return { ...sl, bullets: [sub] }
  })
  return { ...spec, slides }
}

/** Genera los comandos `id={json}` de DeckCraft para toda la presentación. Asume `PptxSpec` ya validado (`isPptxSpec`). */
export function chatDeckCommands(input: PptxSpec, images?: ImageMap): string[] {
  const spec = foldSubtitles(input)
  // `theme` elige la paleta (colores) y `style` la decoración, como pide el agente de Chat: no es siempre el mismo diseño.
  const pal = spec.palette ? customPalette(spec.palette) : paletteFor(spec.theme)
  const look = spec.style ?? 'classic'
  const { c, a, bgslide, rect, ring, dot, dotrow, txt, pill, panel, header, titleFont, setBg, footInk } = createKit(
    pal,
    look,
    pal.accent,
    spec.fonts?.title,
    true
  )
  const accent = pal.accent
  const DOTS = pal.marks
  const chartColors = DOTS.map((col) => '#' + col)
  const [g1, g2] = pal.dark ? ['4A2C96', '14285E'] : [pal.glow, pal.glow2]
  const footer = spec.footer ?? ''
  a('file.new')
  // Arial en todo: Inter (la del tema) no está en todos los equipos y PowerPoint la sustituye por una serif.
  a('design.fonts', { major: spec.fonts?.title ?? 'Arial', minor: spec.fonts?.body ?? 'Arial' })
  // Los gráficos de DeckCraft pintan con los colores de ACENTO del tema (la opción `palette` de `chart.options` no la lee): se fijan acento 1 a 6
  // con la paleta de la presentación, para que las barras y las porciones no salgan en el azul y naranja de siempre.
  a('design.colors', { colors: Object.fromEntries([...DOTS, accent].slice(0, 6).map((col, i) => [`accent${i + 1}`, '#' + col])) })
  let sectionN = 0

  const foot = (s: PptxSlideSpec): void => {
    const t = s.note ?? footer
    if (t) txt(120, 500, 640, 24, t, 11, footInk())
  }
  const head = (n: number, s: PptxSlideSpec): void => {
    header(n, s.title ?? '', s.eyebrow)
    foot(s)
  }
  const list = (items: string[], x: number, y: number, w: number, max: number, gap: number, size: number): void => {
    items.slice(0, max).forEach((t, i) => {
      dot(x, y + i * gap + 8, 12, DOTS[i % DOTS.length])
      // El texto puede ocupar dos líneas: se achica solo si es muy largo y nunca por debajo del 75 % del tamaño base.
      txt(
        x + 28,
        y + i * gap,
        w - 28,
        gap,
        t,
        Math.max(fitSize(t, size, Math.floor((w / (size * 0.52)) * 2)), Math.round(size * 0.75)),
        pal.text,
        false
      )
    })
  }

  spec.slides.forEach((s, idx) => {
    const n = idx + 1
    setBg(s.background ? stripHash(s.background) : undefined)
    const title = s.title ?? ''
    const bullets = s.bullets ?? []
    switch (layoutOf(s, idx)) {
      case 'cover':
        bgslide([
          [380, -300, 900, g1],
          [-220, 300, 560, g2]
        ])
        dotrow(60, 88, 34, 20)
        txt(44, 146, 860, 230, title, chatCoverSize(title), pal.text, true, 'left', chatCoverSize(title) >= 110 ? -8 : -2, titleFont)
        if (bullets[0]) txt(64, 384, 760, 50, bullets[0], fitSize(bullets[0], 28, 60))
        if (bullets[1]) txt(64, 430, 760, 30, bullets[1], 18, pal.muted)
        if (s.eyebrow) pill(64, 476, Math.min(420, 40 + s.eyebrow.length * 9), 36, s.eyebrow, 14)
        break
      case 'section': {
        sectionN += 1
        bgslide([
          [380, -300, 900, pal.dark ? '2E1D66' : pal.glow],
          [-220, 300, 560, g2]
        ])
        dotrow(60, 88, 20, 14)
        txt(54, 130, 700, 160, s.eyebrow ?? String(sectionN).padStart(2, '0'), 120, accent, true, 'left', -4)
        txt(60, 300, 840, 140, title, fitSize(title, 54, 28), pal.text, true, 'left', -1, titleFont)
        foot(s)
        break
      }
      case 'closing':
        bgslide([
          [120, -40, 720, pal.dark ? '2E1D66' : pal.glow],
          [-200, 380, 420, pal.glow2]
        ])
        dotrow(364, 116, 32, 22)
        txt(60, 184, 840, 100, title, fitSize(title, 62, 26), pal.text, true, 'center', -2, titleFont)
        // Hasta 3 líneas (la primera más grande): el contacto o la despedida de verdad no se pierden.
        bullets
          .slice(0, 3)
          .forEach((line, k) =>
            txt(120, k === 0 ? 298 : 338 + (k - 1) * 34, 720, k === 0 ? 60 : 34, line, k === 0 ? 22 : 18, pal.muted, false, 'center')
          )
        if (s.note ?? footer) txt(60, 468, 840, 30, s.note ?? footer, 14, footInk(), false, 'center')
        break
      case 'stat': {
        head(n, { ...s, title: '' })
        txt(52, 130, 600, 200, title, fitSize(title, 150, 5), accent, true, 'left', -4)
        if (bullets[0]) txt(64, 330, 560, 120, bullets[0], fitSize(bullets[0], 24, 70), pal.text)
        if (bullets.length > 1) {
          rect(660, 150, 1, 300, pal.edge)
          list(bullets.slice(1), 690, 160, 230, 5, 62, 17)
        }
        break
      }
      case 'steps': {
        head(n, s)
        const items = bullets.slice(0, 6)
        const k = Math.max(items.length, 1)
        const w = Math.floor(840 / k)
        rect(60, 286, 840, 2, pal.edge)
        // Un solo tamaño para todos los pasos, según el texto más largo (la caja deja sitio para 5 líneas).
        const longest = Math.max(0, ...items.map((t) => t.length))
        const size = longest <= 60 ? 18 : longest <= 100 ? 16 : 14
        items.forEach((t, i) => {
          const x = 60 + i * w
          txt(x - 4, 160, w, 100, String(i + 1).padStart(2, '0'), 72, DOTS[i % DOTS.length], true, 'left', -2)
          dot(x, 279, 16, DOTS[i % DOTS.length])
          txt(x, 326, w - 16, 130, t, size, pal.text, true)
        })
        break
      }
      case 'two-col': {
        head(n, s)
        const cols = s.columns ?? [
          { heading: undefined, bullets: bullets.slice(0, Math.ceil(bullets.length / 2)) },
          { heading: undefined, bullets: bullets.slice(Math.ceil(bullets.length / 2)) }
        ]
        cols.forEach((col, i) => {
          const x = 60 + i * 440
          rect(x, 146, 400, 1, pal.edge)
          if (col.heading) txt(x, 158, 400, 40, col.heading, fitSize(col.heading, 26, 24), i === 0 ? pal.text : pal.accent2, true)
          list(col.bullets, x, col.heading ? 212 : 170, 400, 6, 48, 18)
        })
        rect(480, 150, 1, 320, pal.edge)
        break
      }
      case 'cards': {
        head(n, s)
        const items = bullets.slice(0, 6)
        const per = items.length <= 4 ? 2 : 3
        const w = per === 2 ? 400 : 270
        items.forEach((t, i) => {
          const x = 60 + (i % per) * (per === 2 ? 440 : 285)
          const y = 150 + Math.floor(i / per) * (per === 2 ? 150 : 160)
          rect(x, y, w, 1, pal.edge)
          ring(x, y + 22, 56, DOTS[i % DOTS.length])
          dot(x + 18, y + 40, 20, DOTS[i % DOTS.length])
          txt(x + 76, y + 18, w - 76, 110, t, fitSize(t, 19, Math.floor((w - 76) / 10.5) * 3), pal.text)
        })
        break
      }
      case 'chart': {
        head(n, s)
        if (s.chart) {
          a('insert.chart', {
            type: CHART_TYPE[s.chart.type],
            rect: [60, 140, 840, 340],
            categories: s.chart.type === 'pie' ? pieCategories(s.chart.categories, s.chart.values) : s.chart.categories,
            series: [{ name: title || 'Serie', values: s.chart.values }]
          })
          a('chart.options', {
            title: null,
            legend: s.chart.type === 'pie' ? 'r' : null,
            dataLabels: true,
            gridlines: false,
            palette: chartColors
          })
        }
        break
      }
      case 'kpis': {
        head(n, s)
        const ks = (s.kpis ?? []).slice(0, 4)
        const k = Math.max(ks.length, 1)
        const gap = 20
        const w = Math.floor((840 - gap * (k - 1)) / k)
        const sparse = ks.length <= 2
        const baseSize = sparse ? 90 : 54
        // Un solo tamaño para todas las cifras de la fila (la más larga manda), así «$12.480 M» no queda más chico que «31,2%».
        const kpiSize = Math.min(...ks.map((kp) => autoFitSize(kp.value, baseSize, w - 36, sparse ? 150 : 100, true)), baseSize)
        ks.forEach((kp, i) => {
          const x = 60 + i * (w + gap)
          rect(x, 160, w, 4, DOTS[i % DOTS.length])
          if (!sparse) panel(x, 164, w, 250)
          txt(x + 18, 184, w - 36, sparse ? 56 : 40, kp.label.toUpperCase(), sparse ? 18 : 13, pal.muted, true, 'left', sparse ? 0 : 2)
          txt(x + 18, sparse ? 248 : 232, w - 36, sparse ? 150 : 100, kp.value, kpiSize, sparse ? accent : pal.text, true, 'left', -1)
          if (kp.delta) {
            const deltaBg = sparse ? pal.bg : pal.panel
            const ink = legibleInk(/^\s*[-−–]/.test(kp.delta) ? 'EC4899' : '22C55E', pal.text, deltaBg)
            const deltaInk = contrastRatio(ink, deltaBg) >= 4.5 ? ink : contrastRatio('FFFFFF', deltaBg) >= 4.5 ? 'FFFFFF' : '111111'
            txt(x + 18, sparse ? 414 : 350, w - 36, 50, kp.delta, 16, deltaInk, true)
          }
        })
        break
      }
      case 'timeline': {
        // Línea de tiempo horizontal; los hitos alternan arriba y abajo de la línea. «2024: texto» → etiqueta en acento + descripción.
        head(n, s)
        const items = bullets.slice(0, 6)
        const k = Math.max(items.length, 1)
        const w = Math.floor(840 / k)
        rect(60, 306, 840, 3, pal.edge)
        items.forEach((t, i) => {
          const cut = t.indexOf(': ')
          const label = cut > 0 && cut <= 24 ? t.slice(0, cut) : String(i + 1).padStart(2, '0')
          const desc = cut > 0 && cut <= 24 ? t.slice(cut + 2) : t
          const x = 60 + i * w
          const bw = Math.min(2 * w - 24, 330, 900 - x)
          const up = i % 2 === 0
          dot(x, 299, 18, DOTS[i % DOTS.length])
          rect(x + 8, up ? 262 : 322, 2, 34, pal.edge)
          const y = up ? 150 : 346
          txt(x, y, bw, 40, label, fitSize(label, 28, Math.floor(bw / 16)), DOTS[i % DOTS.length], true, 'left', -1)
          txt(x, y + 40, bw, 70, desc, fitSize(desc, 16, Math.floor((bw / 8.6) * 3)), pal.text)
        })
        break
      }
      case 'quote': {
        bgslide([[480, -260, 800, pal.dark ? '2E1D66' : pal.glow]])
        txt(52, 40, 200, 200, '\u201C', 220, accent, true, 'left')
        txt(110, 170, 740, 220, title, fitSize(title, 46, 70), pal.text, true, 'left', -1, titleFont)
        if (bullets[0]) {
          rect(112, 396, 48, 3, accent)
          txt(110, 408, 740, 40, bullets[0], 20, pal.muted)
        }
        foot(s)
        break
      }
      case 'agenda': {
        head(n, s)
        const items = bullets.slice(0, 7)
        const gap = items.length > 5 ? 46 : 56
        items.forEach((t, i) => {
          const y = 146 + i * gap
          rect(60, y + gap - 6, 840, 1, pal.edge)
          txt(60, y, 90, gap - 8, String(i + 1).padStart(2, '0'), 30, DOTS[i % DOTS.length], true, 'left', -1)
          txt(150, y + 2, 750, gap - 10, t, fitSize(t, items.length > 5 ? 22 : 24, 56), pal.text)
        })
        break
      }
      case 'table': {
        head(n, s)
        const tb = s.table
        if (!tb) break
        const k = tb.columns.length
        const colW = Math.floor(840 / k)
        const rowH = Math.min(48, Math.floor(330 / (tb.rows.length + 1)))
        const size = k > 4 ? 14 : 16
        // Un solo tamaño para toda la tabla: el menor que necesita alguna celda. Achicar celda por celda dejaba letras desiguales en la misma fila.
        const cells: Array<[string, boolean]> = [
          ...tb.columns.map((t): [string, boolean] => [t, true]),
          ...tb.rows.flatMap((row) => row.map((t, i): [string, boolean] => [t, i === 0]))
        ]
        const fit = cells.reduce(
          (m, [t, bold]) =>
            Math.min(m, fitSize(t, size, Math.floor((colW - 20) / (size * 0.55))), autoFitSize(t, size, colW - 20, rowH, bold)),
          size
        )
        const cell = (t: string, i: number, y: number, color: string, bold: boolean): void =>
          txt(60 + i * colW + 12, y + Math.max(0, (rowH - fit * 1.4) / 2), colW - 20, rowH, t, fit, color, bold)
        rect(60, 146, 840, rowH, accent)
        tb.columns.forEach((t, i) => cell(t, i, 146, pal.dark ? pal.bg : 'FFFFFF', true))
        tb.rows.forEach((row, r) => {
          const y = 146 + rowH * (r + 1)
          if (r % 2 === 1) rect(60, y, 840, rowH, pal.panel)
          rect(60, y + rowH - 1, 840, 1, pal.edge)
          row.forEach((t, i) => cell(t, i, y, pal.text, i === 0))
        })
        break
      }
      case 'image': {
        // Imagen de la carpeta de la tarea (ya validada y copiada por `documents/image-files.ts`): `images` solo existe en ese camino. Sin ella
        // (Chat, o la imagen no se pudo leer) la lámina queda como título + viñetas: nunca se usa una ruta que escribió el modelo.
        head(n, s)
        const img = s.image ? images?.get(s.image.path) : undefined
        if (!img) {
          list(bullets, 60, 156, 840, 9, 52, 22)
          break
        }
        const withText = bullets.length > 0
        const box = { x: 60, y: 146, w: withText ? 540 : 840, h: 336 }
        const k = Math.min(box.w / img.width, box.h / img.height)
        const w = Math.round(img.width * k)
        const h = Math.round(img.height * k)
        a('insert.picture', { path: img.file, rect: [box.x + Math.round((box.w - w) / 2), box.y + Math.round((box.h - h) / 2), w, h] })
        if (s.image?.alt) a('shape.altText', { text: s.image.alt })
        if (withText) list(bullets, 640, 170, 260, 5, 70, 18)
        break
      }
      case 'free': {
        // Lienzo libre: la IA decide qué va y dónde. Todo se valida antes (`isPptxSpec`): solo textos y formas con colores hex.
        a('slide.new', { layout: 'blank' })
        a('design.background', { color: '#' + (s.background ? stripHash(s.background) : pal.bg) })
        for (const e of s.elements ?? []) {
          const font = e.font ?? undefined
          if (e.type === 'text') {
            txt(
              e.x,
              e.y,
              e.w,
              e.h,
              e.text,
              e.size ?? 20,
              e.color ? stripHash(e.color) : pal.text,
              e.bold ?? false,
              e.align ?? 'left',
              e.spacing,
              font
            )
            if (e.italic) a('format.italic', { on: true })
            continue
          }
          a('shape.insert', { preset: e.shape, rect: [e.x, e.y, e.w, e.h], ...(e.text ? { text: e.text } : {}) })
          const transparency = e.opacity === undefined ? undefined : Math.round((1 - e.opacity) * 100) / 100
          if (e.fill && e.fillTo) {
            a('shape.fill', {
              gradient: {
                stops: [
                  [0, '#' + stripHash(e.fill)],
                  [1, '#' + stripHash(e.fillTo)]
                ],
                angle: e.angle ?? 90,
                kind: 'linear'
              },
              ...(transparency !== undefined ? { transparency } : {})
            })
          } else if (e.fill) a('shape.fill', { color: '#' + stripHash(e.fill), ...(transparency !== undefined ? { transparency } : {}) })
          else a('shape.fill', { none: true })
          if (e.line) a('shape.line', { color: '#' + stripHash(e.line), width: e.lineWidth ?? 1.5 })
          else a('shape.line', { none: true })
          if (e.rotate) a('shape.rotate', { deg: e.rotate })
          if (e.text) {
            a('format.size', { size: e.size ?? 18 })
            a('format.color', { color: '#' + (e.color ? stripHash(e.color) : pal.text) })
            a('format.bold', { on: e.bold ?? false })
            a('format.align', { align: e.align ?? 'center' })
            a('format.anchor', { anchor: 'middle' })
            if (font) a('format.font', { family: font })
          }
        }
        break
      }
      default: {
        // bullets (el normal)
        head(n, s)
        const many = bullets.length > 6
        // Con pocas viñetas la lámina no queda con dos tercios vacíos: letra y separación crecen cuando hay 4 o menos.
        const few = bullets.length <= 3 ? { y: 172, gap: 96, size: 28 } : bullets.length === 4 ? { y: 164, gap: 80, size: 26 } : null
        if (few) list(bullets, 60, few.y, 840, 9, few.gap, few.size)
        else list(bullets, 60, many ? 148 : 156, 840, 9, many ? 38 : 52, many ? 18 : 22)
      }
    }
    // Notas del orador: texto que solo ve quien presenta (DeckCraft: `slide.notes` sobre la diapositiva recién armada).
    if (s.speaker_notes?.trim()) a('slide.notes', { text: s.speaker_notes.trim() })
  })
  a('slide.delete', { index: 0 }) // `file.new` deja una diapositiva vacía al inicio
  if (spec.transition) {
    a('transition.set', { kind: spec.transition, index: 0 })
    a('transition.applyAll')
  }
  return c
}

/** Arma el .pptx con DeckCraft y devuelve sus bytes. Lanza si el programa falla (quien llama cae al generador de siempre). */
export async function renderChatDeck(
  binary: string,
  spec: PptxSpec,
  timeoutMs = 30_000,
  run: typeof runCraft = runCraft,
  images?: ImageMap
): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'lazunox-chatdeck-'))
  try {
    const out = join(dir, 'deck.pptx')
    const args = ['run', '--save', out]
    for (const cmd of chatDeckCommands(spec, images)) args.push('--cmd', cmd)
    await run(binary, args, timeoutMs)
    return await ensureTitlePlaceholders(await readFile(out))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** .pptx → PDF con DeckCraft (respaldo de la vista previa). Devuelve la ruta del PDF o `null` si falla. */
export async function deckToPdf(binary: string, pptxPath: string, outPdf: string, timeoutMs = 60_000): Promise<string | null> {
  try {
    await runCraft(binary, ['convert', pptxPath, outPdf], timeoutMs)
    return outPdf
  } catch (e) {
    console.warn('[craft] deckToPdf falló:', e instanceof Error ? e.message : e)
    return null
  }
}
