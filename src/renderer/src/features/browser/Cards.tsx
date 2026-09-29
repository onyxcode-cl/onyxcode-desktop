/**
 * Tarjetas de aprobación por sitio (B.8). Se renderizan FUERA del rectángulo de la vista nativa
 * (empujan la página hacia abajo en el flujo normal; nunca se superponen a ella). Contra
 * clickjacking: los botones se arman a los 700 ms de aparecer, el foco por defecto está en "No"
 * y Esc deniega de inmediato (no depende del armado: es un atajo de teclado, no un clic).
 */
import { useEffect, useRef, useState } from 'react'
import type { BrowserApprovalRequest, BrowserDecision } from '@shared/ipc-browser'
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

function titleFor(req: BrowserApprovalRequest): string {
  switch (req.kind) {
    case 'site':
      return `¿Dejar que el agente abra ${req.site}?`
    case 'local-origin':
      return `¿Dejar que el agente abra tu servidor local ${req.host}?`
    case 'sensitive':
      return req.summary ?? 'El agente quiere realizar una acción sensible.'
    case 'download':
      return req.summary ?? `El agente quiere descargar ${req.fileName ?? req.url}`
  }
}

function ApprovalCard({
  req,
  onRespond
}: {
  req: BrowserApprovalRequest
  onRespond: (id: string, decision: BrowserDecision) => void
}): React.JSX.Element {
  const armed = useArmed(req.createdAt)
  const denyRef = useRef<HTMLButtonElement>(null)
  const simple = approvalButtons(req.kind) === 'simple'

  useEffect(() => {
    denyRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onRespond(req.id, 'deny')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [req.id, onRespond])

  const btn = 'shrink-0 rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-40'

  return (
    <div role="group" aria-label="Aprobación del navegador" className="rounded-xl border border-warning/40 bg-elevated px-3.5 py-2.5 shadow-md">
      <p className="text-sm text-fg/90">{titleFor(req)}</p>
      <p className="mt-1 truncate font-mono text-[11px] text-subtle" title={req.url}>
        {req.url}
      </p>
      <div className="mt-2.5 flex justify-end gap-1.5">
        {simple ? (
          <>
            <button ref={denyRef} type="button" disabled={!armed} onClick={() => onRespond(req.id, 'deny')} className={`${btn} text-muted hover:bg-hover hover:text-fg`}>
              Cancelar
            </button>
            <button type="button" disabled={!armed} onClick={() => onRespond(req.id, 'allow')} className={`${btn} bg-accent text-accent-fg hover:opacity-90`}>
              Permitir
            </button>
          </>
        ) : (
          <>
            <button ref={denyRef} type="button" disabled={!armed} onClick={() => onRespond(req.id, 'deny')} className={`${btn} text-muted hover:bg-hover hover:text-fg`}>
              No
            </button>
            <button type="button" disabled={!armed} onClick={() => onRespond(req.id, 'task')} className={`${btn} border border-border hover:border-border-strong hover:bg-hover`}>
              Permitir en esta tarea
            </button>
            <button type="button" disabled={!armed} onClick={() => onRespond(req.id, 'always')} className={`${btn} bg-accent text-accent-fg hover:opacity-90`}>
              Permitir siempre
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
      {requests.map((r) => (
        <ApprovalCard key={r.id} req={r} onRespond={onRespond} />
      ))}
    </div>
  )
}
