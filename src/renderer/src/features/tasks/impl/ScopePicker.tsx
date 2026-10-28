/**
 * Selector único de alcance de Overdrive: «Una carpeta» (carpeta obligatoria, aislada) o «El computador completo» (carpeta
 * opcional, sin límite). Un solo componente para los cuatro sitios donde se elegía (inicio, cabecera, panel Entorno y
 * caja de escribir): todos usan `useScope`, que delega en la misma acción `setAccessMode` (no cambia consentimientos ni
 * el diálogo de Control total). El modo Manual/Automático es el `AutoModeChip` de siempre (`tasks:auto:set`).
 */
import { Check, Loader2, MonitorCog, Shield } from 'lucide-react'
import { ChipMenu } from '../../../components/ChipMenu'
import { useT } from '../../../lib/i18n'
import { platformCaps } from '../../../lib/platform'
import { AutoModeChip } from './AutoModeChip'
import { FolderMenu } from './FolderMenu'
import { setAccessMode } from './actions'
import { useTasks } from './store'
import { isChatFolderPath, useUnifiedApps } from './unified'
import { baseName } from './util'

/** Estado y acción comunes del alcance; todas las variantes y los otros tres sitios lo usan. */
export function useScope(disabled?: boolean): {
  full: boolean
  canFull: boolean
  starting: boolean
  requested: boolean
  off: boolean
  pick: (fullAccess: boolean) => void
} {
  const conn = useTasks((s) => s.conn)
  const phase = useTasks((s) => s.phase)
  const requested = useTasks((s) => s.fullAccess)
  const full = conn ? conn.fullAccess : requested
  const starting = phase === 'starting'
  const off = !!disabled || starting
  // Sin Control del PC (Windows sin las condiciones) solo existe «Una carpeta»: la otra opción no se ofrece.
  const canFull = platformCaps().computer
  const pick = (fullAccess: boolean): void => {
    if (off || (fullAccess && !canFull) || (fullAccess === full && phase === 'ready')) return
    void setAccessMode(fullAccess)
  }
  return { full, canFull, starting, requested, off, pick }
}

/**
 * Modo unificado: el alcance ya no se «cambia»; el chip solo dice dónde trabaja: «Carpeta: <nombre>», «Sin carpeta elegida»
 * (chat con carpeta propia automática) o «Sin aislamiento (avanzado)» con un clic para volver a una carpeta.
 */
export function UnifiedScopeChip({ className = '' }: { className?: string }): React.JSX.Element {
  const t = useT()
  const conn = useTasks((s) => s.conn)
  const requested = useTasks((s) => s.fullAccess)
  const folder = useTasks((s) => s.folder)
  const full = conn ? conn.fullAccess : requested
  if (full) {
    return (
      <button
        type="button"
        data-testid="unified-scope-chip"
        onClick={() => void setAccessMode(false)}
        title={t('tasksComputer.unified.noIsolationBack')}
        className={`flex shrink-0 items-center gap-1 rounded-full border border-warning/50 bg-warning/10 px-2 py-0.5 text-xs whitespace-nowrap text-warning transition hover:opacity-80 ${className}`}
      >
        <MonitorCog size={12} aria-hidden /> {t('tasksComputer.unified.noIsolation')}
      </button>
    )
  }
  const label =
    folder && !isChatFolderPath(folder)
      ? t('tasksComputer.unified.folder', { name: baseName(folder) })
      : t('tasksComputer.unified.noFolderChat')
  return (
    <span
      data-testid="unified-scope-chip"
      title={folder ?? t('tasksComputer.unified.scopeTitle')}
      className={`flex max-w-[220px] shrink-0 items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs whitespace-nowrap text-fg ${className}`}
    >
      <Shield size={12} aria-hidden className="shrink-0" /> <span className="truncate">{label}</span>
    </span>
  )
}

/** Variante «chip» (caja de escribir): menú con las dos opciones y su frase. */
function ScopeChip({ disabled }: { disabled?: boolean }): React.JSX.Element {
  const t = useT()
  const { full, canFull, off, pick } = useScope(disabled)
  const unified = useUnifiedApps()
  if (unified) return <UnifiedScopeChip />
  return (
    <ChipMenu
      name={t('tasksComputer.access.aria')}
      valueLabel={full ? t('tasksComputer.scope.computer') : t('tasksComputer.scope.folder')}
      icon={full ? <MonitorCog size={14} aria-hidden /> : <Shield size={14} aria-hidden />}
      value={full ? 'full' : 'sandbox'}
      tone={full ? 'warning' : undefined}
      disabled={off}
      collapseClass="inline desk:@max-[34rem]:sr-only"
      shortClass="hidden desk:@max-[34rem]:inline"
      testId="access-chip"
      options={[
        {
          id: 'sandbox',
          label: t('tasksComputer.scope.folder'),
          shortLabel: t('tasksComputer.access.sandboxShort'),
          hint: t('tasksComputer.scope.folder.desc'),
          icon: <Shield size={14} className="text-accent" aria-hidden />
        },
        ...(canFull
          ? [
              {
                id: 'full',
                label: t('tasksComputer.scope.computer'),
                shortLabel: t('tasksComputer.access.fullShort'),
                hint: t('tasksComputer.scope.computer.desc'),
                icon: <MonitorCog size={14} className="text-warning" aria-hidden />,
                tone: 'warning' as const
              }
            ]
          : [])
      ]}
      onSelect={(id) => pick(id === 'full')}
    />
  )
}

/** Variante «cards» (inicio): las dos opciones con su descripción + carpeta + Manual/Automático en un solo bloque. */
function ScopeCards({ disabled }: { disabled?: boolean }): React.JSX.Element {
  const t = useT()
  const folder = useTasks((s) => s.folder)
  const { full, canFull, starting, requested, off, pick } = useScope(disabled)
  const unified = useUnifiedApps()

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      pick(false)
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowDown') && canFull) {
      e.preventDefault()
      pick(true)
    }
  }
  const row = (active: boolean, danger: boolean): string =>
    `flex w-full items-start gap-3 rounded-xl border px-3.5 py-2.5 text-left transition disabled:cursor-not-allowed ${
      active ? (danger ? 'border-warning/50 bg-warning/10' : 'border-accent/50 bg-accent-soft/50') : 'border-border hover:bg-hover'
    }`

  return (
    <div data-testid="scope-picker" className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-6">
      {canFull && !unified && (
        <div
          role="radiogroup"
          aria-label={t('tasksComputer.access.aria')}
          onKeyDown={onKey}
          title={disabled ? t('tasksComputer.access.waitTask') : undefined}
          className={`grid gap-2 sm:grid-cols-2 ${off ? 'opacity-70' : ''}`}
        >
          <button
            type="button"
            role="radio"
            data-testid="scope-folder"
            aria-checked={!full}
            aria-label={t('tasksComputer.scope.folder')}
            aria-description={t('tasksComputer.scope.folder.desc')}
            tabIndex={!full ? 0 : -1}
            disabled={off}
            onClick={() => pick(false)}
            title={!folder ? t('tasksComputer.access.pickFolder') : undefined}
            className={row(!full, false)}
          >
            <span className={`mt-0.5 shrink-0 ${!full ? 'text-accent' : 'text-muted'}`}>
              {starting && !requested ? <Loader2 size={16} className="animate-spin" /> : <Shield size={16} />}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{t('tasksComputer.scope.folder')}</span>
              <span className="block text-xs text-muted">{t('tasksComputer.scope.folder.desc')}</span>
            </span>
            {!full && <Check size={15} className="mt-0.5 ml-auto shrink-0 text-accent" aria-hidden />}
          </button>
          {canFull && (
            <button
              type="button"
              role="radio"
              data-testid="scope-computer"
              aria-checked={full}
              aria-label={t('tasksComputer.scope.computer')}
              aria-description={t('tasksComputer.scope.computer.desc')}
              tabIndex={full ? 0 : -1}
              disabled={off}
              onClick={() => pick(true)}
              className={row(full, true)}
            >
              <span className="mt-0.5 shrink-0 text-warning">
                {starting && requested ? <Loader2 size={16} className="animate-spin" /> : <MonitorCog size={16} />}
              </span>
              <span className="min-w-0">
                <span className={`block text-sm font-medium ${full ? 'text-warning' : ''}`}>{t('tasksComputer.scope.computer')}</span>
                <span className="block text-xs text-muted">{t('tasksComputer.scope.computer.desc')}</span>
              </span>
              {full && <Check size={15} className="mt-0.5 ml-auto shrink-0 text-warning" aria-hidden />}
            </button>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <FolderMenu variant="chip" placement="bottom" disabled={off} />
        <AutoModeChip />
      </div>
    </div>
  )
}

export function ScopePicker({ variant, disabled }: { variant: 'cards' | 'chip'; disabled?: boolean }): React.JSX.Element {
  return variant === 'cards' ? <ScopeCards disabled={disabled} /> : <ScopeChip disabled={disabled} />
}
