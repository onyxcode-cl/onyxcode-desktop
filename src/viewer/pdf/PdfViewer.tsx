/**
 * Visor de PDF (Fase 1 del plan del visor): `PDFViewer` de pdf.js sobre el documento que sirve
 * `lazunox-viewer://viewer/doc/<token>`. Los enlaces externos del PDF quedan inertes de todos
 * modos (`will-navigate` los bloquea en `src/main/viewer/view.ts`); acá no hace falta interceptarlos.
 */
import { useEffect, useRef, useState } from 'react'
import { GlobalWorkerOptions, getDocument, type PDFDocumentLoadingTask } from 'pdfjs-dist'
import { EventBus, PDFFindController, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs'
import 'pdfjs-dist/web/pdf_viewer.css'
// `?url`: Vite lo trata como referencia a copiar/versionar, no como módulo (el worker nunca se ejecuta en el hilo principal).
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { docUrl } from '../params'
import type { ViewerLang } from '../i18n'
import { tv } from '../i18n'
import { ZOOM_STEPS, clampPage, scaleOf, zoomIn, zoomOut } from '../zoom'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

type Phase = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; pages: number }

export function PdfViewer({ token, lang }: { token: string; lang: ViewerLang }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewerRef = useRef<PDFViewer | null>(null)
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [zoomPercent, setZoomPercent] = useState(100)
  const [page, setPage] = useState(1)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let cancelled = false
    const eventBus = new EventBus()
    const linkService = new PDFLinkService({ eventBus })
    const findController = new PDFFindController({ eventBus, linkService })
    const viewer = new PDFViewer({
      container,
      eventBus,
      linkService,
      findController,
      removePageBorders: false
    })
    linkService.setViewer(viewer)
    viewerRef.current = viewer

    // El contenedor puede seguir en 0×0 cuando llega `pagesinit` (la vista nativa recién se está
    // posicionando: `attach()` llega un instante después de `openDoc()`, sobre todo la primera vez
    // que se abre un documento desde Chat). Si se ajusta "page-width" con ancho 0, pdf.js calcula
    // una escala absurda (negativa) y no se ve nada. Por eso el ajuste inicial se reintenta por
    // `ResizeObserver` hasta que el contenedor tenga un tamaño de verdad, UNA sola vez (no en cada
    // resize después: si la persona ya hizo zoom a mano, no se lo pisa).
    let committed = false
    const fitToWidthIfSized = (): boolean => {
      if (committed || container.clientWidth <= 0) return false
      viewer.currentScaleValue = 'page-width'
      committed = true
      // `currentScaleValue` dispara `update()` de pdf.js, pero ese `update()` calcula qué páginas
      // están "visibles" leyendo el layout ACTUAL del DOM — justo después de cambiar `--scale-factor`
      // (que mueve el ancho/alto de `.page` vía `round()` en CSS), el navegador puede no haber
      // repintado todavía, así que `_getVisiblePages()` da 0 páginas y nunca llega a dibujar el
      // canvas. Un `update()` extra en el siguiente frame (ya con el reflow hecho) lo destraba.
      requestAnimationFrame(() => {
        if (!cancelled) viewer.update()
      })
      return true
    }
    const onPagesInit = (): void => {
      if (cancelled) return
      fitToWidthIfSized()
    }
    const onScaleChanging = (ev: { scale: number }): void => setZoomPercent(Math.round(ev.scale * 100))
    const onPageChanging = (ev: { pageNumber: number }): void => setPage(ev.pageNumber)
    eventBus.on('pagesinit', onPagesInit)
    eventBus.on('scalechanging', onScaleChanging)
    eventBus.on('pagechanging', onPageChanging)

    const ro = new ResizeObserver(() => {
      if (!cancelled && viewer.pdfDocument) fitToWidthIfSized()
    })
    ro.observe(container)

    const loadingTask = getDocument({
      url: docUrl(token),
      cMapUrl: './pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: './pdfjs/standard_fonts/',
      wasmUrl: './pdfjs/wasm/',
      enableXfa: false
    })
    loadingTaskRef.current = loadingTask
    loadingTask.promise
      .then((pdf) => {
        if (cancelled) return
        viewer.setDocument(pdf)
        linkService.setDocument(pdf)
        setPhase({ kind: 'ready', pages: pdf.numPages })
      })
      .catch(() => !cancelled && setPhase({ kind: 'error' }))

    return () => {
      cancelled = true
      ro.disconnect()
      eventBus.off('pagesinit', onPagesInit)
      eventBus.off('scalechanging', onScaleChanging)
      eventBus.off('pagechanging', onPageChanging)
      viewer.cleanup()
      void loadingTaskRef.current?.destroy()
      loadingTaskRef.current = null
      viewerRef.current = null
    }
  }, [token])

  const applyZoom = (percent: number): void => {
    const v = viewerRef.current
    if (!v) return
    v.currentScale = scaleOf(percent)
    setZoomPercent(percent)
  }
  const goToPage = (n: number): void => {
    const v = viewerRef.current
    if (!v || phase.kind !== 'ready') return
    const clamped = clampPage(n, phase.kind === 'ready' ? phase.pages : 1)
    v.currentPageNumber = clamped
    setPage(clamped)
  }

  return (
    <div className="pdf-root">
      {phase.kind === 'loading' && <div className="viewer-center">{tv(lang, 'loading')}</div>}
      {phase.kind === 'error' && (
        <div className="viewer-center">
          <p>{tv(lang, 'errorTitle')}</p>
        </div>
      )}
      <div className="pdf-toolbar" style={{ display: phase.kind === 'ready' ? 'flex' : 'none' }}>
        <button type="button" onClick={() => applyZoom(zoomOut(zoomPercent))} disabled={zoomPercent <= ZOOM_STEPS[0]}>
          −
        </button>
        <span className="viewer-muted">{zoomPercent}%</span>
        <button type="button" onClick={() => applyZoom(zoomIn(zoomPercent))} disabled={zoomPercent >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}>
          +
        </button>
        <span className="pdf-toolbar-sep" />
        <button type="button" onClick={() => goToPage(page - 1)} disabled={page <= 1}>
          ‹
        </button>
        <span className="viewer-muted">
          {page} / {phase.kind === 'ready' ? phase.pages : '…'}
        </span>
        <button type="button" onClick={() => goToPage(page + 1)} disabled={phase.kind === 'ready' && page >= phase.pages}>
          ›
        </button>
      </div>
      <div className="pdf-container-wrap">
        <div ref={containerRef} className="pdf-container" style={{ visibility: phase.kind === 'ready' ? 'visible' : 'hidden' }}>
          <div className="pdfViewer" />
        </div>
      </div>
    </div>
  )
}
