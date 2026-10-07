/**
 * Control del PC en Windows: tarjeta de consentimiento propia de la app (plan C §3). Windows no tiene los permisos TCC de macOS;
 * este consentimiento (versionado y revocable) los sustituye. Reglas de seguridad:
 *  - Lista lo que el agente puede y NO puede hacer, con la casilla «Entiendo».
 *  - El botón «Activar» se arma a los 600 ms de mostrarse la tarjeta Y con la casilla marcada. El armado lo exige también `main`
 *    (`computer:winConsent`): un `confirm` antes de tiempo no concede nada, aunque el renderer lo envíe.
 *  - SIN atajo de teclado para aceptar: ni Enter global, ni formulario, ni foco automático en el botón.
 *  - Si la pestaña se oculta, se desmarca y se vuelve a armar al volver (como `perm-guard`).
 * Mostrar el estado actual (consentido) con «Retirar permiso» es `ConsentOnView`.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2, ShieldCheck, ShieldOff, X } from 'lucide-react'
import type { ComputerWinConsentAction, ComputerWinConsentResult } from '@shared/ipc-tasks'
import { Button } from '../../../components/Button'
import { useT } from '../../../lib/i18n'
import { errorMessage } from '../../../lib/opencode'
import { cw } from './bridge'
import { refreshComputerStatus } from './store'

/** Tiempo de armado del botón (el mismo que `CONSENT_ARM_MS` de main y `ARM_MS` de `perm-guard`). */
export const CONSENT_UI_ARM_MS = 600

/** ¿Puede pulsarse «Activar» en la interfaz? Casilla marcada y pasado el armado desde que se mostró. Pura (se prueba sin DOM). */
export function consentUiArmed(checked: boolean, shownAt: number | null, now: number): boolean {
  return checked && shownAt !== null && now - shownAt >= CONSENT_UI_ARM_MS
}

type T = ReturnType<typeof useT>

const CAN = ['tasksComputer.consent.can1', 'tasksComputer.consent.can2', 'tasksComputer.consent.can3'] as const
const NEVER = [
  'tasksComputer.consent.never1',
  'tasksComputer.consent.never2',
  'tasksComputer.consent.never3',
  'tasksComputer.consent.never4'
] as const

export interface ConsentCardViewProps {
  t: T
  stale: boolean
  version: number
  checked: boolean
  armed: boolean
  busy: boolean
  /** Mensaje de estado (aviso de espera o de error); se anuncia a lectores de pantalla. */
  message: string | null
  onCheck: (checked: boolean) => void
  onActivate: () => void
}

/** La tarjeta (sin lógica): lo que puede, lo que nunca podrá, la casilla y el botón armado. */
export function ConsentCardView({
  t,
  stale,
  version,
  checked,
  armed,
  busy,
  message,
  onCheck,
  onActivate
}: ConsentCardViewProps): React.JSX.Element {
  return (
    <section
      role="group"
      aria-labelledby="win-consent-title"
      aria-describedby="win-consent-intro"
      className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm"
    >
      <h3
        id="win-consent-title"
        className="mb-2 flex items-center gap-2 font-semibold text-amber-700 desk:text-warning [[data-theme=dark]_&]:text-amber-400"
      >
        <ShieldCheck size={16} aria-hidden="true" /> {t('tasksComputer.consent.title')}
      </h3>
      <p id="win-consent-intro" className="text-fg">
        {t('tasksComputer.consent.intro')}
      </p>
      {stale && (
        <p role="note" className="mt-2 rounded-md border border-amber-500/40 px-2 py-1.5 text-xs text-fg">
          {t('tasksComputer.consent.stale', { version })}
        </p>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <h4 className="mb-1 text-xs font-semibold text-fg">{t('tasksComputer.consent.canTitle')}</h4>
          <ul className="space-y-1">
            {CAN.map((k) => (
              <li key={k} className="flex items-start gap-2 text-muted">
                <Check size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
                <span>{t(k)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="mb-1 text-xs font-semibold text-fg">{t('tasksComputer.consent.neverTitle')}</h4>
          <ul className="space-y-1">
            {NEVER.map((k) => (
              <li key={k} className="flex items-start gap-2 text-muted">
                <X size={14} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
                <span>{t(k)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted">{t('tasksComputer.consent.stop')}</p>
      <p className="mt-1 text-xs text-muted">{t('tasksComputer.consent.audit')}</p>
      <label className="mt-3 flex cursor-pointer items-start gap-2 text-fg">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
          checked={checked}
          disabled={busy}
          onChange={(e) => onCheck(e.target.checked)}
        />
        <span>{t('tasksComputer.consent.check')}</span>
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="primary" type="button" disabled={!armed || busy} aria-describedby="win-consent-hint" onClick={onActivate}>
          {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <ShieldCheck size={14} aria-hidden="true" />}{' '}
          {t('tasksComputer.consent.activate')}
        </Button>
        <span id="win-consent-hint" className="text-xs text-muted">
          {t('tasksComputer.consent.hint')}
        </span>
      </div>
      <p role="status" aria-live="polite" className="mt-2 min-h-4 text-xs text-danger">
        {message}
      </p>
    </section>
  )
}

/** Estado «activado» con el botón de retirar el permiso. */
export function ConsentOnView({ t, busy, onRevoke }: { t: T; busy: boolean; onRevoke: () => void }): React.JSX.Element {
  return (
    <section
      role="group"
      aria-labelledby="win-consent-on"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-elevated p-4 text-sm"
    >
      <div className="min-w-0">
        <h3 id="win-consent-on" className="flex items-center gap-2 font-semibold text-fg">
          <ShieldCheck size={16} className="text-accent" aria-hidden="true" /> {t('tasksComputer.consent.on')}
        </h3>
        <p className="mt-0.5 text-xs text-muted">{t('tasksComputer.consent.onDesc')}</p>
      </div>
      <Button variant="secondary" type="button" disabled={busy} onClick={onRevoke}>
        {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <ShieldOff size={14} aria-hidden="true" />}{' '}
        {t('tasksComputer.consent.revoke')}
      </Button>
    </section>
  )
}

/**
 * Tarjeta con lógica: pide `show` a `main` al montarse (empieza el armado allí), refleja el armado en la interfaz y confirma.
 * `showOnWhenGranted`: con el permiso ya dado muestra `ConsentOnView` (Ajustes); sin él (aviso en Tareas) no pinta nada.
 */
export function ComputerConsentWin({ showOnWhenGranted = false }: { showOnWhenGranted?: boolean }): React.JSX.Element | null {
  const t = useT()
  const [state, setState] = useState<ComputerWinConsentResult | null>(null)
  const [checked, setChecked] = useState(false)
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const shownAt = useRef<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const call = useCallback(
    async (action: ComputerWinConsentAction): Promise<ComputerWinConsentResult> => cw('computer:winConsent', { action }),
    []
  )

  const clearTimer = (): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  /** (Re)muestra la tarjeta: `main` reinicia el armado y aquí también. */
  const show = useCallback(async (): Promise<void> => {
    clearTimer()
    setChecked(false)
    setArmed(false)
    try {
      const r = await call('show')
      shownAt.current = Date.now()
      setState(r)
    } catch (err) {
      setMessage(errorMessage(err))
    }
  }, [call])

  useEffect(() => {
    void show()
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        clearTimer()
        setChecked(false)
        setArmed(false)
        void call('uncheck').catch(() => undefined)
      } else {
        void show()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearTimer()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [show, call])

  const onCheck = (value: boolean): void => {
    setMessage(null)
    setChecked(value)
    clearTimer()
    setArmed(false)
    void call(value ? 'check' : 'uncheck').catch((err: unknown) => setMessage(errorMessage(err)))
    if (value) {
      const wait = Math.max(0, CONSENT_UI_ARM_MS - (Date.now() - (shownAt.current ?? Date.now())))
      timer.current = setTimeout(() => setArmed(consentUiArmed(true, shownAt.current, Date.now())), wait)
    }
  }

  const done = async (action: 'confirm' | 'revoke'): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const r = await call(action)
      setState(r)
      if (action === 'confirm' && !r.granted) {
        setMessage(t('tasksComputer.consent.wait'))
        return
      }
      await refreshComputerStatus()
      if (action === 'revoke') await show()
      else {
        setChecked(false)
        setArmed(false)
      }
    } catch {
      setMessage(t('tasksComputer.consent.failed'))
    } finally {
      setBusy(false)
    }
  }

  if (!state) return null
  if (state.consent) return showOnWhenGranted ? <ConsentOnView t={t} busy={busy} onRevoke={() => void done('revoke')} /> : null
  return (
    <ConsentCardView
      t={t}
      stale={state.stale}
      version={state.version}
      checked={checked}
      armed={armed}
      busy={busy}
      message={message}
      onCheck={onCheck}
      onActivate={() => void done('confirm')}
    />
  )
}
