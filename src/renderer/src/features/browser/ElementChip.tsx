/**
 * Chips del elemento elegido en el navegador. `ElementChipRow` va en el compositor (Code y Tareas): chip con etiqueta,
 * botón quitar, detalle con casillas y un aviso accesible («Elemento añadido»). `ElementReadonlyChip` va en la burbuja del
 * usuario (escritorio y celular): chip compacto, con el mismo detalle, sin casillas.
 */
import { useEffect, useRef, useState } from 'react'
import { MousePointerClick, X } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { isRemoteSurface } from '../../lib/platform'
import { ElementDetailPopover } from './ElementDetailPopover'
import {
  detailFromElement,
  diagnosticsCount,
  effectiveInclude,
  usableImage,
  type ElementAttachment,
  type ElementDetail,
  type ElementInclude
} from './element-context'

function ElementChip({
  att,
  onRemove,
  onInclude
}: {
  att: ElementAttachment
  onRemove: () => void
  onInclude: (include: ElementInclude) => void
}): React.JSX.Element {
  const t = useT()
  const mobile = isRemoteSurface()
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const el = att.element
  const detail = detailFromElement(el)
  const inc = effectiveInclude(el, att.include)
  const thumb = inc.image ? usableImage(el)?.dataUrl : undefined
  const errors = inc.diagnostics ? diagnosticsCount(el) : 0
  return (
    <div className="group/att relative">
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t('browser.element.open', { name: att.name })}
        aria-label={t('browser.element.open', { name: att.name })}
        onClick={() => setOpen((o) => !o)}
        className={`flex w-[220px] max-w-full items-center gap-2 rounded-lg border border-border bg-bg pr-6 text-left hover:border-border-strong focus-visible:outline-2 ${mobile ? 'h-16' : 'h-14'}`}
      >
        <span
          className={`flex shrink-0 items-center justify-center overflow-hidden rounded-l-lg bg-hover text-subtle ${mobile ? 'h-16 w-16' : 'h-14 w-14'}`}
        >
          {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : <MousePointerClick size={18} />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-mono text-[12px] text-fg">{att.name}</span>
          <span className="truncate text-[11px] text-subtle">
            {detail.host} · {detail.size}
          </span>
          {errors > 0 && <span className="text-[10.5px] text-danger">{t('browser.element.errors', { count: errors })}</span>}
        </span>
      </button>
      <button
        type="button"
        title={t('browser.element.remove', { name: att.name })}
        aria-label={t('browser.element.remove', { name: att.name })}
        onClick={onRemove}
        className={
          mobile
            ? 'absolute -top-3.5 -right-3.5 flex h-11 w-11 items-center justify-center'
            : 'absolute top-0.5 right-0.5 flex h-5 w-5 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-fg focus-visible:opacity-100'
        }
      >
        {mobile ? (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-fg text-bg shadow">
            <X size={13} />
          </span>
        ) : (
          <X size={11} />
        )}
      </button>
      {open && (
        <ElementDetailPopover
          detail={detail}
          anchor={btnRef.current}
          onClose={() => setOpen(false)}
          include={att.include}
          onIncludeChange={onInclude}
          canIncludeImage={!!usableImage(el)}
        />
      )}
    </div>
  )
}

/** Fila de chips de elementos del compositor, con la región `aria-live` que anuncia «Elemento añadido». */
export function ElementChipRow({
  elements,
  onRemove,
  onInclude,
  className = ''
}: {
  elements: ElementAttachment[]
  onRemove: (id: string) => void
  onInclude: (id: string, include: ElementInclude) => void
  className?: string
}): React.JSX.Element {
  const t = useT()
  const [announce, setAnnounce] = useState('')
  const prev = useRef<string[]>(elements.map((e) => e.id))
  useEffect(() => {
    const before = prev.current
    const added = elements.filter((e) => !before.includes(e.id))
    if (added.length > 0) setAnnounce(t('browser.element.added', { name: added[added.length - 1]!.name }))
    else if (elements.length < before.length) setAnnounce(t('browser.element.removed'))
    prev.current = elements.map((e) => e.id)
    // `t` cambia con el idioma, no con el contenido: solo importa la lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements])
  return (
    <>
      <span role="status" aria-live="polite" className="sr-only">
        {announce}
      </span>
      {elements.length > 0 && (
        <div className={`flex flex-wrap gap-2 ${className}`} data-testid="element-chips">
          {elements.map((a) => (
            <ElementChip key={a.id} att={a} onRemove={() => onRemove(a.id)} onInclude={(inc) => onInclude(a.id, inc)} />
          ))}
        </div>
      )}
    </>
  )
}

/** Chip compacto de solo lectura (burbuja del usuario): `<tag> selector · host`, con el detalle al hacer clic. */
export function ElementReadonlyChip({ detail }: { detail: ElementDetail }): React.JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  return (
    <span className="inline-flex max-w-full">
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t('browser.element.open', { name: detail.label })}
        aria-label={t('browser.element.open', { name: detail.label })}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-lg border border-border bg-bg px-2 text-left text-[12px] hover:border-border-strong"
      >
        <MousePointerClick size={13} className="shrink-0 text-accent" />
        <span className="truncate font-mono text-fg">{detail.label}</span>
        <span className="shrink-0 text-[11px] text-subtle">· {detail.host}</span>
      </button>
      {open && <ElementDetailPopover detail={detail} anchor={btnRef.current} onClose={() => setOpen(false)} />}
    </span>
  )
}
