/**
 * Detalle de un elemento elegido en el navegador: selector, ruta, HTML saneado, estilos, captura y diagnóstico. Lo usan el
 * chip del compositor (con las dos casillas) y el chip de solo lectura de la burbuja del usuario. En el celular es una hoja
 * inferior (`PopoverPanel`); en escritorio, un diálogo flotante en un portal (no lo recorta el scroll de la conversación).
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { CopyButton } from '../../components/CopyButton'
import { PopoverPanel } from '../../components/PopoverPanel'
import { useT } from '../../lib/i18n'
import { isRemoteSurface } from '../../lib/platform'
import type { ElementDetail, ElementInclude } from './element-context'

const POPOVER_W = 380
const POPOVER_MAX_H = 420
const GAP = 8

interface Pos {
  left: number
  top?: number
  bottom?: number
}

/** Coloca el diálogo junto al ancla: encima si arriba cabe (compositor), si no debajo; siempre dentro de la ventana. */
export function placePopover(anchor: { left: number; top: number; bottom: number }, win: { width: number; height: number }): Pos {
  const left = Math.max(GAP, Math.min(anchor.left, win.width - POPOVER_W - GAP))
  if (anchor.top >= POPOVER_MAX_H + GAP * 2) return { left, bottom: win.height - anchor.top + GAP }
  return { left, top: Math.min(anchor.bottom + GAP, Math.max(GAP, win.height - POPOVER_MAX_H - GAP)) }
}

export interface ElementDetailPopoverProps {
  detail: ElementDetail
  anchor: HTMLElement | null
  onClose: () => void
  /** Solo en el compositor: casillas para elegir qué viaja. Sin ellas (burbuja) el detalle es de solo lectura. */
  include?: ElementInclude
  onIncludeChange?: (next: ElementInclude) => void
  /** Hay captura utilizable (y el elemento no es sensible). */
  canIncludeImage?: boolean
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="flex flex-col gap-1">
      <h4 className="text-[11px] desk:text-meta font-medium tracking-wide text-subtle">{title}</h4>
      {children}
    </section>
  )
}

function Row({ label, value, copyLabel }: { label: string; value: string; copyLabel: string }): React.JSX.Element {
  return (
    <div className="flex items-start gap-1">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] desk:text-meta text-subtle">{label}</div>
        <div className="font-mono text-[12px] break-all text-fg">{value}</div>
      </div>
      <CopyButton text={value} label={copyLabel} />
    </div>
  )
}

/** Contenido del detalle (exportado para las pruebas de render estático). */
export function ElementDetailBody({
  detail,
  include,
  onIncludeChange,
  canIncludeImage
}: Omit<ElementDetailPopoverProps, 'anchor' | 'onClose'>): React.JSX.Element {
  const t = useT()
  const imgId = useId()
  const diagId = useId()
  const diagCount = detail.console.length + detail.network.length
  return (
    <div className="flex flex-col gap-3 p-3 text-[12px]">
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium text-fg">{detail.title || detail.host}</div>
        <div className="truncate text-[11px] desk:text-meta text-subtle">{detail.url}</div>
      </div>
      <Row label={t('browser.element.selector')} value={detail.selector} copyLabel={t('browser.element.copySelector')} />
      <Row label={t('browser.element.path')} value={detail.path} copyLabel={t('browser.element.copyPath')} />
      {detail.imageUrl && (
        <img
          src={detail.imageUrl}
          alt={t('browser.element.imageAlt')}
          className="max-h-40 max-w-full self-start rounded-lg border border-border object-contain"
        />
      )}
      {include && onIncludeChange && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-bg px-2.5 py-2">
          <label htmlFor={imgId} className={`flex items-center gap-2 ${canIncludeImage ? 'text-fg' : 'text-subtle'}`}>
            <input
              id={imgId}
              type="checkbox"
              checked={include.image && !!canIncludeImage}
              disabled={!canIncludeImage}
              onChange={(e) => onIncludeChange({ ...include, image: e.target.checked })}
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            {t('browser.element.includeImage')}
            {!canIncludeImage && <span className="text-[11px] desk:text-meta text-subtle">· {t('browser.element.noImage')}</span>}
          </label>
          <label htmlFor={diagId} className={`flex items-center gap-2 ${diagCount > 0 ? 'text-fg' : 'text-subtle'}`}>
            <input
              id={diagId}
              type="checkbox"
              checked={include.diagnostics && diagCount > 0}
              disabled={diagCount === 0}
              onChange={(e) => onIncludeChange({ ...include, diagnostics: e.target.checked })}
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            {t('browser.element.includeDiag')}
            {diagCount > 0 && (
              <span className="text-[11px] desk:text-meta text-danger">· {t('browser.element.errors', { count: diagCount })}</span>
            )}
          </label>
        </div>
      )}
      {detail.sensitive && (
        <p role="note" className="text-[11px] desk:text-meta text-warning">
          {t('browser.element.sensitive')}
        </p>
      )}
      {detail.redactions > 0 && (
        <p role="note" className="text-[11px] desk:text-meta text-muted">
          {t('browser.element.redacted', { count: detail.redactions })}
        </p>
      )}
      {detail.truncated && (
        <p role="note" className="text-[11px] desk:text-meta text-muted">
          {t('browser.element.truncated')}
        </p>
      )}
      {detail.html && (
        <Section title={t('browser.element.html')}>
          <pre className="max-h-40 overflow-auto rounded-lg bg-code px-2.5 py-2 font-mono text-[11.5px] desk:text-meta whitespace-pre-wrap break-all text-fg">
            {detail.html}
          </pre>
        </Section>
      )}
      {detail.styles.length > 0 && (
        <Section title={t('browser.element.styles')}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11.5px] desk:text-meta">
            {detail.styles.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-mono text-subtle">{k}</dt>
                <dd className="font-mono break-all text-fg">{v}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}
      {detail.console.length > 0 && (
        <Section title={t('browser.element.console')}>
          <ul className="flex flex-col gap-0.5 font-mono text-[11.5px] desk:text-meta break-all text-danger">
            {detail.console.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </Section>
      )}
      {detail.network.length > 0 && (
        <Section title={t('browser.element.network')}>
          <ul className="flex flex-col gap-0.5 font-mono text-[11.5px] desk:text-meta break-all text-danger">
            {detail.network.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </Section>
      )}
      {include && diagCount > 0 && <p className="text-[11px] desk:text-meta text-subtle">{t('browser.element.diagSince')}</p>}
      {include && diagCount === 0 && <p className="text-[11px] desk:text-meta text-subtle">{t('browser.element.noDiag')}</p>}
    </div>
  )
}

export function ElementDetailPopover(props: ElementDetailPopoverProps): React.JSX.Element | null {
  const t = useT()
  const { anchor, onClose } = props
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<Pos | null>(null)
  const mobile = isRemoteSurface()
  const titleId = useId()

  useLayoutEffect(() => {
    if (mobile || !anchor) return
    const place = (): void => setPos(placePopover(anchor.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }))
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchor, mobile])

  // Foco al abrir; Esc cierra solo el diálogo (no llega a quien cancela la selección); clic fuera cierra.
  useEffect(() => {
    if (mobile) return
    ref.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
      anchor?.focus()
    }
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (ref.current?.contains(target) || anchor?.contains(target)) return
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown)
    }
  }, [anchor, onClose, mobile])

  if (mobile) {
    return (
      <PopoverPanel open onClose={onClose} title={t('browser.element.title')} size="full">
        <ElementDetailBody {...props} />
      </PopoverPanel>
    )
  }
  if (!pos) return null
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, width: POPOVER_W, maxHeight: POPOVER_MAX_H }}
      className="z-50 max-w-[calc(100vw-16px)] overflow-y-auto rounded-xl border border-border bg-elevated shadow-lg outline-none"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-elevated px-3 py-1.5">
        <h3 id={titleId} className="text-[12px] font-medium text-fg">
          {t('browser.element.title')} · <span className="font-mono">{props.detail.label}</span>
        </h3>
        <button
          type="button"
          aria-label={t('browser.element.close')}
          title={t('browser.element.close')}
          onClick={() => {
            onClose()
            anchor?.focus()
          }}
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg"
        >
          <X size={13} />
        </button>
      </div>
      <ElementDetailBody {...props} />
    </div>,
    document.body
  )
}
