/**
 * Tarjetas de aprobación por sitio (B.8). Se renderizan FUERA del rectángulo de la vista nativa
 * (empujan la página hacia abajo en el flujo normal; nunca se superponen a ella). Contra
 * clickjacking: los botones se arman a los 700 ms de aparecer, el foco por defecto se coloca en
 * "No"/"Cancelar" EN CUANTO se arman (un botón `disabled` no recibe foco, así que enfocar al montar
 * no servía) y Esc deniega de inmediato (no depende del armado: es un atajo de teclado, no un
 * clic). Con varias tarjetas apiladas, solo la primera toma el foco y responde a Esc (un Esc = una
 * denegación; no deniega todas a la vez).
 */
import { useEffect, useRef, useState } from 'react'
import type { BrowserApprovalRequest, BrowserDecision } from '@shared/ipc-browser'
import { useT } from '../../lib/i18n'
import { approvalButtons, armRemainingMs, isCardArmed } from './store'

function useArmed(createdAt: number): boolean {
  const [armed, setArmed] = useState(() => isCardArmed(Date.now() - createdAt))
  useEffect(() => {
    if (armed) return
    const t = setTimeout(() => setArmed(true), armRemainingMs(createdAt, Date.now()))
    return () => clearTimeout(t)
  }, [armed, createdAt])
  return armed
}

function titleFor(req: BrowserApprovalRequest, t: ReturnType<typeof useT>): string {
  switch (req.kind) {
    case 'site':
      return t('browser.card.site', { site: req.site })
    case 'local-origin':
      return t('browser.card.local', { host: req.host })
    case 'sensitive':
      return req.summary ?? t('browser.card.sensitive')
    case 'download':
      return req.summary ?? t('browser.card.download', { file: req.fileName ?? req.url })
  }
}

function ApprovalCard({
  req,
  first,
  onRespond
}: {
  req: BrowserApprovalRequest
  first: boolean
  onRespond: (id: string, decision: BrowserDecision) => void
}): React.JSX.Element {
  const t = useT()
  const armed = useArmed(req.createdAt)
  const denyRef = useRef<HTMLButtonElement>(null)
  const simple = approvalButtons(req.kind) === 'simple'

  useEffect(() => {
    if (armed && first) denyRef.current?.focus({ preventScroll: true })
  }, [armed, first])

  useEffect(() => {
    if (!first) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onRespond(req.id, 'deny')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [req.id, first, onRespond])

  const btn = 'shrink-0 rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-40'

  return (
    <div
      role="group"
      aria-label={t('browser.card.aria')}
      className="rounded-xl border border-warning/40 bg-elevated px-3.5 py-2.5 shadow-md"
    >
      <p className="text-sm text-fg/90">{titleFor(req, t)}</p>
      <p className="mt-1 truncate font-mono text-[11px] text-subtle" title={req.url}>
        {req.url}
      </p>
      <div className="mt-2.5 flex justify-end gap-1.5">
        {simple ? (
          <>
            <button
              ref={denyRef}
              type="button"
              disabled={!armed}
              onClick={() => onRespond(req.id, 'deny')}
              className={`${btn} text-muted hover:bg-hover hover:text-fg`}
            >
              {t('browser.card.cancel')}
            </button>
            <button
              type="button"
              disabled={!armed}
              onClick={() => onRespond(req.id, 'allow')}
              className={`${btn} bg-accent text-accent-fg hover:opacity-90`}
            >
              {t('browser.card.allow')}
            </button>
          </>
        ) : (
          <>
            <button
              ref={denyRef}
              type="button"
              disabled={!armed}
              onClick={() => onRespond(req.id, 'deny')}
              className={`${btn} text-muted hover:bg-hover hover:text-fg`}
            >
              {t('browser.card.no')}
            </button>
            <button
              type="button"
              disabled={!armed}
              onClick={() => onRespond(req.id, 'task')}
              className={`${btn} border border-border hover:border-border-strong hover:bg-hover`}
            >
              {t('browser.card.allowTask')}
            </button>
            <button
              type="button"
              disabled={!armed}
              onClick={() => onRespond(req.id, 'always')}
              className={`${btn} bg-accent text-accent-fg hover:opacity-90`}
            >
              {t('browser.card.allowAlways')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export function Cards({
  requests,
  onRespond
}: {
  requests: BrowserApprovalRequest[]
  onRespond: (id: string, decision: BrowserDecision) => void
}): React.JSX.Element | null {
  if (requests.length === 0) return null
  return (
    <div className="flex flex-col gap-2 border-b border-border bg-bg px-3 py-2.5">
      {requests.map((r, i) => (
        <ApprovalCard key={r.id} req={r} first={i === 0} onRespond={onRespond} />
      ))}
    </div>
  )
}
