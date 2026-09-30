import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { APP_NAME } from '@shared/brand'
import type { VersionsInfo } from '@shared/ipc-extras'
import type { AppInfo, OpencodeInfo } from '@shared/types'
import { Button } from '../../../components/Button'
import { api } from '../../../lib/api'
import { engineNoticeText, engineSummary } from '../../../lib/engine-notice'
import { CHECK_FAILED_TEXT, checkResultText, lastCheckText, updateView } from '../../../lib/update-notice'
import { runUpdateAction, useUpdateState } from '../../../lib/use-update-state'
import { ProgressBar } from '../../../components/ProgressBar'
import { useSettings } from '../../../stores/settings'
import { errorMessage } from '../../../lib/opencode'
import { useServer } from '../../../stores/server'
import { getExtras } from './extras'
import { Card, ErrorText, Row, SectionHeader, SubTitle, Toggle } from './ui'

export function AboutSection(): React.JSX.Element {
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
      } else setCheckResult(CHECK_FAILED_TEXT)
    })
  }
  const configured = update?.configured ?? false
  const view = updateView(update, { later: false })

  return (
    <div>
      <SectionHeader title={`Acerca de ${APP_NAME}`} description="Cliente de escritorio sobre OpenCode." />
      {error && (
        <div className="mb-3">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
      <Card>
        <Row label={APP_NAME} description={info?.isDev ? 'Modo desarrollo' : undefined}>
          <span className="font-mono text-sm">v{versions?.app ?? info?.version ?? '…'}</span>
        </Row>
        <Row label="Motor" description={engineNoticeText(engine) ?? undefined}>
          <span className="font-mono text-sm">{engineSummary(engine) ?? '—'}</span>
        </Row>
        <Row label="Servidor OpenCode" description={connection ? <span className="font-mono">{connection.baseUrl}</span> : 'Sin conexión'}>
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
        <Row label="Sistema">
          <span className="font-mono text-sm">{versions ? `${versions.platform} ${versions.arch} · ${versions.osRelease}` : '…'}</span>
        </Row>
        <Row label="Proyecto independiente, no afiliado a OpenCode ni a Anthropic." />
      </Card>

      {info && (
        <>
          <SubTitle>Datos</SubTitle>
          <Card>
            <Row label="Datos de la app" description={<span className="font-mono break-all select-text">{info.userDataPath}</span>} />
            <Row label="Espacio de Chat" description={<span className="font-mono break-all select-text">{info.chatDirectory}</span>} />
          </Card>
        </>
      )}

      <SubTitle>Actualizaciones</SubTitle>
      <Card>
        <Row
          label="Buscar actualizaciones automáticamente"
          description={
            configured
              ? `Una vez al día como mucho, la app pide a GitHub (api.github.com) cuál es la última versión publicada. Solo se envía esa petición con el nombre y la versión de la app (${APP_NAME}/${update?.current ?? info?.version ?? ''}); ningún dato tuyo ni identificador. Solo descarga cuando pulsas Actualizar.`
              : 'Esta compilación no tiene configurado dónde buscar versiones nuevas.'
          }
        >
          <Toggle
            checked={checkUpdates}
            onChange={(v) => void useSettings.getState().update({ checkUpdates: v })}
            label="Buscar actualizaciones automáticamente"
            disabled={!configured}
          />
        </Row>
        <Row label="Versión actual">
          <span data-testid="update-current" className="font-mono text-sm">
            v{update?.current ?? info?.version ?? '…'}
          </span>
        </Row>
        <Row label="Canal" description="Solo versiones estables.">
          <span className="text-sm">Estable</span>
        </Row>
        <Row
          label="Buscar ahora"
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
            {update?.checking ? 'Buscando…' : 'Buscar ahora'}
          </Button>
        </Row>
        {view && update && (
          <Row
            label={
              view.phase === 'idle' || view.phase === 'cancelled' ? `Versión ${update.latest?.version ?? ''} disponible` : 'Actualización'
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
            <div className="flex gap-2">
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

      <SubTitle>Enlaces</SubTitle>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => open('https://opencode.ai/docs/')}>
          <ExternalLink size={14} /> Documentación de OpenCode
        </Button>
        <Button onClick={() => open('https://opencode.ai/docs/mcp-servers/')}>
          <ExternalLink size={14} /> Servidores MCP
        </Button>
      </div>
    </div>
  )
}
