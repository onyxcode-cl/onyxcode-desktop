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
  optionalPending,
  rowState,
  visibleRows,
  type PreflightComponent,
  type PreflightId,
  type PreflightReport,
  type RuntimeMap
} from '@shared/preflight'
import { Button } from '../../components/Button'
import { LogoMark } from '../../components/Logo'
import { useT } from '../../lib/i18n'
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
  onInstall: () => void
  onCopy: (id: PreflightId) => void
  onContinue: () => void
  onRecheck: () => void
  onGrantPerms: () => void
  onPickEngine: () => void
}

export function PreflightScreen(p: PreflightScreenProps): React.JSX.Element {
  const t = useT()
  const { report, runtime } = p
  const rows = visibleRows(report)
  const block = blocking(report)
  const optional = optionalPending(report)
  const plan = installPlan(report)
  const bytes = downloadBytes(report)
  const anyFailed = Object.values(runtime).some((r) => r?.state === 'failed')
  const location = report.components.find((c) => c.id === 'location' && !c.ok)?.reason
  const perms = report.components.find((c) => c.id === 'perms')
  const allDone = block.length === 0 && optional.length === 0
  const size = sizeParts(bytes)

  const stateText = (c: PreflightComponent): string => {
    const st = rowState(c, runtime)
    const pct = runtime[c.id]?.pct
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
        <h1
          id="preflight-title"
          tabIndex={-1}
          className="mt-5 font-display text-[26px] leading-8 font-semibold tracking-[-0.02em] outline-none"
        >
          {t('preflight.title', { app: DISPLAY_NAME })}
        </h1>
        <p className="mt-2 max-w-md text-[14px] leading-5 text-muted">
          {block.length > 0
            ? t('preflight.subtitle.blocking', { app: DISPLAY_NAME })
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
                  <p className="font-medium text-fg">{t(LABELS[c.id])}</p>
                  {hint && <p className="text-muted">{hint}</p>}
                  {st === 'failed' && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button variant="secondary" size="sm" onClick={p.onInstall} disabled={p.installing}>
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
                  {c.id === 'perms' && st === 'pending' && c.reason !== 'restart' && (
                    <div className="mt-2">
                      <Button variant="secondary" size="sm" onClick={p.onGrantPerms} disabled={p.permsWaiting}>
                        {p.permsWaiting ? <Loader2 size={13} className="animate-spin" /> : null} {t('preflight.perms.grant')}
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

        {plan.length > 0 && !p.installing && (
          <p className="mt-4 text-[13px] text-muted">{t('preflight.size', { size: t(size.key, { n: size.n }) })}</p>
        )}
        {block.length > 0 && <p className="mt-2 text-[12px] text-subtle">{t('preflight.cannotSkip', { app: DISPLAY_NAME })}</p>}

        <div className="mt-5 flex w-full items-center justify-between gap-2">
          <Button variant="ghost" onClick={p.onRecheck} disabled={p.installing}>
            <RefreshCw size={14} /> {t('preflight.recheck')}
          </Button>
          <div className="flex items-center gap-2">
            {optional.length > 0 && canContinue(report, runtime) && (
              <Button variant="secondary" onClick={p.onContinue}>
                {t('preflight.continueAnyway')}
              </Button>
            )}
            {allDone && (
              <Button variant="primary" onClick={p.onContinue}>
                {t('preflight.continue')}
              </Button>
            )}
            {plan.length > 0 && (
              <Button variant="primary" onClick={p.onInstall} disabled={p.installing || !canInstall(report)} loading={p.installing}>
                {p.installing ? t('preflight.installing') : anyFailed ? t('preflight.retry') : t('preflight.install')}
              </Button>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
