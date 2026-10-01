/**
 * Asistente de primer uso (5 pasos: OpenCode, «Conecta tu IA», modelo, modos, permisos de macOS).
 * El paso 2 ofrece OpenCode Go (recomendado) y cualquier otro proveedor del catálogo de OpenCode (API key u OAuth).
 * Con el motor incluido en la app, el paso 1 es solo informativo («Incluido: OpenCode X»).
 * Solo aparece si `settings.onboarded !== true` y falta el binario o ningún proveedor está
 * configurado (`decideOnboarding`); si todo ya funciona, marca `onboarded` sin mostrar nada.
 * La app nunca ejecuta un instalador: el comando de instalación solo se copia al portapapeles.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CalendarClock,
  Check,
  ClipboardCopy,
  Code2,
  ExternalLink,
  FolderSearch,
  ListChecks,
  Loader2,
  MessageSquare,
  RotateCw,
  Shield
} from 'lucide-react'
import { APP_NAME } from '@shared/brand'
import { MODE_LABELS } from '@shared/labels'
import type { MsgKey } from '@shared/i18n'
import { OPENCODE_INSTALL_COMMAND, type OpencodeAction } from '@shared/opencode-links'
import type { ModeId, OpencodeInfo } from '@shared/types'
import { Button } from '../../components/Button'
import { ModelPicker } from '../../components/ModelPicker'
import { call } from '../../lib/api'
import { useT } from '../../lib/i18n'
import { errorMessage } from '../../lib/opencode'
import { useProviders } from '../../stores/providers'
import { useServer } from '../../stores/server'
import { useSettings } from '../../stores/settings'
import { ProviderKeyForm, unconnectedProviders, useProviderCatalog, useProviderConnect } from '../settings'
import { Badge, ErrorText } from '../settings/impl/ui'
import {
  canAdvance,
  connectedNames,
  connectTasksNotice,
  connectTermsNotice,
  decideOnboarding,
  nextStep,
  ONBOARDING_STEPS,
  opencodeStepMode,
  prevStep,
  stepIndex,
  stepTitle,
  type OnboardingStep,
  type ProviderState
} from './steps'

const GO_PROVIDER = 'opencode-go'
const GO_FORM_PROVIDERS = [{ id: GO_PROVIDER, name: 'OpenCode Go', env: [] as string[] }]

/** Puerta del asistente: no monta nada hasta que los ajustes cargaron y `onboarded` es false. */
export function OnboardingGate(): React.JSX.Element | null {
  const loaded = useSettings((s) => s.loaded)
  const onboarded = useSettings((s) => s.settings.onboarded)
  if (!loaded || onboarded) return null
  return <OnboardingHost />
}

function OnboardingHost(): React.JSX.Element | null {
  const t = useT()
  const client = useServer((s) => s.client)
  const serverStatus = useServer((s) => s.status)
  const update = useSettings((s) => s.update)
  const [info, setInfo] = useState<OpencodeInfo | null>(null)
  const [connected, setConnected] = useState<ProviderState[] | null>(null)
  /** Paso actual; `null` = todavía no se decidió mostrar el asistente. Una vez mostrado, no se oculta solo. */
  const [step, setStep] = useState<OnboardingStep | null>(null)
  const completed = useRef(false)

  const refreshInfo = useCallback(async () => {
    try {
      setInfo(await call('app:opencodeInfo'))
    } catch {
      // sin respuesta: se reintenta al cambiar el estado del servidor
    }
  }, [])

  const refreshProviders = useCallback(async () => {
    if (!client) return
    try {
      const res = await client.provider.list()
      if (res.error || !res.data) return
      const { all, connected: ids } = res.data
      setConnected(all.filter((p) => ids.includes(p.id)).map((p) => ({ id: p.id, source: p.source })))
    } catch {
      // se reintenta cuando el cliente cambie
    }
  }, [client])

  useEffect(() => {
    void refreshInfo()
  }, [refreshInfo, serverStatus.state])

  useEffect(() => {
    if (serverStatus.state === 'ready') void refreshProviders()
  }, [refreshProviders, serverStatus.state])

  const decision = decideOnboarding({
    onboarded: false,
    binary: info === null ? 'unknown' : info.found ? 'found' : 'missing',
    source: info?.source ?? null,
    server: serverStatus.state,
    connected
  })

  useEffect(() => {
    if (step) return
    if (decision.kind === 'show') setStep(decision.step)
    else if (decision.kind === 'complete' && !completed.current) {
      completed.current = true
      void update({ onboarded: true })
    }
  }, [decision, step, update])

  if (!step) return null

  const finish = (): void => void update({ onboarded: true })
  const last = nextStep(step) === null
  const advance = canAdvance(step, {
    binaryFound: info?.found === true,
    serverReady: serverStatus.state === 'ready',
    source: info?.source ?? null
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/85 p-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        className="flex max-h-full w-full max-w-xl animate-pop-in flex-col rounded-2xl border border-border bg-elevated shadow-xl"
      >
        <header className="border-b border-border px-6 pt-5 pb-4">
          <p className="text-[11px] font-semibold tracking-[0.06em] text-subtle uppercase">
            {t('wizard.header', { app: APP_NAME, step: stepIndex(step) + 1, total: ONBOARDING_STEPS.length })}
          </p>
          <h2 id="onboarding-title" className="mt-1 font-display text-xl font-semibold tracking-[-0.015em]">
            {stepTitle(step, opencodeStepMode(info))}
          </h2>
          <div className="mt-3 flex gap-1.5" aria-hidden>
            {ONBOARDING_STEPS.map((s, i) => (
              <span key={s} className={`h-1 flex-1 rounded-full ${i <= stepIndex(step) ? 'bg-accent' : 'bg-hover'}`} />
            ))}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {step === 'opencode' && <StepOpencode info={info} onInfo={setInfo} refreshInfo={refreshInfo} />}
          {step === 'auth' && <StepAuth connected={connected} refreshProviders={refreshProviders} />}
          {step === 'model' && <StepModel />}
          {step === 'modes' && <StepModes />}
          {step === 'permissions' && <StepPermissions />}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-border px-6 py-3">
          <Button variant="ghost" onClick={finish}>
            {t('wizard.skip')}
          </Button>
          <div className="flex items-center gap-2">
            {prevStep(step) && (
              <Button variant="secondary" onClick={() => setStep(prevStep(step))}>
                {t('wizard.back')}
              </Button>
            )}
            <Button variant="primary" disabled={!advance} onClick={() => (last ? finish() : setStep(nextStep(step)))}>
              {last ? t('wizard.start') : t('wizard.continue')}
            </Button>
          </div>
        </footer>
      </section>
    </div>
  )
}

function Lead({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="text-sm leading-relaxed text-muted">{children}</p>
}

/** Ejecuta una acción fija de main (copiar el comando o abrir una página de OpenCode). */
function runAction(action: OpencodeAction): Promise<void> {
  return call('app:opencodeAction', { action })
}

// ───────────── Paso 1: OpenCode ─────────────

function StepOpencode({
  info,
  onInfo,
  refreshInfo
}: {
  info: OpencodeInfo | null
  onInfo: (info: OpencodeInfo) => void
  refreshInfo: () => Promise<void>
}): React.JSX.Element {
  const t = useT()
  const status = useServer((s) => s.status)
  const serverError = useServer((s) => s.error)
  const restart = useServer((s) => s.restart)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pickError, setPickError] = useState<string | null>(null)

  const retry = async (): Promise<void> => {
    setBusy(true)
    try {
      await restart()
      await refreshInfo()
    } finally {
      setBusy(false)
    }
  }

  const pick = async (): Promise<void> => {
    setPickError(null)
    setBusy(true)
    try {
      const res = await call('app:pickOpencodeBin')
      if (res.status === 'invalid') setPickError(res.error)
      else if (res.status === 'ok') {
        onInfo(res.info)
        await restart()
        await refreshInfo()
      }
    } catch (err) {
      setPickError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const copy = async (): Promise<void> => {
    try {
      await runAction('copyInstall')
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch (err) {
      setPickError(errorMessage(err))
    }
  }

  const failure = status.state === 'error' || serverError ? (serverError ?? status.error ?? '').split('\n')[0] : ''
  const ready = status.state === 'ready'
  const mode = opencodeStepMode(info)

  if (mode === 'bundled' && info) {
    return (
      <div className="space-y-4">
        <Lead>{t('wizard.opencode.bundledLead', { app: APP_NAME })}</Lead>
        <div className="rounded-xl border border-border bg-bg px-3.5 py-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <Check size={15} className="text-success" />{' '}
            {t('wizard.opencode.included', { version: info.version ? ` ${info.version}` : '' })}
          </p>
          {!ready && !failure && (
            <p className="mt-2 flex items-center gap-2 text-xs text-muted">
              <Loader2 size={12} className="animate-spin" /> {t('wizard.opencode.starting')}
            </p>
          )}
          {ready && <p className="mt-2 text-xs text-success">{t('wizard.opencode.running')}</p>}
        </div>
        <p className="text-xs text-subtle">{t('wizard.opencode.ownCliHint')}</p>
        {failure && (
          <div role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs whitespace-pre-wrap text-danger">
            {failure}
          </div>
        )}
        {pickError && (
          <div role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
            {pickError}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => void pick()}>
            <FolderSearch size={13} /> {t('wizard.opencode.useMyCli')}
          </Button>
          {failure && (
            <Button size="sm" disabled={busy} onClick={() => void retry()}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <RotateCw size={13} />} {t('wizard.opencode.retry')}
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Lead>{t(info?.found ? 'wizard.opencode.leadFound' : 'wizard.opencode.leadMissing', { app: APP_NAME })}</Lead>

      {info === null ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 size={14} className="animate-spin" /> {t('wizard.opencode.searching')}
        </p>
      ) : info.found ? (
        <div className="rounded-xl border border-border bg-bg px-3.5 py-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <Check size={15} className="text-success" />{' '}
            {t('wizard.opencode.foundTitle', {
              version: info.version ? t('wizard.opencode.versionSuffix', { version: info.version }) : ''
            })}
          </p>
          <p className="mt-1 font-mono text-xs break-all text-muted">{info.path}</p>
          {info.version && !info.compatible && (
            <p className="mt-2 text-xs text-warning">{t('wizard.opencode.versionMismatch', { app: APP_NAME, sdk: info.sdkVersion })}</p>
          )}
          {!ready && !failure && (
            <p className="mt-2 flex items-center gap-2 text-xs text-muted">
              <Loader2 size={12} className="animate-spin" /> {t('wizard.opencode.starting')}
            </p>
          )}
          {ready && <p className="mt-2 text-xs text-success">{t('wizard.opencode.running')}</p>}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-bg px-3.5 py-3 text-sm">
          <p className="font-medium">{t('wizard.opencode.notFound')}</p>
          <p className="mt-1 text-xs text-muted">{t('wizard.opencode.installHint', { app: APP_NAME })}</p>
          <code className="mt-2 block rounded-lg bg-hover px-2.5 py-1.5 font-mono text-xs break-all">{OPENCODE_INSTALL_COMMAND}</code>
        </div>
      )}

      {failure && (
        <div role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs whitespace-pre-wrap text-danger">
          {failure}
        </div>
      )}
      {pickError && (
        <div role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
          {pickError}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void copy()}>
          {copied ? <Check size={13} /> : <ClipboardCopy size={13} />}{' '}
          {copied ? t('wizard.opencode.copied') : t('wizard.opencode.copyInstall')}
        </Button>
        <Button size="sm" onClick={() => void runAction('openDocs')}>
          <ExternalLink size={13} /> {t('wizard.opencode.openDocs')}
        </Button>
        <Button size="sm" disabled={busy} onClick={() => void pick()}>
          <FolderSearch size={13} /> {t('wizard.opencode.pickBinary')}
        </Button>
        <Button size="sm" disabled={busy} onClick={() => void retry()}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <RotateCw size={13} />} {t('wizard.opencode.retry')}
        </Button>
      </div>
    </div>
  )
}

// ───────────── Paso 2: Conecta tu IA ─────────────

function StepAuth({
  connected,
  refreshProviders
}: {
  connected: ProviderState[] | null
  refreshProviders: () => Promise<void>
}): React.JSX.Element {
  const t = useT()
  const client = useServer((s) => s.client)
  const { catalog, loading, error: catalogError, reload } = useProviderCatalog(client)
  const connect = useProviderConnect(client, async () => {
    await Promise.all([refreshProviders(), reload(), client ? useProviders.getState().load(client, true) : Promise.resolve()])
  })
  const [savedIds, setSavedIds] = useState<string[]>([])
  /** Tarjeta que originó la última acción, para mostrar el error bajo ella. */
  const [origin, setOrigin] = useState<'go' | 'other'>('go')
  const markSaved = (id: string): void => setSavedIds((ids) => (ids.includes(id) ? ids : [...ids, id]))

  const connectedNow: ProviderState[] = [
    ...(connected ?? []),
    ...savedIds.filter((id) => !connected?.some((p) => p.id === id)).map((id) => ({ id, source: 'api' }))
  ]
  const goConnected = connectedNow.some((p) => p.id === GO_PROVIDER)
  const names = Object.fromEntries((catalog?.all ?? []).map((p) => [p.id, p.name]))
  const otherNames = connectedNames(
    connectedNow.filter((p) => p.id !== GO_PROVIDER),
    names
  )
  const others = catalog ? unconnectedProviders(catalog, [GO_PROVIDER]) : []

  const setKeyFrom = (card: 'go' | 'other') => async (providerID: string, key: string) => {
    setOrigin(card)
    await connect.setKey(providerID, key)
    markSaved(providerID)
  }
  const oauthStart = (providerID: string, method: number): ReturnType<typeof connect.oauthStart> => {
    setOrigin('other')
    return connect.oauthStart(providerID, method)
  }
  const oauthFinish = async (providerID: string, method: number, code?: string): Promise<void> => {
    setOrigin('other')
    await connect.oauthFinish(providerID, method, code)
    markSaved(providerID)
  }

  return (
    <div className="space-y-4">
      <Lead>{t('wizard.auth.lead')}</Lead>

      <section aria-labelledby="onb-go" className="rounded-xl border border-accent bg-bg p-4">
        <div className="flex items-center gap-2">
          <h3 id="onb-go" className="text-sm font-semibold">
            OpenCode Go
          </h3>
          <Badge tone="accent">{t('wizard.auth.recommended')}</Badge>
          {goConnected && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
              <Check size={11} /> {t('wizard.auth.goConnected')}
            </span>
          )}
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted">{t('wizard.auth.goDescription', { app: APP_NAME })}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void runAction('openAuth')}>
            <ExternalLink size={13} /> {t('wizard.auth.getKey')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void runAction('openGo')}>
            {t('wizard.auth.learnGo')}
          </Button>
        </div>
        <ProviderKeyForm
          providers={GO_FORM_PROVIDERS}
          auth={{}}
          busy={connect.busy || !client}
          onSetKey={setKeyFrom('go')}
          fixedProviderId={GO_PROVIDER}
          title={null}
          className="mt-3 p-3"
        />
        {connect.error && origin === 'go' && (
          <div role="alert" className="mt-2">
            <ErrorText>{connect.error}</ErrorText>
          </div>
        )}
      </section>

      <section aria-labelledby="onb-other" className="rounded-xl border border-border bg-bg p-4">
        <h3 id="onb-other" className="text-sm font-semibold">
          {t('wizard.auth.otherTitle')}
        </h3>
        <p className="mt-1 text-sm text-muted">{t('wizard.auth.otherDescription')}</p>
        <div className="mt-3 space-y-2">
          {!client ? (
            <p className="text-xs text-muted">{t('wizard.auth.waitingServer')}</p>
          ) : catalogError && !catalog ? (
            <div className="space-y-2">
              <ErrorText>{t('wizard.auth.catalogError', { error: catalogError })}</ErrorText>
              <Button size="sm" onClick={() => void reload()}>
                {t('wizard.opencode.retry')}
              </Button>
            </div>
          ) : loading && !catalog ? (
            <p className="flex items-center gap-2 text-xs text-muted" aria-live="polite">
              <Loader2 size={13} className="animate-spin" /> {t('wizard.auth.loadingProviders')}
            </p>
          ) : catalog && others.length === 0 ? (
            <p className="text-xs text-muted">{t('wizard.auth.noOthers')}</p>
          ) : catalog ? (
            <ProviderKeyForm
              providers={others}
              auth={catalog.auth}
              busy={connect.busy}
              onSetKey={setKeyFrom('other')}
              onOauthStart={oauthStart}
              onOauthFinish={oauthFinish}
              title={null}
              className="p-3"
            />
          ) : null}
          {otherNames.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {otherNames.map((n) => (
                <span
                  key={n}
                  className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success"
                >
                  <Check size={11} /> {t('wizard.auth.providerConnected', { name: n })}
                </span>
              ))}
            </div>
          )}
          {connect.error && origin === 'other' && (
            <div role="alert">
              <ErrorText>{connect.error}</ErrorText>
            </div>
          )}
        </div>
      </section>

      <div role="note" className="flex items-start gap-3 rounded-xl border border-border bg-bg px-3.5 py-3">
        <Shield size={16} className="mt-0.5 shrink-0 text-warning" />
        <div className="text-xs leading-relaxed text-muted">
          <p>{connectTasksNotice()}</p>
          <p className="mt-1.5 text-subtle">{connectTermsNotice()}</p>
        </div>
      </div>
    </div>
  )
}

// ───────────── Paso 3: modelo ─────────────

function StepModel(): React.JSX.Element {
  const t = useT()
  const model = useSettings((s) => s.settings.defaultModel)
  const update = useSettings((s) => s.update)
  const client = useServer((s) => s.client)
  const load = useProviders((s) => s.load)
  useEffect(() => {
    if (client) void load(client, true)
  }, [client, load])
  return (
    <div className="space-y-4">
      <Lead>{t('wizard.model.lead')}</Lead>
      <div className="flex items-center gap-3 rounded-xl border border-border bg-bg px-3.5 py-3">
        <span className="text-sm text-muted">{t('wizard.model.default')}</span>
        <ModelPicker value={model} onChange={(m) => void update({ defaultModel: m })} placement="bottom" />
      </div>
    </div>
  )
}

// ───────────── Paso 4: modos ─────────────

const MODE_INFO: { id: ModeId; icon: React.ReactNode; description: MsgKey }[] = [
  { id: 'chat', icon: <MessageSquare size={16} />, description: 'wizard.modes.chat' },
  { id: 'code', icon: <Code2 size={16} />, description: 'wizard.modes.code' },
  { id: 'tasks', icon: <ListChecks size={16} />, description: 'wizard.modes.tasks' },
  { id: 'routines', icon: <CalendarClock size={16} />, description: 'wizard.modes.routines' }
]

function StepModes(): React.JSX.Element {
  const t = useT()
  return (
    <div className="space-y-3">
      <Lead>{t('wizard.modes.lead')}</Lead>
      <ul className="space-y-2">
        {MODE_INFO.map((m) => (
          <li key={m.id} className="flex items-start gap-3 rounded-xl border border-border bg-bg px-3.5 py-3">
            <span className="mt-0.5 text-accent">{m.icon}</span>
            <div>
              <p className="text-sm font-medium">{MODE_LABELS[m.id]}</p>
              <p className="text-xs text-muted">{t(m.description)}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ───────────── Paso 5: permisos de macOS ─────────────

function StepPermissions(): React.JSX.Element {
  const t = useT()
  return (
    <div className="space-y-3">
      <Lead>{t('wizard.permissions.lead', { app: APP_NAME })}</Lead>
      <div className="flex items-start gap-3 rounded-xl border border-border bg-bg px-3.5 py-3">
        <Shield size={16} className="mt-0.5 shrink-0 text-warning" />
        <div className="text-xs leading-relaxed text-muted">
          <p>
            {t('wizard.permissions.intro', { mode: t('wizard.fullControl') })}{' '}
            <strong className="font-medium text-fg">{t('wizard.permissions.accessibility')}</strong>{' '}
            {t('wizard.permissions.accessibilityHint')} <strong className="font-medium text-fg">{t('wizard.permissions.screen')}</strong>{' '}
            {t('wizard.permissions.screenHint')}
          </p>
          <p className="mt-1.5">{t('wizard.permissions.review')}</p>
        </div>
      </div>
    </div>
  )
}
