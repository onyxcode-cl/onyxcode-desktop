/**
 * Ajustes › General › «Tareas (beta) en Windows»: consentimiento de la beta opcional (decisión del dueño, 2026-10-07).
 * El estado y el consentimiento viven en `main` (`tasks:winBeta`; archivo propio que solo escribe `main`): este componente NO
 * guarda nada en `settings` (el ajuste legado `tasksWinBeta` se ignora). Reglas de seguridad, como `ComputerConsentWin`:
 *  - Aviso honesto con lo verificado y lo NO verificado, casilla «Entiendo y acepto» y botón armado a los 600 ms. El armado
 *    lo exige también `main`: un `accept` antes de tiempo no concede nada aunque el renderer lo envíe.
 *  - SIN atajo de teclado que acepte: sin formulario, sin Enter global, sin foco automático en el botón (Escape solo cancela).
 *  - Si la pestaña se oculta, se desmarca y se vuelve a armar al volver.
 * Solo se pinta en Windows y si `main` dice `available` (build con la función); en macOS no muestra nada ni llama a `main`.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2, RotateCw, ShieldCheck, ShieldOff, X } from 'lucide-react'
import type { TasksWinBetaAction, TasksWinBetaState } from '@shared/ipc-tasks'
import type { MsgKey } from '@shared/i18n'
import { Button } from '../../../components/Button'
import { useT } from '../../../lib/i18n'
import { errorMessage } from '../../../lib/opencode'
import { isWindowsPlatform } from '../../../lib/platform'
import { consentUiArmed, CONSENT_UI_ARM_MS } from '../../tasks/impl/ComputerConsentWin'
import { cw, hasTasksBridge } from '../../tasks/impl/bridge'
import { Card, Row } from './ui'

type T = ReturnType<typeof useT>

const VERIFIED: MsgKey[] = ['tasksSettings.beta.confirm.v1', 'tasksSettings.beta.confirm.v2']
const UNVERIFIED: MsgKey[] = [
  'tasksSettings.beta.confirm.u1',
  'tasksSettings.beta.confirm.u2',
  'tasksSettings.beta.confirm.u3',
  'tasksSettings.beta.confirm.u4',
  'tasksSettings.beta.confirm.u5',
  'tasksSettings.beta.confirm.u6'
]
const COMPUTER: MsgKey[] = ['tasksSettings.beta.confirm.c1', 'tasksSettings.beta.confirm.c2']

/** Clave del texto de estado (pura): activa/apagada y, si hay un cambio sin aplicar, que hay que reiniciar. */
export function betaStatusKey(s: Pick<TasksWinBetaState, 'consent' | 'active' | 'restartRequired'>): MsgKey {
  if (s.restartRequired) return s.consent ? 'tasksSettings.beta.statusPendingOn' : 'tasksSettings.beta.statusPendingOff'
  return s.active ? 'tasksSettings.beta.statusOn' : 'tasksSettings.beta.statusOff'
}

export interface TasksWinBetaViewProps {
  t: T
  state: TasksWinBetaState
  dialog: boolean
  checked: boolean
  armed: boolean
  busy: boolean
  message: string | null
  onOpen: () => void
  onCancel: () => void
  onCheck: (checked: boolean) => void
  onAccept: () => void
  onRevoke: () => void
  onRestart: () => void
}

function Bullets({ keys, icon, t }: { keys: MsgKey[]; icon: React.ReactNode; t: T }): React.JSX.Element {
  return (
    <ul className="mt-1 space-y-1">
      {keys.map((k) => (
        <li key={k} className="flex items-start gap-2 text-muted">
          <span className="mt-0.5 shrink-0">{icon}</span>
          <span>{t(k)}</span>
        </li>
      ))}
    </ul>
  )
}

/** La fila y el aviso (sin lógica): estado, botones y el diálogo con lo verificado y lo no verificado. */
export function TasksWinBetaView(p: TasksWinBetaViewProps): React.JSX.Element | null {
  const { t, state } = p
  if (!state.available) return null
  return (
    <>
      <Row label={t('tasksSettings.beta.title')} description={t('tasksSettings.beta.description')} layout="stack-narrow">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span data-testid="tasks-beta-status" role="status" className="text-xs text-muted">
            {t(betaStatusKey(state))}
          </span>
          {state.consent ? (
            <Button size="sm" variant="secondary" type="button" disabled={p.busy} onClick={p.onRevoke}>
              <ShieldOff size={13} aria-hidden="true" /> {t('tasksSettings.beta.revoke')}
            </Button>
          ) : (
            !p.dialog && (
              <Button size="sm" type="button" disabled={p.busy} onClick={p.onOpen}>
                {t('tasksSettings.beta.enable')}
              </Button>
            )
          )}
          {state.restartRequired && (
            <Button size="sm" type="button" disabled={p.busy} onClick={p.onRestart}>
              <RotateCw size={13} aria-hidden="true" /> {t('tasksSettings.beta.restartNow')}
            </Button>
          )}
        </div>
      </Row>
      {state.stale && !state.consent && (
        <p role="note" className="border-t border-border px-4 py-2.5 text-[13px] text-muted">
          {t('tasksSettings.beta.stale')}
        </p>
      )}
      {p.dialog && !state.consent && (
        <div
          role="alertdialog"
          aria-labelledby="tasks-beta-title"
          aria-describedby="tasks-beta-intro"
          className="border-t border-border px-4 py-3 text-[13px] leading-snug"
        >
          <h4 id="tasks-beta-title" className="flex items-center gap-2 font-medium">
            <ShieldCheck size={15} aria-hidden="true" /> {t('tasksSettings.beta.confirm.title')}
          </h4>
          <p id="tasks-beta-intro" className="mt-1.5 text-fg">
            {t('tasksSettings.beta.confirm.intro')}
          </p>
          <h5 className="mt-3 text-xs font-semibold">{t('tasksSettings.beta.confirm.verifiedTitle')}</h5>
          <Bullets keys={VERIFIED} t={t} icon={<Check size={14} className="text-accent" aria-hidden="true" />} />
          <h5 className="mt-3 text-xs font-semibold">{t('tasksSettings.beta.confirm.unverifiedTitle')}</h5>
          <Bullets keys={UNVERIFIED} t={t} icon={<X size={14} className="text-danger" aria-hidden="true" />} />
          <h5 className="mt-3 text-xs font-semibold">{t('tasksSettings.beta.confirm.computerTitle')}</h5>
          <Bullets keys={COMPUTER} t={t} icon={<X size={14} className="text-danger" aria-hidden="true" />} />
          <p className="mt-3 text-muted">{t('tasksSettings.beta.confirm.risk')}</p>
          <label className="mt-3 flex cursor-pointer items-start gap-2 text-fg">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
              checked={p.checked}
              disabled={p.busy}
              onChange={(e) => p.onCheck(e.target.checked)}
            />
            <span>{t('tasksSettings.beta.confirm.check')}</span>
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" type="button" disabled={!p.armed || p.busy} aria-describedby="tasks-beta-hint" onClick={p.onAccept}>
              {p.busy && <Loader2 size={13} className="animate-spin" aria-hidden="true" />} {t('tasksSettings.beta.confirm.accept')}
            </Button>
            <Button size="sm" variant="ghost" type="button" disabled={p.busy} onClick={p.onCancel}>
              {t('tasksSettings.beta.confirm.cancel')}
            </Button>
            <span id="tasks-beta-hint" className="text-xs text-muted">
              {t('tasksSettings.beta.confirm.hint')}
            </span>
          </div>
          <p role="status" aria-live="polite" className="mt-2 min-h-4 text-xs text-danger">
            {p.message}
          </p>
        </div>
      )}
    </>
  )
}

/**
 * Fila con lógica. `standalone`: la envuelve en su propia tarjeta (cuando Tareas no está activa y no hay otra tarjeta alrededor).
 * `platformIsWindows` y `call` se pueden inyectar en pruebas; por defecto, la plataforma real y el puente a `main`.
 */
export function TasksWinBetaRow({ standalone = false }: { standalone?: boolean }): React.JSX.Element | null {
  const t = useT()
  const win = isWindowsPlatform() && hasTasksBridge()
  const [state, setState] = useState<TasksWinBetaState | null>(null)
  const [dialog, setDialog] = useState(false)
  const [checked, setChecked] = useState(false)
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const shownAt = useRef<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const call = useCallback((action: TasksWinBetaAction) => cw('tasks:winBeta', { action }), [])
  const clearTimer = (): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  const disarm = useCallback((): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setChecked(false)
    setArmed(false)
  }, [])

  useEffect(() => {
    if (!win) return
    let alive = true
    call('view')
      .then((s) => alive && setState(s))
      .catch(() => undefined)
    return () => {
      alive = false
      clearTimer()
    }
  }, [win, call])

  // Con el aviso abierto: si la ventana se oculta, se desmarca la casilla y se vuelve a armar al volver.
  useEffect(() => {
    if (!dialog) return
    const onVisibility = (): void => {
      disarm()
      if (document.visibilityState === 'hidden') {
        void call('uncheck').catch(() => undefined)
      } else {
        void call('show')
          .then(() => (shownAt.current = Date.now()))
          .catch(() => undefined)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [dialog, call, disarm])

  // Escape solo CIERRA el aviso: ninguna tecla acepta.
  useEffect(() => {
    if (!dialog) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog])

  if (!win || !state || !state.available) return null

  const run = async (action: TasksWinBetaAction): Promise<TasksWinBetaState | null> => {
    setBusy(true)
    setMessage(null)
    try {
      const s = await call(action)
      setState(s)
      return s
    } catch (err) {
      setMessage(errorMessage(err))
      return null
    } finally {
      setBusy(false)
    }
  }

  function cancel(): void {
    disarm()
    setDialog(false)
    setMessage(null)
  }

  const open = async (): Promise<void> => {
    disarm()
    const s = await run('show')
    if (!s) return
    shownAt.current = Date.now()
    setDialog(true)
  }

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

  const accept = async (): Promise<void> => {
    const s = await run('accept')
    if (!s) return
    if (!s.granted) {
      setMessage(t('tasksSettings.beta.confirm.wait'))
      return
    }
    disarm()
    setDialog(false)
  }

  const view = (
    <TasksWinBetaView
      t={t}
      state={state}
      dialog={dialog}
      checked={checked}
      armed={armed}
      busy={busy}
      message={message}
      onOpen={() => void open()}
      onCancel={cancel}
      onCheck={onCheck}
      onAccept={() => void accept()}
      onRevoke={() => void run('revoke')}
      onRestart={() => void run('restart')}
    />
  )
  return standalone ? <Card>{view}</Card> : view
}
