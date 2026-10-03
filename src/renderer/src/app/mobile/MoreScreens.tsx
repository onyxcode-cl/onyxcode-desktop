import { useState } from 'react'
import { CalendarClock, ChevronRight, Lock, Settings, Smartphone, Unlink, type LucideIcon } from 'lucide-react'
import { MODE_LABELS } from '@shared/labels'
import { confirmDialog } from '../../components/ConfirmDialog'
import { useT } from '../../lib/i18n'
import { useServer } from '../../stores/server'
import { MODES_BY_ID } from '../modes'
import { lockNow, unlinkThisDevice, useLinkStatus } from './link'
import { useMobileNav } from './nav'

const STATUS_KEY = {
  online: 'mobile.phone.status.online',
  connecting: 'mobile.phone.status.connecting',
  reconnecting: 'mobile.phone.status.reconnecting',
  locked: 'mobile.phone.status.locked',
  offline: 'mobile.phone.status.offline'
} as const

const ENGINE_KEY = {
  ready: 'app.status.ready',
  starting: 'app.status.starting',
  stopped: 'app.status.stopped',
  error: 'app.status.error'
} as const

function Row({
  icon: Icon,
  label,
  hint,
  onClick
}: {
  icon: LucideIcon
  label: string
  hint: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-16 w-full items-center gap-3.5 rounded-2xl border border-border bg-elevated px-4 py-3 text-left shadow-xs active:bg-hover"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
        <Icon size={20} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[16px] font-medium">{label}</span>
        <span className="text-[13px] leading-snug text-muted">{hint}</span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-subtle" aria-hidden="true" />
    </button>
  )
}

/** Pestaña «Más»: Rutinas, Ajustes básicos y el estado de este celular. */
export function MoreRoot(): React.JSX.Element {
  const t = useT()
  const { push } = useMobileNav()
  const link = useLinkStatus()
  const online = link === 'online'
  return (
    <div className="flex flex-col gap-3 p-4">
      <Row icon={CalendarClock} label={MODE_LABELS.routines} hint={t('mobile.more.routines.hint')} onClick={() => push('routines')} />
      <Row icon={Settings} label={t('mobile.more.settings')} hint={t('mobile.more.settings.hint')} onClick={() => push('settings')} />
      <Row
        icon={Smartphone}
        label={t('mobile.more.phone')}
        hint={`${t(STATUS_KEY[link])} · ${t('mobile.more.phone.hint')}`}
        onClick={() => push('phone')}
      />
      <span className="sr-only" aria-live="polite">
        {online ? '' : t(STATUS_KEY[link])}
      </span>
    </div>
  )
}

/** Estado de la conexión con el Mac, bloqueo manual y desvinculación. */
export function PhoneScreen(): React.JSX.Element {
  const t = useT()
  const link = useLinkStatus()
  const engine = useServer((s) => s.status.state)
  const [note, setNote] = useState<string | null>(null)
  const tone = link === 'online' ? 'bg-success' : link === 'offline' ? 'bg-danger' : 'bg-warning'
  const engineLabel = engine in ENGINE_KEY ? t(ENGINE_KEY[engine as keyof typeof ENGINE_KEY]) : engine

  const lock = (): void => {
    if (!lockNow()) setNote(t('mobile.phone.lock.unsupported'))
  }
  const unlink = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: t('mobile.phone.unlink.title'),
      message: t('mobile.phone.unlink.message'),
      confirmLabel: t('mobile.phone.unlink.confirm'),
      danger: true
    })
    if (ok && !unlinkThisDevice()) setNote(t('mobile.phone.lock.unsupported'))
  }

  const action =
    'flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-[15px] font-medium active:opacity-80'
  return (
    <div className="flex flex-col gap-4 p-4">
      <dl className="overflow-hidden rounded-2xl border border-border bg-elevated shadow-xs">
        <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-3">
          <dt className="text-[15px] text-muted">{t('mobile.phone.connection')}</dt>
          <dd className="flex items-center gap-2 text-[15px] font-medium" role="status">
            <span className={`h-2.5 w-2.5 rounded-full ${tone}`} aria-hidden="true" />
            {t(STATUS_KEY[link])}
          </dd>
        </div>
        <div className="flex min-h-14 items-center justify-between gap-3 border-t border-border px-4 py-3">
          <dt className="text-[15px] text-muted">{t('mobile.phone.engine')}</dt>
          <dd className="text-[15px] font-medium">{engineLabel}</dd>
        </div>
      </dl>

      <div className="flex flex-col gap-1.5">
        <button type="button" onClick={lock} className={`${action} border-border bg-elevated text-fg`}>
          <Lock size={18} /> {t('mobile.phone.lock')}
        </button>
        <p className="px-2 text-[13px] leading-snug text-muted">{t('mobile.phone.lock.hint')}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <button type="button" onClick={() => void unlink()} className={`${action} border-danger/40 bg-elevated text-danger`}>
          <Unlink size={18} /> {t('mobile.phone.unlink')}
        </button>
        <p className="px-2 text-[13px] leading-snug text-muted">{t('mobile.phone.unlink.hint')}</p>
      </div>

      {note && (
        <p role="alert" className="px-2 text-[13px] text-danger">
          {note}
        </p>
      )}
    </div>
  )
}

/** Rutinas dentro de «Más» (la vista de siempre; en la PWA se descarga al entrar). */
export function RoutinesScreen(): React.JSX.Element {
  const View = MODES_BY_ID.routines.View
  return <View />
}
