/**
 * Visor de Excel (Fase 3 del plan del visor): SheetJS CE parsea en un Worker (`worker.ts`), este
 * componente solo pinta una grilla virtualizada del modelo que resulta (`model.ts`). Nunca ejecuta
 * una fórmula ni sigue un hipervínculo del libro — solo muestra el texto ya calculado por SheetJS.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { docUrl } from '../params'
import type { ViewerLang } from '../i18n'
import { tv } from '../i18n'
import { colLetter, type GridSheet, type GridWorkbook } from './model'
import type { XlsxWorkerRequest, XlsxWorkerResponse } from './worker'
import { visibleRowRange } from './virtualize'

type Phase = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; workbook: GridWorkbook }

const ROW_HEADER_WIDTH_PX = 44

export function XlsxViewer({ token, lang }: { token: string; lang: ViewerLang }): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [sheetIndex, setSheetIndex] = useState(0)
  const [query, setQuery] = useState('')
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(400)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    let worker: Worker | null = null
    setPhase({ kind: 'loading' })
    setSheetIndex(0)

    fetch(docUrl(token))
      .then((res) => {
        if (!res.ok) throw new Error(`http ${res.status}`)
        return res.arrayBuffer()
      })
      .then(
        (buffer) =>
          new Promise<GridWorkbook>((resolve, reject) => {
            worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
            worker.onmessage = (ev: MessageEvent<XlsxWorkerResponse>) => {
              if (ev.data.type === 'result') resolve(ev.data.workbook)
              else reject(new Error('parse-failed'))
            }
            worker.onerror = () => reject(new Error('worker-error'))
            const req: XlsxWorkerRequest = { type: 'parse', buffer }
            worker.postMessage(req, [buffer])
          })
      )
      .then((workbook) => !cancelled && setPhase({ kind: 'ready', workbook }))
      .catch(() => !cancelled && setPhase({ kind: 'error' }))

    return () => {
      cancelled = true
      worker?.terminate()
    }
  }, [token])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight))
    ro.observe(el)
    setViewportH(el.clientHeight)
    return () => ro.disconnect()
  }, [phase.kind])

  const sheet: GridSheet | null = phase.kind === 'ready' ? (phase.workbook.sheets[sheetIndex] ?? null) : null

  const matches = useMemo(() => {
    if (!sheet || !query.trim()) return [] as Array<{ r: number; c: number }>
    const q = query.trim().toLowerCase()
    const found: Array<{ r: number; c: number }> = []
    for (let r = 0; r < sheet.rows && found.length < 500; r++) {
      for (let c = 0; c < sheet.cols; c++) {
        if (sheet.cells[r][c].text.toLowerCase().includes(q)) found.push({ r, c })
      }
    }
    return found
  }, [sheet, query])

  const goToRow = (r: number): void => {
    const el = scrollRef.current
    if (!sheet || !el) return
    const target = sheet.rowHeightsPx.slice(0, r).reduce((a, b) => a + b, 0)
    el.scrollTop = Math.max(0, target - viewportH / 2)
  }

  if (phase.kind === 'loading') return <div className="viewer-center">{tv(lang, 'loading')}</div>
  if (phase.kind === 'error' || !sheet) {
    return (
      <div className="viewer-center">
        <p>{tv(lang, 'errorTitle')}</p>
      </div>
    )
  }

  const range = visibleRowRange(scrollTop, viewportH, sheet.rowHeightsPx, 6)
  const totalWidth = ROW_HEADER_WIDTH_PX + sheet.colWidthsPx.reduce((a, b) => a + b, 0)

  return (
    <div className="xlsx-root">
      <div className="xlsx-toolbar">
        <input
          type="text"
          className="xlsx-search"
          placeholder="…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches.length > 0) goToRow(matches[0].r)
          }}
        />
        {query.trim() !== '' && <span className="viewer-muted">{matches.length}</span>}
        {sheet.truncated && <span className="viewer-muted">{sheet.rows}+</span>}
      </div>
      <div className="xlsx-tabs">
        {phase.workbook.sheets.map((s, i) => (
          <button key={s.name} type="button" className={i === sheetIndex ? 'xlsx-tab-active' : undefined} onClick={() => setSheetIndex(i)}>
            {s.name}
          </button>
        ))}
      </div>
      <div ref={scrollRef} className="xlsx-scroll" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        <div className="xlsx-colheaders" style={{ width: totalWidth }}>
          <div className="xlsx-corner" style={{ width: ROW_HEADER_WIDTH_PX }} />
          {sheet.colWidthsPx.map((w, c) => (
            <div key={c} className="xlsx-colheader" style={{ width: w }}>
              {colLetter(c)}
            </div>
          ))}
        </div>
        <div className="xlsx-body" style={{ height: range.totalHeight, width: totalWidth }}>
          <div className="xlsx-rows" style={{ transform: `translateY(${range.offsetY}px)` }}>
            {Array.from({ length: range.end - range.start }, (_, i) => {
              const r = range.start + i
              return (
                <div key={r} className="xlsx-row" style={{ height: sheet.rowHeightsPx[r] }}>
                  <div className="xlsx-rowheader" style={{ width: ROW_HEADER_WIDTH_PX }}>
                    {r + 1}
                  </div>
                  {sheet.cells[r].map((cell, c) =>
                    cell.covered ? null : (
                      <div
                        key={c}
                        className="xlsx-cell"
                        style={{ width: sheet.colWidthsPx[c], background: cell.fill }}
                        title={cell.formula ? `=${cell.formula}` : undefined}
                      >
                        {cell.text}
                      </div>
                    )
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
