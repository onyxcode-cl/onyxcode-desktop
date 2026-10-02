import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { APP_NAME } from '@shared/brand'
import type { VersionsInfo } from '@shared/ipc-extras'
import type { AppInfo, OpencodeInfo } from '@shared/types'
import { Button } from '../../../components/Button'
import { useT } from '../../../lib/i18n'
import { api } from '../../../lib/api'
import { engineNoticeText, engineSummary } from '../../../lib/engine-notice'
import { checkFailedText, checkResultText, lastCheckText, updateView } from '../../../lib/update-notice'
import { platformCaps } from '../../../lib/platform'
import { PlatformNote } from '../../../components/PlatformNote'
import { runUpdateAction, useUpdateState } from '../../../lib/use-update-state'
import { ProgressBar } from '../../../components/ProgressBar'
import { useSettings } from '../../../stores/settings'
import { errorMessage } from '../../../lib/opencode'
import { useServer } from '../../../stores/server'
import { getExtras } from './extras'
import { Card, ErrorText, Row, SectionHeader, SubTitle, Toggle } from './ui'

export function AboutSection(): React.JSX.Element {
  const t = useT()
  const client = useServer((s) => s.client)
  const connection = useServer((s) => s.connection)
  const [versions, setVersions] = useState<VersionsInfo | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [server, setServer] = useState<{ version: string; healthy: boolean } | null>(null)
  const [engine, setEngine] = useState<OpencodeInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [update, setUpdate] = useUpdateState()
  const checkUpdates = useSettings((s) => s.settings.checkUpdates)
  const [checkResult, setCheckResult] = useState<string | null>(null)

  useEffect(() => {
    void getExtras()
      ?.invoke('extras:versions')
      .then(setVersions)
      .catch((err: unknown) => setError(errorMessage(err)))
    void api.invoke('app:info').then((r) => r.ok && setInfo(r.data))
    void api.invoke('app:opencodeInfo').then((r) => r.ok && setEngine(r.data))
  }, [])

  useEffect(() => {
    if (!client) return
    void client.global
      .health()
      .then((r) => {
        if (r.data) setServer({ version: r.data.version, healthy: r.data.healthy })
        else setError(errorMessage(r.error))
      })
      .catch((err: unknown) => setError(errorMessage(err)))
  }, [client])

  const open = (url: string): void => {
    void api.invoke('app:openExternal', { url })
  }

  const searchNow = (): void => {
    const startedAt = Date.now()
    setCheckResult(null)
    void api.invoke('app:checkUpdates').then((r) => {
      if (r.ok) {
        setUpdate(r.data)
        setCheckResult(checkResultText(r.data, startedAt))
      } else setCheckResult(checkFailedText())
    })
  }
  const configured = update?.configured ?? false
  const view = updateView(update, { later: false })

  return (
    <div>
      <SectionHeader title={t('settings.about.title', { app: APP_NAME })} description={t('settings.about.subtitle')} />
      {error && (
        <div className="mb-3">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
      <Card>
        <Row label={APP_NAME} description={info?.isDev ? t('settings.about.devMode') : undefined}>
          <span className="font-mono text-sm">v{versions?.app ?? info?.version ?? '…'}</span>
        </Row>
        <Row label={t('settings.about.engine')} description={engineNoticeText(engine) ?? undefined}>
          <span className="font-mono text-sm">{engineSummary(engine) ?? '—'}</span>
        </Row>
        <Row
          label={t('settings.about.server')}
          description={connection ? <span className="font-mono">{connection.baseUrl}</span> : t('settings.about.noConnection')}
        >
          <span className="font-mono text-sm">
            {server ? `v${server.version}` : (connection?.version && `v${connection.version}`) || '—'}
          </span>
        </Row>
        <Row label="Electron">
          <span className="font-mono text-sm">{versions?.electron ?? '…'}</span>
        </Row>
        <Row label="Chromium">
          <span className="font-mono text-sm">{versions?.chrome ?? '…'}</span>
        </Row>
        <Row label="Node.js">
          <span className="font-mono text-sm">{versions?.node ?? '…'}</span>
        </Row>
        <Row label={t('settings.about.system')}>
          <span className="font-mono text-sm">{versions ? `${versions.platform} ${versions.arch} · ${versions.osRelease}` : '…'}</span>
        </Row>
        <Row label={t('settings.about.disclaimer')} />
      </Card>

      {info && (
        <>
          <SubTitle>{t('settings.about.data')}</SubTitle>
          <Card>
            <Row
              label={t('settings.about.appData')}
              description={<span className="font-mono break-all select-text">{info.userDataPath}</span>}
            />
            <Row
              label={t('settings.about.chatSpace')}
              description={<span className="font-mono break-all select-text">{info.chatDirectory}</span>}
            />
          </Card>
        </>
      )}

      {platformCaps().updater ? (
        <>
          <SubTitle>{t('settings.about.updates')}</SubTitle>
          <Card>
            <Row
              label={t('settings.about.autoCheck')}
              description={
                configured
                  ? t('settings.about.autoCheck.configured', { agent: `${APP_NAME}/${update?.current ?? info?.version ?? ''}` })
                  : t('settings.about.autoCheck.unconfigured')
              }
            >
              <Toggle
                checked={checkUpdates}
                onChange={(v) => void useSettings.getState().update({ checkUpdates: v })}
                label={t('settings.about.autoCheck')}
                disabled={!configured}
              />
            </Row>
            <Row label={t('settings.about.currentVersion')}>
              <span data-testid="update-current" className="font-mono text-sm">
                v{update?.current ?? info?.version ?? '…'}
              </span>
            </Row>
            <Row label={t('settings.about.channel')} description={t('settings.about.channel.description')}>
              <span className="text-sm">{t('settings.about.channel.stable')}</span>
            </Row>
            <Row
              label={t('settings.about.checkNow')}
              description={
                <span data-testid="update-last-check">
                  {checkResult && (
                    <span data-testid="update-result" className="mb-0.5 block text-fg">
                      {checkResult}
                    </span>
                  )}
                  {lastCheckText(update?.lastCheck ?? null)}
                </span>
              }
            >
              <Button size="sm" onClick={searchNow} disabled={!configured || !checkUpdates || update?.checking === true}>
                {update?.checking ? t('settings.about.checking') : t('settings.about.checkNow')}
              </Button>
            </Row>
            {view && update && (
              <Row
                label={
                  view.phase === 'idle' || view.phase === 'cancelled'
                    ? t('settings.about.versionAvailable', { version: update.latest?.version ?? '' })
                    : t('settings.about.update')
                }
                description={
                  <span data-testid="update-status" data-phase={view.phase}>
                    <span className="block text-fg">
                      {view.text}
                      {view.percent !== null && <span className="ml-1.5 font-mono tabular-nums text-muted">{view.percent} %</span>}
                    </span>
                    {view.progress && view.phase !== 'installing' && view.phase !== 'restarting' && (
                      <span className="mt-1.5 block">
                        <ProgressBar percent={view.percent} label={view.text} />
                      </span>
                    )}
                  </span>
                }
              >
                <div data-testid="update-actions" className="flex gap-2">
                  {view.actions.map((a) => (
                    <Button
                      key={a.id}
                      size="sm"
                      variant={a.primary ? 'primary' : 'secondary'}
                      onClick={() => runUpdateAction(a.id, update, setUpdate)}
                    >
                      {a.label}
                    </Button>
                  ))}
                </div>
              </Row>
            )}
          </Card>
        </>
      ) : (
        <>
          <SubTitle>{t('settings.about.updates')}</SubTitle>
          <PlatformNote>{t('platform.win.unavailable.update')}</PlatformNote>
        </>
      )}

      <SubTitle>{t('settings.about.links')}</SubTitle>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => open('https://opencode.ai/docs/')}>
          <ExternalLink size={14} /> {t('settings.about.docs')}
        </Button>
        <Button onClick={() => open('https://opencode.ai/docs/mcp-servers/')}>
          <ExternalLink size={14} /> {t('settings.about.mcpServers')}
        </Button>
      </div>
    </div>
  )
}
