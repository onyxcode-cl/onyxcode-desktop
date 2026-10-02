import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { FlaskConical, Loader2, RefreshCw, Unplug } from 'lucide-react'
import type { ModelMode } from '@shared/ipc-extras'
import { MODE_LABELS } from '@shared/labels'
import type { ModelRef } from '@shared/types'
import { Button } from '../../../components/Button'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { useT } from '../../../lib/i18n'
import { errorMessage } from '../../../lib/opencode'
import { useProviders } from '../../../stores/providers'
import { useServer } from '../../../stores/server'
import { useSettings } from '../../../stores/settings'
import { useUi } from '../../../stores/ui'
import { useExtrasPrefs, withModeModel } from './extras'
import { modeAvailable } from '@shared/platform-caps'
import { currentPlatform } from '../../../lib/platform'
import { ModelSelect, modelLabel, sortProviders } from './ModelSelect'
import { useProviderCatalog, useProviderConnect, unconnectedProviders, type ProviderCatalog } from './providerCatalog'
import { KeyTestNotice } from './KeyTestNotice'
import { ProviderKeyForm } from './ProviderKeyForm'
import { Badge, Card, ErrorText, Row, SectionHeader, SubTitle, TextInput } from './ui'
import { useKeyTests } from './useKeyTest'

function modes(t: ReturnType<typeof useT>): { id: ModelMode; label: string; description: string }[] {
  const all: { id: ModelMode; label: string; description: string }[] = [
    { id: 'chat', label: MODE_LABELS.chat, description: t('models.mode.chat.description') },
    { id: 'code', label: MODE_LABELS.code, description: t('models.mode.code.description') },
    { id: 'tasks', label: MODE_LABELS.tasks, description: t('models.mode.tasks.description') }
  ]
  return all.filter((m) => modeAvailable(m.id, currentPlatform()))
}

export function ModelsSection(): React.JSX.Element {
  const t = useT()
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

  // «Conectar una IA» abre esta sección con el foco en Proveedores: desplazarse hasta allí una sola vez.
  const focus = useUi((s) => s.settingsFocus)
  const providersRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focus !== 'providers') return
    providersRef.current?.scrollIntoView({ block: 'start' })
    useUi.getState().clearSettingsFocus()
  }, [focus])

  const refresh = async (): Promise<void> => {
    if (!client) return
    setRemoveError(null)
    await Promise.all([load(client, true), loadCatalog()])
  }

  const connect = useProviderConnect(client, refresh)
  const catalogError = connect.error ?? removeError ?? loadError
  const busy = connect.busy || removing

  const setModeModel = (mode: ModelMode, value: ModelRef | null): void => {
    void updatePrefs({ modelsByMode: withModeModel(modelsByMode, mode, value) })
  }

  return (
    <div>
      <SectionHeader title={t('models.title')} description={t('models.subtitle')} />

      {!client && <p className="text-sm text-muted">{t('models.waitingServer')}</p>}
      {error && <ErrorText>{error}</ErrorText>}

      <Card>
        <Row label={t('models.default.label')} description={t('models.default.description')}>
          <ModelSelect
            aria-label={t('models.default.aria')}
            className="w-72"
            providers={providers}
            value={settings.defaultModel}
            onChange={(v) => v && void update({ defaultModel: v })}
          />
        </Row>
        {modes(t).map((m) => (
          <Row key={m.id} label={m.label} description={m.description}>
            <ModelSelect
              aria-label={t('models.forMode.aria', { mode: m.label })}
              className="w-72"
              providers={providers}
              value={modelsByMode[m.id] ?? null}
              defaultLabel={t('models.useDefaultNamed', { model: modelLabel(providers, settings.defaultModel) })}
              onChange={(v) => setModeModel(m.id, v)}
            />
          </Row>
        ))}
      </Card>
      <div className="mt-2 flex items-center gap-2">
        <Button variant="ghost" onClick={() => void refresh()} disabled={!client || loading}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} {t('models.refreshList')}
        </Button>
      </div>

      <div id="settings-providers" ref={providersRef}>
        <SubTitle>{t('models.providers')}</SubTitle>
      </div>
      {catalogError && <ErrorText>{catalogError}</ErrorText>}
      {catalog && (
        <ProvidersList
          catalog={catalog}
          busy={busy}
          onDisconnect={async (id) => {
            if (!client) return
            const ok = await confirmDialog({
              title: t('models.removeCreds.title'),
              message: t('models.removeCreds.message', { id }),
              confirmLabel: t('models.removeCreds.confirm'),
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
  const t = useT()
  const connected = useMemo(() => sortProviders(catalog.all.filter((p) => catalog.connected.includes(p.id))), [catalog])
  const others = useMemo(() => unconnectedProviders(catalog), [catalog])
  const tests = useKeyTests((s) => s.entries)
  const [changing, setChanging] = useState<string | null>(null)

  return (
    <>
      <Card>
        {connected.length === 0 && <Row label={t('models.noProviders.label')} description={t('models.noProviders.description')} />}
        {connected.map((p) => {
          const entry = tests[p.id]
          const needsNewKey = entry?.phase === 'done' && (entry.result.status === 'invalid' || entry.result.status === 'forbidden')
          return (
            <div
              key={p.id}
              className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3 last:border-b-0"
            >
              <div className="min-w-48 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {p.name}
                  <Badge tone="ok">{t('models.badge.connected')}</Badge>
                  {p.id === 'opencode-go' && <Badge tone="accent">{t('models.badge.recommended')}</Badge>}
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  {t('models.modelsSource', { count: Object.keys(p.models).length, source: sourceLabel(t, p.source) })}
                  <KeyTestNotice
                    providerID={p.id}
                    providerName={p.name}
                    className="mt-1"
                    action={
                      needsNewKey && changing !== p.id ? (
                        <Button size="sm" variant="ghost" onClick={() => setChanging(p.id)}>
                          {t('models.changeKey')}
                        </Button>
                      ) : undefined
                    }
                  />
                  {changing === p.id && (
                    <ChangeKeyInline
                      providerName={p.name}
                      busy={busy}
                      onCancel={() => setChanging(null)}
                      onSave={async (key) => {
                        await onSetKey(p.id, key)
                        setChanging(null)
                      }}
                    />
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  disabled={busy || entry?.phase === 'testing'}
                  aria-label={t('models.test.aria', { name: p.name })}
                  onClick={() => void useKeyTests.getState().run(p.id)}
                >
                  {entry?.phase === 'testing' ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />}{' '}
                  {t('models.test')}
                </Button>
                {p.source === 'api' && (
                  <Button variant="ghost" disabled={busy} onClick={() => void onDisconnect(p.id)}>
                    <Unplug size={14} /> {t('models.disconnect')}
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </Card>

      <ProviderKeyForm
        providers={others}
        auth={catalog.auth}
        busy={busy}
        onSetKey={onSetKey}
        onOauthStart={onOauthStart}
        onOauthFinish={onOauthFinish}
        showTestResult={false}
      />
    </>
  )
}

function sourceLabel(t: ReturnType<typeof useT>, source: string): string {
  switch (source) {
    case 'env':
      return t('models.source.env')
    case 'config':
      return t('models.source.config')
    case 'custom':
      return t('models.source.custom')
    case 'api':
      return t('models.source.api')
    default:
      return source
  }
}

/** «Cambiar clave»: reemplaza la clave guardada del proveedor (se prueba sola al guardar). */
function ChangeKeyInline({
  providerName,
  busy,
  onSave,
  onCancel
}: {
  providerName: string
  busy: boolean
  onSave: (key: string) => Promise<void>
  onCancel: () => void
}): React.JSX.Element {
  const t = useT()
  const [key, setKey] = useState('')
  return (
    <form
      className="mt-2 flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!busy && key.trim())
          void onSave(key.trim()).then(
            () => setKey(''),
            () => undefined
          )
      }}
    >
      <TextInput
        type="password"
        autoComplete="off"
        aria-label={t('models.newKey.aria', { name: providerName })}
        placeholder={t('models.newKey.placeholder')}
        value={key}
        onChange={(e) => setKey(e.target.value)}
        className="max-w-xs"
      />
      <Button size="sm" variant="primary" type="submit" disabled={busy || !key.trim()}>
        {t('models.save')}
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        {t('models.cancel')}
      </Button>
    </form>
  )
}
