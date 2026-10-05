import { useState } from 'react'
import { Monitor } from 'lucide-react'
import type { LinkStatus } from '@shared/remote/link'
import { confirmDialog } from '../../components/ConfirmDialog'
import { useT } from '../../lib/i18n'
import { useServer } from '../../stores/server'
import { lockNow, unlinkThisDevice, useLinkStatus } from './link'

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

const dotTone = (link: LinkStatus): string => (link === 'online' ? 'bg-success' : link === 'offline' ? 'bg-subtle' : 'bg-warning')

/** Confirmación de «Desvincular» (título, mensaje y tono de peligro de siempre; no cambian). */
export function confirmUnlink(t: ReturnType<typeof useT>): Promise<boolean> {
  return confirmDialog({
    title: t('mobile.phone.unlink.title'),
    message: t('mobile.phone.unlink.message'),
    confirmLabel: t('mobile.phone.unlink.confirm'),
    danger: true
  })
}

/**
 * Tarjeta de conexión de «Ajustes» (PWA): tile con Monitor y punto de estado, estado del enlace y del motor de IA, y las
 * acciones «Bloquear ahora» y «Desvincular» (esta última con la misma confirmación de siempre). Solo usa datos que ya existen.
 */
export function ConnectionCard(): React.JSX.Element {
  const t = useT()
  const link = useLinkStatus()
  const engine = useServer((s) => s.status.state)
  const [note, setNote] = useState<string | null>(null)
  const engineLabel = engine in ENGINE_KEY ? t(ENGINE_KEY[engine as keyof typeof ENGINE_KEY]) : engine

  const lock = (): void => {
    if (!lockNow()) setNote(t('mobile.phone.lock.unsupported'))
  }
  const unlink = async (): Promise<void> => {
    if ((await confirmUnlink(t)) && !unlinkThisDevice()) setNote(t('mobile.phone.lock.unsupported'))
  }

  return (
    <section data-m="connection" className="rounded-[var(--m-card-radius)] bg-elevated p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-active text-muted">
          <Monitor size={20} aria-hidden="true" />
          <span
            data-m="connection-dot"
            className={`absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-elevated ${dotTone(link)}`}
            aria-hidden="true"
          />
        </span>
        <div className="flex min-w-0 flex-col">
          <h2 className="truncate text-[17px] leading-6 font-semibold text-fg">{t('mobile.settings.connectionTitle')}</h2>
          <p role="status" className="text-[14px] leading-5 text-muted">
            {t(STATUS_KEY[link])} · {t('mobile.phone.engine')}: {engineLabel}
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={lock}
          className="min-h-11 rounded-[var(--m-btn-radius)] bg-active px-3 text-[15px] font-medium text-fg active:bg-hover"
        >
          {t('mobile.phone.lock')}
        </button>
        <button
          type="button"
          onClick={() => void unlink()}
          aria-label={t('mobile.phone.unlink')}
          className="min-h-11 rounded-[var(--m-btn-radius)] border border-border-strong px-3 text-[15px] font-medium text-danger active:bg-hover"
        >
          {t('mobile.phone.unlink.confirm')}
        </button>
      </div>
      <p className="mt-3 text-[13px] leading-snug text-muted">{t('mobile.phone.lock.hint')}</p>
      <p className="mt-1 text-[13px] leading-snug text-muted">{t('mobile.phone.unlink.hint')}</p>
      {note && (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {note}
        </p>
      )}
    </section>
  )
}
