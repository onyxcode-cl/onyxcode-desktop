import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Info, Loader2 } from 'lucide-react'
import { DISPLAY_NAME } from '@shared/brand'
import type { OpencodeInfo } from '@shared/types'
import { call } from '../lib/api'
import { useT } from '../lib/i18n'
import { engineNotice } from '../lib/engine-notice'
import { useServer } from '../stores/server'
import { useSessions } from '../stores/sessions'

const DISMISS_KEY = 'lazunox.engineNotice.dismissed'

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY)
  } catch {
    return null
  }
}

/** Fases del cambio: aviso normal, pide confirmar (hay trabajo en marcha), cambiando, terminado o con un motivo de fallo. */
type Phase = { name: 'idle' } | { name: 'confirm' } | { name: 'switching' } | { name: 'done' } | { name: 'error'; message: string }

/** ¿Hay alguna sesión trabajando ahora? Reiniciar el motor la cortaría. */
function hasRunningWork(): boolean {
  return Object.values(useSessions.getState().status).some((s) => s === 'busy' || s === 'retry')
}

const BANNER =
  'flex animate-fade-in flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-warning/25 bg-warning/8 px-4 py-2 text-xs text-warning desk:min-h-9 desk:border-warning/35 desk:pl-[calc(var(--header-inset,0px)+16px)] desk:pr-[calc(var(--controls-inset,0px)+16px)] desk:text-meta desk:text-fg desk:[-webkit-app-region:drag]'
const BTN =
  'flex shrink-0 items-center gap-1 rounded-md border border-warning/40 bg-elevated px-2 py-0.5 font-medium text-fg transition-colors hover:bg-warning/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-60 desk:h-7 desk:rounded-ctl-sm desk:[-webkit-app-region:no-drag]'
const BTN_PRIMARY = `${BTN} border-warning/60 bg-warning/20`

/**
 * Aviso NO bloqueante: se usa un motor de IA instalado aparte, distinto del probado con esta versión de la app.
 * Ofrece volver al motor incluido (reinicia el motor; si hay trabajo en marcha pide confirmar antes) o «Ahora no»
 * (se recuerda por versión detectada). Solo aparece si de verdad se puede volver al incluido.
 */
export function EngineNotice(): React.JSX.Element | null {
  const t = useT()
  const state = useServer((s) => s.status.state)
  const [info, setInfo] = useState<OpencodeInfo | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(readDismissed)
  const [phase, setPhase] = useState<Phase>({ name: 'idle' })
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    call('app:opencodeInfo')
      .then((i) => alive && setInfo(i))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [state])

  // El botón que tenía el foco desaparece al cambiar de fase: el foco pasa al primer botón del aviso.
  useEffect(() => {
    if (phase.name === 'idle') return
    root.current?.querySelector<HTMLButtonElement>('button')?.focus()
  }, [phase.name])

  const later = useCallback(() => {
    if (!info?.version) return
    setDismissed(info.version)
    try {
      localStorage.setItem(DISMISS_KEY, info.version)
    } catch {
      /* sin localStorage: se cierra solo hasta recargar */
    }
  }, [info])

  const doSwitch = useCallback(async () => {
    setPhase({ name: 'switching' })
    try {
      const res = await call('app:useBundledEngine')
      if (res.status === 'pinned') return setPhase({ name: 'error', message: t('notices.engine.pinned') })
      if (res.status === 'unavailable') return setPhase({ name: 'error', message: t('notices.engine.unavailable') })
      await useServer.getState().restart()
      const err = useServer.getState().error
      if (err) return setPhase({ name: 'error', message: t('notices.engine.restartFailed', { error: err.split('\n')[0] }) })
      setInfo(res.info)
      setPhase({ name: 'done' })
    } catch {
      setPhase({ name: 'error', message: t('notices.engine.failed') })
    }
  }, [t])

  const start = useCallback(() => {
    if (hasRunningWork()) setPhase({ name: 'confirm' })
    else void doSwitch()
  }, [doSwitch])

  const notice = engineNotice(info, dismissed)
  const closeResult = (): void => setPhase({ name: 'idle' })

  if (phase.name === 'done') {
    return (
      <div ref={root} role="status" className={BANNER}>
        <CheckCircle2 size={14} aria-hidden className="shrink-0 desk:text-success" />
        <span className="min-w-0 flex-1">{t('notices.engine.done')}</span>
        <button type="button" onClick={closeResult} className={BTN}>
          {t('notices.engine.dismissDone')}
        </button>
      </div>
    )
  }
  if (phase.name === 'error') {
    return (
      <div ref={root} role="alert" className={BANNER}>
        <Info size={14} aria-hidden className="shrink-0 desk:text-warning" />
        <span className="min-w-0 flex-1">{phase.message}</span>
        <button type="button" onClick={closeResult} className={BTN}>
          {t('notices.engine.dismissDone')}
        </button>
      </div>
    )
  }
  if (phase.name === 'switching') {
    return (
      <div ref={root} role="status" aria-busy="true" className={BANNER}>
        <Loader2 size={14} aria-hidden className="shrink-0 animate-spin" />
        <span className="min-w-0 flex-1">{t('notices.engine.switching')}</span>
      </div>
    )
  }
  if (phase.name === 'confirm') {
    return (
      <div ref={root} role="alert" className={BANNER}>
        <Info size={14} aria-hidden className="shrink-0 desk:text-warning" />
        <span className="min-w-0 flex-1">{t('notices.engine.busy')}</span>
        <button type="button" onClick={closeResult} className={BTN}>
          {t('notices.engine.cancel')}
        </button>
        <button type="button" onClick={() => void doSwitch()} className={BTN_PRIMARY}>
          {t('notices.engine.confirm')}
        </button>
      </div>
    )
  }
  // Solo avisa si hay algo que el usuario pueda hacer (un motor incluido al que volver).
  if (!notice || !notice.canSwitch) return null
  return (
    <div ref={root} role="status" className={BANNER}>
      <Info size={14} aria-hidden className="shrink-0 desk:text-warning" />
      <span className="min-w-0 flex-1">
        {t(notice.kind === 'newer' ? 'notices.engine.newer' : 'notices.engine.older', {
          version: notice.version,
          app: DISPLAY_NAME,
          sdk: notice.sdk
        })}
      </span>
      <button type="button" onClick={start} className={BTN_PRIMARY}>
        {t('notices.engine.use')}
      </button>
      <button type="button" onClick={later} className={BTN}>
        {t('notices.engine.later')}
      </button>
    </div>
  )
}
