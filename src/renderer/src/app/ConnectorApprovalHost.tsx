/**
 * Tarjeta «¿Usar esta herramienta del conector?» para los conectores de la persona con «preguntar cada herramienta» en Tareas aisladas.
 * La pide y la decide main (`tasks/connector-approvals.ts`; el proxy retiene la llamada). Mismas reglas que la de `equipo`
 * (`HostExecApprovalHost.tsx`): argumentos completos con desplazamiento, líneas y caracteres, saltos y tabuladores marcados, lo no ASCII
 * resaltado, «No» con el foco (Enter/Esc), los botones de permitir se activan 1,5 s después de VERSE y, si los datos desbordan, solo tras
 * bajar hasta el final. Además de «Permitir esta vez», «Permitir en esta tarea» (esa herramienta, hasta cerrar la tarea). Nunca «siempre».
 */
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Plug } from 'lucide-react'
import type { ConnectorApprovalRequest, ConnectorDecision } from '@shared/ipc-tasks'
import { Button } from '../components/Button'
import { useT } from '../lib/i18n'
import { cw, hasTasksBridge, onTasks } from '../features/tasks/impl/bridge'
import { commandPieces, commandStats, hostApprovalView, type ScrollState } from './HostExecApprovalHost'

function measureScroll(el: HTMLElement): { overflows: boolean; atEnd: boolean } {
  const overflows = el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1
  return { overflows, atEnd: el.scrollTop + el.clientHeight >= el.scrollHeight - 2 }
}

export function ConnectorApprovalHost(): React.JSX.Element | null {
  const t = useT()
  const [queue, setQueue] = useState<ConnectorApprovalRequest[]>([])
  const [now, setNow] = useState(() => Date.now())
  const [shownAt, setShownAt] = useState<number | null>(null)
  const [scroll, setScroll] = useState<ScrollState>({ overflows: false, reachedEnd: false })
  const dialogRef = useRef<HTMLDivElement>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const current = queue[0] ?? null

  useEffect(() => {
    if (!hasTasksBridge()) return
    const add = (req: ConnectorApprovalRequest): void => setQueue((q) => (q.some((x) => x.id === req.id) ? q : [...q, req]))
    const offReq = onTasks('tasks:connector:approval', add)
    const offDone = onTasks('tasks:connector:approvalDone', ({ id }) => setQueue((q) => q.filter((x) => x.id !== id)))
    void cw('tasks:connector:pending')
      .then((list) => list.forEach(add))
      .catch(() => undefined)
    return () => {
      offReq()
      offDone()
    }
  }, [])

  const id = current?.id
  useEffect(() => {
    if (!id) {
      setShownAt(null)
      return
    }
    const t0 = Date.now()
    setShownAt(t0)
    setNow(t0)
    const el = preRef.current
    const m = el ? measureScroll(el) : { overflows: false, atEnd: true }
    setScroll({ overflows: m.overflows, reachedEnd: !m.overflows || m.atEnd })
    const timer = setInterval(() => setNow(Date.now()), 250)
    dialogRef.current?.querySelector<HTMLButtonElement>('[data-reject]')?.focus()
    return () => clearInterval(timer)
  }, [id])

  const onScroll = useCallback((): void => {
    const el = preRef.current
    if (!el) return
    const m = measureScroll(el)
    setScroll((s) => ({ overflows: m.overflows, reachedEnd: s.reachedEnd || m.atEnd || !m.overflows }))
  }, [])

  useEffect(() => {
    if (current && now >= current.expiresAt) setQueue((q) => q.filter((x) => x.id !== current.id))
  }, [now, current])

  const answer = (decision: ConnectorDecision): void => {
    if (!current) return
    const rid = current.id
    setQueue((q) => q.filter((x) => x.id !== rid))
    void cw('tasks:connector:respond', { id: rid, decision }).catch(() => undefined)
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
  const req = current
  const view = hostApprovalView(req, shownAt, now, scroll)
  const stats = commandStats(req.args)

  return (
    <div className="fixed inset-0 z-[304] flex items-center justify-center bg-fg/30 p-6 animate-fade-in" data-connector-scrim="">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="connector-approval-title"
        aria-describedby="connector-approval-body"
        data-connector-approval={req.id}
        className="flex max-h-full w-full max-w-lg flex-col rounded-2xl border border-warning/40 bg-elevated p-5 shadow-2xl"
      >
        <div className="mb-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Plug size={20} />
        </div>
        <h3 id="connector-approval-title" className="shrink-0 text-base font-semibold">
          {t('tasks.connector.title')}
        </h3>
        <p className="mt-1 shrink-0 text-xs text-muted">{t('tasks.connector.intro')}</p>
        <div id="connector-approval-body" className="mt-3 min-h-0 space-y-3 overflow-y-auto overscroll-contain">
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <span className="font-medium text-muted">{t('tasks.connector.server')}</span>
            <span className="break-all font-mono text-fg" data-connector-server="">
              {req.server}
            </span>
            <span className="font-medium text-muted">{t('tasks.connector.tool')}</span>
            <span className="break-all font-mono text-fg" data-connector-tool="">
              {req.tool}
            </span>
          </div>
          <div>
            <p className="flex justify-between gap-2 text-xs font-medium text-muted">
              <span>{t('tasks.connector.args')}</span>
              <span data-connector-stats="">{t('tasks.hostExec.stats', { lines: stats.lines, chars: stats.chars })}</span>
            </p>
            <pre
              ref={preRef}
              onScroll={onScroll}
              data-connector-args=""
              className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs text-fg"
            >
              {commandPieces(req.args).map((p, i) =>
                p.kind === 'newline' ? (
                  <Fragment key={i}>{'\n'}</Fragment>
                ) : p.kind === 'tab' ? (
                  <Fragment key={i}>
                    <span aria-hidden="true" className="select-none text-subtle" data-mark="tab">
                      →
                    </span>
                    {'\t'}
                  </Fragment>
                ) : p.kind === 'nonascii' ? (
                  <mark key={i} data-mark="nonascii" className="rounded-sm bg-warning/30 text-fg">
                    {p.text}
                  </mark>
                ) : (
                  <Fragment key={i}>{p.text}</Fragment>
                )
              )}
            </pre>
            {stats.nonAscii && <p className="mt-1 text-xs text-warning">{t('tasks.hostExec.nonAscii')}</p>}
            {view.needsScroll && (
              <p className="mt-1 text-xs font-medium text-fg" data-connector-scroll-hint="">
                {t('tasks.hostExec.scrollToEnd')}
              </p>
            )}
          </div>
          <div>
            <p className="text-xs font-medium text-muted">{t('tasks.hostExec.folder')}</p>
            <p className="mt-0.5 break-all font-mono text-xs text-fg">{req.folder}</p>
          </div>
          <p className="text-xs text-muted">{t('tasks.connector.taskHint')}</p>
        </div>
        <p className="mt-3 shrink-0 text-xs font-medium text-fg" aria-live="off">
          {t('tasks.connector.expiresIn', { seconds: view.secondsLeft })}
        </p>
        <div className="mt-4 flex shrink-0 flex-wrap justify-end gap-2">
          <Button data-reject variant="secondary" onClick={() => answer('deny')} autoFocus>
            {t('tasks.hostExec.no')}
          </Button>
          <Button variant="secondary" disabled={!view.canAllow} onClick={() => answer('task')}>
            {t('tasks.connector.allowTask')}
          </Button>
          <Button variant="primary" disabled={!view.canAllow} onClick={() => answer('allow')}>
            {t('tasks.hostExec.allowOnce')}
          </Button>
        </div>
      </div>
    </div>
  )
}
