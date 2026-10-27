/**
 * UI del modo "Control total del Mac" de Tareas: selector de modo, diálogo de
 * confirmación, tarjeta de permisos de macOS, aviso de modelo sin visión, banner
 * "Controlando tu Mac", miniaturas de capturas de pantalla, tarjeta de concesión por app
 * (`request_access`) y lista de permisos por app para Ajustes.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Ban,
  Camera,
  Check,
  ChevronDown,
  Eye,
  Keyboard,
  Lock,
  Loader2,
  MonitorCog,
  MousePointerClick,
  OctagonX,
  Play,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldOff,
  Square,
  Trash2,
  Undo2,
  X
} from 'lucide-react'
import {
  friendlyAppName,
  labeledAppName,
  MAC_FIXED_BLOCKED,
  MAC_SUGGESTED_BLOCK,
  WIN_FIXED_BLOCKED,
  WIN_SUGGESTED_BLOCK,
  type LabeledApp
} from '@shared/blocked-apps'
import { type AppTier, type ComputerStatus } from '@shared/ipc-tasks'
import type { ModelRef } from '@shared/types'
import { Button } from '../../../components/Button'
import { useT } from '../../../lib/i18n'
import { isWindowsPlatform, platformCaps } from '../../../lib/platform'
import { errorMessage } from '../../../lib/opencode'
import { useProviders } from '../../../stores/providers'
import { useServer } from '../../../stores/server'
import { useSessions } from '../../../stores/sessions'
import { useModeModel } from '../../settings/impl/extras'
import { AppLocationNotice, PermsHelp, ScreenRestartNotice } from '../../onboarding/PermsNotices'
import {
  cancelFullAccess,
  checkComputer,
  denyApp,
  requestComputerPermissions,
  resumeComputerControl,
  revokeAppGrant,
  revokePlanApproval,
  changeFullWorkspace,
  setAccessMode,
  setAppGrant,
  stopComputerControl,
  undenyApp
} from './actions'
import { TierBadge, tierInfo } from './AppAccessCard'
import { ComputerConsentWin } from './ComputerConsentWin'
import { describeAction } from './computer-tools'
import { sdkDir } from './conn-paths'
import { useScope } from './ScopePicker'
import { loadGrants, setTaskModel, useTasks } from './store'
import { isTasksSource } from './util'

export const VISION_MODEL: ModelRef = { providerID: 'opencode-go', modelID: 'kimi-k3' }

// ───────────────────────────── Selector de modo ─────────────────────────────

/** Chip del header con el modo de acceso de la carpeta (Sandbox / Control total). */
export function AccessModeSwitch({ disabled }: { disabled?: boolean }): React.JSX.Element | null {
  const t = useT()
  const conn = useTasks((s) => s.conn)
  const phase = useTasks((s) => s.phase)
  const requested = useTasks((s) => s.fullAccess)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const full = conn ? conn.fullAccess : requested
  // «Usando tu Mac» solo cuando el agente acaba de tocar de verdad el ratón, el teclado o la pantalla (< 15 s); el resto del tiempo
  // el chip dice lo que PUEDE hacer, en palabras llanas.
  const lastAction = useTasks((s) => s.lastAction)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!lastAction) return
    const id = setInterval(() => setNow(Date.now()), 2000)
    return () => clearInterval(id)
  }, [lastAction])
  const usingMac = full && !!lastAction && now - lastAction.at < 15_000
  let chip: React.JSX.Element
  if (full) {
    chip = usingMac ? (
      <>
        <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
        </span>{' '}
        {t('tasksComputer.chip.full')}
      </>
    ) : (
      <>
        <MonitorCog size={12} aria-hidden /> {t('tasksComputer.chip.full')}
      </>
    )
  } else if (conn && !conn.sandboxed) {
    chip = (
      <>
        <ShieldOff size={12} /> {t('tasksComputer.mode.noSandbox')}
      </>
    )
  } else {
    chip = (
      <>
        <Shield size={12} aria-hidden /> {t('tasksComputer.chip.folder')}
      </>
    )
  }
  const tone = full
    ? 'border-amber-500/50 bg-amber-500/10 text-amber-700 desk:text-warning [[data-theme=dark]_&]:text-amber-400'
    : conn && !conn.sandboxed
      ? 'border-danger/40 text-danger'
      : 'border-border text-fg'

  const scope = useScope()
  const pick = (fullAccess: boolean): void => {
    setOpen(false)
    scope.pick(fullAccess)
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled || phase === 'starting'}
        onClick={() => setOpen((o) => !o)}
        title={
          disabled
            ? t('tasksComputer.access.waitTask')
            : full
              ? `${usingMac ? `${t('tasksComputer.chip.using')}. ` : ''}${t('tasksComputer.mode.fullTitle')}`
              : t('tasksComputer.mode.sandboxTitle')
        }
        className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 whitespace-nowrap transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60 ${tone}`}
      >
        {chip}
        <ChevronDown size={11} />
      </button>
      {open && (
        <div className="absolute top-full right-0 z-30 mt-1 w-80 rounded-xl border border-border bg-elevated p-1 text-sm text-fg shadow-lg">
          <ModeOption
            active={!full}
            icon={<Shield size={16} className="text-accent" />}
            title={t('tasksComputer.scope.folder')}
            desc={t('tasksComputer.scope.folder.desc')}
            onClick={() => pick(false)}
          />
          {scope.canFull && (
            <ModeOption
              active={full}
              icon={<MonitorCog size={16} className="text-amber-500" />}
              title={t('tasksComputer.scope.computer')}
              desc={t('tasksComputer.scope.computer.desc')}
              onClick={() => pick(true)}
            />
          )}
        </div>
      )}
    </div>
  )
}

function ModeOption({
  active,
  icon,
  title,
  desc,
  onClick
}: {
  active: boolean
  icon: React.ReactNode
  title: string
  desc: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-hover">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{title}</span>
        <span className="block text-xs text-muted">{desc}</span>
      </span>
      {active && <Check size={15} className="mt-0.5 shrink-0 text-accent" />}
    </button>
  )
}

// ───────────────────────────── Confirmación ─────────────────────────────

/** Ruta para mostrar: la carpeta personal como «~». */
function displayFolder(path: string, home?: string): string {
  if (home && path === home) return '~'
  if (home && path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`
  return path
}

/** Aviso visible de que Control total no está confinado, con la carpeta de trabajo y cómo cambiarla (opcional). */
export function FullWorkspaceNote({ canChange = true }: { canChange?: boolean }): React.JSX.Element | null {
  const t = useT()
  const conn = useTasks((s) => s.conn)
  const requested = useTasks((s) => s.fullAccess)
  const folder = useTasks((s) => s.folder)
  const home = useTasks((s) => s.fullAccessInfo?.home)
  const full = conn ? conn.fullAccess : requested
  if (!full || !folder) return null
  return (
    <div
      data-testid="full-workspace-note"
      className="mx-auto mt-3 flex w-full max-w-3xl items-center gap-2 px-6 text-xs text-muted"
      title={t('tasksComputer.workspace.unconfined')}
    >
      <ShieldOff size={13} className="shrink-0 text-warning" />
      <span className="min-w-0 flex-1 truncate">{t('tasksComputer.workspace.label', { folder: displayFolder(folder, home) })}</span>
      {canChange && (
        <button
          type="button"
          onClick={() => void changeFullWorkspace()}
          className="no-drag shrink-0 rounded-md px-2 py-0.5 font-medium text-fg underline-offset-2 hover:underline"
        >
          {t('tasksComputer.workspace.change')}
        </button>
      )}
    </div>
  )
}

/** "¿Permitir que el agente controle tu Mac?" */
export function FullAccessDialog(): React.JSX.Element | null {
  const t = useT()
  const folder = useTasks((s) => s.pendingFullAccess)
  const home = useTasks((s) => s.fullAccessInfo?.home)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!folder) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cancelFullAccess()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [folder])

  if (!folder) return null
  const name = displayFolder(folder, home)

  const confirm = (): void => {
    setBusy(true)
    void setAccessMode(true, true).finally(() => setBusy(false))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onMouseDown={cancelFullAccess}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="tasks-fullaccess-title"
        className="w-full max-w-lg rounded-2xl border border-border bg-elevated p-6 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/15 text-amber-500">
          <ShieldAlert size={22} />
        </div>
        <h2 id="tasks-fullaccess-title" className="text-lg font-semibold">
          {t('tasksComputer.full.title')}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {t('tasksComputer.full.intro1')}
          <strong className="text-fg">{t('tasksComputer.full.noSandbox')}</strong>
          {t('tasksComputer.full.intro2', { name })}
        </p>
        <ul className="mt-4 space-y-2.5 text-sm text-muted">
          <li className="flex gap-2.5">
            <MousePointerClick size={16} className="mt-0.5 shrink-0 text-amber-500" />
            {t('tasksComputer.full.b1')}
          </li>
          <li className="flex gap-2.5">
            <Camera size={16} className="mt-0.5 shrink-0 text-amber-500" />
            <span>
              {t('tasksComputer.full.cap1')}
              <strong className="text-fg">{t('tasksComputer.full.cap2')}</strong>
              {t('tasksComputer.full.cap3')}
              <span className="mt-1 block text-xs text-subtle" data-testid="capture-retention">
                {t('tasksComputer.full.retention')}
              </span>
            </span>
          </li>
          <li className="flex gap-2.5">
            <ShieldOff size={16} className="mt-0.5 shrink-0 text-amber-500" />
            {t('tasksComputer.full.b3')}
          </li>
          <li className="flex gap-2.5">
            <OctagonX size={16} className="mt-0.5 shrink-0 text-danger" />
            <span>
              {t('tasksComputer.full.stop1')}
              <strong className="text-fg">{t('tasksComputer.stop')}</strong>
              {t('tasksComputer.full.stop2')}{' '}
              <kbd className="rounded border border-border bg-hover px-1 font-mono text-xs text-fg">{t('tasksComputer.shortcut')}</kbd>.
            </span>
          </li>
        </ul>
        <p className="mt-4 rounded-lg bg-hover px-3 py-2 text-xs text-muted">{t('tasksComputer.full.warn')}</p>
        <p className="mt-2 text-xs text-subtle" data-testid="full-consent-once">
          {t('tasksComputer.full.once')}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={cancelFullAccess} autoFocus>
            {t('tasksComputer.cancel')}
          </Button>
          <Button variant="primary" className="!bg-amber-700 !text-white" onClick={confirm} disabled={busy}>
            {busy && <Loader2 size={14} className="animate-spin" />} {t('tasksComputer.full.allow')}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ───────────────────────────── Permisos de macOS ─────────────────────────────

function PermRow({ ok, label, hint }: { ok: boolean; label: string; hint: string }): React.JSX.Element {
  return (
    <li className="flex items-start gap-2">
      {ok ? <Check size={15} className="mt-0.5 shrink-0 text-accent" /> : <X size={15} className="mt-0.5 shrink-0 text-danger" />}
      <span>
        <span className={ok ? 'text-muted' : 'font-medium text-fg'}>{label}</span>
        {!ok && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </li>
  )
}

/** Windows: lo que impide usar Control del PC (helper, administrador, escritorio no interactivo) y, si falta, el consentimiento. */
function WinPermissionsCard({
  status,
  checking,
  fallbackHelperOk,
  fallbackConsent
}: {
  status: ComputerStatus | null
  checking: boolean
  fallbackHelperOk: boolean
  fallbackConsent: boolean
}): React.JSX.Element | null {
  const t = useT()
  const helperOk = status ? status.helperOk : fallbackHelperOk
  const consent = status?.win ? status.win.consent : fallbackConsent
  const notAdmin = status?.win?.elevated !== true
  const interactive = status?.win?.interactive !== false
  if (helperOk && consent && notAdmin && interactive) return null
  const problems = !helperOk || !notAdmin || !interactive
  return (
    <div className="mx-auto mt-4 w-full max-w-3xl space-y-3 px-6">
      {problems && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <div className="mb-2 flex items-center gap-2 font-semibold text-amber-700 desk:text-warning [[data-theme=dark]_&]:text-amber-400">
            <ShieldAlert size={16} aria-hidden="true" /> {t('tasksComputer.perms.title')}
          </div>
          <ul className="space-y-1.5">
            <PermRow ok={helperOk} label={t('tasksComputer.winStatus.helper')} hint={t('tasksComputer.winStatus.helperMissing')} />
            <PermRow ok={notAdmin} label={t('tasksComputer.winStatus.admin')} hint={t('tasksComputer.winStatus.adminYes')} />
            <PermRow ok={interactive} label={t('tasksComputer.winStatus.session')} hint={t('tasksComputer.winStatus.sessionNo')} />
          </ul>
          <div className="mt-3">
            <Button variant="secondary" type="button" onClick={() => void checkComputer()} disabled={checking}>
              {checking ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}{' '}
              {t('tasksComputer.perms.recheck')}
            </Button>
          </div>
        </div>
      )}
      {!consent && <ComputerConsentWin />}
    </div>
  )
}

/** Tarjeta con los permisos que faltan (Accesibilidad / Grabación de pantalla / helper). */
export function ComputerPermissionsCard(): React.JSX.Element | null {
  const t = useT()
  const conn = useTasks((s) => s.conn)
  const status = useTasks((s) => s.computerStatus)
  const checking = useTasks((s) => s.computerChecking)
  const [error, setError] = useState<string | null>(null)
  const full = conn?.fullAccess === true

  // Volver a comprobar al regresar de Ajustes del Sistema.
  useEffect(() => {
    if (!full) return
    const onFocus = (): void => void checkComputer()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [full])

  if (!full || !conn) return null
  // Windows: sin permisos TCC; manda el consentimiento propio de la app (y que haya escritorio interactivo y no sea administrador).
  if (platformCaps().computerBackend === 'uia') {
    return (
      <WinPermissionsCard
        status={status}
        checking={checking}
        fallbackHelperOk={conn.computerUse?.available ?? false}
        fallbackConsent={conn.computerUse?.accessibility ?? false}
      />
    )
  }
  const helperOk = status ? status.helperOk : (conn.computerUse?.available ?? false)
  const accessibility = status ? status.accessibility : (conn.computerUse?.accessibility ?? false)
  const screenRecording = status ? status.screenRecording : (conn.computerUse?.screenRecording ?? false)
  if (helperOk && accessibility && screenRecording) return null

  const request = (): void => {
    setError(null)
    requestComputerPermissions().catch((err: unknown) => setError(errorMessage(err)))
  }

  return (
    <div className="mx-auto mt-4 w-full max-w-3xl px-6">
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
        <div className="mb-2 flex items-center gap-2 font-semibold text-amber-700 desk:text-warning [[data-theme=dark]_&]:text-amber-400">
          <ShieldAlert size={16} /> {t('tasksComputer.perms.title')}
        </div>
        <ul className="space-y-1.5">
          <PermRow
            ok={helperOk}
            label={t('tasksComputer.perms.helper')}
            hint={conn.computerUse?.reason ?? t('tasksComputer.perms.helperHint')}
          />
          <PermRow ok={accessibility} label={t('tasksComputer.perms.accessibility')} hint={t('tasksComputer.perms.accessibilityHint')} />
          <PermRow ok={screenRecording} label={t('tasksComputer.perms.screen')} hint={t('tasksComputer.perms.screenHint')} />
        </ul>
        <p className="mt-3 text-xs text-muted">
          {t('tasksComputer.perms.help1')} <code>{'npm run dev'}</code> (
          <strong className="text-fg">{t('tasksComputer.perms.helpApps')}</strong>
          {t('tasksComputer.perms.help2')}
        </p>
        <AppLocationNotice location={status?.location} />
        {helperOk && accessibility && !screenRecording && <ScreenRestartNotice />}
        <PermsHelp />
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" onClick={request}>
            <ShieldAlert size={14} /> {t('tasksComputer.perms.grant')}
          </Button>
          <Button variant="secondary" onClick={() => void checkComputer()} disabled={checking}>
            {checking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} {t('tasksComputer.perms.recheck')}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ───────────────────────────── Modelo con visión ─────────────────────────────

/** Aviso si el modelo elegido no acepta imágenes (necesario para ver las capturas). */
export function VisionModelHint(): React.JSX.Element | null {
  const t = useT()
  const full = useTasks((s) => s.conn?.fullAccess === true)
  // Modelo de la tarea (o el del modo Tareas): nunca el modelo predeterminado de Chat.
  const taskModel = useTasks((s) => s.taskModel)
  const modeModel = useModeModel('tasks')
  const model = taskModel ?? modeModel
  const client = useServer((s) => s.client)
  const providers = useProviders((s) => s.providers)
  const load = useProviders((s) => s.load)

  useEffect(() => {
    if (full && client) void load(client)
  }, [full, client, load])

  const { current, visionAvailable } = useMemo(() => {
    const m = providers.find((p) => p.id === model.providerID)?.models[model.modelID]
    const v = providers.find((p) => p.id === VISION_MODEL.providerID)?.models[VISION_MODEL.modelID]
    return { current: m, visionAvailable: providers.length === 0 || !!v }
  }, [providers, model])

  // Sin datos del modelo no podemos afirmar nada: no avisar.
  if (!full || !current) return null
  if (current.capabilities.input.image) return null

  const isVision = model.providerID === VISION_MODEL.providerID && model.modelID === VISION_MODEL.modelID
  return (
    <div className="mx-auto mb-2 w-full max-w-3xl px-6">
      <div className="flex items-center gap-2 rounded-lg bg-hover/60 px-3 py-2 text-xs text-muted">
        <Eye size={14} className="shrink-0 text-warning" />
        <span className="min-w-0 flex-1">
          <strong>{current.name}</strong>
          {t('tasksComputer.vision.text')}
        </span>
        {!isVision && visionAvailable && (
          <button
            type="button"
            onClick={() => setTaskModel(VISION_MODEL)}
            className="shrink-0 rounded-md bg-accent px-2 py-1 font-medium text-accent-fg hover:opacity-90"
          >
            {t('tasksComputer.vision.use')}
          </button>
        )}
      </div>
    </div>
  )
}

// ───────────────────────────── Banner "Controlando tu Mac" ─────────────────────────────

/** Barra visible mientras una tarea con Control total está trabajando, con botón Detener. */
export function ControlBanner(): React.JSX.Element | null {
  const t = useT()
  const conn = useTasks((s) => s.conn)
  const folder = useTasks((s) => s.folder)
  const lastAction = useTasks((s) => s.lastAction)
  const stoppedAt = useTasks((s) => s.controlStoppedAt)
  const shortcutUnavailable = useTasks((s) => s.shortcutUnavailable)
  const accessRequest = useTasks((s) => s.accessRequest)
  const activeTaskId = useTasks((s) => s.activeTaskId)
  const planApproved = useTasks((s) => (s.activeTaskId ? !!s.approvedPlans[s.activeTaskId] : false))
  const [revoking, setRevoking] = useState(false)
  // Solo sesiones de un servidor de Tareas (F6-B1, F7-B37): Code/Chat (origen principal) no cuentan; el otro servidor de Tareas sí.
  const anyBusy = useSessions((s) =>
    Object.keys(s.status).some(
      (id) => s.status[id] !== 'idle' && !!folder && s.sessions[id]?.directory === sdkDir(folder) && isTasksSource(s.sessionSource[id])
    )
  )
  const [stopping, setStopping] = useState(false)
  const [resuming, setResuming] = useState(false)
  const [resumeError, setResumeError] = useState<string | null>(null)
  const [, tick] = useState(0)

  // Refresca el "hace Xs" de la última acción.
  useEffect(() => {
    if (!anyBusy) return
    const timer = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [anyBusy])

  if (!conn?.fullAccess) return null

  const shortcutWarning = shortcutUnavailable ? (
    <div className="flex shrink-0 items-center gap-2 border-b border-warning/40 bg-warning/10 px-4 py-1.5 text-xs text-warning">
      <ShieldAlert size={14} /> {t('tasksComputer.banner.shortcutOff')}
    </div>
  ) : null

  // Fila compacta "Plan aprobado" (Control total): el permiso dura toda la tarea hasta Revocar/Detener.
  const revokeRow =
    planApproved && activeTaskId ? (
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-elevated px-4 py-1.5 text-xs text-muted">
        <Check size={13} className="shrink-0 text-success" />
        <span className="min-w-0 flex-1 truncate">{t('tasksComputer.banner.planApproved')}</span>
        <button
          type="button"
          onClick={() => {
            setRevoking(true)
            void revokePlanApproval(activeTaskId).finally(() => setRevoking(false))
          }}
          disabled={revoking}
          className="no-drag flex shrink-0 items-center gap-1 rounded-lg border border-border bg-elevated px-2.5 py-1 text-xs font-semibold text-fg hover:bg-hover disabled:opacity-60"
        >
          {revoking && <Loader2 size={12} className="animate-spin" />} {t('tasksComputer.banner.revoke')}
        </button>
      </div>
    ) : null

  // La parada NO se deshace sola: sigue visible hasta que el usuario pulse "Reanudar control".
  if (stoppedAt) {
    const resume = (): void => {
      setResuming(true)
      setResumeError(null)
      resumeComputerControl()
        .catch((err: unknown) => setResumeError(errorMessage(err)))
        .finally(() => setResuming(false))
    }
    return (
      <>
        <div className="flex shrink-0 items-center gap-2 border-b border-danger/40 bg-danger/10 px-4 py-2 text-sm font-medium text-danger">
          <OctagonX size={16} className="shrink-0" /> {t('tasksComputer.banner.stopped')}
          {anyBusy && <Loader2 size={14} className="animate-spin" />}
          <span className="min-w-0 flex-1 truncate text-xs font-normal text-muted">
            {resumeError ?? (anyBusy ? t('tasksComputer.banner.cancelling') : t('tasksComputer.banner.stoppedDesc'))}
          </span>
          <button
            type="button"
            onClick={resume}
            disabled={resuming || anyBusy}
            className="no-drag flex shrink-0 items-center gap-1.5 rounded-lg border border-danger/40 bg-elevated px-3 py-1 text-xs font-semibold text-fg hover:bg-danger/10 disabled:opacity-60"
          >
            {resuming ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} {t('tasksComputer.banner.resume')}
          </button>
        </div>
        {shortcutWarning}
      </>
    )
  }
  // Esperando que el usuario responda una tarjeta `request_access` (sin límite de tiempo): pausa,
  // no error. Fila COMPACTA de estado (una línea, en el flujo normal bajo la cabecera, sin tapar
  // nada): el detalle (plan, apps, selector de nivel) vive en la tarjeta `PlanAccessCard`, fija
  // sobre el compositor. El botón Detener sigue disponible por si el usuario prefiere cancelar.
  if (accessRequest) {
    const stop = (): void => {
      setStopping(true)
      void stopComputerControl().finally(() => setStopping(false))
    }
    // Plan sin apps (nada de ratón ni teclado): la barra es serena, con el acento, no una alerta ámbar.
    const calmWait = !!accessRequest.plan && accessRequest.apps.length === 0
    const dot = calmWait ? 'bg-accent' : 'bg-amber-500'
    return (
      <>
        <div
          className={`flex shrink-0 items-center gap-2.5 border-b px-4 py-1.5 ${calmWait ? 'border-accent/30 bg-accent-soft/40 text-fg' : 'border-amber-600/40 bg-amber-500/10 text-amber-800 [[data-theme=dark]_&]:text-amber-300'}`}
        >
          <span className="relative flex h-2 w-2 shrink-0">
            <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${dot}`} />
            <span className={`relative inline-flex h-2 w-2 rounded-full ${dot}`} />
          </span>
          <span className="min-w-0 flex-1 truncate text-xs font-medium">
            {t('tasksComputer.banner.waiting', {
              card: accessRequest.plan ? t('tasksComputer.banner.cardPlan') : t('tasksComputer.banner.cardPerms')
            })}
          </span>
          <button
            type="button"
            onClick={stop}
            disabled={stopping}
            className="no-drag flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-600/40 bg-elevated px-2.5 py-1 text-xs font-semibold text-fg hover:bg-amber-500/10 disabled:opacity-70"
          >
            {stopping ? <Loader2 size={12} className="animate-spin" /> : <Square size={11} fill="currentColor" />} {t('tasksComputer.stop')}
          </button>
        </div>
        {shortcutWarning}
      </>
    )
  }
  // Sin ninguna acción real sobre la pantalla (tarea de archivos, documentos o navegador) no hay «modo control»: nada de banner rojo.
  if (!anyBusy || !lastAction)
    return (
      <>
        {revokeRow}
        {shortcutWarning}
      </>
    )

  const ago = lastAction ? Math.max(0, Math.round((Date.now() - lastAction.at) / 1000)) : null
  const stop = (): void => {
    setStopping(true)
    void stopComputerControl().finally(() => setStopping(false))
  }

  return (
    <>
      <div
        className="flex shrink-0 items-center gap-3 border-b border-red-700/50 bg-gradient-to-r from-red-600 to-amber-600 px-4 py-2 text-white shadow-sm"
        data-testid="control-banner-busy"
      >
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">
            {t('tasksComputer.banner.controlling')}{' '}
            <span className="text-xs font-normal text-white/80">· {t('tasksComputer.workspace.unconfined')}</span>
          </div>
          <div className="truncate text-xs text-white/85">
            {lastAction ? (
              <>
                {describeAction(lastAction)}
                {ago !== null && ago > 1 && <span className="text-white/60">{t('tasksComputer.banner.ago', { ago })}</span>}
              </>
            ) : (
              t('tasksComputer.banner.firstAction')
            )}
          </div>
        </div>
        {shortcutUnavailable ? (
          <span
            className="hidden items-center gap-1 text-[11px] desk:text-meta text-white/85 md:flex"
            title={t('tasksComputer.banner.shortcutOff')}
          >
            <ShieldAlert size={12} /> {t('tasksComputer.banner.shortcutNA')}
          </span>
        ) : (
          <span className="hidden items-center gap-1 text-[11px] desk:text-meta text-white/75 md:flex">
            <Keyboard size={12} /> {t('tasksComputer.shortcut')}
          </span>
        )}
        <button
          type="button"
          onClick={stop}
          disabled={stopping}
          className="no-drag flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-4 py-1.5 text-sm font-bold text-red-700 shadow hover:bg-red-50 disabled:opacity-70"
        >
          {stopping ? <Loader2 size={15} className="animate-spin" /> : <Square size={14} fill="currentColor" />} {t('tasksComputer.stop')}
        </button>
      </div>
      {revokeRow}
    </>
  )
}

// ───────────────────────────── Capturas ─────────────────────────────

/** Miniaturas de capturas (clic para ampliar). Las URLs deben venir de `safeImageUrl`. */
export function ScreenshotThumbs({ images }: { images: Array<{ id: string; url: string; name: string }> }): React.JSX.Element | null {
  const t = useT()
  const [zoom, setZoom] = useState<string | null>(null)
  const [broken, setBroken] = useState<Record<string, boolean>>({})
  const visible = images.filter((i) => !broken[i.id])

  useEffect(() => {
    if (!zoom) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setZoom(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [zoom])

  if (visible.length === 0) return null
  return (
    <>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {visible.map((img) => (
          <button
            key={img.id}
            type="button"
            title={t('tasksComputer.shot.zoom')}
            onClick={() => setZoom(img.url)}
            className="overflow-hidden rounded-md border border-border hover:border-accent"
          >
            <img
              src={img.url}
              alt={img.name}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="h-16 w-28 object-cover object-top"
              onError={() => setBroken((b) => ({ ...b, [img.id]: true }))}
            />
          </button>
        ))}
      </div>
      {zoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8" onMouseDown={() => setZoom(null)}>
          <img
            src={zoom}
            alt={t('tasksComputer.shot.alt')}
            referrerPolicy="no-referrer"
            className="max-h-full max-w-full rounded-lg shadow-2xl"
          />
          <button
            type="button"
            title={t('tasksComputer.shot.close')}
            className="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            onClick={() => setZoom(null)}
          >
            <X size={18} />
          </button>
        </div>
      )}
    </>
  )
}

/** Botón «Bloquear» con confirmación breve que explica el efecto. Bloquear llama a `denyApp` y la app pasa a «Bloqueadas por ti». */
function BlockButton({ bundleId, name }: { bundleId: string; name: string }): React.JSX.Element {
  const t = useT()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  if (asking) {
    return (
      <div
        role="group"
        aria-label={t('tasksComputer.grants.blockAria', { app: name })}
        className="flex w-full flex-wrap items-center gap-2"
      >
        <span className="min-w-0 flex-1 text-xs text-muted">{t('tasksComputer.grants.blockConfirm', { app: name })}</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void denyApp(bundleId, name).finally(() => {
              setBusy(false)
              setAsking(false)
            })
          }}
          className="rounded-md px-2 py-1 text-xs font-medium text-danger hover:bg-hover disabled:opacity-60"
        >
          {t('tasksComputer.grants.blockYes')}
        </button>
        <button type="button" onClick={() => setAsking(false)} className="rounded-md px-2 py-1 text-xs text-muted hover:bg-hover">
          {t('tasksComputer.grants.blockCancel')}
        </button>
      </div>
    )
  }
  return (
    <button
      type="button"
      aria-label={t('tasksComputer.grants.blockAria', { app: name })}
      onClick={() => setAsking(true)}
      className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-hover hover:text-danger"
    >
      <Ban size={12} /> {t('tasksComputer.grants.block')}
    </button>
  )
}

/** Fila de una app concedida, con selector de nivel, «Quitar permiso» y «Bloquear». */
function GrantRow({ bundleId, name, tier }: { bundleId: string; name: string; tier: AppTier }): React.JSX.Element {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const change = (next: AppTier): void => {
    if (next === tier) return
    setBusy(true)
    void setAppGrant(bundleId, name, next).finally(() => setBusy(false))
  }
  const revoke = (): void => {
    setBusy(true)
    void revokeAppGrant(bundleId).finally(() => setBusy(false))
  }
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
      <div className="min-w-0">
        <div className="font-medium text-fg">{name}</div>
        <div className="truncate text-xs text-muted">{bundleId}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {busy ? (
          <Loader2 size={14} className="animate-spin text-muted" />
        ) : (
          <select
            value={tier}
            aria-label={t('tasksComputer.grants.tierAria', { app: name })}
            onChange={(e) => change(e.target.value as AppTier)}
            className="rounded-md border border-border bg-elevated px-2 py-1 text-xs text-fg"
          >
            <option value="view">{t('tasksComputer.tier.view')}</option>
            <option value="click">{t('tasksComputer.tier.click')}</option>
            <option value="full">{t('tasksComputer.tier.full')}</option>
          </select>
        )}
        <button
          type="button"
          aria-label={t('tasksComputer.grants.revokeAria', { app: name })}
          onClick={revoke}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-hover hover:text-danger"
        >
          <Trash2 size={12} /> {t('tasksComputer.grants.revoke')}
        </button>
        <BlockButton bundleId={bundleId} name={name} />
      </div>
    </li>
  )
}

/** Fila de «Bloqueadas por ti»: nombre legible, clave pequeña debajo y «Quitar» (aria-label con el nombre). */
function DeniedRow({ bundleId, name }: { bundleId: string; name: string }): React.JSX.Element {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const allow = (): void => {
    setBusy(true)
    void undenyApp(bundleId).finally(() => setBusy(false))
  }
  return (
    <li className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
      <div className="min-w-0">
        <div className="truncate font-medium text-fg">{name}</div>
        <div className="truncate text-xs text-muted">{bundleId}</div>
      </div>
      <button
        type="button"
        onClick={allow}
        disabled={busy}
        aria-label={t('tasksComputer.grants.allowAgainAria', { app: name })}
        className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-hover disabled:opacity-60"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} aria-hidden="true" />} {t('tasksComputer.grants.allowAgain')}
      </button>
    </li>
  )
}

/** Fila de una app sugerida para bloquear (sensible, no bloqueada por defecto). */
function SuggestedRow({ app }: { app: LabeledApp }): React.JSX.Element {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
      <div className="min-w-0">
        <div className="font-medium text-fg">{app.name}</div>
        <div className="truncate text-xs text-muted">{app.id}</div>
      </div>
      <BlockButton bundleId={app.id} name={app.name} />
    </li>
  )
}

/**
 * Lista de permisos por app para Ajustes: apps concedidas (con su nivel, editable), «Bloqueadas por ti», sugeridas para bloquear
 * y las bloqueadas por seguridad (solo lectura, sin botón). Se carga sola al montar; se actualiza tras cada cambio y tras
 * responder una tarjeta `request_access` (ver `respondAccessRequest`).
 */
export function ComputerGrantsList(): React.JSX.Element {
  const t = useT()
  const grants = useTasks((s) => s.grants)

  useEffect(() => {
    void loadGrants()
  }, [])

  const info = tierInfo(t)
  const sorted = useMemo(() => [...(grants?.grants ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [grants])
  const denied = grants?.denied ?? []
  const deniedNames = grants?.deniedNames ?? {}
  const win = isWindowsPlatform()
  const fixed = win ? WIN_FIXED_BLOCKED : MAC_FIXED_BLOCKED
  const suggested = (win ? WIN_SUGGESTED_BLOCK : MAC_SUGGESTED_BLOCK).filter(
    (a) =>
      !denied.some((d) => d.toLowerCase() === a.id.toLowerCase()) && !sorted.some((g) => g.bundleId.toLowerCase() === a.id.toLowerCase())
  )

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-fg">{t('tasksComputer.grants.granted')}</h3>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted">
            {t('tasksComputer.grants.empty1')} <code>{'request_access'}</code>
            {t('tasksComputer.grants.empty2')}
          </p>
        ) : (
          <ul className="space-y-2">
            {sorted.map((g) => (
              <GrantRow key={g.bundleId} bundleId={g.bundleId} name={g.name} tier={g.tier} />
            ))}
          </ul>
        )}
      </div>
      {denied.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-fg">{t('tasksComputer.grants.denied')}</h3>
          <ul className="space-y-2">
            {denied.map((bundleId) => (
              <DeniedRow key={bundleId} bundleId={bundleId} name={deniedNames[bundleId] || friendlyAppName(bundleId)} />
            ))}
          </ul>
        </div>
      )}
      {suggested.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-fg">{t('tasksComputer.grants.suggested')}</h3>
          <p className="mb-2 text-xs text-muted">{t('tasksComputer.grants.suggestedHint')}</p>
          <ul className="space-y-2">
            {suggested.map((a) => (
              <SuggestedRow key={a.id} app={a} />
            ))}
          </ul>
        </div>
      )}
      <div data-testid="fixed-blocked">
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-fg">
          <Lock size={13} aria-hidden="true" /> {t('tasksComputer.grants.fixed')}
        </h3>
        <p className="mb-2 text-xs text-muted">{t('tasksComputer.grants.fixedNote')}</p>
        <ul className="flex flex-wrap gap-1.5">
          {fixed.map((a) => (
            <li key={a.id} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted">
              <Lock size={11} aria-hidden="true" /> {labeledAppName(a, t)}
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-muted">
        {t('tasksComputer.grants.levels')} <TierBadge tier="view" /> {info.view.desc} · <TierBadge tier="click" /> {info.click.desc} ·{' '}
        <TierBadge tier="full" /> {info.full.desc}
      </p>
    </div>
  )
}

// `denyApp` se usa desde fuera (p. ej. un botón "Denegar" en una lista de apps detectadas); se
// reexporta el tipo para quien construya esa lista sin duplicar el shape.
export type { AppTier }
export { denyApp }
