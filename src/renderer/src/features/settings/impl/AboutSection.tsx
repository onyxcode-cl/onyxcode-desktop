import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { APP_NAME } from '@shared/brand'
import type { VersionsInfo } from '@shared/ipc-extras'
import type { AppInfo, OpencodeInfo } from '@shared/types'
import { Button } from '../../../components/Button'
import { api } from '../../../lib/api'
import { engineNoticeText, engineSummary } from '../../../lib/engine-notice'
import { errorMessage } from '../../../lib/opencode'
import { useServer } from '../../../stores/server'
import { getExtras } from './extras'
import { Card, ErrorText, Row, SectionHeader, SubTitle } from './ui'

export function AboutSection(): React.JSX.Element {
  const client = useServer((s) => s.client)
  const connection = useServer((s) => s.connection)
  const [versions, setVersions] = useState<VersionsInfo | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [server, setServer] = useState<{ version: string; healthy: boolean } | null>(null)
  const [engine, setEngine] = useState<OpencodeInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

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
