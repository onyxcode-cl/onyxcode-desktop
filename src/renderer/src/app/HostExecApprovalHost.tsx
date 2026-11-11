/**
 * Tarjeta «¿Ejecutar este comando en tu computador?» de la herramienta `equipo` de las Tareas. La pide y la decide main
 * (`host-exec/approvals.ts`): aquí solo se muestra y se responde. Se monta una vez en `App.tsx`, así se ve en cualquier sección.
 *
 * Reglas (iguales a la confirmación del celular y a las tarjetas del navegador):
 *  - El comando se muestra COMPLETO tal cual se ejecutará, con el motivo del agente y la carpeta de la tarea.
 *  - «No» tiene el foco y responde a Enter/Esc; «Permitir esta vez» se activa tras 1,5 s (evita un Enter por inercia).
 *  - No hay «permitir siempre». Si nadie responde, main lo deniega solo al vencer (cuenta regresiva visible).
 */
import { useEffect, useRef, useState } from 'react'
import { TerminalSquare } from 'lucide-react'
import type { HostExecApprovalRequest, HostExecDecision } from '@shared/ipc-tasks'
import { Button } from '../components/Button'
import { useT } from '../lib/i18n'
import { cw, hasTasksBridge, onTasks } from '../features/tasks/impl/bridge'

/** Margen antes de poder pulsar «Permitir esta vez». */
export const HOST_ALLOW_DELAY_MS = 1500

/** Estado visible de la tarjeta en un instante (puro, para pruebas). */
export function hostApprovalView(
  req: HostExecApprovalRequest,
  shownAt: number,
  now: number
): { canAllow: boolean; secondsLeft: number; expired: boolean } {
  return {
    canAllow: now - shownAt >= HOST_ALLOW_DELAY_MS,
    secondsLeft: Math.max(0, Math.ceil((req.expiresAt - now) / 1000)),
    expired: now >= req.expiresAt
  }
}

type Item = { req: HostExecApprovalRequest; shownAt: number }

export function HostExecApprovalHost(): React.JSX.Element | null {
  const t = useT()
  const [queue, setQueue] = useState<Item[]>([])
  const [now, setNow] = useState(() => Date.now())
  const dialogRef = useRef<HTMLDivElement>(null)
  const current = queue[0] ?? null

  useEffect(() => {
    if (!hasTasksBridge()) return
    const add = (req: HostExecApprovalRequest): void =>
      setQueue((q) => (q.some((x) => x.req.id === req.id) ? q : [...q, { req, shownAt: Date.now() }]))
    const offReq = onTasks('tasks:hostExec:approval', add)
    const offDone = onTasks('tasks:hostExec:approvalDone', ({ id }) => setQueue((q) => q.filter((x) => x.req.id !== id)))
    // Las que ya esperaban antes de abrir esta ventana.
    void cw('tasks:hostExec:pending')
      .then((list) => list.forEach(add))
      .catch(() => undefined)
    return () => {
      offReq()
      offDone()
    }
  }, [])

  const id = current?.req.id
  useEffect(() => {
    if (!id) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 250)
    dialogRef.current?.querySelector<HTMLButtonElement>('[data-reject]')?.focus()
    return () => clearInterval(timer)
  }, [id])

  // Venció: main ya la denegó; aquí solo se cierra.
  useEffect(() => {
    if (current && now >= current.req.expiresAt) setQueue((q) => q.filter((x) => x.req.id !== current.req.id))
  }, [now, current])

  const answer = (decision: HostExecDecision): void => {
    if (!current) return
    const rid = current.req.id
    setQueue((q) => q.filter((x) => x.req.id !== rid))
    void cw('tasks:hostExec:respond', { id: rid, decision }).catch(() => undefined)
  }

  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        answer('deny')
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current])

  if (!current) return null
  const { req, shownAt } = current
  const view = hostApprovalView(req, shownAt, now)

  return (
    <div className="fixed inset-0 z-[305] flex items-center justify-center bg-fg/30 p-6 animate-fade-in" data-host-exec-scrim="">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="host-exec-title"
        aria-describedby="host-exec-body"
        data-host-exec-approval={req.id}
        className="flex max-h-full w-full max-w-lg flex-col rounded-2xl border border-warning/40 bg-elevated p-5 shadow-2xl"
      >
        <div className="mb-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <TerminalSquare size={20} />
        </div>
        <h3 id="host-exec-title" className="shrink-0 text-base font-semibold">
          {t('tasks.hostExec.title')}
        </h3>
        <p className="mt-1 shrink-0 text-xs text-muted">{t('tasks.hostExec.intro')}</p>
        <div id="host-exec-body" className="mt-3 min-h-0 space-y-3 overflow-y-auto overscroll-contain">
          <div>
            <p className="text-xs font-medium text-muted">{t('tasks.hostExec.command')}</p>
            <pre
              data-host-exec-command=""
              className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs text-fg"
            >
              {req.command}
            </pre>
          </div>
          <div>
            <p className="text-xs font-medium text-muted">{t('tasks.hostExec.reason')}</p>
            <p className="mt-0.5 break-words text-sm text-fg">{req.reason}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted">{t('tasks.hostExec.folder')}</p>
            <p className="mt-0.5 break-all font-mono text-xs text-fg">{req.folder}</p>
          </div>
          <p className="text-xs text-muted">
            {req.background ? t('tasks.hostExec.background') : t('tasks.hostExec.timeout', { seconds: req.timeoutS })}
          </p>
          <p className="text-xs text-muted">{t('tasks.hostExec.once')}</p>
        </div>
        <p className="mt-3 shrink-0 text-xs font-medium text-fg" aria-live="off">
          {t('tasks.hostExec.expiresIn', { seconds: view.secondsLeft })}
        </p>
        <div className="mt-4 flex shrink-0 justify-end gap-2">
          <Button data-reject variant="secondary" onClick={() => answer('deny')} autoFocus>
            {t('tasks.hostExec.no')}
          </Button>
          <Button variant="primary" disabled={!view.canAllow} onClick={() => answer('allow')}>
            {t('tasks.hostExec.allowOnce')}
          </Button>
        </div>
      </div>
    </div>
  )
}
