import { useCallback, useEffect, useMemo, useState } from 'react'
import { KeyRound, Loader2, RefreshCw, Unplug } from 'lucide-react'
import type { Provider, ProviderAuthMethod } from '@opencode-ai/sdk/v2/client'
import type { ModelMode } from '@shared/ipc-extras'
import type { ModelRef } from '@shared/types'
import { Button } from '../../../components/Button'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { errorMessage } from '../../../lib/opencode'
import { useProviders } from '../../../stores/providers'
import { useServer } from '../../../stores/server'
import { useSettings } from '../../../stores/settings'
import { useExtrasPrefs } from './extras'
import { ModelSelect, sortProviders } from './ModelSelect'
import { Badge, Card, ErrorText, Field, Row, SectionHeader, Select, SubTitle, TextInput } from './ui'

const MODES: { id: ModelMode; label: string; description: string }[] = [
  { id: 'chat', label: 'Chat', description: 'Conversaciones generales.' },
  { id: 'code', label: 'Code', description: 'Agente de programación sobre una carpeta.' },
  { id: 'cowork', label: 'Cowork', description: 'Tareas autónomas sobre documentos.' }
]

interface ProviderCatalog {
  all: Provider[]
  connected: string[]
  auth: Record<string, ProviderAuthMethod[]>
}

export function ModelsSection(): React.JSX.Element {
  const client = useServer((s) => s.client)
  const { providers, loading, error, load } = useProviders()
  const { settings, update } = useSettings()
  const modelsByMode = useExtrasPrefs((s) => s.prefs.modelsByMode)
  const updatePrefs = useExtrasPrefs((s) => s.update)

  const [catalog, setCatalog] = useState<ProviderCatalog | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadCatalog = useCallback(async () => {
    if (!client) return
    setCatalogError(null)
    try {
      const [list, auth] = await Promise.all([client.provider.list(), client.provider.auth()])
      if (list.error || !list.data) throw new Error(errorMessage(list.error))
      setCatalog({ all: list.data.all, connected: list.data.connected, auth: auth.data ?? {} })
    } catch (err) {
      setCatalogError(errorMessage(err))
    }
  }, [client])

  useEffect(() => {
    if (!client) return
    void load(client)
    void loadCatalog()
  }, [client, load, loadCatalog])

  const refresh = async (): Promise<void> => {
    if (!client) return
    await Promise.all([load(client, true), loadCatalog()])
  }

  const setModeModel = (mode: ModelMode, value: ModelRef | null): void => {
    const next = { ...modelsByMode }
    if (value) next[mode] = value
    else delete next[mode]
    void updatePrefs({ modelsByMode: next })
  }

  return (
    <div>
      <SectionHeader
        title="Modelos"
        description="Modelo predeterminado y por modo. Los modelos de OpenCode Go aparecen primero."
      />

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
            setBusy(true)
            try {
              const r = await client.auth.remove({ providerID: id })
              if (r.error) throw new Error(errorMessage(r.error))
              await client.global.dispose()
              await refresh()
            } catch (err) {
              setCatalogError(errorMessage(err))
            } finally {
              setBusy(false)
            }
          }}
          onSetKey={async (id, key) => {
            if (!client) return
            setBusy(true)
            try {
              const r = await client.auth.set({ providerID: id, auth: { type: 'api', key } })
              if (r.error) throw new Error(errorMessage(r.error))
              // Recarga proveedores (las respuestas en curso se interrumpen).
              await client.global.dispose()
              await refresh()
            } catch (err) {
              setCatalogError(errorMessage(err))
            } finally {
              setBusy(false)
            }
          }}
        />
      )}
    </div>
  )
}

function ProvidersList({
  catalog,
  busy,
  onDisconnect,
  onSetKey
}: {
  catalog: ProviderCatalog
  busy: boolean
  onDisconnect: (id: string) => Promise<void>
  onSetKey: (id: string, key: string) => Promise<void>
}): React.JSX.Element {
  const connected = useMemo(
    () => sortProviders(catalog.all.filter((p) => catalog.connected.includes(p.id))),
    [catalog]
  )
  const others = useMemo(
    () =>
      catalog.all
        .filter((p) => !catalog.connected.includes(p.id))
        .sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [catalog]
  )
  const [target, setTarget] = useState('')
  const [key, setKey] = useState('')
  const methods = target ? (catalog.auth[target] ?? []) : []
  const supportsApi = !target || methods.length === 0 || methods.some((m) => m.type === 'api')
  const targetProvider = others.find((p) => p.id === target)

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

      <Card className="mt-3 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <KeyRound size={15} /> Conectar proveedor con API key
        </div>
        <div className="grid grid-cols-[1fr_1.4fr_auto] items-end gap-2">
          <Field label="Proveedor">
            <Select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Elegir…</option>
              {others.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="API key">
            <TextInput
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={targetProvider?.env[0] ?? 'sk-…'}
              disabled={!target || !supportsApi}
            />
          </Field>
          <Button
            variant="primary"
            disabled={busy || !target || !key.trim() || !supportsApi}
            onClick={() => {
              void onSetKey(target, key.trim()).then(() => {
                setKey('')
                setTarget('')
              })
            }}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : null} Guardar
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-subtle">
          {target && !supportsApi
            ? 'Este proveedor sólo admite inicio de sesión OAuth: ejecuta `opencode auth login` en una terminal.'
            : 'La clave se guarda en el almacén de credenciales de OpenCode (~/.local/share/opencode/auth.json). Para OAuth usa `opencode auth login`.'}
        </p>
      </Card>
    </>
  )
}

const SOURCE_LABEL: Record<string, string> = {
  env: 'variable de entorno',
  config: 'config',
  custom: 'personalizado',
  api: 'credencial guardada'
}
