/**
 * Tarjetas de concesión por app (herramientas MCP `request_access` y `request_full_control`):
 *  - `AppPermissionCard`: «¿Permitir que Lazunox use {App}?» — motivo del agente, avisos, una fila por app con su
 *    nivel (se puede bajar), «Denegar» (Esc), «Permitir para esta sesión» (⌘↵ / Ctrl+↵) y «Bloquear siempre».
 *  - `PlanDetailCard`: tarjeta con plan de la tarea (y/o sin apps).
 *  - `TakeoverAccessCard`: «¿Tomar el control de la pantalla?».
 * Aprobar nunca baja un nivel ya concedido (main aplica el máximo) y Esc nunca concede nada.
 */
import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Eye, ListChecks, Loader2, MonitorCog, MousePointerClick, ShieldAlert, X } from 'lucide-react'
import {
  APP_TIER_RANK,
  defaultAccessDecision,
  type AccessDecision,
  type AccessRequest,
  type AccessRequestApp,
  type AppTier
} from '@shared/ipc-tasks'
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
  if (!req.plan && req.apps.length > 0) return <AppPermissionCard key={req.id} req={req} />
  return <PlanDetailCard key={req.id} req={req} />
}

function PlanDetailCard({ req }: { req: AccessRequest }): React.JSX.Element {
  const t = useT()
  const [choices, setChoices] = useState<Record<string, AccessDecision>>({})
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [detailsOpen, setDetailsOpen] = useState<boolean | null>(null)

  useEffect(() => {
    setDetailsOpen(null)
    setChoices(Object.fromEntries(req.apps.map((a) => [a.bundleId, defaultAccessDecision(a)])))
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

  /** Plan sin apps: cancela el plan y vuelve a «Solo en tu carpeta» (si no hay carpeta autorizada, explica por qué no). */
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
  const calm = !!req.plan && !hasApps
  // Resumen de una línea; los pasos y las notas van plegados. Con ratón y teclado (plan no «tranquilo») nacen abiertos.
  const steps = req.plan?.length ?? 0
  const summary = req.reason
    ? `«${req.reason}»`
    : steps > 0
      ? t(steps === 1 ? 'tasksComputer.plan.summaryOne' : 'tasksComputer.plan.summaryMany', { n: steps })
      : ''
  const showDetails = detailsOpen ?? !calm
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
        className={`animate-rise-in rounded-2xl border p-4 shadow-sm ${calm ? 'border-accent/30 bg-accent-soft/20' : 'border-amber-500/40 bg-amber-500/5'}`}
      >
        <div className="flex items-start gap-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${calm ? 'bg-accent-soft text-accent' : 'bg-amber-500/15 text-amber-700 desk:text-warning [[data-theme=dark]_&]:text-amber-400'}`}
          >
            {calm ? <ListChecks size={18} /> : <ShieldAlert size={18} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
                <h3 id="tasks-plan-access-title" className="text-sm font-semibold text-fg">
                  {title}
                </h3>
                {req.plan && (
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${calm ? 'bg-success/10 text-success' : 'bg-amber-500/10 text-warning'}`}
                  >
                    {calm ? <Check size={12} aria-hidden /> : <MousePointerClick size={12} aria-hidden />}
                    {calm ? t('tasksComputer.plan.stampBackground') : t('tasksComputer.plan.stampControl')}
                  </span>
                )}
              </div>
              {
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
              }
            </div>
            {summary && !(showDetails && req.reason) && (
              <p className="mt-1 truncate text-sm text-muted" title={summary}>
                {summary}
              </p>
            )}
            {req.unresolved && req.unresolved.length > 0 && (
              <p className="mt-1.5 text-xs text-warning">{t('tasksComputer.plan.notFound', { list: req.unresolved.join(', ') })}</p>
            )}
            {
              <div id="tasks-plan-access-details" hidden={!showDetails}>
                {req.reason && <p className="mt-1.5 text-sm text-muted">«{req.reason}»</p>}
                {req.plan && req.plan.length > 0 && (
                  <ol className="mt-2.5 space-y-1.5 rounded-lg border border-border bg-hover/60 px-3 py-2.5 text-sm text-fg">
                    {req.plan.map((step, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <span
                          aria-hidden
                          className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] desk:text-meta font-semibold ${calm ? 'bg-accent-soft text-accent' : 'bg-amber-500/15 text-warning'}`}
                        >
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1">{step}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {!hasApps && <p className="mt-2.5 text-xs text-muted">{t('tasksComputer.plan.noApps')}</p>}
                <p className="mt-2.5 text-xs text-muted">
                  {t('tasksComputer.noTimeout')}
                  {hasApps && ` ${t('tasksComputer.plan.neverLowers')}`}
                  {hasApps && ` ${t('tasksComputer.plan.mouseKeyboard')} ${t('tasksComputer.plan.filesHint')}`}
                </p>
              </div>
            }
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
                {req.plan && !hasApps && (
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

/** ¿Es el atajo de «Permitir»? ⌘↵ en Mac, Ctrl+↵ en el resto (sin Mayús/Alt). Pura. */
export function isAllowShortcut(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>, mac: boolean): boolean {
  if (e.key !== 'Enter' || e.shiftKey || e.altKey) return false
  return mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
}

/**
 * Tarjeta «¿Permitir que Lazunox use {App}?»: sin plan y con apps. «Permitir» manda `scope: 'session'` (explícito);
 * «Denegar» (y Esc) deniega solo en esta tarea; «Bloquear siempre» deniega y manda `alsoBlock`.
 * ⌘↵ / Ctrl+↵ concede solo si el foco está dentro de la tarjeta; Esc nunca concede.
 */
export function AppPermissionCard({ req }: { req: AccessRequest }): React.JSX.Element {
  const t = useT()
  const mac = isMacPlatform()
  const win = isWindowsPlatform()
  const cardRef = useRef<HTMLDivElement>(null)
  const [choices, setChoices] = useState<Record<string, AccessDecision>>(() =>
    Object.fromEntries(req.apps.map((a) => [a.bundleId, defaultAccessDecision(a)]))
  )
  const [busy, setBusy] = useState(false)
  const decisionFor = (a: AccessRequestApp): AccessDecision => choices[a.bundleId] ?? defaultAccessDecision(a)

  const denyDecisions = (): Array<{ bundleId: string; name: string; decision: AccessDecision }> =>
    req.apps.map((a) => ({ bundleId: a.bundleId, name: a.name, decision: 'deny' as const }))
  const allow = (): void => {
    if (busy) return
    setBusy(true)
    void respondAccessRequest(
      req.apps.map((a) => ({ bundleId: a.bundleId, name: a.name, decision: decisionFor(a) })),
      { scope: 'session' }
    ).finally(() => setBusy(false))
  }
  const deny = (): void => {
    if (busy) return
    setBusy(true)
    void respondAccessRequest(denyDecisions()).finally(() => setBusy(false))
  }
  const blockAlways = (): void => {
    if (busy) return
    setBusy(true)
    void respondAccessRequest(denyDecisions(), { alsoBlock: true }).finally(() => setBusy(false))
  }

  // Esc = Denegar (nunca concede). Se escucha en el documento para que funcione sin foco en la tarjeta.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') deny()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req, busy])

  // Si nadie tiene el foco (nadie está escribiendo), la tarjeta lo toma para que el atajo de «Permitir» funcione.
  useEffect(() => {
    const el = document.activeElement
    if (!el || el === document.body) cardRef.current?.focus({ preventScroll: true })
  }, [req])

  const many = req.apps.length > 1
  const title = many ? t('tasksComputer.appAccess.titleMany') : t('tasksComputer.appAccess.title', { app: req.apps[0]?.name ?? '' })
  const anyAction = req.apps.some((a) => decisionFor(a) !== 'view')
  const shortcut = mac ? '⌘↵' : 'Ctrl+↵'

  return (
    <div className="mx-auto mb-2 w-full max-w-3xl px-6">
      <div
        ref={cardRef}
        tabIndex={-1}
        role="alertdialog"
        aria-labelledby="tasks-app-access-title"
        onKeyDown={(e) => {
          // Solo con el foco dentro de la tarjeta (el evento sube desde ella).
          if (isAllowShortcut(e.nativeEvent, mac)) {
            e.preventDefault()
            allow()
          }
        }}
        className="animate-rise-in rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4 shadow-sm outline-none"
      >
        <h3 id="tasks-app-access-title" className="text-base font-semibold text-fg">
          {title}
        </h3>
        <p
          data-testid="app-access-reason"
          className="mt-1.5 max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-sm text-muted"
        >
          {req.reason?.trim() ? req.reason : t('tasksComputer.appAccess.reasonNone')}
        </p>
        <p className="mt-2 text-xs text-muted">{win ? t('tasksComputer.appAccess.background.win') : t('tasksComputer.appAccess.background')}</p>
        {anyAction && <p className="mt-1 text-xs text-muted">{t('tasksComputer.appAccess.windows')}</p>}
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
                    <span
                      aria-hidden
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-hover text-xs font-semibold text-muted"
                    >
                      {a.name.trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 truncate text-sm font-medium text-fg" title={a.bundleId}>
                      {a.name}
                    </span>
                  </span>
                  <TierSegmented
                    withDeny={false}
                    value={choice}
                    onChange={(v) => setChoices((c) => ({ ...c, [a.bundleId]: v }))}
                  />
                </div>
                <p className={`mt-1.5 text-xs ${tier === 'full' ? 'font-medium text-danger' : 'text-muted'}`} data-tier={tier}>
                  {t(`tasksComputer.appAccess.tier.${tier}.warn`)}
                </p>
                <AppAccessMeta app={a} choice={choice} />
              </li>
            )
          })}
        </ul>
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={blockAlways}
            disabled={busy}
            className="no-drag rounded-ctl px-1 py-1 text-xs text-muted underline-offset-2 outline-none hover:text-danger hover:underline focus-visible:shadow-focus disabled:opacity-60"
          >
            {t('tasksComputer.appAccess.blockAlways')}
          </button>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {busy && (
              <span role="status" className="inline-flex items-center gap-1.5 text-xs text-muted">
                <Loader2 size={12} className="animate-spin" /> {t('tasksComputer.appAccess.pending')}
              </span>
            )}
            <Button variant="ghost" onClick={deny} disabled={busy}>
              {t('tasksComputer.appAccess.deny')} <kbd className="kbd">Esc</kbd>
            </Button>
            <Button variant="primary" onClick={allow} disabled={busy}>
              {t('tasksComputer.appAccess.allowSession')} <kbd className="kbd">{shortcut}</kbd>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
