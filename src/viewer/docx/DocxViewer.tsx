/**
 * Visor de Word (Fase 2 del plan del visor): `docx-preview` sobre el documento que sirve
 * `lazunox-viewer://viewer/doc/<token>`. El documento es contenido hostil por definición: la CSP
 * del visor ya bloquea cualquier red saliente, y `sanitizeDocxDom` corre después del render como
 * segunda capa (enlaces inertes, imágenes externas sin `src`, sin scripts/iframes/objetos).
 */
import { useEffect, useRef, useState } from 'react'
import { renderAsync } from 'docx-preview'
import { docUrl } from '../params'
import type { ViewerLang } from '../i18n'
import { tv } from '../i18n'
import { ZOOM_STEPS, zoomIn, zoomOut } from '../zoom'
import { sanitizeDocxDom } from './sanitize'

type Phase = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready' }

export function DocxViewer({ token, lang }: { token: string; lang: ViewerLang }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [zoomPercent, setZoomPercent] = useState(100)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let cancelled = false
    container.replaceChildren()
    setPhase({ kind: 'loading' })

    fetch(docUrl(token))
      .then((res) => {
        if (!res.ok) throw new Error(`http ${res.status}`)
        return res.blob()
      })
      .then((blob) =>
        renderAsync(blob, container, container, {
          useBase64URL: true,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          inWrapper: true,
          className: 'docx'
        })
      )
      .then(() => {
        if (cancelled) return
        sanitizeDocxDom(container)
        setPhase({ kind: 'ready' })
      })
      .catch(() => !cancelled && setPhase({ kind: 'error' }))

    return () => {
      cancelled = true
      container.replaceChildren()
    }
  }, [token])

  return (
    <div className="docx-root">
      {phase.kind === 'loading' && <div className="viewer-center">{tv(lang, 'loading')}</div>}
      {phase.kind === 'error' && (
        <div className="viewer-center">
          <p>{tv(lang, 'errorTitle')}</p>
        </div>
      )}
      <div className="docx-toolbar" style={{ display: phase.kind === 'ready' ? 'flex' : 'none' }}>
        <button type="button" onClick={() => setZoomPercent(zoomOut(zoomPercent))} disabled={zoomPercent <= ZOOM_STEPS[0]}>
          −
        </button>
        <span className="viewer-muted">{zoomPercent}%</span>
        <button
          type="button"
          onClick={() => setZoomPercent(zoomIn(zoomPercent))}
          disabled={zoomPercent >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
        >
          +
        </button>
      </div>
      <div className="docx-scroll" style={{ visibility: phase.kind === 'ready' ? 'visible' : 'hidden' }}>
        <div
          ref={containerRef}
          className="docx-pages"
          style={{ transform: `scale(${zoomPercent / 100})`, transformOrigin: 'top center' }}
        />
      </div>
    </div>
  )
}
