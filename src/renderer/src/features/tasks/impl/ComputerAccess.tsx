/**
 * UI del modo "Control total del Mac" de Tareas: selector de modo, diálogo de
 * confirmación, tarjeta de permisos de macOS, aviso de modelo sin visión, banner
 * "Controlando tu Mac", miniaturas de capturas de pantalla, tarjeta de concesión por app
 * (`request_access`) y lista de permisos por app para Ajustes.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Camera,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Keyboard,
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
  X
} from 'lucide-react'
import {
  APP_TIER_RANK,
  defaultAccessDecision,
  type AccessDecision,
  type AccessRequest,
  type AccessRequestApp,
  type AppTier
} from '@shared/ipc-tasks'
import { TASKS_TERMS } from '@shared/tasks-glossary'
import type { ModelRef } from '@shared/types'
import { Button } from '../../../components/Button'
import { useT } from '../../../lib/i18n'
import { errorMessage } from '../../../lib/opencode'
import { useProviders } from '../../../stores/providers'
import { useServer } from '../../../stores/server'
import { useSessions } from '../../../stores/sessions'
import { useModeModel } from '../../settings/impl/extras'
import {
  cancelFullAccess,
  checkComputer,
  denyApp,
  dismissAccessRequest,
  requestComputerPermissions,
  respondAccessRequest,
  resumeComputerControl,
  revokeAppGrant,
  revokePlanApproval,
  setAccessMode,
  setAppGrant,
  stopComputerControl,
  undenyApp
} from './actions'
import { describeAction } from './computer-tools'
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
  let chip: React.JSX.Element
  if (full) {
    chip = (
      <>
        <MonitorCog size={12} /> {TASKS_TERMS.fullControlShort}
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
        <Shield size={12} /> {t('tasksComputer.mode.sandboxOn')}
      </>
    )
  }
  const tone = full
    ? 'border-amber-500/50 bg-amber-500/10 text-amber-700 [[data-theme=dark]_&]:text-amber-400'
    : conn && !conn.sandboxed
      ? 'border-danger/40 text-danger'
      : 'border-accent/40 text-accent'

  const pick = (fullAccess: boolean): void => {
    setOpen(false)
    if (fullAccess === full && phase === 'ready') return
    void setAccessMode(fullAccess)
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled || phase === 'starting'}
        onClick={() => setOpen((o) => !o)}
        title={
          disabled ? t('tasksComputer.access.waitTask') : full ? t('tasksComputer.mode.fullTitle') : t('tasksComputer.mode.sandboxTitle')
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
            title={TASKS_TERMS.sandbox}
            desc={t('tasksComputer.mode.sandboxDesc')}
            onClick={() => pick(false)}
          />
          <ModeOption
            active={full}
            icon={<MonitorCog size={16} className="text-amber-500" />}
            title={TASKS_TERMS.fullControl}
            desc={t('tasksComputer.mode.fullDesc')}
            onClick={() => pick(true)}
          />
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

/** "¿Permitir que el agente controle tu Mac?" */
export function FullAccessDialog(): React.JSX.Element | null {
  const t = useT()
  const folder = useTasks((s) => s.pendingFullAccess)
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
  const name = folder.split('/').filter(Boolean).pop() ?? folder

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
          {t('tasksComputer.full.intro1', { name })}
          <strong className="text-fg">{t('tasksComputer.full.noSandbox')}</strong>
          {t('tasksComputer.full.intro2')}
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
              <kbd className="rounded border border-border bg-hover px-1 font-mono text-xs text-fg">⌘ ⇧ Esc</kbd>.
            </span>
          </li>
        </ul>
        <p className="mt-4 rounded-lg bg-hover px-3 py-2 text-xs text-muted">{t('tasksComputer.full.warn')}</p>
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
        <div className="mb-2 flex items-center gap-2 font-semibold text-amber-700 [[data-theme=dark]_&]:text-amber-400">
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
      <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 [[data-theme=dark]_&]:text-amber-300">
        <Eye size={14} className="shrink-0" />
        <span className="min-w-0 flex-1">
          <strong>{current.name}</strong>
          {t('tasksComputer.vision.text')}
        </span>
        {!isVision && visionAvailable && (
          <button
            type="button"
            onClick={() => setTaskModel(VISION_MODEL)}
            className="shrink-0 rounded-md bg-amber-700 px-2 py-1 font-medium text-white hover:opacity-90"
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
      (id) => s.status[id] !== 'idle' && s.sessions[id]?.directory === folder && isTasksSource(s.sessionSource[id])
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
    return (
      <>
        <div className="flex shrink-0 items-center gap-2.5 border-b border-amber-600/40 bg-amber-500/10 px-4 py-1.5 text-amber-800 [[data-theme=dark]_&]:text-amber-300">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
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
  if (!anyBusy)
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
      <div className="flex shrink-0 items-center gap-3 border-b border-red-700/50 bg-gradient-to-r from-red-600 to-amber-600 px-4 py-2 text-white shadow-sm">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{t('tasksComputer.banner.controlling')}</div>
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
          <span className="hidden items-center gap-1 text-[11px] text-white/85 md:flex" title={t('tasksComputer.banner.shortcutOff')}>
            <ShieldAlert size={12} /> {t('tasksComputer.banner.shortcutNA')}
          </span>
        ) : (
          <span className="hidden items-center gap-1 text-[11px] text-white/75 md:flex">
            <Keyboard size={12} /> ⌘⇧Esc
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

// ───────────────────────────── Concesión por app ─────────────────────────────

type T = ReturnType<typeof useT>

function tierInfo(t: T): Record<AppTier, { label: string; icon: React.ReactNode; desc: string }> {
  return {
    view: { label: t('tasksComputer.tier.view'), icon: <Eye size={13} />, desc: t('tasksComputer.tier.viewDesc') },
    click: { label: t('tasksComputer.tier.click'), icon: <MousePointerClick size={13} />, desc: t('tasksComputer.tier.clickDesc') },
    full: { label: t('tasksComputer.tier.full'), icon: <MonitorCog size={13} />, desc: t('tasksComputer.tier.fullDesc') }
  }
}

/** Insignia compacta con el nivel concedido a una app. */
function TierBadge({ tier }: { tier: AppTier }): React.JSX.Element {
  const info = tierInfo(useT())[tier]
  const tone =
    tier === 'full'
      ? 'border-amber-500/50 bg-amber-500/10 text-amber-700 [[data-theme=dark]_&]:text-amber-400'
      : tier === 'click'
        ? 'border-accent/40 bg-accent/10 text-accent'
        : 'border-border bg-hover text-muted'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}>
      {info.icon} {info.label}
    </span>
  )
}

/** Opciones del selector segmentado de nivel (incluye "Denegar"), en orden de menos a más acceso. */
function tierSegmentOptions(t: T): Array<{ v: AccessDecision; label: string; icon: React.ReactNode; title: string }> {
  return [
    { v: 'deny', label: t('tasksComputer.tier.deny'), icon: <X size={12} />, title: t('tasksComputer.tier.denyTitle') },
    { v: 'view', label: t('tasksComputer.tier.view'), icon: <Eye size={12} />, title: t('tasksComputer.tier.viewDesc') },
    { v: 'click', label: t('tasksComputer.tier.click'), icon: <MousePointerClick size={12} />, title: t('tasksComputer.tier.clickDesc') },
    { v: 'full', label: t('tasksComputer.tier.full'), icon: <MonitorCog size={12} />, title: t('tasksComputer.tier.fullDesc') }
  ]
}

/** Selector de nivel (o "Denegar") por app, en forma de control segmentado (como `AccessSegmented`). */
function TierSegmented({ value, onChange }: { value: AccessDecision; onChange: (v: AccessDecision) => void }): React.JSX.Element {
  const t = useT()
  return (
    <div
      role="radiogroup"
      aria-label={t('tasksComputer.tier.aria')}
      className="inline-flex shrink-0 flex-wrap items-center gap-0.5 rounded-full border border-border bg-hover/60 p-0.5"
    >
      {tierSegmentOptions(t).map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          title={o.title}
          onClick={() => onChange(o.v)}
          className={`flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium transition ${
            value === o.v ? (o.v === 'deny' ? 'bg-danger/15 text-danger' : 'bg-elevated text-accent shadow-sm') : 'text-muted hover:text-fg'
          }`}
        >
          {o.icon} {o.label}
        </button>
      ))}
    </div>
  )
}

/** Línea "Solicita: X · Actual: Y · Denegada antes" de una app de la tarjeta (con la insignia de nivel). */
function AppAccessMeta({ app, choice }: { app: AccessRequestApp; choice: AccessDecision }): React.JSX.Element {
  const t = useT()
  const requested = app.requested ?? 'click'
  // La tarjeta nunca baja un nivel ya concedido (main aplica el máximo): se avisa si la elección queda por debajo.
  const keeps = app.current && choice !== 'deny' && APP_TIER_RANK[choice] < APP_TIER_RANK[app.current] ? app.current : null
  return (
    <div className="flex basis-full flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      <span className="flex items-center gap-1.5">
        {t('tasksComputer.meta.requests')} <TierBadge tier={requested} />
      </span>
      <span className="flex items-center gap-1.5">
        {t('tasksComputer.meta.current')}{' '}
        {app.current ? <TierBadge tier={app.current} /> : <span className="text-subtle">{t('tasksComputer.meta.none')}</span>}
      </span>
      {app.denied && <span className="text-danger">{t('tasksComputer.meta.deniedBefore')}</span>}
      {keeps && <span>{t('tasksComputer.meta.keeps', { tier: tierInfo(t)[keeps].label })}</span>}
    </div>
  )
}

/**
 * Tarjeta "Plan y permisos" / "¿Permitir que el agente use X?" (herramienta MCP `request_access`):
 * lugar PRINCIPAL en la ventana de OnyxCode — una tarjeta EN LA CONVERSACIÓN, fija sobre el
 * compositor (igual que `ApprovalBar`), no un modal centrado que tape el resto de la tarea. La
 * píldora flotante (`overlay/pill.ts`) es el otro lugar donde responder. El usuario elige el nivel
 * (o deniega) por app, o escribe feedback para que el agente replantee el plan. La espera NO tiene
 * límite de tiempo: solo Detener resuelve sin respuesta explícita.
 *
 * Nunca escala ni baja en silencio: se preselecciona `defaultAccessDecision` (lo que declara el agente,
 * sin bajar de lo ya concedido); Cancelar/Esc = `cancel` (no toca ninguna concesión) y solo el
 * "Denegar" explícito por app (o "Denegar todo" en tarjetas sin plan) deniega.
 */
/**
 * Tarjeta "¿Tomar el control de la pantalla?" (`kind === 'takeover'`, herramienta MCP
 * `request_full_control`): el agente trabajaba en segundo plano (por Accessibility API, sin mover
 * el ratón) y necesita el ratón y el teclado reales para esa app concreta. Sin plan ni selector de
 * nivel por app (el nivel pedido es siempre "Control total"): solo dos botones binarios.
 * "Seguir en segundo plano" no toca ninguna concesión (`cancel: true`); "Permitir" aprueba sin
 * decisiones por app (`approvePlan: true, decisions: []`) — la app ya tiene su nivel concedido por
 * la tarjeta de acceso previa; esto solo entrega el control de la pantalla para la tarea.
 */
function TakeoverAccessCard({ req }: { req: AccessRequest }): React.JSX.Element {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const appName = req.apps[0]?.name ?? t('tasksComputer.takeover.anApp')

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') dismissAccessRequest()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const decline = (): void => {
    setBusy(true)
    void respondAccessRequest([], { cancel: true }).finally(() => setBusy(false))
  }
  const allow = (): void => {
    setBusy(true)
    void respondAccessRequest([], { approvePlan: true }).finally(() => setBusy(false))
  }

  return (
    <div className="mx-auto mb-2 w-full max-w-3xl px-6">
      <div
        role="alertdialog"
        aria-labelledby="tasks-takeover-title"
        className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4 shadow-sm"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-700 [[data-theme=dark]_&]:text-amber-400">
            <MonitorCog size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 id="tasks-takeover-title" className="text-sm font-semibold text-fg">
              {t('tasksComputer.takeover.title')}
            </h3>
            <p className="mt-1 text-sm text-muted">
              {t('tasksComputer.takeover.text1')}
              <strong className="text-fg">{appName}</strong>
              {t('tasksComputer.takeover.text2')}
            </p>
            {req.reason && <p className="mt-1 text-xs text-muted italic">«{req.reason}»</p>}
            <p className="mt-2.5 text-xs text-muted">{t('tasksComputer.noTimeout')}</p>
            <div className="mt-3.5 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={decline} disabled={busy}>
                {t('tasksComputer.takeover.background')}
              </Button>
              <Button variant="primary" onClick={allow} disabled={busy}>
                {busy && <Loader2 size={14} className="animate-spin" />} {t('tasksComputer.confirm.allow')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function PlanAccessCard(): React.JSX.Element | null {
  const t = useT()
  const req = useTasks((s) => s.accessRequest)
  const [choices, setChoices] = useState<Record<string, AccessDecision>>({})
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [feedback, setFeedback] = useState('')

  useEffect(() => {
    if (!req) return
    setChoices(Object.fromEntries(req.apps.map((a) => [a.bundleId, defaultAccessDecision(a)])))
    setEditing(false)
    setFeedback('')
  }, [req])

  useEffect(() => {
    if (!req) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') dismissAccessRequest()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [req])

  if (!req) return null
  if (req.kind === 'takeover') return <TakeoverAccessCard req={req} />

  const hasApps = req.apps.length > 0
  const decisionFor = (a: AccessRequestApp): AccessDecision => choices[a.bundleId] ?? defaultAccessDecision(a)

  const confirm = (): void => {
    setBusy(true)
    void respondAccessRequest(
      req.apps.map((a) => ({ bundleId: a.bundleId, name: a.name, decision: decisionFor(a) })),
      { approvePlan: !!req.plan }
    ).finally(() => setBusy(false))
  }

  /** "Denegar todo" (solo tarjetas sin plan): denegación explícita de cada app. */
  const denyAll = (): void => {
    setBusy(true)
    void respondAccessRequest(req.apps.map((a) => ({ bundleId: a.bundleId, name: a.name, decision: 'deny' as const }))).finally(() =>
      setBusy(false)
    )
  }

  const sendFeedback = (): void => {
    const text = feedback.trim()
    if (!text) return
    setBusy(true)
    // El feedback no concede ni deniega nada: no se envía ninguna decisión.
    void respondAccessRequest([], { feedback: text }).finally(() => setBusy(false))
  }

  const title = req.plan
    ? hasApps
      ? t('tasksComputer.plan.titlePlan')
      : t('tasksComputer.plan.titleTask')
    : req.apps.length === 1
      ? t('tasksComputer.plan.titleOne', { name: req.apps[0]?.name ?? '' })
      : t('tasksComputer.plan.titleMany')

  return (
    <div className="mx-auto mb-2 w-full max-w-3xl px-6">
      <div
        role="alertdialog"
        aria-labelledby="tasks-plan-access-title"
        className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4 shadow-sm"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-700 [[data-theme=dark]_&]:text-amber-400">
            <ShieldAlert size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 id="tasks-plan-access-title" className="text-sm font-semibold text-fg">
              {title}
            </h3>
            {req.reason && <p className="mt-0.5 text-sm text-muted">«{req.reason}»</p>}
            {req.plan && req.plan.length > 0 && (
              <ol className="mt-2.5 list-decimal space-y-1 rounded-lg border border-border bg-hover/60 px-4 py-2.5 pl-8 text-sm text-fg">
                {req.plan.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            )}
            {!hasApps && <p className="mt-2.5 text-xs text-muted">{t('tasksComputer.plan.noApps')}</p>}
            {req.unresolved && req.unresolved.length > 0 && (
              <p className="mt-2.5 text-xs text-warning">{t('tasksComputer.plan.notFound', { list: req.unresolved.join(', ') })}</p>
            )}
            {hasApps && (
              <ul className="mt-3 space-y-2">
                {req.apps.map((a) => (
                  <li
                    key={a.bundleId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-elevated/60 px-3 py-2"
                  >
                    <span className="min-w-0 truncate text-sm font-medium text-fg" title={a.bundleId}>
                      {a.name}
                    </span>
                    <TierSegmented value={decisionFor(a)} onChange={(v) => setChoices((c) => ({ ...c, [a.bundleId]: v }))} />
                    <AppAccessMeta app={a} choice={decisionFor(a)} />
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2.5 text-xs text-muted">
              {t('tasksComputer.noTimeout')}
              {hasApps && ` ${t('tasksComputer.plan.neverLowers')}`}
            </p>
            {editing ? (
              <div className="mt-3">
                <label htmlFor="tasks-access-feedback" className="mb-1 block text-xs font-medium text-muted">
                  {t('tasksComputer.plan.feedbackLabel')}
                </label>
                <textarea
                  id="tasks-access-feedback"
                  autoFocus
                  rows={2}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder={t('tasksComputer.plan.feedbackPlaceholder')}
                  className="w-full resize-none rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                />
                <div className="mt-2.5 flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
                    {t('tasksComputer.plan.back')}
                  </Button>
                  <Button variant="primary" onClick={sendFeedback} disabled={busy || !feedback.trim()}>
                    {busy && <Loader2 size={14} className="animate-spin" />} {t('tasksComputer.plan.sendChanges')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-3.5 flex flex-wrap justify-end gap-2">
                {req.plan ? (
                  <Button variant="ghost" onClick={dismissAccessRequest} disabled={busy} title={t('tasksComputer.plan.cancelTitle')}>
                    {t('tasksComputer.cancel')}
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={denyAll} disabled={busy}>
                    {t('tasksComputer.plan.denyAll')}
                  </Button>
                )}
                {req.plan && (
                  <Button variant="secondary" onClick={() => setEditing(true)} disabled={busy}>
                    {t('tasksComputer.plan.edit')}
                  </Button>
                )}
                <Button variant="primary" onClick={confirm} disabled={busy}>
                  {busy && <Loader2 size={14} className="animate-spin" />}{' '}
                  {req.plan ? t('tasksComputer.plan.approve') : t('tasksComputer.plan.confirm')}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Fila de una app concedida, con selector de nivel y botón para revocar. */
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
      <div className="flex items-center gap-2">
        {busy ? (
          <Loader2 size={14} className="animate-spin text-muted" />
        ) : (
          <select
            value={tier}
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
          title={t('tasksComputer.grants.revoke')}
          onClick={revoke}
          className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-danger"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </li>
  )
}

/** Fila de una app denegada, con botón para volver a permitirla (pasa a "sin decidir"). */
function DeniedRow({ bundleId }: { bundleId: string }): React.JSX.Element {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const allow = (): void => {
    setBusy(true)
    void undenyApp(bundleId).finally(() => setBusy(false))
  }
  return (
    <li className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
      <span className="truncate text-muted">{bundleId}</span>
      <button
        type="button"
        onClick={allow}
        disabled={busy}
        className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-hover disabled:opacity-60"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <EyeOff size={12} />} {t('tasksComputer.grants.allowAgain')}
      </button>
    </li>
  )
}

/**
 * Lista de permisos por app para Ajustes: apps concedidas (con su nivel, editable) y apps
 * denegadas. Se carga sola al montar; se actualiza tras cada cambio y tras responder una tarjeta
 * `request_access` (ver `respondAccessRequest`).
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
              <DeniedRow key={bundleId} bundleId={bundleId} />
            ))}
          </ul>
        </div>
      )}
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
