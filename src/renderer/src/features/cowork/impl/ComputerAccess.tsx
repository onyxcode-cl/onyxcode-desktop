/**
 * UI del modo "Acceso total + control del Mac" de Cowork: selector de modo, diálogo de
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
import type { AccessDecision, AppTier } from '@shared/ipc-cowork'
import type { ModelRef } from '@shared/types'
import { Button } from '../../../components/Button'
import { errorMessage } from '../../../lib/opencode'
import { useProviders } from '../../../stores/providers'
import { useServer } from '../../../stores/server'
import { useSessions } from '../../../stores/sessions'
import { useSettings } from '../../../stores/settings'
import {
  cancelFullAccess,
  checkComputer,
  denyApp,
  dismissAccessRequest,
  requestComputerPermissions,
  respondAccessRequest,
  resumeComputerControl,
  revokeAppGrant,
  setAccessMode,
  setAppGrant,
  stopComputerControl,
  undenyApp
} from './actions'
import { describeAction } from './computer-tools'
import { loadGrants, useCowork } from './store'

export const VISION_MODEL: ModelRef = { providerID: 'opencode-go', modelID: 'kimi-k3' }

// ───────────────────────────── Selector de modo ─────────────────────────────

/** Chip del header con el modo de acceso de la carpeta (Sandbox / Acceso total). */
export function AccessModeSwitch({ disabled }: { disabled?: boolean }): React.JSX.Element | null {
  const conn = useCowork((s) => s.conn)
  const phase = useCowork((s) => s.phase)
  const requested = useCowork((s) => s.fullAccess)
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
        <MonitorCog size={12} /> Acceso total
      </>
    )
  } else if (conn && !conn.sandboxed) {
    chip = (
      <>
        <ShieldOff size={12} /> Sin sandbox
      </>
    )
  } else {
    chip = (
      <>
        <Shield size={12} /> Sandbox activo
      </>
    )
  }
  const tone = full
    ? 'border-amber-500/50 bg-amber-500/10 text-amber-600 [[data-theme=dark]_&]:text-amber-400'
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
          disabled
            ? 'Espera a que termine la tarea para cambiar el modo de acceso'
            : full
              ? 'Sin sandbox: el agente puede controlar el Mac y modificar archivos en cualquier lugar'
              : 'Escrituras limitadas a esta carpeta (sandbox-exec)'
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
            title="Sandbox"
            desc="Lee y escribe solo dentro de esta carpeta. Recomendado."
            onClick={() => pick(false)}
          />
          <ModeOption
            active={full}
            icon={<MonitorCog size={16} className="text-amber-500" />}
            title="Acceso total + control del Mac"
            desc="Sin sandbox. Puede mover el ratón, escribir, tomar capturas y modificar archivos en cualquier lugar."
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
  const folder = useCowork((s) => s.pendingFullAccess)
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
        aria-labelledby="cowork-fullaccess-title"
        className="w-full max-w-lg rounded-2xl border border-border bg-elevated p-6 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/15 text-amber-500">
          <ShieldAlert size={22} />
        </div>
        <h2 id="cowork-fullaccess-title" className="text-lg font-semibold">
          ¿Permitir que el agente controle tu Mac?
        </h2>
        <p className="mt-1 text-sm text-muted">
          Las tareas de «{name}» se ejecutarán <strong className="text-fg">sin sandbox</strong> y con control del
          computador.
        </p>
        <ul className="mt-4 space-y-2.5 text-sm text-muted">
          <li className="flex gap-2.5">
            <MousePointerClick size={16} className="mt-0.5 shrink-0 text-amber-500" />
            Podrá mover el ratón, hacer clic, escribir y pulsar teclas en cualquier aplicación.
          </li>
          <li className="flex gap-2.5">
            <Camera size={16} className="mt-0.5 shrink-0 text-amber-500" />
            Tomará capturas de pantalla, que <strong className="text-fg">se envían al proveedor del modelo</strong>.
            Cierra o oculta lo que no quieras compartir.
          </li>
          <li className="flex gap-2.5">
            <ShieldOff size={16} className="mt-0.5 shrink-0 text-amber-500" />
            Podrá crear, modificar y borrar archivos y ejecutar comandos en cualquier lugar de tu Mac, no solo en esta
            carpeta.
          </li>
          <li className="flex gap-2.5">
            <OctagonX size={16} className="mt-0.5 shrink-0 text-danger" />
            <span>
              Para detenerlo en cualquier momento pulsa <strong className="text-fg">Detener</strong> o el atajo{' '}
              <kbd className="rounded border border-border bg-hover px-1 font-mono text-xs text-fg">⌘ ⇧ Esc</kbd>.
            </span>
          </li>
        </ul>
        <p className="mt-4 rounded-lg bg-hover px-3 py-2 text-xs text-muted">
          Úsalo solo con tareas y sitios de confianza: el contenido de la pantalla (webs, correos…) podría intentar
          engañar al agente.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={cancelFullAccess} autoFocus>
            Cancelar
          </Button>
          <Button
            variant="primary"
            className="!bg-amber-600 !text-white"
            onClick={confirm}
            disabled={busy}
          >
            {busy && <Loader2 size={14} className="animate-spin" />} Permitir control
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
      {ok ? (
        <Check size={15} className="mt-0.5 shrink-0 text-accent" />
      ) : (
        <X size={15} className="mt-0.5 shrink-0 text-danger" />
      )}
      <span>
        <span className={ok ? 'text-muted' : 'font-medium text-fg'}>{label}</span>
        {!ok && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </li>
  )
}

/** Tarjeta con los permisos que faltan (Accesibilidad / Grabación de pantalla / helper). */
export function ComputerPermissionsCard(): React.JSX.Element | null {
  const conn = useCowork((s) => s.conn)
  const status = useCowork((s) => s.computerStatus)
  const checking = useCowork((s) => s.computerChecking)
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
          <ShieldAlert size={16} /> Faltan permisos para controlar el Mac
        </div>
        <ul className="space-y-1.5">
          <PermRow
            ok={helperOk}
            label="Helper nativo de control"
            hint={conn.computerUse?.reason ?? 'No se encontró el helper de ratón/teclado o no se pudo iniciar.'}
          />
          <PermRow
            ok={accessibility}
            label="Accesibilidad"
            hint="Necesario para mover el ratón, hacer clic y escribir."
          />
          <PermRow
            ok={screenRecording}
            label="Grabación de pantalla"
            hint="Necesario para tomar capturas. macOS puede pedir reiniciar la app tras concederlo."
          />
        </ul>
        <p className="mt-3 text-xs text-muted">
          Actívalos en Ajustes del Sistema › Privacidad y seguridad. En desarrollo el permiso se concede a la app desde la
          que ejecutas <code>npm run dev</code> (<strong className="text-fg">Terminal, iTerm o VS Code</strong>); en la app
          empaquetada, a la propia app. Tras concederlo, reinicia la app.
        </p>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" onClick={request}>
            <ShieldAlert size={14} /> Conceder permisos
          </Button>
          <Button variant="secondary" onClick={() => void checkComputer()} disabled={checking}>
            {checking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Volver a comprobar
          </Button>
        </div>
      </div>
    </div>
  )
}

// ───────────────────────────── Modelo con visión ─────────────────────────────

/** Aviso si el modelo elegido no acepta imágenes (necesario para ver las capturas). */
export function VisionModelHint(): React.JSX.Element | null {
  const full = useCowork((s) => s.conn?.fullAccess === true)
  const model = useSettings((s) => s.settings.defaultModel)
  const update = useSettings((s) => s.update)
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
          <strong>{current.name}</strong> no acepta imágenes: no podrá ver las capturas de pantalla. El control del Mac
          necesita un modelo con visión.
        </span>
        {!isVision && visionAvailable && (
          <button
            type="button"
            onClick={() => void update({ defaultModel: VISION_MODEL })}
            className="shrink-0 rounded-md bg-amber-600 px-2 py-1 font-medium text-white hover:opacity-90"
          >
            Usar Kimi K3
          </button>
        )}
      </div>
    </div>
  )
}

// ───────────────────────────── Banner "Controlando tu Mac" ─────────────────────────────

/** Barra visible mientras una tarea con acceso total está trabajando, con botón Detener. */
export function ControlBanner(): React.JSX.Element | null {
  const conn = useCowork((s) => s.conn)
  const folder = useCowork((s) => s.folder)
  const lastAction = useCowork((s) => s.lastAction)
  const stoppedAt = useCowork((s) => s.controlStoppedAt)
  const shortcutUnavailable = useCowork((s) => s.shortcutUnavailable)
  const accessRequest = useCowork((s) => s.accessRequest)
  const anyBusy = useSessions((s) =>
    Object.keys(s.status).some((id) => s.status[id] !== 'idle' && s.sessions[id]?.directory === folder)
  )
  const [stopping, setStopping] = useState(false)
  const [resuming, setResuming] = useState(false)
  const [resumeError, setResumeError] = useState<string | null>(null)
  const [, tick] = useState(0)

  // Refresca el "hace Xs" de la última acción.
  useEffect(() => {
    if (!anyBusy) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [anyBusy])

  if (!conn?.fullAccess) return null

  const shortcutWarning = shortcutUnavailable ? (
    <div className="flex shrink-0 items-center gap-2 border-b border-warning/40 bg-warning/10 px-4 py-1.5 text-xs text-warning">
      <ShieldAlert size={14} /> El atajo ⌘⇧Esc no está disponible; usa el botón Detener
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
          <OctagonX size={16} className="shrink-0" /> Control detenido
          {anyBusy && <Loader2 size={14} className="animate-spin" />}
          <span className="min-w-0 flex-1 truncate text-xs font-normal text-muted">
            {resumeError ??
              (anyBusy
                ? 'Cancelando la tarea…'
                : 'El agente no puede usar el ratón ni el teclado hasta que reanudes el control.')}
          </span>
          <button
            type="button"
            onClick={resume}
            disabled={resuming || anyBusy}
            className="no-drag flex shrink-0 items-center gap-1.5 rounded-lg border border-danger/40 bg-elevated px-3 py-1 text-xs font-semibold text-fg hover:bg-danger/10 disabled:opacity-60"
          >
            {resuming ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Reanudar control
          </button>
        </div>
        {shortcutWarning}
      </>
    )
  }
  // Esperando que el usuario responda una tarjeta `request_access` (sin límite de tiempo): pausa,
  // no error. El botón Detener sigue disponible por si el usuario prefiere cancelar del todo.
  if (accessRequest) {
    const stop = (): void => {
      setStopping(true)
      void stopComputerControl().finally(() => setStopping(false))
    }
    return (
      <>
        <div className="flex shrink-0 items-center gap-3 border-b border-amber-600/40 bg-amber-500/10 px-4 py-2 text-amber-800 [[data-theme=dark]_&]:text-amber-300">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Esperando tu permiso</div>
            <div className="truncate text-xs opacity-80">
              {accessRequest.plan ? 'Revisa el plan y las apps' : 'El agente necesita acceso a una app extra'} — sin límite
              de tiempo, no se cancela sola.
            </div>
          </div>
          <button
            type="button"
            onClick={stop}
            disabled={stopping}
            className="no-drag flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-600/40 bg-elevated px-3 py-1.5 text-xs font-semibold text-fg hover:bg-amber-500/10 disabled:opacity-70"
          >
            {stopping ? <Loader2 size={13} className="animate-spin" /> : <Square size={12} fill="currentColor" />} Detener
          </button>
        </div>
        {shortcutWarning}
      </>
    )
  }
  if (!anyBusy) return shortcutWarning

  const ago = lastAction ? Math.max(0, Math.round((Date.now() - lastAction.at) / 1000)) : null
  const stop = (): void => {
    setStopping(true)
    void stopComputerControl().finally(() => setStopping(false))
  }

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-red-700/50 bg-gradient-to-r from-red-600 to-amber-600 px-4 py-2 text-white shadow-sm">
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">Controlando tu Mac</div>
        <div className="truncate text-xs text-white/85">
          {lastAction ? (
            <>
              {describeAction(lastAction)}
              {ago !== null && ago > 1 && <span className="text-white/60"> · hace {ago}s</span>}
            </>
          ) : (
            'Esperando la primera acción…'
          )}
        </div>
      </div>
      {shortcutUnavailable ? (
        <span className="hidden items-center gap-1 text-[11px] text-white/85 md:flex" title="El atajo ⌘⇧Esc no está disponible; usa el botón Detener">
          <ShieldAlert size={12} /> ⌘⇧Esc no disponible
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
        {stopping ? <Loader2 size={15} className="animate-spin" /> : <Square size={14} fill="currentColor" />} Detener
      </button>
    </div>
  )
}

// ───────────────────────────── Capturas ─────────────────────────────

/** Miniaturas de capturas (clic para ampliar). Las URLs deben venir de `safeImageUrl`. */
export function ScreenshotThumbs({ images }: { images: Array<{ id: string; url: string; name: string }> }): React.JSX.Element | null {
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
            title="Ampliar captura"
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
            alt="Captura de pantalla"
            referrerPolicy="no-referrer"
            className="max-h-full max-w-full rounded-lg shadow-2xl"
          />
          <button
            type="button"
            title="Cerrar"
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

const TIER_INFO: Record<AppTier, { label: string; icon: React.ReactNode; desc: string }> = {
  view: { label: 'Solo ver', icon: <Eye size={13} />, desc: 'Aparece en las capturas; ninguna acción de ratón ni teclado.' },
  click: { label: 'Ver y clic', icon: <MousePointerClick size={13} />, desc: 'Clic y scroll; nada de teclear, teclas ni arrastrar.' },
  full: { label: 'Control total', icon: <MonitorCog size={13} />, desc: 'Todo, incluida la escritura.' }
}

/** Insignia compacta con el nivel concedido a una app. */
function TierBadge({ tier }: { tier: AppTier }): React.JSX.Element {
  const tone =
    tier === 'full'
      ? 'border-amber-500/50 bg-amber-500/10 text-amber-600 [[data-theme=dark]_&]:text-amber-400'
      : tier === 'click'
        ? 'border-accent/40 bg-accent/10 text-accent'
        : 'border-border bg-hover text-muted'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}>
      {TIER_INFO[tier].icon} {TIER_INFO[tier].label}
    </span>
  )
}

/** Selector de nivel (o "Denegar") para una app dentro de la tarjeta de `request_access`. */
function TierPicker({ value, onChange }: { value: AccessDecision; onChange: (v: AccessDecision) => void }): React.JSX.Element {
  const options: Array<{ v: AccessDecision; label: string }> = [
    { v: 'view', label: 'Solo ver' },
    { v: 'click', label: 'Ver y clic' },
    { v: 'full', label: 'Control total' },
    { v: 'deny', label: 'Denegar' }
  ]
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
            value === o.v
              ? o.v === 'deny'
                ? 'border-danger/50 bg-danger/10 text-danger'
                : 'border-accent bg-accent/15 text-accent'
              : 'border-border text-muted hover:bg-hover'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Tarjeta "Plan y permisos" / "¿Permitir que el agente use X?" (herramienta MCP `request_access`):
 * lugar SECUNDARIO (el primario es la píldora, ver `overlay/pill.ts`) para responder — útil cuando
 * el usuario ya tiene Lapis al frente, o para "Editar" con más espacio para escribir. El usuario
 * elige el nivel (o deniega) por app, o escribe feedback para que el agente replantee el plan. La
 * espera NO tiene límite de tiempo: solo Detener resuelve sin respuesta explícita.
 */
export function AccessRequestDialog(): React.JSX.Element | null {
  const req = useCowork((s) => s.accessRequest)
  const [choices, setChoices] = useState<Record<string, AccessDecision>>({})
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [feedback, setFeedback] = useState('')

  useEffect(() => {
    if (!req) return
    setChoices(Object.fromEntries(req.apps.map((a) => [a.bundleId, 'click' as AccessDecision])))
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

  const confirm = (): void => {
    setBusy(true)
    void respondAccessRequest(req.apps.map((a) => ({ bundleId: a.bundleId, name: a.name, decision: choices[a.bundleId] ?? 'deny' }))).finally(() =>
      setBusy(false)
    )
  }

  const sendFeedback = (): void => {
    const text = feedback.trim()
    if (!text) return
    setBusy(true)
    void respondAccessRequest(
      req.apps.map((a) => ({ bundleId: a.bundleId, name: a.name, decision: 'deny' as const })),
      text
    ).finally(() => setBusy(false))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onMouseDown={dismissAccessRequest}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cowork-access-request-title"
        className="w-full max-w-lg rounded-2xl border border-border bg-elevated p-6 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-accent/15 text-accent">
          <ShieldAlert size={22} />
        </div>
        <h2 id="cowork-access-request-title" className="text-lg font-semibold">
          {req.plan
            ? 'Plan y permisos'
            : req.apps.length === 1
              ? `¿Permitir que el agente use ${req.apps[0]?.name}?`
              : '¿Permitir que el agente use estas apps?'}
        </h2>
        {req.reason && <p className="mt-1 text-sm text-muted">«{req.reason}»</p>}
        {req.plan && req.plan.length > 0 && (
          <ol className="mt-3 list-decimal space-y-1 rounded-lg border border-border bg-hover px-4 py-2.5 pl-8 text-sm text-fg">
            {req.plan.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        )}
        <ul className="mt-4 space-y-3">
          {req.apps.map((a) => (
            <li key={a.bundleId} className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="font-medium text-fg">{a.name}</span>
                <span className="truncate text-xs text-muted">{a.bundleId}</span>
              </div>
              <TierPicker value={choices[a.bundleId] ?? 'click'} onChange={(v) => setChoices((c) => ({ ...c, [a.bundleId]: v }))} />
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">
          Puedes cambiar el nivel de cada app cuando quieras desde Ajustes. La espera no tiene límite de tiempo: la
          tarea queda en pausa hasta que respondas.
        </p>
        {editing ? (
          <div className="mt-4">
            <label htmlFor="cowork-access-feedback" className="mb-1 block text-xs font-medium text-muted">
              Qué quieres que cambie del plan
            </label>
            <textarea
              id="cowork-access-feedback"
              autoFocus
              rows={3}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="p.ej. «No abras el navegador, solo necesito Discord»"
              className="w-full resize-none rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-fg outline-none focus:border-accent"
            />
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
                Volver
              </Button>
              <Button variant="primary" onClick={sendFeedback} disabled={busy || !feedback.trim()}>
                {busy && <Loader2 size={14} className="animate-spin" />} Enviar cambios
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={dismissAccessRequest} autoFocus disabled={busy}>
              {req.plan ? 'Cancelar' : 'Denegar todo'}
            </Button>
            {req.plan && (
              <Button variant="secondary" onClick={() => setEditing(true)} disabled={busy}>
                Editar
              </Button>
            )}
            <Button variant="primary" onClick={confirm} disabled={busy}>
              {busy && <Loader2 size={14} className="animate-spin" />} {req.plan ? 'Aprobar y empezar' : 'Confirmar'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

/** Fila de una app concedida, con selector de nivel y botón para revocar. */
function GrantRow({ bundleId, name, tier }: { bundleId: string; name: string; tier: AppTier }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const change = (t: AppTier): void => {
    if (t === tier) return
    setBusy(true)
    void setAppGrant(bundleId, name, t).finally(() => setBusy(false))
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
            <option value="view">Solo ver</option>
            <option value="click">Ver y clic</option>
            <option value="full">Control total</option>
          </select>
        )}
        <button type="button" title="Quitar concesión" onClick={revoke} className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-danger">
          <Trash2 size={14} />
        </button>
      </div>
    </li>
  )
}

/** Fila de una app denegada, con botón para volver a permitirla (pasa a "sin decidir"). */
function DeniedRow({ bundleId }: { bundleId: string }): React.JSX.Element {
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
        {busy ? <Loader2 size={12} className="animate-spin" /> : <EyeOff size={12} />} Permitir de nuevo
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
  const grants = useCowork((s) => s.grants)

  useEffect(() => {
    void loadGrants()
  }, [])

  const sorted = useMemo(() => [...(grants?.grants ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [grants])
  const denied = grants?.denied ?? []

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-fg">Apps con acceso concedido</h3>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted">
            Ninguna todavía. Se conceden al pedirlo el agente (herramienta <code>request_access</code>) o al abrir un
            navegador/terminal reconocido por primera vez.
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
          <h3 className="mb-2 text-sm font-semibold text-fg">Apps denegadas</h3>
          <ul className="space-y-2">
            {denied.map((bundleId) => (
              <DeniedRow key={bundleId} bundleId={bundleId} />
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-muted">
        Niveles: <TierBadge tier="view" /> {TIER_INFO.view.desc} · <TierBadge tier="click" /> {TIER_INFO.click.desc} ·{' '}
        <TierBadge tier="full" /> {TIER_INFO.full.desc}
      </p>
    </div>
  )
}

// `denyApp` se usa desde fuera (p. ej. un botón "Denegar" en una lista de apps detectadas); se
// reexporta el tipo para quien construya esa lista sin duplicar el shape.
export type { AppTier }
export { denyApp }
