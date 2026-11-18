import { useCallback, useEffect, useState } from 'react'
import type { MsgKey, Params } from '@shared/i18n'
import { videoMb, type VideoSnapshot } from '@shared/video'
import { Button } from '../../../components/Button'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { useT } from '../../../lib/i18n'
import { openExternalUrl } from '../../../lib/open-external'
import { cw } from '../../tasks/impl/bridge'
import { runtimesErrorKey } from './runtimes-view'
import { VideoImageSearch } from './VideoImageSearch'
import { Card, Row, SubTitle } from './ui'

const PHASES = {
  node: 'settings.video.phase.node',
  download: 'settings.runtimes.phase.download',
  extract: 'settings.runtimes.phase.extract',
  npm: 'settings.video.phase.npm',
  verify: 'settings.runtimes.phase.verify',
  done: 'settings.runtimes.phase.done'
} as const satisfies Record<NonNullable<VideoSnapshot['progress']>['phase'], MsgKey>

interface Props {
  t: (key: MsgKey, params?: Params) => string
  snapshot: VideoSnapshot | null
  busy: boolean
  error: string | null
  onInstall: () => void
  onCancel: () => void
  onRemove: () => void
}

export function VideoCardView({ t, snapshot: s, busy, error, onInstall, onCancel, onRemove }: Props): React.JSX.Element | null {
  if (!s?.offered) return null
  const installing = busy || s.installing
  const total = s.progress?.total ?? 0
  const done = s.progress?.done ?? 0
  const err = error ?? s.error
  return (
    <>
      <SubTitle>{t('settings.video.title')}</SubTitle>
      <Card>
        <Row
          label={t('settings.video.name')}
          description={
            <span className="block space-y-1" data-testid="video-card">
              <span className="block">{t('settings.video.desc')}</span>
              <span className="block text-xs">{t('settings.video.chrome')}</span>
              <span className="block text-xs">
                {t('settings.video.gpl')}{' '}
                <button
                  className="text-accent underline"
                  onClick={() => void openExternalUrl('https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz')}
                >
                  {t('settings.video.source')}
                </button>
                {' · '}
                <button className="text-accent underline" onClick={() => void openExternalUrl('https://www.gnu.org/licenses/gpl-3.0.html')}>
                  {t('settings.video.license')}
                </button>
              </span>
              {installing ? (
                <>
                  <span className="block text-xs">{t(PHASES[s.progress?.phase ?? 'download'])}</span>
                  <span
                    role="progressbar"
                    aria-label={t('settings.video.name')}
                    aria-valuemin={0}
                    aria-valuemax={total || undefined}
                    aria-valuenow={total ? done : undefined}
                    className="block h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-hover"
                  >
                    <span className="block h-full bg-accent" style={{ width: total ? `${Math.min(100, (done / total) * 100)}%` : '30%' }} />
                  </span>
                  {total > 0 && (
                    <span className="block text-xs">{t('settings.craft.progress', { done: videoMb(done), total: videoMb(total) })}</span>
                  )}
                </>
              ) : s.ready ? (
                <span className="block text-xs">{t('settings.video.ready')}</span>
              ) : err ? (
                <span role="alert" className="block text-xs text-danger">
                  {t(err === 'io' ? 'settings.video.error.io' : runtimesErrorKey(err))}
                </span>
              ) : (
                <span className="block text-xs">{t('settings.video.missing')}</span>
              )}
            </span>
          }
        >
          {installing ? (
            <Button size="sm" variant="secondary" onClick={onCancel}>
              {t('settings.runtimes.cancel')}
            </Button>
          ) : (
            <span className="flex items-center gap-2">
              {s.items.some((i) => i.id !== 'node' && i.state !== 'missing') && (
                <Button size="sm" variant="secondary" onClick={onRemove}>
                  {t('settings.runtimes.remove')}
                </Button>
              )}
              {!s.ready && (
                <Button size="sm" onClick={onInstall}>
                  {t('settings.video.install', { mb: videoMb(s.missingBytes) })}
                </Button>
              )}
            </span>
          )}
        </Row>
      </Card>
    </>
  )
}

export function VideoCard(): React.JSX.Element | null {
  const t = useT()
  const [snapshot, setSnapshot] = useState<VideoSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    setSnapshot(await cw('video:status').catch(() => null))
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])
  useEffect(() => {
    if (!busy && !snapshot?.installing) return
    const id = setInterval(() => void refresh(), 750)
    return () => clearInterval(id)
  }, [busy, snapshot?.installing, refresh])
  const install = async (): Promise<void> => {
    if (
      !snapshot ||
      !(await confirmDialog({
        title: t('settings.video.title'),
        message: t('settings.video.consent', { mb: videoMb(snapshot.missingBytes) }),
        confirmLabel: t('settings.video.confirm'),
        focusCancel: true
      }))
    )
      return
    setBusy(true)
    setError(null)
    try {
      const r = await cw('video:install')
      if (!r.ok) setError(r.error)
    } catch {
      setError('download')
    } finally {
      setBusy(false)
      void refresh()
    }
  }
  const remove = async (): Promise<void> => {
    if (
      !(await confirmDialog({
        title: t('settings.video.removeTitle'),
        message: t('settings.video.removeBody'),
        confirmLabel: t('settings.runtimes.remove'),
        danger: true
      }))
    )
      return
    await cw('video:remove').catch(() => setError('io'))
    void refresh()
  }
  return (
    <>
      <VideoCardView
        t={t}
        snapshot={snapshot}
        busy={busy}
        error={error}
        onInstall={() => void install()}
        onRemove={() => void remove()}
        onCancel={() => void cw('video:cancel').then(refresh, refresh)}
      />
      {snapshot?.offered && (
        <Card>
          <VideoImageSearch />
        </Card>
      )}
    </>
  )
}
