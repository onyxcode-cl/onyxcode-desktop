/**
 * Ajustes › «Componentes opcionales»: tarjeta de Node.js y uv de la app (F8-B195), los dos programas que usan los conectores locales
 * de correo, calendario y archivos. Muestra su estado, descarga lo que falta (el botón, tras el aviso, ES el consentimiento) y permite
 * «Quitar» (borra su carpeta). Todo el estado vive en main (`runtimes:*`). Solo aparece donde hay conectores locales (hoy, Mac).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MsgKey, Params } from '@shared/i18n'
import { DISPLAY_NAME } from '@shared/brand'
import type { RuntimesSnapshot } from '@shared/runtimes'
import { Button } from '../../../components/Button'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { useT } from '../../../lib/i18n'
import { officeMb } from './component-install'
import { runtimesApi, runtimesErrorKey } from './runtimes-view'
import { Card, Row, SubTitle } from './ui'

type T = (key: MsgKey, params?: Params) => string

const POLL_MS = 1000

const PHASE_KEYS = {
  download: 'settings.runtimes.phase.download',
  extract: 'settings.runtimes.phase.extract',
  verify: 'settings.runtimes.phase.verify',
  done: 'settings.runtimes.phase.done'
} as const satisfies Record<NonNullable<RuntimesSnapshot['progress']>['phase'], MsgKey>

export interface RuntimesCardViewProps {
  t: T
  snapshot: RuntimesSnapshot | null
  busy: boolean
  error: string | null
  onInstall: () => void
  onCancel: () => void
  onRemove: () => void
}

/** Vista pura. Sin snapshot, o en una plataforma sin conectores locales, no pinta nada. */
export function RuntimesCardView({
  t,
  snapshot,
  busy,
  error,
  onInstall,
  onCancel,
  onRemove
}: RuntimesCardViewProps): React.JSX.Element | null {
  if (!snapshot || !snapshot.offered) return null
  const installing = snapshot.installing || busy
  const err = installing ? null : (error ?? snapshot.error ?? null)
  const progress = snapshot.progress
  const total = progress?.total ?? 0
  const done = progress?.done ?? 0
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
  const anyBroken = snapshot.items.some((i) => i.state === 'broken')
  const anyInstalled = snapshot.items.some((i) => i.state === 'installed' || i.state === 'broken')
  const ver = (id: 'node' | 'uv'): string => snapshot.items.find((i) => i.id === id)?.version ?? ''

  let extra: React.JSX.Element | null = null
  let control: React.JSX.Element | null
  if (installing) {
    extra = (
      <span className="block space-y-1">
        <span className="block text-xs text-fg">{t(PHASE_KEYS[progress?.phase ?? 'download'])}</span>
        <span
          role="progressbar"
          aria-label={t('settings.runtimes.name')}
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
            {t('settings.craft.progress', { done: officeMb(done), total: officeMb(total) })}
          </span>
        )}
      </span>
    )
    control = (
      <Button size="sm" variant="secondary" onClick={onCancel}>
        {t('settings.runtimes.cancel')}
      </Button>
    )
  } else if (snapshot.ready) {
    extra = <span className="block text-xs text-muted">{t('settings.runtimes.installed', { node: ver('node'), uv: ver('uv') })}</span>
    control = (
      <Button size="sm" variant="secondary" onClick={onRemove}>
        {t('settings.runtimes.remove')}
      </Button>
    )
  } else {
    extra = err ? (
      <span role="alert" className="block text-xs text-danger">
        {t(runtimesErrorKey(err))}
      </span>
    ) : anyBroken ? (
      <span className="block text-xs text-muted">{t('settings.runtimes.broken')}</span>
    ) : null
    control = (
      <span className="flex items-center gap-2">
        {anyInstalled && (
          <Button size="sm" variant="secondary" onClick={onRemove}>
            {t('settings.runtimes.remove')}
          </Button>
        )}
        <Button size="sm" variant={err ? 'secondary' : 'primary'} onClick={onInstall}>
          {err ? t('settings.runtimes.retry') : t('settings.runtimes.install', { mb: officeMb(snapshot.missingBytes) })}
        </Button>
      </span>
    )
  }

  return (
    <>
      <SubTitle>{t('settings.runtimes.title')}</SubTitle>
      <Card>
        <Row
          label={t('settings.runtimes.name')}
          description={
            <span className="block space-y-1" data-testid="runtimes-card">
              <span className="block">{t('settings.runtimes.desc', { app: DISPLAY_NAME })}</span>
              {extra}
            </span>
          }
        >
          {control}
        </Row>
      </Card>
    </>
  )
}

/** Tarjeta conectada a IPC: carga el estado, sondea mientras instala y reacciona a las acciones. */
export function RuntimesCard(): React.JSX.Element | null {
  const t = useT()
  const [snapshot, setSnapshot] = useState<RuntimesSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const s = await runtimesApi.status()
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

  const polling = snapshot?.installing === true
  useEffect(() => {
    if (!polling) return
    const id = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(id)
  }, [polling, refresh])

  const onInstall = async (): Promise<void> => {
    if (!snapshot) return
    const ok = await confirmDialog({
      title: t('settings.runtimes.consent.title'),
      message: t('settings.runtimes.consent.body', { mb: officeMb(snapshot.missingBytes), app: DISPLAY_NAME }),
      confirmLabel: t('settings.runtimes.consent.confirm'),
      focusCancel: true
    })
    if (!ok) return
    setError(null)
    setBusy(true)
    void refresh()
    const r = await runtimesApi.install().catch(() => ({ ok: false as const, error: 'download', message: '' }))
    setBusy(false)
    if (!r.ok) setError(r.error)
    void refresh()
  }

  const onRemove = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: t('settings.runtimes.removeTitle'),
      message: t('settings.runtimes.removeBody'),
      confirmLabel: t('settings.runtimes.removeConfirm'),
      danger: true
    })
    if (!ok) return
    await runtimesApi.remove().catch(() => setError('generic'))
    void refresh()
  }

  return (
    <RuntimesCardView
      t={t}
      snapshot={snapshot}
      busy={busy}
      error={error}
      onInstall={() => void onInstall()}
      onCancel={() => void runtimesApi.cancel().then(refresh, refresh)}
      onRemove={() => void onRemove()}
    />
  )
}
