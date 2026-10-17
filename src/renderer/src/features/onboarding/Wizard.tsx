/**
 * Asistente de primer uso: «Conecta tu IA», modelo, modos y «Prepara tu equipo» (4 pasos). Solo con un motor propio o sin motor se
 * añade el paso del motor (OpenCode) al principio (5 pasos). Los permisos de macOS ya no se piden aquí: se piden al usar «Control total».
 * «Conecta tu IA» ofrece primero lo gratuito (los modelos gratuitos de OpenCode, sin cuenta ni clave), luego OpenCode Go (con suscripción)
 * y cualquier otro servicio del catálogo de OpenCode (clave u OAuth). Nada de pago se destaca como recomendado.
 * El último paso ofrece «Probar con un ejemplo» a la vista.
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
import { firstFreeModel } from '@shared/ai-availability'
import { DISPLAY_NAME } from '@shared/brand'
import { MODE_LABELS } from '@shared/labels'
import type { MsgKey } from '@shared/i18n'
import { openCodeInstallCommand, type OpencodeAction } from '@shared/opencode-links'
import type { ModeId, OpencodeInfo } from '@shared/types'
import { Button } from '../../components/Button'
import { LogoMark } from '../../components/Logo'
import { ModelPicker } from '../../components/ModelPicker'
import { call } from '../../lib/api'
import { useT } from '../../lib/i18n'
import { currentFlags, currentPlatform, isMacPlatform, platformCaps } from '../../lib/platform'
import { modeAvailable } from '@shared/platform-caps'
import { errorMessage } from '../../lib/opencode'
import { useProviders } from '../../stores/providers'
import { useServer } from '../../stores/server'
import { useSettings } from '../../stores/settings'
import { useUi } from '../../stores/ui'
import { useTasks } from '../tasks/impl/store'
import { cw, hasTasksBridge } from '../tasks/impl/bridge'
import { ProviderKeyForm, unconnectedProviders, useProviderCatalog, useProviderConnect } from '../settings'
import { SwitchNoticeBar } from '../settings/impl/SwitchNoticeBar'
import { Badge, ErrorText } from '../settings/impl/ui'
import { installFailureCode, officeErrorKey } from '../settings/impl/component-install'
import { Welcome } from './Welcome'
import {
  canAdvance,
  connectedNames,
  connectTasksNotice,
  connectTermsNotice,
  decideOnboarding,
  engineStepNeeded,
  nextStep,
  stepsFor,
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
  /** ¿Lleva el paso del motor? Se decide al mostrar el asistente y no cambia a mitad del recorrido (el contador de pasos sería inestable). */
  const [withEngine, setWithEngine] = useState(true)
  /** La bienvenida (animación, revisión y preparación del equipo) va antes del primer paso, una vez por arranque del asistente. */
  const [welcomed, setWelcomed] = useState(false)

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
    if (decision.kind === 'show') {
      setWithEngine(decision.step === 'opencode' || engineStepNeeded(info))
      setStep(decision.step)
    } else if (decision.kind === 'complete' && !completed.current) {
      completed.current = true
      void update({ onboarded: true })
    }
  }, [decision, step, update, info])

  // L10: el foco inicial y el de cada cambio de paso van al título (no a un botón, que mostraría el anillo).
  const titleRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (step) titleRef.current?.focus({ preventScroll: true })
  }, [step])

  if (!step) return null
  if (!welcomed) return <Welcome info={info} onDone={() => setWelcomed(true)} />

  const steps = stepsFor(undefined, withEngine)
  const finish = (): void => void update({ onboarded: true })
  // «Probar con un ejemplo»: cierra la guía, abre Tareas y deja una tarea de ejemplo escrita para que solo haya que enviarla.
  const tryExample = (): void => {
    useUi.getState().setMode('tasks')
    useTasks.setState({ draft: t('wizard.sampleTask') })
    finish()
  }
  const last = nextStep(step, undefined, withEngine) === null
  const advance = canAdvance(step, {
    binaryFound: info?.found === true,
    serverReady: serverStatus.state === 'ready',
    source: info?.source ?? null
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        className="flex max-h-full w-full max-w-xl animate-pop-in flex-col rounded-modal border border-transparent bg-elevated shadow-modal"
      >
        <header className="border-b border-border/60 px-6 pt-5 pb-4">
          <p className="flex items-center gap-2 text-meta text-muted">
            <LogoMark size={18} animated={false} />
            <span data-testid="onboarding-progress">
              {t('wizard.header', { step: stepIndex(step, undefined, withEngine) + 1, total: steps.length })}
            </span>
          </p>
          <h2
            id="onboarding-title"
            ref={titleRef}
            tabIndex={-1}
            className="mt-1 font-display text-[22px] leading-7 font-semibold tracking-[-0.01em] outline-none"
          >
            {stepTitle(step, opencodeStepMode(info))}
          </h2>
          <div
            className="mt-3 flex gap-1.5"
            role="progressbar"
            aria-label={t('wizard.header', { step: stepIndex(step, undefined, withEngine) + 1, total: steps.length })}
            aria-valuemin={1}
            aria-valuemax={steps.length}
            aria-valuenow={stepIndex(step, undefined, withEngine) + 1}
          >
            {steps.map((s, i) => (
              <span
                key={s}
                className={`h-1 flex-1 rounded-full ${i <= stepIndex(step, undefined, withEngine) ? 'bg-accent' : 'bg-active'}`}
              />
            ))}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {step === 'opencode' && <StepOpencode info={info} onInfo={setInfo} refreshInfo={refreshInfo} />}
          {step === 'auth' && <StepAuth connected={connected} refreshProviders={refreshProviders} />}
          {step === 'model' && <StepModel />}
          {step === 'modes' && <StepModes />}
          {step === 'setup' && <StepSetup onTryExample={tryExample} />}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-border/60 px-6 py-3">
          <Button variant="ghost" onClick={finish}>
            {t('wizard.skip')}
          </Button>
          <div className="flex items-center gap-2">
            {prevStep(step, undefined, withEngine) && (
              <Button variant="secondary" onClick={() => setStep(prevStep(step, undefined, withEngine))}>
                {t('wizard.back')}
              </Button>
            )}
            <Button
              variant="primary"
              disabled={!advance}
              onClick={() => (last ? finish() : setStep(nextStep(step, undefined, withEngine)))}
            >
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
        <Lead>{t('wizard.opencode.bundledLead', { app: DISPLAY_NAME })}</Lead>
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
      <Lead>{t(info?.found ? 'wizard.opencode.leadFound' : 'wizard.opencode.leadMissing', { app: DISPLAY_NAME })}</Lead>

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
            <p className="mt-2 text-xs text-warning">{t('wizard.opencode.versionMismatch', { app: DISPLAY_NAME, sdk: info.sdkVersion })}</p>
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
          <p className="mt-1 text-xs text-muted">{t('wizard.opencode.installHint', { app: DISPLAY_NAME })}</p>
          <code className="mt-2 block rounded-lg bg-hover px-2.5 py-1.5 font-mono text-xs break-all">
            {openCodeInstallCommand(currentPlatform())}
          </code>
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
  const providers = useProviders((s) => s.providers)
  const providersLoaded = useProviders((s) => s.loaded)
  const defaultModel = useSettings((s) => s.settings.defaultModel)
  const updateSettings = useSettings((s) => s.update)
  const freeModel = providersLoaded ? firstFreeModel(providers) : null
  const freeChosen = freeModel !== null && defaultModel.providerID === freeModel.providerID && defaultModel.modelID === freeModel.modelID
  /** Tarjeta que originó la última acción, para mostrar el error bajo ella. */
  const [origin, setOrigin] = useState<'go' | 'other'>('go')
  const serverStatus = useServer((s) => s.status)
  const serverError = useServer((s) => s.error)
  const restartServer = useServer((s) => s.restart)
  const [restarting, setRestarting] = useState(false)
  const engineFailure = serverStatus.state === 'error' || serverError ? (serverError ?? serverStatus.error ?? '').split('\n')[0] : ''
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
      <p className="text-[13px] leading-[18px] text-muted">{t('wizard.auth.keyHelp', { app: DISPLAY_NAME })}</p>
      {engineFailure && (
        <div role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
          <p>{t('wizard.auth.engineFailed', { app: DISPLAY_NAME })}</p>
          <p className="mt-1 break-words whitespace-pre-wrap opacity-80">{engineFailure}</p>
          <Button
            size="sm"
            className="mt-2"
            disabled={restarting}
            onClick={() => {
              setRestarting(true)
              void restartServer().finally(() => setRestarting(false))
            }}
          >
            {restarting ? <Loader2 size={13} className="animate-spin" /> : <RotateCw size={13} />} {t('wizard.opencode.retry')}
          </Button>
        </div>
      )}

      <section aria-labelledby="onb-free" className="rounded-card border-0 bg-accent-soft p-4 ring-[1.5px] ring-accent ring-inset">
        <div className="flex items-center gap-2">
          <h3 id="onb-free" className="text-sm font-semibold">
            {t('wizard.auth.freeTitle')}
          </h3>
          <Badge tone="ok">{t('wizard.auth.free')}</Badge>
          {freeChosen && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] desk:text-meta font-medium text-fg">
              <Check size={11} className="text-success" /> {t('wizard.auth.freeChosen')}
            </span>
          )}
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted">{t('wizard.auth.freeDescription')}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={!freeModel || freeChosen}
            onClick={() => freeModel && void updateSettings({ defaultModel: freeModel })}
          >
            {t('wizard.auth.freeUse')}
          </Button>
          {providersLoaded && !freeModel && <span className="text-xs text-muted">{t('wizard.auth.freeUnavailable')}</span>}
        </div>
      </section>

      <section aria-labelledby="onb-go" className="rounded-card border-0 bg-elevated p-4 shadow-raised">
        <div className="flex items-center gap-2">
          <h3 id="onb-go" className="text-sm font-semibold">
            OpenCode Go
          </h3>
          <Badge>{t('wizard.auth.paid')}</Badge>
          {goConnected && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] desk:text-meta font-medium text-fg">
              <Check size={11} className="text-success" /> {t('wizard.auth.goConnected')}
            </span>
          )}
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted">{t('wizard.auth.goDescription', { app: DISPLAY_NAME })}</p>
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
          className="mt-3 border-0! bg-transparent! p-0! shadow-none!"
        />
        <SwitchNoticeBar notice={connect.notice} onClose={() => connect.setNotice(null)} />
        {connect.error && origin === 'go' && (
          <div role="alert" className="mt-2">
            <ErrorText>{connect.error}</ErrorText>
          </div>
        )}
      </section>

      <section aria-labelledby="onb-other" className="rounded-card border-0 bg-elevated p-4 shadow-raised">
        <h3 id="onb-other" className="text-sm font-semibold">
          {t('wizard.auth.otherTitle')}
        </h3>
        <p className="mt-1 text-sm text-muted">{t('wizard.auth.otherDescription')}</p>
        <div className="mt-3 space-y-2">
          {!client ? (
            <p className="text-xs text-muted">{t('wizard.auth.waitingServer', { app: DISPLAY_NAME })}</p>
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
              onOauthCancel={connect.cancelOauth}
              title={null}
              className="border-0! bg-transparent! p-0! shadow-none!"
            />
          ) : null}
          {otherNames.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {otherNames.map((n) => (
                <span
                  key={n}
                  className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] desk:text-meta font-medium text-fg"
                >
                  <Check size={11} className="text-success" /> {t('wizard.auth.providerConnected', { name: n })}
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

      <div role="note" className="flex items-start gap-3 rounded-ctl bg-warning/10 px-3.5 py-3 ring-1 ring-warning/45 ring-inset">
        <Shield size={16} className="mt-0.5 shrink-0 text-warning" />
        <div className="text-[13px] leading-[18px] text-fg">
          <p>{connectTasksNotice()}</p>
          <p className="mt-1.5 text-muted">{connectTermsNotice()}</p>
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
      <div className="flex items-center gap-3 rounded-card bg-elevated px-3.5 py-3 shadow-raised">
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
        {MODE_INFO.filter((m) => modeAvailable(m.id, currentPlatform(), currentFlags())).map((m) => (
          <li key={m.id} className="flex items-start gap-3 rounded-card bg-elevated px-3.5 py-3 shadow-raised">
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

// ───────────── Paso 5: prepara tu equipo (permisos + componentes) ─────────────

type SetupItemId = 'craft' | 'sandbox'
type SetupState = 'idle' | 'running' | 'done' | 'failed'

/**
 * Un solo botón deja el equipo listo: en macOS pide Accesibilidad y Grabación de pantalla y baja ArtCraft (el diseñador de documentos: descarga de GitHub,
 * verificada por hash y firma); en Windows prepara el entorno aislado de Tareas. Pulsarlo ES el consentimiento de todo lo que la tarjeta
 * enumera; nada se hace antes. Cada pieza se puede reintentar y todo se puede hacer después desde Ajustes.
 */
function StepSetup({ onTryExample }: { onTryExample: () => void }): React.JSX.Element {
  const t = useT()
  const mac = isMacPlatform()
  const caps = platformCaps()
  const [items, setItems] = useState<Partial<Record<SetupItemId, SetupState>>>({})
  const [craftMb, setCraftMb] = useState(0)
  const [craftError, setCraftError] = useState<string | undefined>()
  const [pct, setPct] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (id: SetupItemId, st: SetupState): void => setItems((p) => ({ ...p, [id]: st }))

  const refresh = useCallback(async (): Promise<void> => {
    if (!hasTasksBridge()) return
    const o = await cw('craft:status').catch(() => null)
    if (o?.status.state === 'missing') {
      setCraftMb(Math.round(o.status.sizeBytes / 1e6))
      set('craft', 'idle')
    } else if (o?.status.state === 'installed') set('craft', 'done')
    if (caps.tasks && caps.tasksSandbox === 'wsl') {
      const s = await cw('tasks:sandbox:status', undefined).catch(() => null)
      if (s) set('sandbox', s.state === 'ready' ? 'done' : 'idle')
    }
  }, [caps.tasks, caps.tasksSandbox])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const runAll = async (): Promise<void> => {
    setBusy(true)
    try {
      if (items.craft && items.craft !== 'done') {
        set('craft', 'running')
        const poll = setInterval(() => {
          void cw('craft:status')
            .then((s) => {
              const total = s.progress?.total ?? 0
              setPct(s.installing && total > 0 ? Math.min(100, Math.round(((s.progress?.done ?? 0) / total) * 100)) : null)
            })
            .catch(() => undefined)
        }, 1000)
        const r = await cw('craft:install').catch(() => undefined)
        clearInterval(poll)
        setPct(null)
        setCraftError(installFailureCode(r))
        set('craft', r?.ok ? 'done' : 'failed')
      }
      if (items.sandbox && items.sandbox !== 'done') {
        set('sandbox', 'running')
        const poll = setInterval(() => {
          void cw('tasks:sandbox:status', undefined).then((s) => setPct(s.setup?.running ? s.setup.pct : null))
        }, 1500)
        const s = await cw('tasks:sandbox:setup').catch(() => null)
        clearInterval(poll)
        setPct(null)
        set('sandbox', s?.state === 'ready' ? 'done' : 'failed')
      }
    } finally {
      setBusy(false)
    }
  }

  const rows: Array<{ id: SetupItemId; label: string; hint: string }> = []
  if (items.craft) rows.push({ id: 'craft', label: t('wizard.setup.craft'), hint: t('wizard.setup.craft.hint', { mb: craftMb }) })
  if (items.sandbox) rows.push({ id: 'sandbox', label: t('wizard.setup.sandbox'), hint: t('wizard.setup.sandbox.hint') })
  const allDone = rows.length > 0 && rows.every((r) => items[r.id] === 'done')
  const anyFailed = rows.some((r) => items[r.id] === 'failed')

  return (
    <div className="space-y-3">
      <Lead>{rows.length === 0 ? t('wizard.setup.nothing', { app: DISPLAY_NAME }) : t('wizard.setup.lead', { app: DISPLAY_NAME })}</Lead>
      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((r) => {
            const st = items[r.id] ?? 'idle'
            return (
              <li key={r.id} className="flex items-start gap-3 rounded-ctl bg-inset px-3.5 py-3">
                <span className="mt-0.5 shrink-0">
                  {st === 'done' ? (
                    <Check size={16} className="text-success" />
                  ) : st === 'running' ? (
                    <Loader2 size={16} className="animate-spin text-accent" />
                  ) : (
                    <Shield size={16} className={st === 'failed' ? 'text-warning' : 'text-subtle'} />
                  )}
                </span>
                <div className="min-w-0 flex-1 text-[13px] leading-[18px]">
                  <p className="font-medium text-fg">{r.label}</p>
                  <p className="text-muted">
                    {st === 'running' && (r.id === 'sandbox' || r.id === 'craft') && pct !== null ? `${pct} % · ` : ''}
                    {st === 'failed'
                      ? r.id === 'craft' && craftError
                        ? `${t(officeErrorKey(craftError))} ${t('wizard.setup.craft.retryHint')}`
                        : t('wizard.setup.status.failed')
                      : st === 'done'
                        ? t('wizard.setup.status.ready')
                        : r.hint}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {rows.length > 0 && (
        <div className="flex items-center gap-3">
          <Button variant="primary" disabled={busy || allDone} onClick={() => void runAll()}>
            {busy
              ? t('wizard.setup.running')
              : allDone
                ? t('wizard.setup.done')
                : anyFailed
                  ? t('wizard.setup.retry')
                  : t('wizard.setup.run')}
          </Button>
          <span className="text-meta text-muted">{t('wizard.setup.later')}</span>
        </div>
      )}
      {mac && caps.computer && (
        <p role="note" className="text-[13px] leading-[18px] text-muted">
          {t('wizard.setup.permsLater', { app: DISPLAY_NAME, mode: t('wizard.fullControl') })}
        </p>
      )}
      <section aria-labelledby="onb-example" className="rounded-card bg-accent-soft p-4 ring-[1.5px] ring-accent ring-inset">
        <h3 id="onb-example" className="text-sm font-semibold">
          {t('wizard.example.title')}
        </h3>
        <p className="mt-1 text-sm leading-relaxed text-muted">{t('wizard.example.body', { sample: t('wizard.sampleTask') })}</p>
        <Button className="mt-3" variant="primary" onClick={onTryExample}>
          {t('wizard.tryExample')}
        </Button>
      </section>
    </div>
  )
}
