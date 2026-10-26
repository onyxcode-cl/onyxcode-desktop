/**
 * Diálogo «Presupuesto de esta conversación» (experimental, `engineExperiments.codeExtras.budget`): tokens, pasos, minutos y «continuar si se
 * corta». Main escribe `metadata.presupuesto` con `PATCH /session/{id}` reenviando TODAS las claves de `metadata` que la sesión ya tenía
 * (no se sabe si el motor reemplaza o fusiona). Los avisos al 80 % llegan solos como texto del asistente. `role="dialog"` con foco atrapado
 * y Esc para cerrar (DialogFrame); el resultado se anuncia en una región `aria-live`.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { BUDGET_LIMITS, budgetFromInputs, budgetIsEmpty, type BudgetConfig } from '@shared/engine-code-extras'
import { Button } from '../../../components/Button'
import { DialogFrame } from '../../../components/DialogFrame'
import { Input } from '../../../components/Input'
import { call } from '../../../lib/api'
import { useT } from '../../../lib/i18n'
import { errorMessage } from './client'

const toInputs = (c: BudgetConfig): { tokens: string; steps: string; minutes: string; continueOnCut: boolean } => ({
  tokens: c.tokens === undefined ? '' : String(c.tokens),
  steps: c.steps === undefined ? '' : String(c.steps),
  minutes: c.minutes === undefined ? '' : String(c.minutes),
  continueOnCut: c.continueOnCut
})

export function BudgetDialog({
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
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [detail, setDetail] = useState('')
  const [inp, setInp] = useState(toInputs({ continueOnCut: false }))
  const [saved, setSaved] = useState<BudgetConfig | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const base = useCallback(() => ({ sessionID: sessionId, ...(directory ? { directory } : {}) }), [sessionId, directory])

  const load = useCallback(async (): Promise<void> => {
    setPhase('loading')
    try {
      const r = await call('budget:get', base())
      if (!alive.current) return
      setSaved(r.config)
      setInp(toInputs(r.config))
      setPhase('ready')
    } catch (err) {
      if (!alive.current) return
      setDetail(errorMessage(err))
      setPhase('error')
    }
  }, [base])
  useEffect(() => {
    void load()
  }, [load])

  const parsed = budgetFromInputs(inp)
  const write = async (config: BudgetConfig, done: string): Promise<void> => {
    setBusy(true)
    setNotice('')
    setError('')
    try {
      const r = await call('budget:set', { ...base(), config })
      if (!alive.current) return
      setSaved(r.config)
      setInp(toInputs(r.config))
      setNotice(done)
    } catch (err) {
      if (alive.current) setError(t('code.extras.loadFailed', { detail: errorMessage(err) }))
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const field = (key: 'tokens' | 'steps' | 'minutes', label: string, help: string): React.JSX.Element => (
    <div className="flex flex-col gap-1 text-fg">
      <label htmlFor={`${id}-${key}`}>{label}</label>
      <Input
        id={`${id}-${key}`}
        inputMode="numeric"
        value={inp[key]}
        onChange={(e) => setInp({ ...inp, [key]: e.target.value })}
        invalid={budgetFromInputs({ tokens: '', steps: '', minutes: '', continueOnCut: false, [key]: inp[key] }) === null}
        aria-describedby={`${id}-${key}-h`}
        className="w-40"
      />
      <p id={`${id}-${key}-h`} className="text-xs text-muted">
        {help}
      </p>
    </div>
  )

  const footer = (
    <>
      {saved && !budgetIsEmpty(saved) && (
        <Button variant="secondary" disabled={busy} onClick={() => void write({ continueOnCut: false }, t('code.budget.cleared'))}>
          {t('code.budget.clear')}
        </Button>
      )}
      {phase === 'ready' && (
        <Button
          variant="primary"
          disabled={busy || parsed === null}
          onClick={() => parsed && void write(parsed, t(budgetIsEmpty(parsed) ? 'code.budget.cleared' : 'code.budget.saved'))}
        >
          {t('code.budget.save')}
        </Button>
      )}
      <Button variant="ghost" onClick={onClose}>
        {t('code.extras.close')}
      </Button>
    </>
  )

  return (
    <DialogFrame title={t('code.budget.title')} onClose={onClose} size="lg" footer={footer}>
      <div data-testid="budget-dialog" className="flex flex-col gap-3">
        <p className="leading-relaxed">{t('code.budget.intro')}</p>
        {phase === 'loading' && <p>{t('code.extras.loading')}</p>}
        {phase === 'error' && (
          <div className="flex flex-col items-start gap-2">
            <p className="text-danger">{t('code.extras.loadFailed', { detail })}</p>
            <Button size="sm" onClick={() => void load()}>
              {t('code.extras.retry')}
            </Button>
          </div>
        )}
        {phase === 'ready' && (
          <>
            {field('tokens', t('code.budget.tokens'), t('code.budget.tokens.help', BUDGET_LIMITS.tokens))}
            {field('steps', t('code.budget.steps'), t('code.budget.steps.help', BUDGET_LIMITS.steps))}
            {field('minutes', t('code.budget.minutes'), t('code.budget.minutes.help', BUDGET_LIMITS.minutes))}
            <div className="flex flex-col gap-1 text-fg">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={inp.continueOnCut}
                  onChange={(e) => setInp({ ...inp, continueOnCut: e.target.checked })}
                  aria-describedby={`${id}-cont-h`}
                />
                {t('code.budget.continue')}
              </label>
              <p id={`${id}-cont-h`} className="text-xs text-muted">
                {t('code.budget.continue.help')}
              </p>
            </div>
            {parsed === null && <p className="text-danger">{t('code.budget.invalid')}</p>}
            <p className="text-xs text-muted">{t('code.budget.engineNote')}</p>
          </>
        )}
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        <p role="status" aria-live="polite" className="min-h-[1.25rem] text-fg">
          {notice}
        </p>
      </div>
    </DialogFrame>
  )
}
