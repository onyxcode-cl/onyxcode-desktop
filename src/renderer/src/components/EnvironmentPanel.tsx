/**
 * Panel «Entorno» (solo escritorio): de un vistazo, DÓNDE trabaja la IA. Equipo, carpeta, rama (Code) y, en Tareas, el modo de
 * acceso con un botón «Cambiar» y el punto de restauración. Es presentacional: quien lo usa le pasa los datos y la acción de cambiar.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, Folder, GitBranch, History, Laptop, MonitorCog, Shield } from 'lucide-react'
import { useT } from '../lib/i18n'
import { baseName, tildify } from '../lib/paths'
import { useDismiss } from '../lib/use-dismiss'

export interface EnvironmentMode {
  /** Control total (true) o «Solo en tu carpeta» (false). */
  full: boolean
  /** Nombre visible del modo actual (el mismo texto que la insignia del encabezado). */
  label: string
  /** Nombre visible del otro modo, para el botón «Cambiar». */
  otherLabel: string
  /** Deshabilita el cambio (tarea en curso o servidor arrancando). */
  busy?: boolean
  /** Motivo claro por el que no se puede cambiar (p. ej. falta una carpeta autorizada). */
  blockedReason?: string | null
  onChange: () => void
  /** Estado del punto de restauración; ausente = se omite la fila. */
  restore?: 'on' | 'off'
}

export interface EnvironmentPanelProps {
  /** Nombre del equipo; `null` mientras carga o si no se pudo leer. */
  hostName: string | null
  /** Carpeta de trabajo (ruta absoluta con `/` o `\`). */
  directory: string | null
  /** Rama git (solo Code). `changes` = archivos con cambios. */
  branch?: { name: string; changes: number } | null
  mode?: EnvironmentMode
}

function Row({
  icon,
  label,
  children,
  action
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <li className="flex items-start gap-3 px-3.5 py-2.5">
      <span className="mt-0.5 shrink-0 text-muted" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted">{label}</div>
        {children}
      </div>
      {action}
    </li>
  )
}

export function EnvironmentPanel({ hostName, directory, branch, mode }: EnvironmentPanelProps): React.JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const rootRef = useDismiss(open, close)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const id = useId()

  // Al abrir, el foco entra al panel; al cerrar con Esc vuelve al botón (un clic fuera deja el foco donde el usuario lo puso).
  useEffect(() => {
    if (open) dialogRef.current?.focus()
  }, [open])
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    }
  }

  const shown = directory ? tildify(directory) : null
  const name = directory ? baseName(directory) : null

  return (
    <div ref={rootRef} className="no-drag relative shrink-0" onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        className="no-drag flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted hover:bg-hover hover:text-fg"
      >
        {t('env.title')}
        <ChevronDown size={14} aria-hidden className={open ? 'rotate-180' : ''} />
      </button>
      {open && (
        <div
          ref={dialogRef}
          id={id}
          role="dialog"
          aria-label={t('env.aria')}
          tabIndex={-1}
          className="absolute top-full right-0 z-30 mt-1 w-[26rem] max-w-[calc(100vw-1.5rem)] rounded-xl border border-border bg-elevated text-sm text-fg shadow-lg outline-none"
        >
          <div className="flex items-center gap-1 border-b border-border px-3.5 py-2 text-sm font-medium">
            {t('env.title')}
            <ChevronDown size={14} aria-hidden className="text-muted" />
          </div>
          <ul className="divide-y divide-border">
            <Row icon={<Laptop size={16} />} label={t('env.host.name')}>
              <div className="truncate font-medium" title={hostName ?? undefined}>
                {hostName || '—'}
              </div>
              <div className="text-xs text-muted">{t('env.host.this')}</div>
            </Row>
            <Row icon={<Folder size={16} />} label={t('env.folder.label')}>
              {directory ? (
                <>
                  <div className="truncate font-medium" title={name ?? undefined}>
                    {name}
                  </div>
                  <div className="text-xs [overflow-wrap:anywhere] text-muted" title={directory} data-testid="env-path">
                    {shown}
                  </div>
                </>
              ) : (
                <div className="text-muted">{t('env.folder.none')}</div>
              )}
            </Row>
            {branch && (
              <Row icon={<GitBranch size={16} />} label={t('env.branch.label')}>
                <div className="truncate font-mono font-medium" title={branch.name}>
                  {branch.name}
                </div>
                <div className="text-xs text-muted">
                  {branch.changes > 0 ? t('env.branch.changes', { count: branch.changes }) : t('env.branch.clean')}
                </div>
              </Row>
            )}
            {mode && (
              <>
                <Row
                  icon={mode.full ? <MonitorCog size={16} className="text-warning" /> : <Shield size={16} className="text-accent" />}
                  label={t('env.mode.label')}
                  action={
                    <button
                      type="button"
                      disabled={mode.busy || !!mode.blockedReason}
                      aria-label={t('env.mode.changeTo', { mode: mode.otherLabel })}
                      onClick={mode.onChange}
                      className="no-drag shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t('env.mode.change')}
                    </button>
                  }
                >
                  <div className={`font-medium ${mode.full ? 'text-warning' : ''}`}>{mode.label}</div>
                  {mode.blockedReason && (
                    <div className="text-xs text-muted" role="note">
                      {mode.blockedReason}
                    </div>
                  )}
                </Row>
                {mode.restore && (
                  <Row icon={<History size={16} />} label={t('env.restore.label')}>
                    <div className="font-medium">{mode.restore === 'on' ? t('env.restore.on') : t('env.restore.off')}</div>
                  </Row>
                )}
              </>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
