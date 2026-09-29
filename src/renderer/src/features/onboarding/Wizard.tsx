/**
 * Asistente de primer uso (5 pasos: OpenCode, OpenCode Go, modelo, modos, permisos de macOS).
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
import type { Provider } from '@opencode-ai/sdk/v2/client'
import { APP_NAME } from '@shared/brand'
import { TASKS_TERMS } from '@shared/tasks-glossary'
import { MODE_LABELS } from '@shared/labels'
import { OPENCODE_INSTALL_COMMAND, type OpencodeAction } from '@shared/opencode-links'
import type { ModeId, OpencodeInfo } from '@shared/types'
import { Button } from '../../components/Button'
import { ModelPicker } from '../../components/ModelPicker'
import { call } from '../../lib/api'
import { errorMessage } from '../../lib/opencode'
import { useProviders } from '../../stores/providers'
import { useServer } from '../../stores/server'
import { useSettings } from '../../stores/settings'
import { ProviderKeyForm, saveProviderKey } from '../settings'
import {
  canAdvance,
  decideOnboarding,
  nextStep,
  ONBOARDING_STEPS,
  prevStep,
  stepIndex,
  type OnboardingStep,
  type ProviderState
} from './steps'

const GO_PROVIDER = 'opencode-go'
const GO_FORM_PROVIDERS: Pick<Provider, 'id' | 'name' | 'env'>[] = [{ id: GO_PROVIDER, name: 'OpenCode Go', env: [] }]

const STEP_TITLES: Record<OnboardingStep, string> = {
  opencode: 'Instala o localiza OpenCode',
  auth: 'Conecta OpenCode Go',
  model: 'Elige tu modelo',
  modes: 'Los cuatro modos',
  permissions: 'Permisos de macOS'
}

/** Puerta del asistente: no monta nada hasta que los ajustes cargaron y `onboarded` es false. */
export function OnboardingGate(): React.JSX.Element | null {
  const loaded = useSettings((s) => s.loaded)
  const onboarded = useSettings((s) => s.settings.onboarded)
  if (!loaded || onboarded) return null
  return <OnboardingHost />
}

function OnboardingHost(): React.JSX.Element | null {
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
  const advance = canAdvance(step, { binaryFound: info?.found === true, serverReady: serverStatus.state === 'ready' })

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
            Bienvenido a {APP_NAME} · Paso {stepIndex(step) + 1} de {ONBOARDING_STEPS.length}
          </p>
          <h2 id="onboarding-title" className="mt-1 font-display text-xl font-semibold tracking-[-0.015em]">
            {STEP_TITLES[step]}
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
            Saltar
          </Button>
          <div className="flex items-center gap-2">
            {prevStep(step) && (
              <Button variant="secondary" onClick={() => setStep(prevStep(step))}>
                Atrás
              </Button>
            )}
            <Button variant="primary" disabled={!advance} onClick={() => (last ? finish() : setStep(nextStep(step)))}>
              {last ? 'Empezar' : 'Continuar'}
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

  return (
    <div className="space-y-4">
      <Lead>
        {APP_NAME} usa OpenCode como motor. {info?.found ? 'Ya lo encontramos en este Mac.' : 'Necesitas tenerlo instalado en este Mac.'}
      </Lead>

      {info === null ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 size={14} className="animate-spin" /> Buscando OpenCode…
        </p>
      ) : info.found ? (
        <div className="rounded-xl border border-border bg-bg px-3.5 py-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <Check size={15} className="text-success" /> OpenCode encontrado{info.version ? ` (versión ${info.version})` : ''}
          </p>
          <p className="mt-1 font-mono text-xs break-all text-muted">{info.path}</p>
          {info.version && !info.compatible && (
            <p className="mt-2 text-xs text-warning">
              Esta versión de {APP_NAME} se probó con OpenCode {info.sdkVersion}. Con otra versión puede haber diferencias.
            </p>
          )}
          {!ready && !failure && (
            <p className="mt-2 flex items-center gap-2 text-xs text-muted">
              <Loader2 size={12} className="animate-spin" /> Iniciando OpenCode…
            </p>
          )}
          {ready && <p className="mt-2 text-xs text-success">OpenCode está en marcha.</p>}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-bg px-3.5 py-3 text-sm">
          <p className="font-medium">No se encontró OpenCode.</p>
          <p className="mt-1 text-xs text-muted">
            Instálalo abriendo la app Terminal y pegando este comando (cópialo con el botón; {APP_NAME} nunca lo ejecuta por ti):
          </p>
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
          {copied ? <Check size={13} /> : <ClipboardCopy size={13} />} {copied ? 'Comando copiado' : 'Copiar comando de instalación'}
        </Button>
        <Button size="sm" onClick={() => void runAction('openDocs')}>
          <ExternalLink size={13} /> Abrir instrucciones
        </Button>
        <Button size="sm" disabled={busy} onClick={() => void pick()}>
          <FolderSearch size={13} /> Elegir binario…
        </Button>
        <Button size="sm" disabled={busy} onClick={() => void retry()}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <RotateCw size={13} />} Reintentar
        </Button>
      </div>
    </div>
  )
}

// ───────────── Paso 2: OpenCode Go ─────────────

function StepAuth({
  connected,
  refreshProviders
}: {
  connected: ProviderState[] | null
  refreshProviders: () => Promise<void>
}): React.JSX.Element {
  const client = useServer((s) => s.client)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const goConnected = saved || (connected?.some((p) => p.id === GO_PROVIDER) ?? false)

  const onSetKey = async (providerID: string, key: string): Promise<void> => {
    if (!client) return
    setBusy(true)
    setError(null)
    try {
      await saveProviderKey(client, providerID, key)
      setSaved(true)
      await Promise.all([refreshProviders(), useProviders.getState().load(client, true)])
    } catch (err) {
      setError(errorMessage(err))
      throw err
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <Lead>
        OpenCode Go es una suscripción económica con acceso a modelos abiertos para programar. Crea tu cuenta, suscríbete y copia tu API
        key; luego pégala aquí. Se guarda en OpenCode, no en {APP_NAME}.
      </Lead>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void runAction('openAuth')}>
          <ExternalLink size={13} /> Obtener mi clave
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void runAction('openGo')}>
          Conocer OpenCode Go
        </Button>
        {goConnected && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
            <Check size={11} /> OpenCode Go conectado
          </span>
        )}
      </div>
      <ProviderKeyForm
        providers={GO_FORM_PROVIDERS}
        auth={{}}
        busy={busy || !client}
        onSetKey={onSetKey}
        fixedProviderId={GO_PROVIDER}
        className="p-4"
      />
      {!client && <p className="text-xs text-muted">Esperando a OpenCode… Vuelve al paso anterior si no arranca.</p>}
      {error && (
        <div role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs whitespace-pre-wrap text-danger">
          {error}
        </div>
      )}
      <p className="text-xs text-subtle">¿Usas otro proveedor? Puedes conectarlo después en Ajustes › Modelos.</p>
    </div>
  )
}

// ───────────── Paso 3: modelo ─────────────

function StepModel(): React.JSX.Element {
  const model = useSettings((s) => s.settings.defaultModel)
  const update = useSettings((s) => s.update)
  const client = useServer((s) => s.client)
  const load = useProviders((s) => s.load)
  useEffect(() => {
    if (client) void load(client, true)
  }, [client, load])
  return (
    <div className="space-y-4">
      <Lead>
        Es el modelo que usarán los chats y las tareas cuando no elijas otro. Puedes cambiarlo cuando quieras en Ajustes › Modelos.
      </Lead>
      <div className="flex items-center gap-3 rounded-xl border border-border bg-bg px-3.5 py-3">
        <span className="text-sm text-muted">Modelo predeterminado</span>
        <ModelPicker value={model} onChange={(m) => void update({ defaultModel: m })} placement="bottom" />
      </div>
    </div>
  )
}

// ───────────── Paso 4: modos ─────────────

const MODE_INFO: { id: ModeId; icon: React.ReactNode; description: string }[] = [
  { id: 'chat', icon: <MessageSquare size={16} />, description: 'Conversaciones generales con el modelo, sin tocar tus archivos.' },
  { id: 'code', icon: <Code2 size={16} />, description: 'Un agente de programación que trabaja sobre la carpeta de tu proyecto.' },
  {
    id: 'tasks',
    icon: <ListChecks size={16} />,
    description: 'Tareas autónomas sobre tus documentos y carpetas, con permisos que tú apruebas.'
  },
  { id: 'routines', icon: <CalendarClock size={16} />, description: 'Tareas programadas que se ejecutan solas a la hora que elijas.' }
]

function StepModes(): React.JSX.Element {
  return (
    <div className="space-y-3">
      <Lead>Cambias de modo desde la barra lateral (⌃Tab recorre los cuatro).</Lead>
      <ul className="space-y-2">
        {MODE_INFO.map((m) => (
          <li key={m.id} className="flex items-start gap-3 rounded-xl border border-border bg-bg px-3.5 py-3">
            <span className="mt-0.5 text-accent">{m.icon}</span>
            <div>
              <p className="text-sm font-medium">{MODE_LABELS[m.id]}</p>
              <p className="text-xs text-muted">{m.description}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ───────────── Paso 5: permisos de macOS ─────────────

function StepPermissions(): React.JSX.Element {
  return (
    <div className="space-y-3">
      <Lead>{APP_NAME} no pide ningún permiso especial de macOS al empezar.</Lead>
      <div className="flex items-start gap-3 rounded-xl border border-border bg-bg px-3.5 py-3">
        <Shield size={16} className="mt-0.5 shrink-0 text-warning" />
        <div className="text-xs leading-relaxed text-muted">
          <p>
            Solo si activas «{TASKS_TERMS.fullControl}» en una tarea, macOS te pedirá dos permisos:{' '}
            <strong className="font-medium text-fg">Accesibilidad</strong> (mover el ratón, hacer clic y escribir) y{' '}
            <strong className="font-medium text-fg">Grabación de pantalla</strong> (ver lo que hay en pantalla).
          </p>
          <p className="mt-1.5">Puedes revisarlos o quitarlos en Ajustes del Sistema › Privacidad y seguridad.</p>
        </div>
      </div>
    </div>
  )
}
