/**
 * Tarjeta «¿Ejecutar este comando en tu computador?» de la herramienta `equipo` de las Tareas. La pide y la decide main
 * (`host-exec/approvals.ts`): aquí solo se muestra y se responde. Se monta una vez en `App.tsx`, así se ve en cualquier sección.
 *
 * Reglas (iguales a la confirmación del celular y a las tarjetas del navegador):
 *  - El comando se muestra COMPLETO tal cual se ejecutará, con desplazamiento, su número de líneas y caracteres, los saltos de línea (⏎) y
 *    tabuladores (→) marcados y lo que no es ASCII resaltado (letras parecidas de otros alfabetos). Si no cabe, «Permitir esta vez» solo se
 *    activa después de bajar hasta el final.
 *  - El motivo va DESPUÉS del comando, en texto normal y rotulado como lo que dice el agente, sin verificar.
 *  - «No» tiene el foco y responde a Enter/Esc; «Permitir esta vez» se activa 1,5 s después de que la tarjeta pasa a VERSE (no al llegar:
 *    con dos tarjetas en cola, la segunda no aparece ya armada).
 *  - No hay «permitir siempre». Si nadie responde, main lo deniega solo al vencer (cuenta regresiva visible).
 */
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { TerminalSquare } from 'lucide-react'
import type { HostExecApprovalRequest, HostExecDecision } from '@shared/ipc-tasks'
import { Button } from '../components/Button'
import { useT } from '../lib/i18n'
import { cw, hasTasksBridge, onTasks } from '../features/tasks/impl/bridge'

/** Margen antes de poder pulsar «Permitir esta vez», contado desde que la tarjeta se VE. */
export const HOST_ALLOW_DELAY_MS = 1500

export interface ScrollState {
  /** El comando no cabe en su recuadro. */
  overflows: boolean
  /** Ya se bajó hasta el final (o no hacía falta). */
  reachedEnd: boolean
}

/** Estado visible de la tarjeta en un instante (puro, para pruebas). `shownAt` null = aún no se ve. */
export function hostApprovalView(
  req: Pick<HostExecApprovalRequest, 'expiresAt'>,
  shownAt: number | null,
  now: number,
  scroll: ScrollState = { overflows: false, reachedEnd: true }
): { canAllow: boolean; needsScroll: boolean; secondsLeft: number; expired: boolean } {
  const needsScroll = scroll.overflows && !scroll.reachedEnd
  return {
    canAllow: shownAt !== null && now - shownAt >= HOST_ALLOW_DELAY_MS && !needsScroll,
    needsScroll,
    secondsLeft: Math.max(0, Math.ceil((req.expiresAt - now) / 1000)),
    expired: now >= req.expiresAt
  }
}

/** Trozos del comando para pintarlo: texto ASCII normal, saltos y tabuladores marcados, y lo que no es ASCII resaltado. */
export type CommandPiece = { kind: 'text' | 'newline' | 'tab' | 'nonascii'; text: string }
export function commandPieces(command: string): CommandPiece[] {
  const out: CommandPiece[] = []
  for (const ch of command) {
    const cp = ch.codePointAt(0) ?? 0
    const kind: CommandPiece['kind'] = ch === '\n' ? 'newline' : ch === '\t' ? 'tab' : cp > 0x7e || cp < 0x20 ? 'nonascii' : 'text'
    const last = out[out.length - 1]
    if (last && last.kind === kind && (kind === 'text' || kind === 'nonascii')) last.text += ch
    else out.push({ kind, text: ch })
  }
  return out
}

export function commandStats(command: string): { lines: number; chars: number; nonAscii: boolean } {
  return { lines: command.split('\n').length, chars: [...command].length, nonAscii: /[^\x20-\x7e\t\n]/.test(command) }
}

function measureScroll(el: HTMLElement): { overflows: boolean; atEnd: boolean } {
  const overflows = el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1
  const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 2
  return { overflows, atEnd }
}

export function HostExecApprovalHost(): React.JSX.Element | null {
  const t = useT()
  const [queue, setQueue] = useState<HostExecApprovalRequest[]>([])
  const [now, setNow] = useState(() => Date.now())
  const [shownAt, setShownAt] = useState<number | null>(null)
  const [scroll, setScroll] = useState<ScrollState>({ overflows: false, reachedEnd: false })
  const dialogRef = useRef<HTMLDivElement>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const current = queue[0] ?? null

  useEffect(() => {
    if (!hasTasksBridge()) return
    const add = (req: HostExecApprovalRequest): void => setQueue((q) => (q.some((x) => x.id === req.id) ? q : [...q, req]))
    const offReq = onTasks('tasks:hostExec:approval', add)
    const offDone = onTasks('tasks:hostExec:approvalDone', ({ id }) => setQueue((q) => q.filter((x) => x.id !== id)))
    // Las que ya esperaban antes de abrir esta ventana.
    void cw('tasks:hostExec:pending')
      .then((list) => list.forEach(add))
      .catch(() => undefined)
    return () => {
      offReq()
      offDone()
    }
  }, [])

  // La tarjeta pasa a VERSE: desde aquí cuentan el margen de 1,5 s, el foco y la medida del desplazamiento.
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
    // Llegar al final una vez basta (no se vuelve a bloquear al subir para releer).
    setScroll((s) => ({ overflows: m.overflows, reachedEnd: s.reachedEnd || m.atEnd || !m.overflows }))
  }, [])

  // Venció: main ya la denegó; aquí solo se cierra.
  useEffect(() => {
    if (current && now >= current.expiresAt) setQueue((q) => q.filter((x) => x.id !== current.id))
  }, [now, current])

  const answer = (decision: HostExecDecision): void => {
    if (!current) return
    const rid = current.id
    setQueue((q) => q.filter((x) => x.id !== rid))
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
  const req = current
  const view = hostApprovalView(req, shownAt, now, scroll)
  const stats = commandStats(req.command)

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
            <p className="flex justify-between gap-2 text-xs font-medium text-muted">
              <span>{t('tasks.hostExec.command')}</span>
              <span data-host-exec-stats="">{t('tasks.hostExec.stats', { lines: stats.lines, chars: stats.chars })}</span>
            </p>
            <pre
              ref={preRef}
              onScroll={onScroll}
              data-host-exec-command=""
              className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs text-fg"
            >
              {commandPieces(req.command).map((p, i) =>
                p.kind === 'newline' ? (
                  <Fragment key={i}>
                    <span aria-hidden="true" className="select-none text-subtle" data-mark="newline">
                      ⏎
                    </span>
                    {'\n'}
                  </Fragment>
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
              <p className="mt-1 text-xs font-medium text-fg" data-host-exec-scroll-hint="">
                {t('tasks.hostExec.scrollToEnd')}
              </p>
            )}
          </div>
          <div>
            <p className="text-xs font-medium text-muted">{t('tasks.hostExec.folder')}</p>
            <p className="mt-0.5 break-all font-mono text-xs text-fg">{req.folder}</p>
          </div>
          <p className="text-xs text-muted">
            {req.background ? t('tasks.hostExec.background') : t('tasks.hostExec.timeout', { seconds: req.timeoutS })}{' '}
            {t('tasks.hostExec.vault')}
          </p>
          <div data-host-exec-reason="">
            <p className="text-xs font-medium text-muted">{t('tasks.hostExec.reason')}</p>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-muted">{req.reason}</p>
          </div>
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
