/**
 * Visor de PowerPoint (Fase 4 del plan del visor): vista ESTRUCTURAL propia, sin conversión externa (el Chat
 * prefiere la versión web de DeckCraft cuando está instalada). Cada diapositiva es un lienzo con proporción fija, escalado por CSS (`aspect-ratio` +
 * `width: 100%`), con las formas posicionadas en porcentaje. El tamaño del texto se expresa en `cqw`
 * (porcentaje del ancho del propio lienzo, vía `container-type`): así escala igual sin importar si el
 * lienzo se ve grande (diapositiva activa) o chico (una miniatura), sin medir nada en JS.
 * «Vista simplificada»: no es un render fiel de PowerPoint.
 */
import { useEffect, useState } from 'react'
import JSZip from 'jszip'
import { docUrl } from '../params'
import type { ViewerLang } from '../i18n'
import { tv } from '../i18n'
import { parseDeck, type ChartData, type Deck, type Shape } from './model'

type Phase = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; deck: Deck }

const EMU_PER_PT = 12700

export function PptxViewer({ token, lang }: { token: string; lang: ViewerLang }): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [index, setIndex] = useState(0)

  useEffect(() => {
    let cancelled = false
    setPhase({ kind: 'loading' })
    setIndex(0)

    fetch(docUrl(token))
      .then((res) => {
        if (!res.ok) throw new Error(`http ${res.status}`)
        return res.arrayBuffer()
      })
      .then((buffer) => JSZip.loadAsync(buffer))
      .then((zip) => parseDeck(zip))
      .then((deck) => !cancelled && setPhase({ kind: 'ready', deck }))
      .catch(() => !cancelled && setPhase({ kind: 'error' }))

    return () => {
      cancelled = true
    }
  }, [token])

  useEffect(() => {
    if (phase.kind !== 'ready') return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown')
        setIndex((i) => Math.min(phase.deck.slides.length - 1, i + 1))
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') setIndex((i) => Math.max(0, i - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase])

  if (phase.kind === 'loading') return <div className="viewer-center">{tv(lang, 'loading')}</div>
  if (phase.kind === 'error') {
    return (
      <div className="viewer-center">
        <p>{tv(lang, 'errorTitle')}</p>
      </div>
    )
  }

  const { deck } = phase
  const aspect = deck.widthEmu / deck.heightEmu
  const slide = deck.slides[index]

  return (
    <div className="pptx-root">
      <div className="pptx-banner">{lang === 'es' ? 'Vista simplificada' : 'Simplified view'}</div>
      <div className="pptx-stage">
        <button type="button" className="pptx-nav" disabled={index <= 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>
          ‹
        </button>
        <div className="pptx-canvas-wrap" style={{ aspectRatio: aspect }}>
          <SlideCanvas slide={slide} widthEmu={deck.widthEmu} />
        </div>
        <button
          type="button"
          className="pptx-nav"
          disabled={index >= deck.slides.length - 1}
          onClick={() => setIndex((i) => Math.min(deck.slides.length - 1, i + 1))}
        >
          ›
        </button>
      </div>
      <div className="pptx-counter viewer-muted">
        {index + 1} / {deck.slides.length}
      </div>
      <div className="pptx-thumbs">
        {deck.slides.map((s, i) => (
          <button key={i} type="button" className={i === index ? 'pptx-thumb-active' : undefined} onClick={() => setIndex(i)}>
            <div className="pptx-thumb-canvas" style={{ aspectRatio: aspect }}>
              <SlideCanvas slide={s} widthEmu={deck.widthEmu} />
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

export function SlideCanvas({ slide, widthEmu }: { slide: { shapes: Shape[]; background?: string }; widthEmu: number }): React.JSX.Element {
  return (
    <div className="pptx-canvas" style={{ background: slide.background ?? '#fff' }}>
      {slide.shapes.map((shape, i) => (
        <ShapeView key={i} shape={shape} widthEmu={widthEmu} />
      ))}
    </div>
  )
}

/** Puntos (tamaño de fuente de OOXML, unidad absoluta) → `cqw` (porcentaje del ancho del propio lienzo). */
function ptToCqw(sizePt: number | undefined, widthEmu: number): string | undefined {
  if (sizePt === undefined) return undefined
  return `${((sizePt * EMU_PER_PT) / widthEmu) * 100}cqw`
}

/** `ShapeGeom` → cómo redondear la caja — solo lo que distingue un círculo/`roundRect` de un rectángulo. */
const GEOM_RADIUS: Record<string, string> = { ellipse: '50%', roundRect: '12%' }

function ShapeView({ shape, widthEmu }: { shape: Shape; widthEmu: number }): React.JSX.Element {
  const box = { left: `${shape.xPct}%`, top: `${shape.yPct}%`, width: `${shape.wPct}%`, height: `${shape.hPct}%` }
  if (shape.kind === 'unknown') return <div className="pptx-shape pptx-shape-unknown" style={box} />
  if (shape.kind === 'picture') {
    return (
      <div className="pptx-shape" style={box}>
        {shape.dataUrl && <img src={shape.dataUrl} alt="" className="pptx-pic" />}
      </div>
    )
  }
  if (shape.kind === 'table') {
    return (
      <div className="pptx-shape pptx-table" style={box}>
        {shape.rows.map((row, r) => (
          <div key={r} className="pptx-table-row">
            {row.map((cell, c) => (
              <div key={c} className="pptx-table-cell" style={{ fontSize: ptToCqw(14, widthEmu) }}>
                {cell.paragraphs.map((p) => p.runs.map((run) => run.text).join('')).join(' ')}
              </div>
            ))}
          </div>
        ))}
      </div>
    )
  }
  if (shape.kind === 'chart') return <ChartView box={box} chart={shape.chart} />
  const justify = shape.anchor === 'b' ? 'flex-end' : shape.anchor === 'ctr' ? 'center' : 'flex-start'
  return (
    <div
      className="pptx-shape"
      style={{
        ...box,
        background: shape.fill,
        borderRadius: shape.geom ? GEOM_RADIUS[shape.geom] : undefined,
        border: !shape.fill && shape.stroke ? `2px solid ${shape.stroke}` : undefined,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: justify
      }}
    >
      {shape.paragraphs.map((p, pi) => (
        <p
          key={pi}
          className="pptx-para"
          style={{
            textAlign: p.align === 'ctr' ? 'center' : p.align === 'r' ? 'right' : 'left',
            marginBottom: p.spaceAfterPt ? ptToCqw(p.spaceAfterPt, widthEmu) : undefined
          }}
        >
          {p.bulleted && <span className="pptx-bullet">•</span>}
          {p.runs.map((run, ri) => (
            <span
              key={ri}
              style={{
                fontWeight: run.bold ? 700 : 400,
                fontStyle: run.italic ? 'italic' : undefined,
                color: run.color,
                fontSize: ptToCqw(run.sizePt, widthEmu),
                fontFamily: run.font ? `"${run.font}", sans-serif` : undefined,
                letterSpacing: run.letterSpacingPt ? ptToCqw(run.letterSpacingPt, widthEmu) : undefined
              }}
            >
              {run.text}
            </span>
          ))}
        </p>
      ))}
    </div>
  )
}

/** Paleta de RESPALDO — solo para un gráfico sin colores propios (debería ser raro: `render-pptx.ts` siempre fija `chartColors`). */
const CHART_FALLBACK_PALETTE = ['#3a6ea5', '#e2725b', '#5fa777', '#c9a227', '#8468ad', '#4aa3a3']

function chartColorAt(chart: ChartData, i: number): string {
  return chart.colors?.[i] ?? CHART_FALLBACK_PALETTE[i % CHART_FALLBACK_PALETTE.length]
}

/** Vista ESTRUCTURAL del gráfico (barras/línea → barras CSS; torta → `conic-gradient`) — nunca un
 * render fiel (sin ejes de verdad), pero con los colores REALES del `.pptx` (`chart.colors`, leídos de
 * `c:dPt`/`c:spPr`), y mejor que la caja "unknown" de siempre (que no mostraba nada reconocible). */
function ChartView({ box, chart }: { box: React.CSSProperties; chart?: ChartData }): React.JSX.Element {
  if (!chart) return <div className="pptx-shape pptx-shape-unknown" style={box} />
  const max = Math.max(...chart.values, 1)
  if (chart.type === 'pie') {
    const total = chart.values.reduce((a, b) => a + b, 0) || 1
    let acc = 0
    const stops = chart.values.map((v, i) => {
      const from = (acc / total) * 360
      acc += v
      const to = (acc / total) * 360
      return `${chartColorAt(chart, i)} ${from}deg ${to}deg`
    })
    return (
      <div className="pptx-shape pptx-chart" style={box}>
        <div className="pptx-chart-pie" style={{ background: `conic-gradient(${stops.join(', ')})` }} />
        <div className="pptx-chart-legend">
          {chart.categories.map((c, i) => (
            <span key={i} className="pptx-chart-legend-item">
              <i style={{ background: chartColorAt(chart, i) }} />
              {c}
            </span>
          ))}
        </div>
      </div>
    )
  }
  return (
    <div className="pptx-shape pptx-chart" style={box}>
      <div className="pptx-chart-bars">
        {chart.values.map((v, i) => (
          <div key={i} className="pptx-chart-bar-col">
            <div className="pptx-chart-bar" style={{ height: `${Math.max(2, (v / max) * 100)}%`, background: chartColorAt(chart, i) }} />
            <span className="pptx-chart-bar-label">{chart.categories[i]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
