/**
 * Diálogo «Objetivo de esta conversación» (experimental, `engineExperiments.codeExtras.goal`). Crea, muestra y quita el objetivo del
 * motor (`goal:*`). El objetivo NO inicia turnos: lo dice el texto. Todo lo que llega del motor (motivo, salida del comando) se pinta
 * como texto plano. `role="dialog"` con foco atrapado y Esc para cerrar (DialogFrame); los resultados se anuncian en una región `aria-live`.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { GOAL_LIMITS, GOAL_NOT_RESUMABLE, GOAL_STOPPED_STATES, type EngineGoal, type GoalState } from '@shared/engine-code-extras'
import type { MsgKey } from '@shared/i18n'
import { Button } from '../../../components/Button'
import { DialogFrame } from '../../../components/DialogFrame'
import { Input } from '../../../components/Input'
import { call } from '../../../lib/api'
import { useT } from '../../../lib/i18n'
import { errorMessage } from './client'

/** Cada cuánto se relee el estado mientras el diálogo está abierto (el motor lo cambia al terminar cada turno). */
export const GOAL_POLL_MS = 4000

const STATE_LABEL: Record<GoalState, MsgKey> = {
  activo: 'code.goal.state.activo',
  pausado: 'code.goal.state.pausado',
  cumplido: 'code.goal.state.cumplido',
  imposible: 'code.goal.state.imposible',
  bloqueado: 'code.goal.state.bloqueado',
  presupuesto_agotado: 'code.goal.state.presupuesto_agotado',
  tope: 'code.goal.state.tope'
}
const STATE_HINT: Record<GoalState, MsgKey> = {
  activo: 'code.goal.stateHint.activo',
  pausado: 'code.goal.stateHint.pausado',
  cumplido: 'code.goal.stateHint.cumplido',
  imposible: 'code.goal.stateHint.imposible',
  bloqueado: 'code.goal.stateHint.bloqueado',
  presupuesto_agotado: 'code.goal.stateHint.presupuesto_agotado',
  tope: 'code.goal.stateHint.tope'
}
const STATE_TONE: Record<GoalState, string> = {
  activo: 'bg-accent-soft text-accent',
  pausado: 'bg-hover text-muted',
  cumplido: 'bg-hover text-fg',
  imposible: 'bg-danger/10 text-danger',
  bloqueado: 'bg-danger/10 text-danger',
  presupuesto_agotado: 'bg-danger/10 text-danger',
  tope: 'bg-hover text-muted'
}

type View = { kind: 'loading' } | { kind: 'unavailable' } | { kind: 'error'; detail: string } | { kind: 'ready'; goal: EngineGoal | null }

export function GoalDialog({
  sessionId,
  directory,
  onClose
}: {
  sessionId: string
  directory?: string
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const id = useId()
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [condition, setCondition] = useState('')
  const [verify, setVerify] = useState('')
  const [cap, setCap] = useState(String(GOAL_LIMITS.capDefault))
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [formError, setFormError] = useState('')
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const base = useCallback(() => ({ sessionID: sessionId, ...(directory ? { directory } : {}) }), [sessionId, directory])

  const load = useCallback(
    async (quiet = false): Promise<void> => {
      if (!quiet) setView({ kind: 'loading' })
      try {
        const r = await call('goal:get', base())
        if (!alive.current) return
        setView(r.available ? { kind: 'ready', goal: r.goal } : { kind: 'unavailable' })
      } catch (err) {
        if (!alive.current) return
        // Un fallo en una relectura silenciosa conserva lo que ya se veía.
        if (!quiet) setView({ kind: 'error', detail: errorMessage(err) })
      }
    },
    [base]
  )

  useEffect(() => {
    void load()
  }, [load])
  const goal = view.kind === 'ready' ? view.goal : null
  useEffect(() => {
    if (view.kind !== 'ready') return undefined
    const timer = setInterval(() => void load(true), GOAL_POLL_MS)
    return () => clearInterval(timer)
  }, [view.kind, load])

  const capNum = Number(cap)
  const capValid = /^\d{1,2}$/.test(cap.trim()) && capNum >= 1 && capNum <= GOAL_LIMITS.capMax
  const canCreate = condition.trim().length > 0 && capValid && !busy

  const create = async (): Promise<void> => {
    setBusy(true)
    setNotice('')
    setFormError('')
    try {
      const r = await call('goal:set', {
        ...base(),
        condition: condition.trim(),
        ...(verify.trim() ? { verify: verify.trim() } : {}),
        cap: capNum
      })
      if (!alive.current) return
      if (!r.available) setView({ kind: 'unavailable' })
      else if (!r.ok) setFormError(t(r.error === 'final' ? 'code.goal.error.final' : 'code.goal.error.invalid'))
      else {
        setNotice(t('code.goal.created'))
        await load(true)
      }
    } catch (err) {
      if (alive.current) setFormError(t('code.extras.loadFailed', { detail: errorMessage(err) }))
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const resume = async (g: EngineGoal): Promise<void> => {
    setBusy(true)
    setNotice('')
    setFormError('')
    try {
      const r = await call('goal:set', {
        ...base(),
        condition: g.condition,
        ...(g.verify ? { verify: g.verify } : {}),
        cap: Math.max(1, g.cap),
        resume: true
      })
      if (!alive.current) return
      if (!r.available) setView({ kind: 'unavailable' })
      else if (!r.ok) setFormError(t(r.error === 'final' ? 'code.goal.error.final' : 'code.goal.error.invalid'))
      else await load(true)
    } catch (err) {
      if (alive.current) setFormError(t('code.extras.loadFailed', { detail: errorMessage(err) }))
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    setBusy(true)
    setNotice('')
    setFormError('')
    try {
      const r = await call('goal:clear', base())
      if (!alive.current) return
      if (!r.available) setView({ kind: 'unavailable' })
      else {
        setNotice(t('code.goal.removed'))
        await load(true)
      }
    } catch (err) {
      if (alive.current) setFormError(t('code.extras.loadFailed', { detail: errorMessage(err) }))
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const footer = (
    <>
      {goal && (
        <Button variant="danger" disabled={busy} onClick={() => void remove()}>
          {t('code.goal.remove')}
        </Button>
      )}
      {goal && GOAL_STOPPED_STATES.has(goal.state) && !GOAL_NOT_RESUMABLE.has(goal.state) && (
        <Button variant="primary" disabled={busy} onClick={() => void resume(goal)}>
          {t('code.goal.resume')}
        </Button>
      )}
      {view.kind === 'ready' && !goal && (
        <Button variant="primary" disabled={!canCreate} onClick={() => void create()}>
          {t('code.goal.create')}
        </Button>
      )}
      <Button variant="ghost" onClick={onClose}>
        {t('code.extras.close')}
      </Button>
    </>
  )

  return (
    <DialogFrame title={t('code.goal.title')} onClose={onClose} size="lg" footer={footer}>
      <div data-testid="goal-dialog" className="flex flex-col gap-3">
        <p className="leading-relaxed">{t('code.goal.intro')}</p>

        {view.kind === 'loading' && <p>{t('code.extras.loading')}</p>}
        {view.kind === 'unavailable' && <p className="text-fg">{t('code.extras.noEngine')}</p>}
        {view.kind === 'error' && (
          <div className="flex flex-col items-start gap-2">
            <p className="text-danger">{t('code.extras.loadFailed', { detail: view.detail })}</p>
            <Button size="sm" onClick={() => void load()}>
              {t('code.extras.retry')}
            </Button>
          </div>
        )}

        {view.kind === 'ready' && !goal && (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-fg" htmlFor={`${id}-c`}>
              {t('code.goal.condition')}
              <textarea
                id={`${id}-c`}
                value={condition}
                maxLength={GOAL_LIMITS.condition}
                rows={3}
                onChange={(e) => setCondition(e.target.value)}
                placeholder={t('code.goal.condition.placeholder')}
                className="w-full resize-y rounded-ctl border border-border bg-bg px-3 py-2 text-sm text-fg"
              />
            </label>
            <div className="flex flex-col gap-1 text-fg">
              <label htmlFor={`${id}-v`}>{t('code.goal.verify')}</label>
              <Input
                id={`${id}-v`}
                value={verify}
                maxLength={GOAL_LIMITS.verify}
                onChange={(e) => setVerify(e.target.value)}
                placeholder={t('code.goal.verify.placeholder')}
                aria-describedby={`${id}-vh`}
                className="font-mono"
              />
              <p id={`${id}-vh`} className="text-xs text-muted">
                {t('code.goal.verify.help')}
              </p>
            </div>
            <div className="flex flex-col gap-1 text-fg">
              <label htmlFor={`${id}-n`}>{t('code.goal.cap', { max: GOAL_LIMITS.capMax })}</label>
              <Input
                id={`${id}-n`}
                inputMode="numeric"
                value={cap}
                onChange={(e) => setCap(e.target.value)}
                invalid={!capValid}
                className="w-24"
              />
            </div>
          </div>
        )}

        {view.kind === 'ready' && goal && (
          <div className="flex flex-col gap-2" data-testid="goal-status">
            <p className="rounded-lg border border-border bg-bg px-3 py-2 break-words whitespace-pre-wrap text-fg">{goal.condition}</p>
            {goal.verify && <p className="font-mono text-xs break-all text-fg">{goal.verify}</p>}
            <p className="flex flex-wrap items-center gap-2">
              <span>{t('code.goal.status')}:</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_TONE[goal.state]}`}>{t(STATE_LABEL[goal.state])}</span>
            </p>
            <p>{t(STATE_HINT[goal.state])}</p>
            {goal.reason && <p className="break-words whitespace-pre-wrap">{t('code.goal.reason', { reason: goal.reason })}</p>}
            <p>{t('code.goal.progress', { count: goal.iterations, max: goal.cap })}</p>
            {goal.lastVerification && (
              <div>
                <p>
                  {goal.lastVerification.code === null
                    ? t('code.goal.lastCheck.none')
                    : t('code.goal.lastCheck', { code: goal.lastVerification.code })}
                </p>
                {goal.lastVerification.output && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs">{t('code.goal.lastOutput')}</summary>
                    <pre className="mt-1 max-h-40 overflow-auto rounded-lg border border-border bg-bg p-2 text-xs break-words whitespace-pre-wrap text-fg">
                      {goal.lastVerification.output}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </div>
        )}

        {formError && (
          <p role="alert" className="text-danger">
            {formError}
          </p>
        )}
        <p role="status" aria-live="polite" className="min-h-[1.25rem] text-fg">
          {notice}
        </p>
      </div>
    </DialogFrame>
  )
}
