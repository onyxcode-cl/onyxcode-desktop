import { useState } from 'react'
import { CalendarClock, Lock, Settings, Smartphone, Unlink } from 'lucide-react'
import type { LinkStatus } from '@shared/remote/link'
import { MODE_LABELS } from '@shared/labels'
import { confirmDialog } from '../../components/ConfirmDialog'
import { ListGroup, ListRow } from '../../components/mobile/List'
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

const DOT = { online: 'bg-success', offline: 'bg-danger' } as const

/** Punto de color + texto del estado de la conexión (dato final de una fila o de «Este celular»). */
function StatusDetail({ link, label }: { link: LinkStatus; label: string }): React.JSX.Element {
  const tone = link === 'online' ? DOT.online : link === 'offline' ? DOT.offline : 'bg-warning'
  return (
    <>
      <span className={`h-2 w-2 rounded-full ${tone}`} aria-hidden="true" />
      {label}
    </>
  )
}

/** Pestaña «Más»: lista agrupada con Rutinas y Ajustes (General) y este celular con su estado como dato final. */
export function MoreRoot(): React.JSX.Element {
  const t = useT()
  const { push } = useMobileNav()
  const link = useLinkStatus()
  const online = link === 'online'
  return (
    <div className="flex flex-col gap-6 px-[var(--m-gutter)] py-4" data-m="more">
      <ListGroup title={t('mobile.more.group.general')}>
        <ListRow icon={CalendarClock} label={MODE_LABELS.routines} hint={t('mobile.more.routines.hint')} onClick={() => push('routines')} />
        <ListRow icon={Settings} label={t('mobile.more.settings')} hint={t('mobile.more.settings.hint')} onClick={() => push('settings')} />
      </ListGroup>
      <ListGroup title={t('mobile.more.group.device')} footer={t('mobile.more.phone.hint')}>
        <ListRow
          icon={Smartphone}
          label={t('mobile.more.phone')}
          detail={<StatusDetail link={link} label={t(STATUS_KEY[link])} />}
          onClick={() => push('phone')}
        />
      </ListGroup>
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

  return (
    <div className="flex flex-col gap-6 px-[var(--m-gutter)] py-4" data-m="phone">
      <ListGroup>
        <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-3">
          <span className="text-[16px]">{t('mobile.phone.connection')}</span>
          <span className="flex items-center gap-2 text-[15px] font-medium" role="status">
            <StatusDetail link={link} label={t(STATUS_KEY[link])} />
          </span>
        </div>
        <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-3">
          <span className="text-[16px]">{t('mobile.phone.engine')}</span>
          <span className="text-[15px] font-medium text-muted">{engineLabel}</span>
        </div>
      </ListGroup>

      <ListGroup footer={t('mobile.phone.lock.hint')}>
        <ListRow icon={Lock} label={t('mobile.phone.lock')} onClick={lock} chevron={false} />
      </ListGroup>

      <ListGroup footer={t('mobile.phone.unlink.hint')}>
        <ListRow icon={Unlink} label={t('mobile.phone.unlink')} onClick={() => void unlink()} tone="danger" chevron={false} />
      </ListGroup>

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
