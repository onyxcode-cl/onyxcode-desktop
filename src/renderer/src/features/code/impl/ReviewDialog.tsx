/**
 * Diálogo «Revisar cambios» (experimental, `engineExperiments.codeExtras.review`). Lanza `/review` (agente de solo lectura del motor) y
 * pinta los hallazgos por archivo y línea como TEXTO PLANO: sin Markdown, sin enlaces ni rutas que se abran. Lo que llega ya pasó por
 * `parseReviewOutput` en main (validación defensiva: la salida del modelo no es de confianza) y aquí se vuelve a tratar como texto.
 * `role="dialog"` con foco atrapado y Esc para cerrar (DialogFrame); estados anunciados en una región `aria-live`.
 */
import { useEffect, useRef, useState } from 'react'
import { groupFindingsByFile, type ReviewFinding, type ReviewReport, type ReviewResult } from '@shared/engine-code-extras'
import type { MsgKey } from '@shared/i18n'
import { Button } from '../../../components/Button'
import { DialogFrame } from '../../../components/DialogFrame'
import { call } from '../../../lib/api'
import { useT } from '../../../lib/i18n'
import { resolveModelForMode } from '../../settings/impl/extras'
import { errorMessage } from './client'
import { useCode } from './store'

const PRIORITY_KEY: Record<ReviewFinding['priority'], MsgKey> = {
  P0: 'code.review.priority.P0',
  P1: 'code.review.priority.P1',
  P2: 'code.review.priority.P2',
  P3: 'code.review.priority.P3'
}
const PRIORITY_TONE: Record<ReviewFinding['priority'], string> = {
  P0: 'bg-danger/10 text-danger',
  P1: 'bg-danger/10 text-danger',
  P2: 'bg-hover text-fg',
  P3: 'bg-hover text-muted'
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'cancelled' }
  | { kind: 'error'; detail: string }
  | { kind: 'done'; result: ReviewResult }

export function ReviewReportView({ report, skipped }: { report: ReviewReport; skipped: number }): React.JSX.Element {
  const t = useT()
  const groups = groupFindingsByFile(report.findings)
  return (
    <div data-testid="review-report" className="flex flex-col gap-3">
      <p className="text-xs text-muted">{t('code.review.untrusted')}</p>
      <p className="font-medium text-fg">{t(report.correct ? 'code.review.verdict.correct' : 'code.review.verdict.incorrect')}</p>
      {report.explanation && <p className="break-words whitespace-pre-wrap">{report.explanation}</p>}
      {groups.length === 0 && <p>{t('code.review.none')}</p>}
      {groups.map((g) => (
        <section
          key={g.file}
          aria-label={t('code.review.file', { file: g.file })}
          className="rounded-lg border border-border bg-bg px-3 py-2"
        >
          <h3 className="font-mono text-xs font-semibold break-all text-fg">{g.file}</h3>
          <ul className="mt-2 flex flex-col gap-3">
            {g.findings.map((f, i) => (
              <li key={`${f.line}-${i}`} className="flex flex-col gap-1">
                <p className="flex flex-wrap items-center gap-2 text-fg">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_TONE[f.priority]}`}>
                    {t(PRIORITY_KEY[f.priority])}
                  </span>
                  <span className="font-medium break-words">{f.title}</span>
                </p>
                <p className="text-xs text-muted">
                  {f.lineEnd !== undefined
                    ? t('code.review.lines', { from: f.line, to: f.lineEnd })
                    : t('code.review.line', { line: f.line })}
                  {' · '}
                  {t('code.review.confidence', { percent: Math.round(f.confidence * 100) })}
                </p>
                <p className="break-words whitespace-pre-wrap">{f.body}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {skipped > 0 && <p className="text-xs text-muted">{t('code.review.skipped', { count: skipped })}</p>}
    </div>
  )
}

export function ReviewDialog({
  sessionId,
  directory,
  busy,
  onClose
}: {
  sessionId: string
  directory?: string
  busy: boolean
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const run = useRef(0)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const start = async (): Promise<void> => {
    const mine = ++run.current
    setPhase({ kind: 'running' })
    try {
      const picked = useCode.getState().model ?? resolveModelForMode('code')
      const result = await call('review:run', {
        sessionID: sessionId,
        ...(directory ? { directory } : {}),
        model: `${picked.providerID}/${picked.modelID}`
      })
      if (alive.current && mine === run.current) setPhase({ kind: 'done', result })
    } catch (err) {
      if (alive.current && mine === run.current) setPhase({ kind: 'error', detail: errorMessage(err) })
    }
  }

  const cancel = (): void => {
    run.current++ // el resultado que llegue después se ignora
    setPhase({ kind: 'cancelled' })
    void useCode.getState().abort()
  }

  const footer = (
    <>
      {phase.kind === 'running' ? (
        <Button variant="danger" onClick={cancel}>
          {t('code.review.cancel')}
        </Button>
      ) : (
        <Button variant="primary" disabled={busy} onClick={() => void start()}>
          {t('code.review.start')}
        </Button>
      )}
      <Button variant="ghost" onClick={onClose}>
        {t('code.extras.close')}
      </Button>
    </>
  )

  return (
    <DialogFrame title={t('code.review.title')} onClose={onClose} size="lg" footer={footer}>
      <div data-testid="review-dialog" className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
        <p className="leading-relaxed">{t('code.review.intro')}</p>
        {busy && phase.kind !== 'running' && <p>{t('code.review.busyNow')}</p>}
        <p role="status" aria-live="polite" className="text-fg">
          {phase.kind === 'running' && t('code.review.running')}
          {phase.kind === 'cancelled' && t('code.review.cancelled')}
        </p>
        {phase.kind === 'error' && (
          <p role="alert" className="text-danger">
            {t('code.extras.loadFailed', { detail: phase.detail })}
          </p>
        )}
        {phase.kind === 'done' && phase.result.status === 'unavailable' && <p className="text-fg">{t('code.extras.noEngine')}</p>}
        {phase.kind === 'done' && phase.result.status === 'unreadable' && <p className="text-fg">{t('code.review.unreadable')}</p>}
        {phase.kind === 'done' && phase.result.status === 'ok' && (
          <ReviewReportView report={phase.result.report} skipped={phase.result.skipped} />
        )}
      </div>
    </DialogFrame>
  )
}
