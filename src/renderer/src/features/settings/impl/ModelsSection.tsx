import { useEffect, useMemo, useState, type ComponentProps } from 'react'
import { Loader2, RefreshCw, Unplug } from 'lucide-react'
import type { ModelMode } from '@shared/ipc-extras'
import { MODE_LABELS } from '@shared/labels'
import type { ModelRef } from '@shared/types'
import { Button } from '../../../components/Button'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { errorMessage } from '../../../lib/opencode'
import { useProviders } from '../../../stores/providers'
import { useServer } from '../../../stores/server'
import { useSettings } from '../../../stores/settings'
import { useExtrasPrefs } from './extras'
import { ModelSelect, sortProviders } from './ModelSelect'
import { useProviderCatalog, useProviderConnect, unconnectedProviders, type ProviderCatalog } from './providerCatalog'
import { ProviderKeyForm } from './ProviderKeyForm'
import { Badge, Card, ErrorText, Row, SectionHeader, SubTitle } from './ui'

const MODES: { id: ModelMode; label: string; description: string }[] = [
  { id: 'chat', label: 'Chat', description: 'Conversaciones generales.' },
  { id: 'code', label: 'Code', description: 'Agente de programación sobre una carpeta.' },
  { id: 'tasks', label: MODE_LABELS.tasks, description: 'Tareas autónomas sobre documentos.' }
]

export function ModelsSection(): React.JSX.Element {
  const client = useServer((s) => s.client)
  const { providers, loading, error, load } = useProviders()
  const { settings, update } = useSettings()
  const modelsByMode = useExtrasPrefs((s) => s.prefs.modelsByMode)
  const updatePrefs = useExtrasPrefs((s) => s.update)

  const { catalog, error: loadError, reload: loadCatalog } = useProviderCatalog(client)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)

  useEffect(() => {
    if (client) void load(client)
  }, [client, load])

  const refresh = async (): Promise<void> => {
    if (!client) return
    setRemoveError(null)
    await Promise.all([load(client, true), loadCatalog()])
  }

  const connect = useProviderConnect(client, refresh)
  const catalogError = connect.error ?? removeError ?? loadError
  const busy = connect.busy || removing

  const setModeModel = (mode: ModelMode, value: ModelRef | null): void => {
    const next = { ...modelsByMode }
    if (value) next[mode] = value
    else delete next[mode]
    void updatePrefs({ modelsByMode: next })
  }

  return (
    <div>
      <SectionHeader title="Modelos" description="Modelo predeterminado y por modo. Los modelos de OpenCode Go aparecen primero." />

      {!client && <p className="text-sm text-muted">Esperando al servidor de OpenCode…</p>}
      {error && <ErrorText>{error}</ErrorText>}

      <Card>
        <Row label="Predeterminado" description="Se usa cuando un modo no tiene un modelo propio.">
          <ModelSelect
            aria-label="Modelo predeterminado"
            className="w-72"
            providers={providers}
            value={settings.defaultModel}
            onChange={(v) => v && void update({ defaultModel: v })}
          />
        </Row>
        {MODES.map((m) => (
          <Row key={m.id} label={m.label} description={m.description}>
            <ModelSelect
              aria-label={`Modelo para ${m.label}`}
              className="w-72"
              providers={providers}
              value={modelsByMode[m.id] ?? null}
              defaultLabel="Usar predeterminado"
              onChange={(v) => setModeModel(m.id, v)}
            />
          </Row>
        ))}
      </Card>
      <div className="mt-2 flex items-center gap-2">
        <Button variant="ghost" onClick={() => void refresh()} disabled={!client || loading}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Actualizar lista
        </Button>
      </div>

      <SubTitle>Proveedores</SubTitle>
      {catalogError && <ErrorText>{catalogError}</ErrorText>}
      {catalog && (
        <ProvidersList
          catalog={catalog}
          busy={busy}
          onDisconnect={async (id) => {
            if (!client) return
            const ok = await confirmDialog({
              title: '¿Eliminar credenciales?',
              message: `Se eliminarán las credenciales guardadas de "${id}".`,
              confirmLabel: 'Eliminar',
              danger: true
            })
            if (!ok) return
            setRemoving(true)
            try {
              const r = await client.auth.remove({ providerID: id })
              if (r.error) throw new Error(errorMessage(r.error))
              await client.global.dispose()
              await refresh()
            } catch (err) {
              setRemoveError(errorMessage(err))
            } finally {
              setRemoving(false)
            }
          }}
          onSetKey={connect.setKey}
          onOauthStart={connect.oauthStart}
          onOauthFinish={connect.oauthFinish}
        />
      )}
    </div>
  )
}

function ProvidersList({
  catalog,
  busy,
  onDisconnect,
  onSetKey,
  onOauthStart,
  onOauthFinish
}: {
  catalog: ProviderCatalog
  busy: boolean
  onDisconnect: (id: string) => Promise<void>
  onSetKey: (id: string, key: string) => Promise<void>
  onOauthStart: ComponentProps<typeof ProviderKeyForm>['onOauthStart']
  onOauthFinish: ComponentProps<typeof ProviderKeyForm>['onOauthFinish']
}): React.JSX.Element {
  const connected = useMemo(() => sortProviders(catalog.all.filter((p) => catalog.connected.includes(p.id))), [catalog])
  const others = useMemo(() => unconnectedProviders(catalog), [catalog])

  return (
    <>
      <Card>
        {connected.length === 0 && <Row label="Ningún proveedor conectado" description="Agrega una API key abajo." />}
        {connected.map((p) => (
          <Row
            key={p.id}
            label={
              <span className="flex items-center gap-2">
                {p.name}
                <Badge tone="ok">Conectado</Badge>
                {p.id === 'opencode-go' && <Badge tone="accent">Recomendado</Badge>}
              </span>
            }
            description={`${Object.keys(p.models).length} modelos · origen: ${SOURCE_LABEL[p.source] ?? p.source}`}
          >
            {p.source === 'api' && (
              <Button variant="ghost" disabled={busy} onClick={() => void onDisconnect(p.id)}>
                <Unplug size={14} /> Desconectar
              </Button>
            )}
          </Row>
        ))}
      </Card>

      <ProviderKeyForm
        providers={others}
        auth={catalog.auth}
        busy={busy}
        onSetKey={onSetKey}
        onOauthStart={onOauthStart}
        onOauthFinish={onOauthFinish}
      />
    </>
  )
}

const SOURCE_LABEL: Record<string, string> = {
  env: 'variable de entorno',
  config: 'config',
  custom: 'personalizado',
  api: 'credencial guardada'
}
