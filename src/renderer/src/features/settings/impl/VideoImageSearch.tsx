import { useEffect, useState } from 'react'
import type { VideoImageProvider, VideoImageSearchStatus } from '@shared/video'
import { useT } from '../../../lib/i18n'
import { openExternalUrl } from '../../../lib/open-external'
import { Button } from '../../../components/Button'
import { cw } from '../../tasks/impl/bridge'
import { Row } from './ui'

export function VideoImageSearch(): React.JSX.Element {
  const t = useT()
  const [status, setStatus] = useState<VideoImageSearchStatus | null>(null)
  const [provider, setProvider] = useState<VideoImageProvider>('serper')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<'saved' | 'error' | null>(null)
  useEffect(() => {
    let active = true
    void cw('video:imageSearchStatus').then(
      (s) => {
        if (active) {
          setStatus(s)
          setProvider(s.provider)
        }
      },
      () => {
        if (active) setMessage('error')
      }
    )
    return () => {
      active = false
    }
  }, [])
  const save = async (remove = false): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await cw('video:imageSearchSave', { provider, ...(remove ? { key: '' } : key.trim() ? { key: key.trim() } : {}) })
      if (!result.ok) throw Error('save')
      setKey('')
      setStatus(await cw('video:imageSearchStatus'))
      setMessage('saved')
    } catch {
      setKey('')
      setMessage('error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Row label={t('settings.video.images.title')} description={t('settings.video.images.desc')}>
      <div className="flex w-full max-w-sm flex-col gap-2" data-testid="video-image-search">
        <select
          aria-label={t('settings.video.images.provider')}
          value={provider}
          disabled={busy}
          className="rounded border border-border bg-input px-2 py-1 text-sm"
          onChange={(e) => {
            setProvider(e.target.value as VideoImageProvider)
            setKey('')
            setMessage(null)
          }}
        >
          <option value="serper">{t('settings.video.images.serper')}</option>
          <option value="brave">{t('settings.video.images.brave')}</option>
        </select>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          maxLength={512}
          disabled={busy || !status?.secure}
          aria-label={t('settings.video.images.key')}
          placeholder={t(status?.configured[provider] ? 'settings.video.images.configured' : 'settings.video.images.key')}
          className="rounded border border-border bg-input px-2 py-1 text-sm"
          onChange={(e) => {
            setKey(e.target.value)
            setMessage(null)
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy || !status?.secure} onClick={() => void save()}>
            {t('settings.video.images.save')}
          </Button>
          {status?.configured[provider] && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void save(true)}>
              {t('settings.video.images.remove')}
            </Button>
          )}
          <button
            className="text-xs text-accent underline"
            onClick={() => void openExternalUrl(provider === 'serper' ? 'https://serper.dev/' : 'https://api-dashboard.search.brave.com/')}
          >
            {t('settings.video.images.getKey')}
          </button>
        </div>
        {status && !status.secure && (
          <span role="alert" className="text-xs text-danger">
            {t('settings.video.images.unavailable')}
          </span>
        )}
        {message && (
          <span role={message === 'error' ? 'alert' : 'status'} className="text-xs">
            {t(message === 'error' ? 'settings.video.images.error' : 'settings.video.images.saved')}
          </span>
        )}
      </div>
    </Row>
  )
}
