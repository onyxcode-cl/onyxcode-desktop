/**
 * Tarjetas de concesión por app (herramientas MCP `request_access` y `request_full_control`):
 *  - `AppPermissionCard`: «¿Permitir que Lazunox use {App}?» — motivo del agente, avisos, una fila por app con su
 *    nivel (se puede bajar), «Cancelar» (Esc), «Denegar», «Permitir para esta sesión» (⌘↵ / Ctrl+↵) y «Bloquear siempre» por app.
 *  - `PlanDetailCard`: tarjeta con plan de la tarea (y/o sin apps).
 *  - `TakeoverAccessCard`: «¿Tomar el control de la pantalla?».
 * Aprobar nunca baja un nivel ya concedido (main aplica el máximo) y Esc nunca concede ni deniega (cancela).
 */
import { useEffect, useRef, useState } from 'react'
import { isRemoteClientApp } from '@shared/remote-clients'
import { Ban, Check, ChevronDown, Eye, ListChecks, Loader2, MonitorCog, MousePointerClick, X } from 'lucide-react'
import {
  APP_TIER_RANK,
  defaultAccessDecision,
  type AccessDecision,
  type AccessRequest,
  type AccessRequestApp,
  type AppTier
} from '@shared/ipc-tasks'
import { isSafeIconDataUrl } from '@shared/app-icon'
import { Button } from '../../../components/Button'
import { useT } from '../../../lib/i18n'
import { isMacPlatform, isWindowsPlatform } from '../../../lib/platform'
import { dismissAccessRequest, respondAccessRequest, switchPlanToFolderMode } from './actions'
import { useTasks } from './store'

// ───────────────────────────── Concesión por app ─────────────────────────────

export type T = ReturnType<typeof useT>

export function tierInfo(t: T): Record<AppTier, { label: string; icon: React.ReactNode; desc: string }> {
  return {
    view: { label: t('tasksComputer.tier.view'), icon: <Eye size={13} />, desc: t('tasksComputer.tier.viewDesc') },
    click: { label: t('tasksComputer.tier.click'), icon: <MousePointerClick size={13} />, desc: t('tasksComputer.tier.clickDesc') },
    full: { label: t('tasksComputer.tier.full'), icon: <MonitorCog size={13} />, desc: t('tasksComputer.tier.fullDesc') }
  }
}

/** Insignia compacta con el nivel concedido a una app. */
export function TierBadge({ tier }: { tier: AppTier }): React.JSX.Element {
  const info = tierInfo(useT())[tier]
  const tone =
    tier === 'full'
      ? 'border-amber-500/50 bg-amber-500/10 text-amber-700 desk:text-warning [[data-theme=dark]_&]:text-amber-400'
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
export function TierSegmented({
  value,
  onChange,
  withDeny = true
}: {
  value: AccessDecision
  onChange: (v: AccessDecision) => void
  /** La tarjeta de permiso por app no lo muestra: «Denegar» es un botón aparte. */
  withDeny?: boolean
}): React.JSX.Element {
  const t = useT()
  return (
    <div
      role="radiogroup"
      aria-label={t('tasksComputer.tier.aria')}
      className="inline-flex shrink-0 flex-wrap items-center gap-0.5 rounded-full border border-border bg-hover/60 p-0.5"
    >
      {tierSegmentOptions(t)
        .filter((o) => withDeny || o.v !== 'deny')
        .map((o) => (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={value === o.v}
            title={o.title}
            onClick={() => onChange(o.v)}
            className={`flex items-center gap-1 rounded-full px-2 py-1 text-[11px] desk:text-meta font-medium transition ${
              value === o.v
                ? o.v === 'deny'
                  ? 'bg-danger/15 text-danger'
                  : 'bg-elevated text-accent shadow-sm'
                : 'text-muted hover:text-fg'
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
      {app.alreadyOpen && choice !== 'deny' && <span className="basis-full text-warning">{t('tasksComputer.meta.alreadyOpen')}</span>}
      {keeps && <span>{t('tasksComputer.meta.keeps', { tier: tierInfo(t)[keeps].label })}</span>}
    </div>
  )
}

/**
 * Tarjeta "Plan y permisos" / "¿Permitir que el agente use X?" (herramienta MCP `request_access`):
 * lugar PRINCIPAL en la ventana de Lazunox — una tarjeta EN LA CONVERSACIÓN, fija sobre el
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
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-700 desk:text-warning [[data-theme=dark]_&]:text-amber-400">
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
            <p className="mt-1 text-sm text-muted">{t('tasksComputer.takeover.hint')}</p>
            <p className="mt-2.5 text-xs text-muted">{t('tasksComputer.noTimeout')}</p>
            <div className="mt-3.5 flex flex-wrap justify-end gap-2">
              <Button variant="primary" onClick={decline} disabled={busy}>
                {t('tasksComputer.takeover.background')}
              </Button>
              <Button variant="secondary" onClick={allow} disabled={busy}>
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
  const req = useTasks((s) => s.accessRequest)
  if (!req) return null
  if (req.kind === 'takeover') return <TakeoverAccessCard req={req} />
  // Con apps (con o sin plan) siempre la tarjeta nueva; el plan sin apps (terminal, archivos, web) conserva su tarjeta propia.
  if (req.apps.length > 0) return <AppPermissionCard key={req.id} req={req} />
  return <PlanDetailCard key={req.id} req={req} />
}

function PlanDetailCard({ req }: { req: AccessRequest }): React.JSX.Element {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [detailsOpen, setDetailsOpen] = useState<boolean | null>(null)

  useEffect(() => {
    setDetailsOpen(null)
    setEditing(false)
    setFeedback('')
  }, [req])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') dismissAccessRequest()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [req])

  const confirm = (): void => {
    setBusy(true)
    void respondAccessRequest([], { approvePlan: !!req.plan }).finally(() => setBusy(false))
  }

  /** "Denegar todo" (solo tarjetas sin plan): sin apps no hay nada que denegar app por app. */
  const denyAll = (): void => {
    setBusy(true)
    void respondAccessRequest([]).finally(() => setBusy(false))
  }

  /** Plan sin apps: cancela el plan y vuelve a «Una carpeta» (si no hay carpeta autorizada, explica por qué no). */
  const switchToFolder = (): void => {
    setBusy(true)
    void switchPlanToFolderMode().finally(() => setBusy(false))
  }

  const sendFeedback = (): void => {
    const text = feedback.trim()
    if (!text) return
    setBusy(true)
    // El feedback no concede ni deniega nada: no se envía ninguna decisión.
    void respondAccessRequest([], { feedback: text }).finally(() => setBusy(false))
  }

  // Plan sin apps (tarea de archivos, documentos o navegador): sin ratón ni teclado, así que no se ve como una alerta.
  const steps = req.plan?.length ?? 0
  const summary = req.reason
    ? `«${req.reason}»`
    : steps > 0
      ? t(steps === 1 ? 'tasksComputer.plan.summaryOne' : 'tasksComputer.plan.summaryMany', { n: steps })
      : ''
  const showDetails = detailsOpen ?? false
  const title = req.plan ? t('tasksComputer.plan.titleTask') : t('tasksComputer.plan.titleMany')

  return (
    <div className="mx-auto mb-2 w-full max-w-3xl px-6">
      <div
        role="alertdialog"
        aria-labelledby="tasks-plan-access-title"
        className="animate-rise-in rounded-2xl border border-accent/30 bg-accent-soft/20 p-4 shadow-sm"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <ListChecks size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
                <h3 id="tasks-plan-access-title" className="text-sm font-semibold text-fg">
                  {title}
                </h3>
                {req.plan && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success">
                    <Check size={12} aria-hidden />
                    {t('tasksComputer.plan.stampBackground')}
                  </span>
                )}
              </div>
              <button
                type="button"
                aria-expanded={showDetails}
                aria-controls="tasks-plan-access-details"
                onClick={() => setDetailsOpen(!showDetails)}
                className="no-drag inline-flex shrink-0 items-center gap-1 rounded-ctl px-2 py-1 text-xs text-muted outline-none hover:bg-hover hover:text-fg focus-visible:shadow-focus"
              >
                {showDetails ? t('perm.details.hide') : t('perm.details.show')}
                <ChevronDown size={14} aria-hidden className={`transition-transform ${showDetails ? 'rotate-180' : ''}`} />
              </button>
            </div>
            {summary && !(showDetails && req.reason) && (
              <p className="mt-1 truncate text-sm text-muted" title={summary}>
                {summary}
              </p>
            )}
            {req.unresolved && req.unresolved.length > 0 && (
              <p className="mt-1.5 text-xs text-warning">{t('tasksComputer.plan.notFound', { list: req.unresolved.join(', ') })}</p>
            )}
            <div id="tasks-plan-access-details" hidden={!showDetails}>
              {req.reason && <p className="mt-1.5 text-sm text-muted">«{req.reason}»</p>}
              {req.plan && req.plan.length > 0 && (
                <ol className="mt-2.5 space-y-1.5 rounded-lg border border-border bg-hover/60 px-3 py-2.5 text-sm text-fg">
                  {req.plan.map((step, i) => (
                    <li key={i} className="flex items-start gap-2.5">
                      <span
                        aria-hidden
                        className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] desk:text-meta font-semibold text-accent"
                      >
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1">{step}</span>
                    </li>
                  ))}
                </ol>
              )}
              <p className="mt-2.5 text-xs text-muted">{t('tasksComputer.plan.noApps')}</p>
              <p className="mt-2.5 text-xs text-muted">{t('tasksComputer.noTimeout')}</p>
            </div>
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
                  <Button variant="secondary" onClick={switchToFolder} disabled={busy} title={t('tasksComputer.plan.toFolderTitle')}>
                    {t('tasksComputer.plan.toFolder')}
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

/** Tiempo de armado de la tarjeta (el mismo que `CONSENT_UI_ARM_MS` de ComputerConsentWin): antes, ninguna tecla responde. */
export const APP_CARD_ARM_MS = 600
/** Un plan de más de 4 pasos nace plegado a sus 3 primeros pasos. */
const PLAN_STEPS_COLLAPSED_OVER = 4
const PLAN_STEPS_SHOWN = 3

/** ¿Es el atajo de «Permitir»? ⌘↵ en Mac, Ctrl+↵ en el resto (sin Mayús/Alt). Pura. */
export function isAllowShortcut(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>, mac: boolean): boolean {
  if (e.key !== 'Enter' || e.shiftKey || e.altKey) return false
  return mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
}

/** Una tecla que ya fue atendida por otro (IME, select, diálogo) o que es autorrepetición no responde la tarjeta. */
function isStrayKey(e: Pick<KeyboardEvent, 'repeat' | 'isComposing' | 'defaultPrevented'>): boolean {
  return e.repeat || e.isComposing || e.defaultPrevented
}

/**
 * Logo de la app: su icono real (solo como `<img src>`, validado: PNG en data URL acotado) o, si no hay, la inicial pequeña
 * junto al NOMBRE COMPLETO en texto. Con icono el nombre se muestra al lado igualmente.
 */
export function AppLogo({ app }: { app: AccessRequestApp }): React.JSX.Element {
  const [broken, setBroken] = useState(false)
  const icon = !broken && isSafeIconDataUrl(app.icon) ? app.icon : null
  return (
    <>
      {icon ? (
        <img
          src={icon}
          alt=""
          width={28}
          height={28}
          draggable={false}
          onError={() => setBroken(true)}
          className="h-7 w-7 shrink-0 rounded-lg"
        />
      ) : (
        <span
          aria-hidden
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-hover text-[11px] desk:text-meta font-semibold text-muted"
        >
          {app.name.trim().charAt(0).toUpperCase()}
        </span>
      )}
      <span
        className={`min-w-0 text-sm font-medium text-fg ${icon ? 'truncate' : 'break-words'}`}
        title={app.bundleId}
        data-testid="app-name"
      >
        {app.name}
      </span>
    </>
  )
}

/**
 * Tarjeta «¿Permitir que Lazunox use {App}?»: sin plan y con apps. «Permitir» manda `scope: 'session'` (explícito);
 * «Denegar» deniega solo en esta tarea; «Bloquear siempre» (por app) deniega esa app y manda `alsoBlock`.
 * Teclado, solo con el foco DENTRO de la tarjeta (nunca se roba el foco al montarse): ⌘↵ / Ctrl+↵ concede; Esc CANCELA
 * (no concede ni deniega). Ambos ignoran la autorrepetición, la composición de un IME y las teclas ya atendidas, y no
 * responden hasta 600 ms después de mostrarse la tarjeta (una tecla mantenida no aprueba la siguiente). El atajo nunca
 * concede «Control total» si esa app no lo tenía ya.
 */
export function AppPermissionCard({ req }: { req: AccessRequest }): React.JSX.Element {
  const t = useT()
  const mac = isMacPlatform()
  const win = isWindowsPlatform()
  const [choices, setChoices] = useState<Record<string, AccessDecision>>(() =>
    Object.fromEntries(req.apps.map((a) => [a.bundleId, defaultAccessDecision(a)]))
  )
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [stepsOpen, setStepsOpen] = useState(false)
  const armed = useRef(false)
  useEffect(() => {
    armed.current = false
    const id = setTimeout(() => {
      armed.current = true
    }, APP_CARD_ARM_MS)
    return () => clearTimeout(id)
  }, [req.id])
  const decisionFor = (a: AccessRequestApp): AccessDecision => choices[a.bundleId] ?? defaultAccessDecision(a)

  const allow = (): void => {
    if (busy) return
    setBusy(true)
    void respondAccessRequest(
      req.apps.map((a) => ({ bundleId: a.bundleId, name: a.name, decision: decisionFor(a) })),
      { scope: 'session', ...(req.plan ? { approvePlan: true } : {}) }
    ).finally(() => setBusy(false))
  }
  /**
   * Apps para las que el agente pidió «Control total» y que no lo tienen ni lo han elegido en el selector: la tarjeta ofrece un botón
   * explícito «Aceptar Control total» (un clic aparte de «Permitir», sin atajo de teclado) para no obligar a buscar el selector.
   */
  const fullAskedApps = req.apps.filter((a) => a.requested === 'full' && a.current !== 'full' && decisionFor(a) !== 'full')
  const acceptFull = (): void => {
    if (busy) return
    setBusy(true)
    void respondAccessRequest(
      req.apps.map((a) => ({
        bundleId: a.bundleId,
        name: a.name,
        decision: fullAskedApps.some((f) => f.bundleId === a.bundleId) ? ('full' as const) : decisionFor(a)
      })),
      { scope: 'session', ...(req.plan ? { approvePlan: true } : {}) }
    ).finally(() => setBusy(false))
  }
  /** «Editar»: el feedback no concede ni deniega nada; el agente replantea el plan. */
  const sendFeedback = (): void => {
    const text = feedback.trim()
    if (busy || !text) return
    setBusy(true)
    void respondAccessRequest([], { feedback: text }).finally(() => setBusy(false))
  }
  /** El atajo no concede «Control total» a una app que no lo tenía: eso exige elegirlo y pulsar el botón. */
  const shortcutAllowed = (): boolean => !req.apps.some((a) => decisionFor(a) === 'full' && a.current !== 'full')
  const deny = (): void => {
    if (busy) return
    setBusy(true)
    void respondAccessRequest(req.apps.map((a) => ({ bundleId: a.bundleId, name: a.name, decision: 'deny' as const }))).finally(() =>
      setBusy(false)
    )
  }
  /** Bloquea SOLO esa app para siempre; las demás de la tarjeta quedan sin responder (el agente las volverá a pedir). */
  const blockAlways = (a: AccessRequestApp): void => {
    if (busy) return
    setBusy(true)
    void respondAccessRequest([{ bundleId: a.bundleId, name: a.name, decision: 'deny' }], { alsoBlock: true }).finally(() => setBusy(false))
  }
  const cancel = (): void => {
    if (busy) return
    setBusy(true)
    dismissAccessRequest()
  }

  // Con plan, «Ver y clic» y «Control total» usan el ratón y el teclado REALES (sesión en primer plano); solo «Solo ver» es segundo plano.
  const realInput = !!req.plan && req.apps.some((a) => decisionFor(a) === 'click' || decisionFor(a) === 'full')
  const many = req.apps.length > 1
  const title = many ? t('tasksComputer.appAccess.titleMany') : t('tasksComputer.appAccess.title', { app: req.apps[0]?.name ?? '' })
  const shortcut = mac ? '⌘↵' : 'Ctrl+↵'
  const planSteps = req.plan ?? []
  const shownSteps = stepsOpen || planSteps.length <= PLAN_STEPS_COLLAPSED_OVER ? planSteps : planSteps.slice(0, PLAN_STEPS_SHOWN)

  return (
    <div className="mx-auto mb-2 w-full max-w-3xl px-6">
      <div
        tabIndex={-1}
        role="alertdialog"
        aria-labelledby="tasks-app-access-title"
        onKeyDown={(e) => {
          // Solo con el foco dentro de la tarjeta (el evento sube desde ella), armada y sin teclas ajenas.
          if (!armed.current || isStrayKey(e.nativeEvent) || e.defaultPrevented) return
          if (editing) {
            // Editando el plan: Esc vuelve a la tarjeta y el atajo no concede nada.
            if (e.key === 'Escape') {
              e.preventDefault()
              setEditing(false)
            }
            return
          }
          if (isAllowShortcut(e.nativeEvent, mac)) {
            // Con el foco en otro botón o enlace («Bloquear siempre», «Denegar», «Editar»…) el atajo no aprueba por sorpresa.
            const target = e.target as Element | null
            const onOtherControl =
              !!target?.closest?.('button, a, input, textarea, select') && !target.closest('[data-approve], [role="radio"]')
            if (onOtherControl) return
            e.preventDefault()
            if (shortcutAllowed()) allow()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            cancel()
          }
        }}
        className="animate-rise-in rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4 shadow-sm outline-none"
      >
        <h3 id="tasks-app-access-title" className="text-base font-semibold text-fg">
          {title}
        </h3>
        <p data-testid="app-access-reason" className="mt-1.5 max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-sm text-muted">
          {req.reason?.trim() ? req.reason : t('tasksComputer.appAccess.reasonNone')}
        </p>
        {planSteps.length > 0 && (
          <section className="mt-2.5" aria-labelledby="tasks-app-access-plan">
            <div className="rounded-lg border border-dashed border-border bg-hover/40 px-3 py-2" data-testid="app-access-plan-box">
              <h4 id="tasks-app-access-plan" className="text-xs font-semibold tracking-wide text-muted uppercase">
                {t('tasksComputer.appAccess.planHeading')}
              </h4>
              <ol data-testid="app-access-plan" className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-fg marker:text-muted">
                {shownSteps.map((step, i) => (
                  <li key={i} className="break-words">
                    {step}
                  </li>
                ))}
              </ol>
              {planSteps.length > PLAN_STEPS_COLLAPSED_OVER && (
                <button
                  type="button"
                  aria-expanded={stepsOpen}
                  onClick={() => setStepsOpen(!stepsOpen)}
                  className="no-drag mt-1 inline-flex items-center gap-1 rounded-ctl px-1.5 py-0.5 text-xs text-muted outline-none hover:bg-hover hover:text-fg focus-visible:shadow-focus"
                >
                  {stepsOpen ? t('tasksComputer.appAccess.planHide') : t('tasksComputer.appAccess.planShowAll', { n: planSteps.length })}
                  <ChevronDown size={12} aria-hidden className={`transition-transform ${stepsOpen ? 'rotate-180' : ''}`} />
                </button>
              )}
            </div>
          </section>
        )}
        <div className="mt-2 space-y-1 text-xs text-muted" data-testid="app-access-notices">
          {realInput ? (
            <>
              <p data-testid="app-access-real-input" className="font-medium text-warning">
                {win ? t('tasksComputer.plan.stampControl.win') : t('tasksComputer.plan.stampControl')}
              </p>
              <p>{t('tasksComputer.plan.mouseKeyboard')}</p>
            </>
          ) : (
            <p data-testid="app-access-background">
              {win ? t('tasksComputer.appAccess.background.win') : t('tasksComputer.appAccess.background')}
            </p>
          )}
          {req.plan && <p>{t('tasksComputer.appAccess.neverLowers')}</p>}
          {req.plan && (
            <p>
              {t('tasksComputer.noTimeout')} {t('tasksComputer.plan.filesHint')}
            </p>
          )}
        </div>
        {req.unresolved && req.unresolved.length > 0 && (
          <p className="mt-1.5 text-xs text-warning">{t('tasksComputer.plan.notFound', { list: req.unresolved.join(', ') })}</p>
        )}
        <ul className="mt-3 space-y-2">
          {req.apps.map((a) => {
            const choice = decisionFor(a)
            const tier: AppTier = choice === 'deny' ? 'view' : choice
            return (
              <li key={a.bundleId} className="rounded-lg border border-border bg-elevated/60 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <AppLogo app={a} />
                  </span>
                  <TierSegmented withDeny={false} value={choice} onChange={(v) => setChoices((c) => ({ ...c, [a.bundleId]: v }))} />
                </div>
                <p className={`mt-1.5 text-xs ${tier === 'full' ? 'font-medium text-danger' : 'text-muted'}`} data-tier={tier}>
                  {t(`tasksComputer.appAccess.tier.${tier}.warn`)}
                </p>
                {isRemoteClientApp(a) && (
                  <p className="mt-1 text-xs font-medium text-danger" data-testid="app-access-remote-warn">
                    {t('tasksComputer.appAccess.remoteWarn')}
                  </p>
                )}
                {a.requested === 'full' && choice !== 'full' && (
                  <p className="mt-1 text-xs text-muted" data-testid="app-access-full-hint">
                    {t('tasksComputer.appAccess.fullHint')}
                  </p>
                )}
                <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <AppAccessMeta app={a} choice={choice} />
                  <button
                    type="button"
                    onClick={() => blockAlways(a)}
                    disabled={busy}
                    aria-label={t('tasksComputer.appAccess.blockAlwaysAria', { app: a.name })}
                    className="no-drag ml-auto inline-flex items-center gap-1 rounded-ctl px-1.5 py-0.5 text-xs font-medium text-fg underline underline-offset-2 outline-none hover:text-danger focus-visible:shadow-focus disabled:opacity-60"
                  >
                    <Ban size={12} aria-hidden className="text-danger" />
                    {t('tasksComputer.appAccess.blockAlways')}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
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
                {t('tasksComputer.plan.back')} <kbd className="kbd">Esc</kbd>
              </Button>
              <Button variant="primary" onClick={sendFeedback} disabled={busy || !feedback.trim()}>
                {t('tasksComputer.plan.sendChanges')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3.5 flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" onClick={cancel} disabled={busy} title={t('tasksComputer.plan.cancelTitle')}>
              {t('tasksComputer.cancel')} <kbd className="kbd">Esc</kbd>
            </Button>
            {req.plan && (
              <Button variant="ghost" onClick={() => setEditing(true)} disabled={busy}>
                {t('tasksComputer.plan.edit')}
              </Button>
            )}
            <Button variant="secondary" onClick={deny} disabled={busy}>
              {t('tasksComputer.appAccess.deny')}
            </Button>
            {fullAskedApps.length > 0 && (
              <Button variant="secondary" onClick={acceptFull} disabled={busy} data-testid="app-access-accept-full">
                {t('tasksComputer.appAccess.acceptFull')}
              </Button>
            )}
            <Button variant="primary" onClick={allow} disabled={busy} data-approve="">
              {req.plan ? t('tasksComputer.plan.approve') : t('tasksComputer.appAccess.allowSession')} <kbd className="kbd">{shortcut}</kbd>
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
