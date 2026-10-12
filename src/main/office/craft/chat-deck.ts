/**
 * PRUEBA (rama `exp/craft-office-pruebas`): el bloque ```pptx del Chat (`PptxSpec`, el mismo que lee `render-pptx.ts`) → comandos de
 * `deckcraft-cli` con el diseño «dots». El Chat no tiene herramientas ni MCP: el modelo solo escribe el JSON y la APP arma el archivo,
 * así que aquí es donde ArtCraft se conecta al Chat. Si DeckCraft no está instalado o algo falla, `chat-docs.ts` cae al generador de siempre.
 *
 * Mismo criterio que `deck-builder.ts`: el contenido es DATO (va como valor JSON de cada parámetro), nada del JSON del modelo se interpreta
 * como comando o ruta, y el tamaño de letra se ajusta al largo del texto porque la herramienta no mide ni autoajusta.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PptxChartType, PptxSlideSpec, PptxSpec, PptxTheme } from '@shared/chat-doc-spec'
import { DOTS, EDGE, MU, VI, VIL, WH, createKit, fitSize } from './deck-kit'

const ACCENT: Record<PptxTheme, string> = { blue: '3B82F6', green: '22C55E', dark: VI, warm: 'F59E0B', mono: 'A1A1B5' }
const PANEL = '12121B'
const CHART_TYPE: Record<PptxChartType, string> = { bar: 'column', line: 'line', pie: 'pie' }
/** Colores de un gráfico sobre fondo oscuro: los cinco puntos de la marca. */
const CHART_COLORS = DOTS.map((c) => '#' + c)

/** Título de portada del Chat: enorme si es corto y, si es largo, en hasta dos líneas grandes (la caja deja sitio para dos). */
export function chatCoverSize(title: string): number {
  if (title.length <= 8) return 190
  if (title.length <= 14) return 110
  if (title.length <= 44) return 76
  return 56
}

function layoutOf(s: PptxSlideSpec, index: number): NonNullable<PptxSlideSpec['layout']> {
  if (s.layout) return s.layout
  if (index === 0) return 'cover'
  if (s.title && !s.bullets?.length) return 'section'
  return 'bullets'
}

/** Genera los comandos `id={json}` de DeckCraft para toda la presentación. Asume `PptxSpec` ya validado (`isPptxSpec`). */
export function chatDeckCommands(spec: PptxSpec): string[] {
  const accent = ACCENT[spec.theme ?? 'blue']
  const { c, a, bgslide, rect, ring, dot, dotrow, txt, pill, header } = createKit(accent)
  const footer = spec.footer ?? ''
  a('file.new')
  // Arial en todo: Inter (la del tema) no está en todos los equipos y LibreOffice/PowerPoint la sustituyen por una serif.
  a('design.fonts', { major: 'Arial', minor: 'Arial' })
  let sectionN = 0

  const foot = (s: PptxSlideSpec): void => {
    const t = s.note ?? footer
    if (t) txt(120, 500, 640, 24, t, 11, MU)
  }
  const head = (n: number, s: PptxSlideSpec): void => {
    header(n, s.title ?? '', s.eyebrow)
    foot(s)
  }
  const list = (items: string[], x: number, y: number, w: number, max: number, gap: number, size: number): void => {
    items.slice(0, max).forEach((t, i) => {
      dot(x, y + i * gap + 8, 12, DOTS[i % DOTS.length])
      txt(x + 28, y + i * gap, w - 28, gap, t, fitSize(t, size, Math.floor(w / (size * 0.52))), WH, false)
    })
  }

  spec.slides.forEach((s, idx) => {
    const n = idx + 1
    const title = s.title ?? ''
    const bullets = s.bullets ?? []
    switch (layoutOf(s, idx)) {
      case 'cover':
        bgslide([
          [380, -300, 900, '4A2C96'],
          [-220, 300, 560, '14285E']
        ])
        dotrow(60, 88, 34, 20)
        txt(44, 146, 860, 230, title, chatCoverSize(title), WH, true, 'left', chatCoverSize(title) >= 110 ? -8 : -2)
        if (bullets[0]) txt(64, 384, 760, 50, bullets[0], fitSize(bullets[0], 28, 60))
        if (bullets[1]) txt(64, 430, 760, 30, bullets[1], 18, MU)
        if (s.eyebrow) pill(64, 476, Math.min(420, 40 + s.eyebrow.length * 9), 36, s.eyebrow, 14)
        break
      case 'section': {
        sectionN += 1
        bgslide([
          [380, -300, 900, '2E1D66'],
          [-220, 300, 560, '14285E']
        ])
        dotrow(60, 88, 20, 14)
        txt(54, 130, 700, 160, s.eyebrow ?? String(sectionN).padStart(2, '0'), 120, accent, true, 'left', -4)
        txt(60, 300, 840, 140, title, fitSize(title, 54, 28), WH, true, 'left', -1)
        foot(s)
        break
      }
      case 'closing':
        bgslide([
          [120, -40, 720, '2E1D66'],
          [-200, 380, 420, '0F1A3A']
        ])
        dotrow(364, 116, 32, 22)
        txt(60, 184, 840, 100, title, fitSize(title, 62, 26), WH, true, 'center', -2)
        if (bullets[0]) txt(120, 298, 720, 60, bullets[0], 22, MU, false, 'center')
        if (s.note ?? footer) txt(60, 468, 840, 30, s.note ?? footer, 14, MU, false, 'center')
        break
      case 'stat': {
        head(n, { ...s, title: '' })
        txt(52, 130, 600, 200, title, fitSize(title, 150, 5), accent, true, 'left', -4)
        if (bullets[0]) txt(64, 330, 560, 120, bullets[0], fitSize(bullets[0], 24, 70), WH)
        if (bullets.length > 1) {
          rect(660, 150, 1, 300, EDGE)
          list(bullets.slice(1), 690, 160, 230, 5, 62, 17)
        }
        break
      }
      case 'steps': {
        head(n, s)
        const items = bullets.slice(0, 6)
        const k = Math.max(items.length, 1)
        const w = Math.floor(840 / k)
        rect(60, 286, 840, 2, EDGE)
        // Un solo tamaño para todos los pasos: el del texto más largo.
        const size = Math.min(22, ...items.map((t) => fitSize(t, 22, Math.floor(((w - 16) / 12) * 2))))
        items.forEach((t, i) => {
          const x = 60 + i * w
          txt(x - 4, 160, w, 100, String(i + 1).padStart(2, '0'), 72, DOTS[i % DOTS.length], true, 'left', -2)
          dot(x, 279, 16, DOTS[i % DOTS.length])
          txt(x, 326, w - 16, 130, t, size, WH, true)
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
          rect(x, 146, 400, 1, EDGE)
          if (col.heading) txt(x, 158, 400, 40, col.heading, fitSize(col.heading, 26, 24), i === 0 ? WH : VIL, true)
          list(col.bullets, x, col.heading ? 212 : 170, 400, 6, 48, 18)
        })
        rect(480, 150, 1, 320, EDGE)
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
          rect(x, y, w, 1, EDGE)
          ring(x, y + 22, 56, DOTS[i % DOTS.length])
          dot(x + 18, y + 40, 20, DOTS[i % DOTS.length])
          txt(x + 76, y + 18, w - 76, 110, t, fitSize(t, 19, Math.floor((w - 76) / 10.5) * 3), WH)
        })
        break
      }
      case 'chart': {
        head(n, s)
        if (s.chart) {
          a('insert.chart', {
            type: CHART_TYPE[s.chart.type],
            rect: [60, 140, 840, 340],
            categories: s.chart.categories,
            series: [{ name: title || 'Serie', values: s.chart.values }]
          })
          a('chart.options', {
            title: null,
            legend: s.chart.type === 'pie' ? 'r' : null,
            dataLabels: true,
            gridlines: false,
            palette: CHART_COLORS
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
        ks.forEach((kp, i) => {
          const x = 60 + i * (w + gap)
          rect(x, 160, w, 4, DOTS[i % DOTS.length])
          rect(x, 164, w, 250, PANEL)
          txt(x + 18, 184, w - 36, 40, kp.label.toUpperCase(), 13, MU, true, 'left', 2)
          txt(x + 14, 232, w - 28, 110, kp.value, fitSize(kp.value, 54, Math.floor((w - 28) / 29)), WH, true, 'left', -1)
          if (kp.delta) txt(x + 18, 350, w - 36, 50, kp.delta, 16, /^\s*[-−–]/.test(kp.delta) ? 'EC4899' : '22C55E', true)
        })
        break
      }
      default: {
        // bullets (el normal)
        head(n, s)
        const many = bullets.length > 6
        list(bullets, 60, many ? 148 : 156, 840, 9, many ? 38 : 52, many ? 18 : 22)
      }
    }
  })
  a('slide.delete', { index: 0 }) // `file.new` deja una diapositiva vacía al inicio
  return c
}

const run = (bin: string, args: string[], timeoutMs: number): Promise<void> =>
  new Promise((ok, fail) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 1 << 20, env: envFor() }, (err, _o, stderr) =>
      err ? fail(new Error(`DeckCraft falló: ${String(stderr || err.message).slice(0, 300)}`)) : ok()
    )
  })

function envFor(): NodeJS.ProcessEnv {
  // Sin tocar la configuración del usuario: carpetas de datos propias y PATH mínimo.
  const home = tmpdir()
  return { PATH: '/usr/bin:/bin', HOME: home, XDG_CONFIG_HOME: home, XDG_DATA_HOME: home, XDG_CACHE_HOME: home, XDG_STATE_HOME: home }
}

/** Arma el .pptx con DeckCraft y devuelve sus bytes. Lanza si el programa falla (quien llama cae al generador de siempre). */
export async function renderChatDeck(binary: string, spec: PptxSpec, timeoutMs = 30_000): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'lazunox-chatdeck-'))
  try {
    const out = join(dir, 'deck.pptx')
    const args = ['run', '--save', out]
    for (const cmd of chatDeckCommands(spec)) args.push('--cmd', cmd)
    await run(binary, args, timeoutMs)
    return await readFile(out)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** .pptx → PDF con DeckCraft (para la vista previa, sin LibreOffice). Devuelve la ruta del PDF o `null` si falla. */
export async function deckToPdf(binary: string, pptxPath: string, outPdf: string, timeoutMs = 60_000): Promise<string | null> {
  try {
    await run(binary, ['convert', pptxPath, outPdf], timeoutMs)
    return outPdf
  } catch {
    return null
  }
}
