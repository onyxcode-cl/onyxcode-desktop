/**
 * Ajustes › Tareas › «Componentes opcionales»: tarjeta de LibreOffice (revisión visual de Word/Excel/PowerPoint) con instalación bajo
 * demanda. El botón «Instalar» ES el consentimiento: el diálogo confirma la descarga antes de llamar a `office:install`. Todo el estado
 * vive en main (`office:*`); aquí solo se muestra y se piden acciones. `officeController` es la lógica sin DOM que se prueba aparte.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MsgKey, Params } from '@shared/i18n'
import type { OfficeInstallResult, OfficeUiSnapshot } from '@shared/office'
import { Button } from '../../../components/Button'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { useT } from '../../../lib/i18n'
import { cw } from '../../tasks/impl/bridge'
import { Card, Row, SubTitle } from './ui'

type T = (key: MsgKey, params?: Params) => string
type Phase = NonNullable<OfficeUiSnapshot['progress']>['phase']

const POLL_MS = 1000

const PHASE_KEYS = {
  download: 'settings.office.phase.download',
  verify: 'settings.office.phase.verify',
  mount: 'settings.office.phase.mount',
  copy: 'settings.office.phase.copy',
  done: 'settings.office.phase.done'
} as const satisfies Record<Phase, MsgKey>

/** Megabytes redondeados (1 MB = 1e6 bytes, como en la descarga). */
export function officeMb(bytes: number): number {
  return Math.round(Math.max(0, bytes) / 1e6)
}

/** Clave del mensaje humano de un fallo (`disk`, `hash`/`size`, `signature`, `download`, `cancelled`… o genérico). */
export function officeErrorKey(code: string | undefined): MsgKey {
  switch (code) {
    case 'disk':
      return 'settings.office.error.disk'
    case 'hash':
    case 'size':
      return 'settings.office.error.hash'
    case 'signature':
      return 'settings.office.error.signature'
    case 'download':
      return 'settings.office.error.download'
    case 'cancelled':
      return 'settings.office.error.cancelled'
    default:
      return 'settings.office.error.generic'
  }
}

/** ¿Hay que consultar `office:status` cada segundo? Solo mientras una instalación está en curso. */
export function officeNeedsPoll(snapshot: OfficeUiSnapshot | null): boolean {
  return snapshot?.installing === true
}

export interface OfficeApi {
  status: () => Promise<OfficeUiSnapshot>
  install: () => Promise<OfficeInstallResult>
  cancel: () => Promise<void>
  remove: () => Promise<void>
}

export type OfficeInstallOutcome = { kind: 'declined' } | { kind: 'installed' } | { kind: 'failed'; error: string }

/**
 * Acciones de la tarjeta. `install` pide el consentimiento ANTES de llamar a `api.install`: si se rechaza no se descarga nada.
 * `onStart` se invoca justo cuando la instalación arranca (tras confirmar).
 */
export function officeController(api: OfficeApi, confirm: (mb: number) => Promise<boolean>) {
  return {
    status: () => api.status(),
    async install(mb: number, onStart?: () => void): Promise<OfficeInstallOutcome> {
      if (!(await confirm(mb))) return { kind: 'declined' }
      onStart?.()
      const r = await api.install()
      return r.ok ? { kind: 'installed' } : { kind: 'failed', error: r.error }
    },
    cancel: () => api.cancel(),
    remove: () => api.remove()
  }
}

const REAL_API: OfficeApi = {
  status: () => cw('office:status'),
  install: () => cw('office:install'),
  cancel: () => cw('office:cancel'),
  remove: () => cw('office:remove')
}

export interface OfficeCardViewProps {
  t: T
  snapshot: OfficeUiSnapshot | null
  /** Instalación lanzada desde esta pestaña (antes de que el siguiente `status` la marque como en curso). */
  busy: boolean
  /** Código del último fallo, si lo hay (`null` si no). */
  error: string | null
  onInstall: () => void
  onCancel: () => void
  onRemove: () => void
}

/** Vista pura de la tarjeta. Sin snapshot o con `unsupported` no pinta nada. */
export function OfficeCardView({ t, snapshot, busy, error, onInstall, onCancel, onRemove }: OfficeCardViewProps): React.JSX.Element | null {
  if (!snapshot || snapshot.status.state === 'unsupported') return null
  const status = snapshot.status
  const installing = snapshot.installing || busy
  const err = installing ? null : (error ?? snapshot.error ?? null)
  const progress = snapshot.progress
  const total = progress?.total ?? 0
  const done = progress?.done ?? 0
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0

  let description: React.JSX.Element
  let control: React.JSX.Element | null
  if (installing) {
    description = (
      <span className="block space-y-1">
        <span className="block">{t('settings.office.desc')}</span>
        <span className="block text-xs text-fg">{t(PHASE_KEYS[progress?.phase ?? 'download'])}</span>
        <span
          role="progressbar"
          aria-label={t('settings.office.name')}
          aria-valuemin={0}
          aria-valuemax={total > 0 ? total : undefined}
          aria-valuenow={total > 0 ? done : undefined}
          className="block h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-hover"
        >
          <span
            className="block h-full bg-accent transition-[width] duration-300 motion-reduce:transition-none"
            style={{ width: `${pct}%` }}
          />
        </span>
        {total > 0 && (
          <span className="block text-xs tabular-nums">
            {t('settings.office.progress', { done: officeMb(done), total: officeMb(total) })}
          </span>
        )}
      </span>
    )
    control = (
      <Button size="sm" variant="secondary" onClick={onCancel}>
        {t('settings.office.cancel')}
      </Button>
    )
  } else if (status.state === 'installed') {
    description = (
      <span className="block space-y-1">
        <span className="block">{t('settings.office.desc')}</span>
        <span className="block text-xs text-muted">
          {status.source === 'system'
            ? t('settings.office.installedSystem', { version: status.version })
            : t('settings.office.installed', { version: status.version })}
        </span>
      </span>
    )
    control =
      status.source === 'app' ? (
        <Button size="sm" variant="secondary" onClick={onRemove}>
          {t('settings.office.remove')}
        </Button>
      ) : null
  } else {
    description = (
      <span className="block space-y-1">
        <span className="block">{t('settings.office.desc')}</span>
        {err && (
          <span role="alert" className="block text-xs text-danger">
            {t(officeErrorKey(err))}
          </span>
        )}
      </span>
    )
    control = (
      <Button size="sm" variant={err ? 'secondary' : 'primary'} onClick={onInstall}>
        {err ? t('settings.office.retry') : t('settings.office.install', { mb: officeMb(status.sizeBytes) })}
      </Button>
    )
  }

  return (
    <>
      <SubTitle>{t('settings.office.title')}</SubTitle>
      <Card>
        <Row label={t('settings.office.name')} description={description}>
          {control}
        </Row>
      </Card>
    </>
  )
}

/** Tarjeta conectada a IPC: carga el estado, sondea mientras instala y reacciona a las acciones. */
export function OfficeComponentCard(): React.JSX.Element | null {
  const t = useT()
  const [snapshot, setSnapshot] = useState<OfficeUiSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const s = await REAL_API.status()
      if (alive.current) setSnapshot(s)
    } catch {
      if (alive.current) setSnapshot(null)
    }
  }, [])

  useEffect(() => {
    alive.current = true
    void refresh()
    return () => {
      alive.current = false
    }
  }, [refresh])

  const polling = officeNeedsPoll(snapshot)
  useEffect(() => {
    if (!polling) return
    const id = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(id)
  }, [polling, refresh])

  const controller = officeController(REAL_API, (mb) =>
    confirmDialog({
      title: t('settings.office.consent.title'),
      message: t('settings.office.consent.body', { mb }),
      confirmLabel: t('settings.office.consent.confirm'),
      focusCancel: true
    })
  )

  const onInstall = async (): Promise<void> => {
    if (!snapshot || snapshot.status.state !== 'missing') return
    setError(null)
    const outcome = await controller.install(officeMb(snapshot.status.sizeBytes), () => {
      setBusy(true)
      void refresh()
    })
    setBusy(false)
    if (outcome.kind === 'failed') setError(outcome.error)
    void refresh()
  }

  const onCancel = async (): Promise<void> => {
    await controller.cancel().catch(() => undefined)
    void refresh()
  }

  const onRemove = async (): Promise<void> => {
    setError(null)
    await controller.remove().catch(() => setError('failed'))
    void refresh()
  }

  return (
    <OfficeCardView
      t={t}
      snapshot={snapshot}
      busy={busy}
      error={error}
      onInstall={() => void onInstall()}
      onCancel={() => void onCancel()}
      onRemove={() => void onRemove()}
    />
  )
}
