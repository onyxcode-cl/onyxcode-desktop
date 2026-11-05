/**
 * Pantalla «Preparando Lazunox» (revisión de arranque). Solo presenta: la lista de componentes con su estado, el tamaño a descargar y los
 * botones. La lógica (revisar, instalar, reintentar) vive en `PreflightGate` y `preflight-run.ts`. Mientras falte algo esencial no hay
 * forma de omitirla; lo no esencial (permisos de macOS, ubicación de la app, ayudante) sale como «Pendiente» y se puede continuar.
 */
import { AlertTriangle, Check, Clock, Copy, Loader2, RefreshCw } from 'lucide-react'
import { DISPLAY_NAME } from '@shared/brand'
import {
  blocking,
  canContinue,
  canInstall,
  downloadBytes,
  installPlan,
  installable,
  optionalPending,
  rowState,
  stageRows,
  visibleRows,
  type PreflightStage,
  type PreflightComponent,
  type PreflightId,
  type PreflightReport,
  type RuntimeMap
} from '@shared/preflight'
import { CLICK_IDS, PERMS_IDS } from '@shared/preflight'
import { Button } from '../../components/Button'
import { LogoMark } from '../../components/Logo'
import { call } from '../../lib/api'
import { useT } from '../../lib/i18n'
import { ComponentPick } from './ComponentPick'
import { AppLocationNotice, PermsHelp, ScreenRestartNotice } from './PermsNotices'
import { LABELS, STATE_LABELS, failureKey, hintKey, sizeParts } from './preflight-view'
import { officeMb } from '../settings/impl/component-install'

export interface PreflightScreenProps {
  report: PreflightReport
  runtime: RuntimeMap
  /** Hay una instalación en curso. */
  installing: boolean
  /** Detalle redactado de cada fallo (para «Copiar detalle»). */
  details: Partial<Record<PreflightId, string>>
  /** Componente cuyo detalle se acaba de copiar. */
  copied: PreflightId | null
  /** Se pidieron los permisos y siguen sin activarse: muestra la ayuda de reparación. */
  permsStalled: boolean
  /** Se está esperando que la persona active los permisos en Ajustes del Sistema. */
  permsWaiting: boolean
  /** Abre Ajustes del Sistema › Acceso total al disco (solo con clic). */
  onOpenFullDisk?: () => void
  /** Casillas desmarcadas (por defecto todo lo opcional va marcado). */
  unchecked: readonly PreflightId[]
  /** Primer uso: «Paso 2 de 4 · …» sobre el título. */
  stepLabel?: string
  /** Etapa del recorrido (instalar / permisos). Sin ella, la pantalla de siempre con todo junto (revisión de arranque). */
  stage?: PreflightStage
  /** «Aceptar todo e instalar»: instala todo lo instalable sin mirar casillas (nunca los permisos). */
  onAcceptAll?: () => void
  /** Casillas visibles («Elegir qué instalar»). */
  custom?: boolean
  onCustom?: () => void
  /** Avance general de «Aceptar todo» (piezas terminadas de las que se instalan y % de la actual). */
  progress?: { total: number; done: number; pct: number | null }
  onToggle: (id: PreflightId) => void
  /** Sin ids instala lo marcado; con ids (reintento de una fila) solo esos. */
  onInstall: (ids?: PreflightId[]) => void
  onCopy: (id: PreflightId) => void
  onContinue: () => void
  onRecheck: () => void
  onGrantPerms: () => void
  onPickEngine: () => void
}

export function PreflightScreen(p: PreflightScreenProps): React.JSX.Element {
  const t = useT()
  const { report, runtime } = p
  const stage = p.stage
  // Etapa «Instalar» con «Aceptar todo»: sin personalizar cuenta todo lo instalable; con «Elegir qué instalar», lo marcado.
  const effUnchecked = stage === 'install' && !p.custom ? [] : p.unchecked
  const showPicks = !stage || p.custom === true
  const rows = stage ? stageRows(report, stage, effUnchecked) : visibleRows(report, p.unchecked)
  const block = blocking(report)
  const optional = optionalPending(report).filter((c) =>
    stage === 'perms' ? PERMS_IDS.includes(c.id) : stage === 'install' ? !PERMS_IDS.includes(c.id) : true
  )
  const choices = installable(report).map((c) => c.id)
  const plan = installPlan(report, effUnchecked)
  const bytes = downloadBytes(report, effUnchecked)
  const anyFailed = Object.values(runtime).some((r) => r?.state === 'failed')
  const location = report.components.find((c) => c.id === 'location' && !c.ok)?.reason
  const perms = report.components.find((c) => c.id === 'perms')
  // «Ubicación de la app» es un aviso (tiene su propia nota), no una tarea pendiente: por sí sola no quita el botón «Continuar».
  const todo = optional.filter((c) => c.id !== 'location')
  const allDone = block.length === 0 && (stage === 'install' ? choices.length === 0 : todo.length === 0)
  const guided = stage === 'install' && p.onAcceptAll !== undefined
  const permsPending = stage === 'perms' && report.components.some((c) => c.id === 'perms' && !c.ok)
  const size = sizeParts(bytes)

  const stateText = (c: PreflightComponent): string => {
    const st = rowState(c, runtime)
    const pct = runtime[c.id]?.pct
    if (st === 'pending' && CLICK_IDS.includes(c.id)) return t('preflight.state.click')
    return st === 'downloading' && pct !== undefined ? t('preflight.progress', { pct }) : t(STATE_LABELS[st])
  }

  const hintOf = (c: PreflightComponent): string | null => {
    const rt = runtime[c.id]
    if (rt?.state === 'failed') return t(failureKey(c.id, rt.error), { app: DISPLAY_NAME })
    // Translocada o desde el .dmg: el aviso de abajo (el mismo del asistente) lo explica.
    if (c.id === 'location' && (c.reason === 'translocated' || c.reason === 'volume')) return null
    const k = hintKey(c)
    if (!k) return c.version ? t('preflight.version', { v: c.version }) : null
    return t(k, { app: DISPLAY_NAME, mb: officeMb(c.sizeBytes ?? 0) })
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-bg p-4" data-testid="preflight-screen">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="preflight-title"
        className="my-auto flex w-full max-w-lg flex-col items-center text-center"
      >
        <LogoMark size={64} variant="tile" animated={false} />
        {p.stepLabel && (
          <p className="mt-4 text-meta font-medium text-muted" data-testid="preflight-step">
            {p.stepLabel}
          </p>
        )}
        <h1
          id="preflight-title"
          tabIndex={-1}
          className={`${p.stepLabel ? 'mt-1' : 'mt-5'} font-display text-[26px] leading-8 font-semibold tracking-[-0.02em] outline-none`}
        >
          {stage === 'perms' ? t('preflight.perms.title') : t('preflight.title', { app: DISPLAY_NAME })}
        </h1>
        <p className="mt-2 max-w-md text-[14px] leading-5 text-muted">
          {stage === 'perms'
            ? t('preflight.perms.intro', { app: DISPLAY_NAME })
            : block.length > 0
              ? t('preflight.subtitle.blocking', { app: DISPLAY_NAME })
              : guided
                ? t('preflight.acceptAll.subtitle', { app: DISPLAY_NAME })
                : t('preflight.subtitle.optional', { app: DISPLAY_NAME })}
        </p>

        <ul className="mt-6 w-full space-y-2 text-left" aria-live="polite">
          {rows.map((c) => {
            const st = rowState(c, runtime)
            const hint = hintOf(c)
            return (
              <li
                key={c.id}
                data-testid={`preflight-row-${c.id}`}
                data-state={st}
                className="flex items-start gap-3 rounded-ctl bg-inset px-3.5 py-3"
              >
                <span className="mt-0.5 shrink-0">
                  {st === 'ready' ? (
                    <Check size={16} className="text-success" />
                  ) : st === 'downloading' ? (
                    <Loader2 size={16} className="animate-spin text-accent" />
                  ) : st === 'failed' || st === 'missing' ? (
                    <AlertTriangle size={16} className="text-warning" />
                  ) : (
                    <Clock size={16} className="text-subtle" />
                  )}
                </span>
                <div className="min-w-0 flex-1 text-[13px] leading-[18px]">
                  {showPicks && choices.includes(c.id) ? (
                    <ComponentPick
                      id={c.id}
                      label={t(LABELS[c.id], { app: DISPLAY_NAME })}
                      checked={!p.unchecked.includes(c.id)}
                      disabled={p.installing}
                      onChange={() => p.onToggle(c.id)}
                    >
                      {hint}
                    </ComponentPick>
                  ) : (
                    <>
                      <p className="font-medium text-fg">{t(LABELS[c.id], { app: DISPLAY_NAME })}</p>
                      {hint && <p className="text-muted">{hint}</p>}
                    </>
                  )}
                  {st === 'failed' && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button variant="secondary" size="sm" onClick={() => p.onInstall([c.id])} disabled={p.installing}>
                        <RefreshCw size={13} /> {t('preflight.retry')}
                      </Button>
                      {p.details[c.id] && (
                        <Button variant="secondary" size="sm" onClick={() => p.onCopy(c.id)}>
                          {p.copied === c.id ? <Check size={13} /> : <Copy size={13} />}{' '}
                          {p.copied === c.id ? t('preflight.copied') : t('preflight.copy')}
                        </Button>
                      )}
                    </div>
                  )}
                  {c.id === 'engine' && st === 'missing' && (
                    <div className="mt-2">
                      <Button variant="secondary" size="sm" onClick={p.onPickEngine}>
                        {t('preflight.engine.pick')}
                      </Button>
                    </div>
                  )}
                  {c.id === 'files' && st === 'pending' && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button variant="secondary" size="sm" onClick={() => p.onOpenFullDisk?.()}>
                        {t('preflight.files.open')}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => void call('app:relaunch')}>
                        {t('preflight.files.restart', { app: DISPLAY_NAME })}
                      </Button>
                    </div>
                  )}
                  {c.id === 'perms' && st === 'pending' && (
                    <div className="mt-2">
                      <Button variant="secondary" size="sm" onClick={p.onGrantPerms} disabled={p.permsWaiting}>
                        {p.permsWaiting ? <Loader2 size={13} className="animate-spin" /> : null}{' '}
                        {t(c.reason === 'restart' ? 'preflight.perms.openScreen' : 'preflight.perms.grant')}
                      </Button>
                    </div>
                  )}
                </div>
                <span className="shrink-0 pt-0.5 text-[12px] text-muted">{stateText(c)}</span>
              </li>
            )
          })}
        </ul>

        {(location === 'translocated' || location === 'volume') && <AppLocationNotice location={location} />}
        {perms && !perms.ok && perms.reason === 'restart' && <ScreenRestartNotice />}
        {perms && !perms.ok && p.permsStalled && <PermsHelp />}

        {guided && p.installing && p.progress && p.progress.total > 0 && (
          <div className="mt-4 w-full" data-testid="preflight-progress">
            <div
              role="progressbar"
              aria-label={t('preflight.acceptAll.progress', { done: p.progress.done, total: p.progress.total })}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(((p.progress.done + (p.progress.pct ?? 0) / 100) / p.progress.total) * 100)}
              className="h-1.5 w-full overflow-hidden rounded-full bg-active"
            >
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${Math.round(((p.progress.done + (p.progress.pct ?? 0) / 100) / p.progress.total) * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-[12px] text-muted">
              {t('preflight.acceptAll.progress', { done: p.progress.done, total: p.progress.total })}
            </p>
          </div>
        )}
        {stage !== 'perms' && choices.length > 0 && !p.installing && (
          <p className="mt-4 text-[13px] text-muted" data-testid="preflight-size">
            {plan.length === 0
              ? t('preflight.size.none')
              : bytes === 0
                ? t('preflight.size.zero')
                : t(guided && !p.custom ? 'preflight.acceptAll.size' : 'preflight.size', { size: t(size.key, { n: size.n }) })}
          </p>
        )}
        {stage === 'perms' && (
          <p className="mt-4 text-[12px] text-subtle" data-testid="preflight-perms-note">
            {t('preflight.perms.note')}
          </p>
        )}
        {block.length > 0 && <p className="mt-2 text-[12px] text-subtle">{t('preflight.cannotSkip', { app: DISPLAY_NAME })}</p>}

        {stage !== 'perms' && optional.length > 0 && canContinue(report, runtime) && (
          <p className="mt-2 text-[12px] text-subtle" data-testid="preflight-later-hint">
            {t('preflight.laterHint')}
          </p>
        )}

        <div className="sticky bottom-0 mt-5 flex w-full flex-wrap items-center justify-between gap-2 bg-bg py-2">
          <Button variant="ghost" onClick={p.onRecheck} disabled={p.installing}>
            <RefreshCw size={14} /> {t('preflight.recheck')}
          </Button>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {(stage === 'perms' ? permsPending : optional.length > 0) && !allDone && canContinue(report, runtime) && (
              <Button variant="secondary" onClick={p.onContinue}>
                {t('preflight.continueAnyway')}
              </Button>
            )}
            {allDone && (
              <Button variant="primary" onClick={p.onContinue}>
                {t('preflight.continue')}
              </Button>
            )}
            {guided && choices.length > 0 && !p.custom && (
              <Button variant="primary" size="lg" onClick={p.onAcceptAll} disabled={p.installing} loading={p.installing}>
                {p.installing ? t('preflight.installing') : anyFailed ? t('preflight.retry') : t('preflight.acceptAll')}
              </Button>
            )}
            {stage !== 'perms' && choices.length > 0 && (!guided || p.custom) && (
              <Button
                variant="primary"
                onClick={() => p.onInstall()}
                disabled={p.installing || !canInstall(report, p.unchecked)}
                loading={p.installing}
              >
                {p.installing ? t('preflight.installing') : anyFailed ? t('preflight.retry') : t('preflight.install')}
              </Button>
            )}
          </div>
          {guided && choices.length > 0 && (
            <Button
              variant="link"
              className="w-full justify-center"
              onClick={p.onCustom}
              disabled={p.installing}
              aria-expanded={p.custom === true}
            >
              {p.custom ? t('preflight.custom.hide') : t('preflight.custom.show')}
            </Button>
          )}
        </div>
      </section>
    </div>
  )
}
