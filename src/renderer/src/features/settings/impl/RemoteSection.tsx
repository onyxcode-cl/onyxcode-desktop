/**
 * Ajustes › Celular: «Conectar mi celular» (control remoto por red local, prototipo). Apagado por defecto:
 * «Activar» abre el servidor local y muestra un QR de un solo uso (caduca a los 120 s). La vinculación se
 * confirma en un diálogo aparte (`RemotePairHost`) con un código de 6 dígitos.
 */
import { useEffect, useMemo, useState } from 'react'
import { Loader2, Smartphone, Trash2 } from 'lucide-react'
import { getLang } from '@shared/i18n'
import { LIMITS } from '@shared/remote/protocol'
import type { RemoteApi, RemoteState } from '@shared/ipc-remote'
import { Button } from '../../../components/Button'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { errText } from '../../../lib/format'
import { useT } from '../../../lib/i18n'
import { Badge, Card, ErrorText, Row, SectionHeader, SubTitle } from './ui'

function getRemote(): RemoteApi | undefined {
  return (window as unknown as { api?: { remote?: RemoteApi } }).api?.remote
}

const locale = (): string => (getLang() === 'en' ? 'en-US' : 'es-CL')

/** QR dibujado como SVG (matriz que entrega main; sin imágenes ni librerías en el renderer). */
export function QrSvg({ matrix, label }: { matrix: boolean[][]; label: string }): React.JSX.Element {
  const quiet = 3
  const size = matrix.length
  const d = useMemo(() => {
    const parts: string[] = []
    matrix.forEach((row, y) =>
      row.forEach((on, x) => {
        if (on) parts.push(`M${x + quiet} ${y + quiet}h1v1h-1z`)
      })
    )
    return parts.join('')
  }, [matrix])
  const total = size + quiet * 2
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${total} ${total}`}
      shapeRendering="crispEdges"
      className="h-52 w-52 rounded-lg border border-border bg-white"
    >
      <rect width={total} height={total} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  )
}

export function RemoteSection(): React.JSX.Element {
  const t = useT()
  const api = getRemote()
  const [state, setState] = useState<RemoteState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!api) return
    let alive = true
    void api
      .invoke('remote:getState')
      .then((s) => alive && setState(s))
      .catch((err: unknown) => alive && setError(errText(err)))
    const off = api.on('remote:changed', (s) => setState(s))
    return () => {
      alive = false
      off()
    }
  }, [api])

  const pairingActive = state?.pairing != null
  useEffect(() => {
    if (!pairingActive) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [pairingActive])

  if (!api) {
    return (
      <div>
        <SectionHeader title={t('remote.title')} description={t('misc.desktopOnly')} />
      </div>
    )
  }

  const run = (fn: () => Promise<RemoteState>): void => {
    setError(null)
    setBusy(true)
    fn()
      .then(setState)
      .catch((err: unknown) => setError(errText(err)))
      .finally(() => setBusy(false))
  }

  const unavailableText = (reason: NonNullable<RemoteState['unavailable']>): string =>
    reason === 'platform'
      ? t('remote.unavailable.platform')
      : reason === 'no-safe-storage'
        ? t('remote.unavailable.noSafeStorage')
        : reason === 'no-network'
          ? t('remote.unavailable.noNetwork')
          : t('remote.unavailable.noRtc')

  const startError = (e: string): string =>
    e === 'no-network'
      ? t('remote.unavailable.noNetwork')
      : e.startsWith('no-rtc')
        ? t('remote.unavailable.noRtc')
        : t('remote.error.start', { detail: e })

  const revoke = async (id: string, name: string): Promise<void> => {
    const ok = await confirmDialog({
      title: t('remote.devices.revokeTitle', { name }),
      message: t('remote.devices.revokeBody'),
      confirmLabel: t('remote.devices.revoke'),
      danger: true
    })
    if (ok) run(() => api.invoke('remote:revoke', { deviceId: id }))
  }

  const copy = (url: string): void => {
    void navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => undefined)
  }

  if (!state) {
    return (
      <div>
        <SectionHeader title={t('remote.title')} description={t('remote.intro')} />
        {error ? <ErrorText>{error}</ErrorText> : <Loader2 size={16} className="animate-spin text-muted" />}
      </div>
    )
  }

  const connected = state.devices.some((d) => d.connected)
  const on = state.mode !== 'off'
  const remaining = state.pairing ? Math.max(0, Math.ceil((state.pairing.expiresAt - now) / 1000)) : 0

  return (
    <div>
      <SectionHeader title={t('remote.title')} description={t('remote.intro')} />

      {!state.available && state.unavailable ? (
        <div role="status" className="rounded-xl border border-border bg-elevated px-4 py-3 text-sm text-muted">
          {unavailableText(state.unavailable)}
        </div>
      ) : (
        <>
          <Card>
            <Row
              label={
                <span className="flex items-center gap-2">
                  <Smartphone size={14} className="text-accent" /> {t('remote.title')}
                </span>
              }
              description={on ? t('remote.stopAll.hint') : undefined}
            >
              <span className="flex items-center gap-2">
                <Badge tone={connected ? 'ok' : on ? 'accent' : 'muted'}>
                  {connected
                    ? t('remote.state.connected')
                    : state.mode === 'pairing'
                      ? t('remote.state.pairing')
                      : on
                        ? t('remote.state.active')
                        : t('remote.state.off')}
                </Badge>
                {on ? (
                  <Button variant="danger" size="sm" disabled={busy} onClick={() => run(() => api.invoke('remote:stop'))}>
                    {t('remote.stopAll')}
                  </Button>
                ) : (
                  <Button variant="primary" size="sm" disabled={busy} onClick={() => run(() => api.invoke('remote:start'))}>
                    {busy ? t('remote.activating') : t('remote.activate')}
                  </Button>
                )}
              </span>
            </Row>
          </Card>

          {(error || state.error) && <ErrorText>{error ?? startError(state.error as string)}</ErrorText>}

          {state.pairing && (
            <>
              <SubTitle>{t('remote.qr.title')}</SubTitle>
              <Card className="flex flex-col items-center gap-3 p-5">
                <QrSvg matrix={state.pairing.qr} label={t('remote.qr.alt')} />
                <p className="text-center text-xs text-muted">{t('remote.qr.hint')}</p>
                <p className="text-xs font-medium text-fg" aria-live="off">
                  {t('remote.qr.expiresIn', { seconds: remaining })}
                </p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => copy(state.pairing!.url)}>
                    {copied ? t('remote.qr.copied') : t('remote.qr.copy')}
                  </Button>
                  <Button size="sm" disabled={busy} onClick={() => run(() => api.invoke('remote:newPairing'))}>
                    {t('remote.newQr')}
                  </Button>
                </div>
              </Card>
            </>
          )}

          {on && !state.pairing && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-border bg-elevated px-4 py-3 text-sm">
              <span className="text-muted">{state.pairingExpired ? t('remote.qr.expired') : t('remote.state.active')}</span>
              <Button
                size="sm"
                disabled={busy || state.devices.length >= LIMITS.maxDevices}
                onClick={() => run(() => api.invoke('remote:newPairing'))}
              >
                {t('remote.newQr')}
              </Button>
            </div>
          )}

          {on && state.idleStopAt && (
            <p className="mt-3 text-xs text-muted">
              {t('remote.idle', { time: new Date(state.idleStopAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) })}
            </p>
          )}

          <SubTitle>{t('remote.devices.title')}</SubTitle>
          <Card>
            {state.devices.length === 0 ? (
              <div className="px-4 py-3 text-sm text-muted">{t('remote.devices.empty')}</div>
            ) : (
              state.devices.map((d) => (
                <Row
                  key={d.id}
                  label={d.name}
                  description={
                    d.connected
                      ? t('remote.devices.connected')
                      : d.lastSeenAt
                        ? t('remote.devices.lastSeen', { when: new Date(d.lastSeenAt).toLocaleString(locale()) })
                        : t('remote.devices.never')
                  }
                >
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => void revoke(d.id, d.name)}>
                    <Trash2 size={13} /> {t('remote.devices.revoke')}
                  </Button>
                </Row>
              ))
            )}
          </Card>
          {state.devices.length >= LIMITS.maxDevices && (
            <p className="mt-2 text-xs text-muted">{t('remote.devices.max', { count: LIMITS.maxDevices })}</p>
          )}

          <p className="mt-6 text-xs leading-relaxed text-subtle">{t('remote.risk')}</p>
        </>
      )}
    </div>
  )
}
