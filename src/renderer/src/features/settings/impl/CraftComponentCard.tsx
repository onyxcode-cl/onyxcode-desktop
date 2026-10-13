/**
 * Ajustes › Tareas › «Componentes opcionales»: tarjeta de ArtCraft (presentaciones, documentos, hojas y PDF con diseño premium) con
 * instalación bajo demanda. El botón «Instalar» ES el consentimiento (el diálogo confirma la descarga antes de llamar a `craft:install`)
 * y todo el estado vive en main (`craft:*`). La lógica sin DOM (controlador, MB, errores) está en `component-install.ts`.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MsgKey, Params } from '@shared/i18n'
import type { CraftInstallResult, CraftUiSnapshot } from '@shared/craft'
import { Button } from '../../../components/Button'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { useT } from '../../../lib/i18n'
import { cw } from '../../tasks/impl/bridge'
import { officeController, officeErrorKey, officeMb, type InstallOutcome } from './component-install'
import { Card, Row, SubTitle } from './ui'

type T = (key: MsgKey, params?: Params) => string

const POLL_MS = 1000

const PHASE_KEYS = {
  download: 'settings.craft.phase.download',
  verify: 'settings.craft.phase.verify',
  copy: 'settings.craft.phase.copy',
  done: 'settings.craft.phase.done'
} as const satisfies Record<NonNullable<CraftUiSnapshot['progress']>['phase'], MsgKey>

/** Mensaje humano de un fallo (disco, hash, firma, descarga, cancelado o genérico). */
export const craftErrorKey = officeErrorKey

const REAL_API = {
  status: () => cw('craft:status') as Promise<CraftUiSnapshot>,
  install: () => cw('craft:install') as Promise<CraftInstallResult>,
  cancel: () => cw('craft:cancel') as Promise<void>,
  remove: () => cw('craft:remove') as Promise<void>
}

const confirmInstall =
  (t: T) =>
  (mb: number): Promise<boolean> =>
    confirmDialog({
      title: t('settings.craft.consent.title'),
      message: t('settings.craft.consent.body', { mb }),
      confirmLabel: t('settings.craft.consent.confirm'),
      focusCancel: true
    })

/**
 * Flujo de instalación de ArtCraft para otras pantallas (Diagnóstico): consulta el tamaño, pide el mismo consentimiento y llama a
 * `craft:install`. Si ya está instalado (o no hay nada que instalar) no hace nada.
 */
export async function requestCraftInstall(t: T): Promise<InstallOutcome> {
  const s = await REAL_API.status()
  if (s.status.state !== 'missing') return { kind: 'installed' }
  return officeController(REAL_API, confirmInstall(t)).install(officeMb(s.status.sizeBytes))
}

export interface CraftCardViewProps {
  t: T
  snapshot: CraftUiSnapshot | null
  busy: boolean
  error: string | null
  onInstall: () => void
  onCancel: () => void
  onRemove: () => void
}

/** Vista pura. Sin snapshot o con `unsupported` (p. ej. Windows) no pinta nada. */
export function CraftCardView({ t, snapshot, busy, error, onInstall, onCancel, onRemove }: CraftCardViewProps): React.JSX.Element | null {
  if (!snapshot || snapshot.status.state === 'unsupported') return null
  const status = snapshot.status
  const installing = snapshot.installing || busy
  const err = installing ? null : (error ?? snapshot.error ?? null)
  const progress = snapshot.progress
  const total = progress?.total ?? 0
  const done = progress?.done ?? 0
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0

  let extra: React.JSX.Element | null = null
  let control: React.JSX.Element | null
  if (installing) {
    extra = (
      <span className="block space-y-1">
        <span className="block text-xs text-fg">{t(PHASE_KEYS[progress?.phase ?? 'download'])}</span>
        <span
          role="progressbar"
          aria-label={t('settings.craft.name')}
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
        {t('settings.craft.cancel')}
      </Button>
    )
  } else if (status.state === 'installed') {
    extra = <span className="block text-xs text-muted">{t('settings.craft.installed', { version: status.version })}</span>
    control = (
      <Button size="sm" variant="secondary" onClick={onRemove}>
        {t('settings.craft.remove')}
      </Button>
    )
  } else {
    if (err)
      extra = (
        <span role="alert" className="block text-xs text-danger">
          {t(craftErrorKey(err))}
        </span>
      )
    control = (
      <Button size="sm" variant={err ? 'secondary' : 'primary'} onClick={onInstall}>
        {err ? t('settings.craft.retry') : t('settings.craft.install', { mb: officeMb(status.sizeBytes) })}
      </Button>
    )
  }

  return (
    <>
      <SubTitle>{t('settings.craft.title')}</SubTitle>
      <Card>
        <Row
          label={t('settings.craft.name')}
          description={
            <span className="block space-y-1">
              <span className="block">{t('settings.craft.desc')}</span>
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
export function CraftComponentCard(): React.JSX.Element | null {
  const t = useT()
  const [snapshot, setSnapshot] = useState<CraftUiSnapshot | null>(null)
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

  const polling = snapshot?.installing === true
  useEffect(() => {
    if (!polling) return
    const id = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(id)
  }, [polling, refresh])

  const controller = officeController(REAL_API, confirmInstall(t))

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

  return (
    <CraftCardView
      t={t}
      snapshot={snapshot}
      busy={busy}
      error={error}
      onInstall={() => void onInstall()}
      onCancel={() => void controller.cancel().then(refresh, refresh)}
      onRemove={() => void controller.remove().then(refresh, () => setError('failed'))}
    />
  )
}
