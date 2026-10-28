/**
 * Chip "Modo auto" del compositor: visible SOLO si el interruptor maestro está activo (Ajustes ›
 * Modo auto). Muestra si está encendido para la carpeta/tarea actuales y deja activarlo/desactivarlo
 * sin salir de la conversación. Cuando el Modo auto aprueba algo, el chip muestra brevemente
 * "Aprobado por el modo auto: …" (evento `tasks:auto:approved`, vía el store).
 */
import { useEffect, useRef, useState } from 'react'
import { Check, Eye, FolderClosed, Loader2, Zap } from 'lucide-react'
import { UI_LABELS } from '@shared/labels'
import { useT } from '../../../lib/i18n'
import { ChipMenu } from '../../../components/ChipMenu'
import { setAutoModeSettings, useTasks } from './store'
import { enableAutoOnlyFor, useUnified, useUnifiedApps } from './unified'

const NOTICE_MS = 5000

/** Chip del compositor: en el modo unificado es el selector «Manual / Automático» (siempre visible); si no, el chip de siempre. */
export function AutoModeChip(): React.JSX.Element | null {
  return useUnifiedApps() ? <UnifiedModeChip /> : <ClassicAutoModeChip />
}

/**
 * Modo unificado: «Manual» (pide permiso en cada acción sensible) o «Automático». No depende del interruptor maestro de Ajustes:
 * elegir «Automático» lo enciende para la carpeta (o, si aún no hay carpeta, para la que se cree al enviar). Lo que el modo
 * automático concede (p. ej. solo «Solo ver» a las apps de la lista permitida) lo decide main; aquí no se toca esa lógica.
 */
function UnifiedModeChip(): React.JSX.Element {
  const t = useT()
  const autoMode = useTasks((s) => s.autoMode)
  const folder = useTasks((s) => s.folder)
  const wantAuto = useUnified((s) => s.wantAuto)
  const settings = autoMode?.settings
  const auto = folder ? !!settings?.enabled && settings.folders.includes(folder) : wantAuto
  const blocked = !!autoMode?.policyDisabled
  const pick = (id: string): void => {
    const on = id === 'auto'
    if (on && blocked) return
    useUnified.setState({ wantAuto: folder ? false : on })
    if (folder) {
      const done = on ? enableAutoOnlyFor(folder) : setAutoModeSettings({ folder: { path: folder, on } })
      void done.catch(() => undefined)
    }
  }
  return (
    <ChipMenu
      name={t('tasksComputer.unified.modeAria')}
      valueLabel={auto ? t('tasksComputer.scope.auto') : t('tasksComputer.scope.manual')}
      icon={<Zap size={14} aria-hidden />}
      value={auto ? 'auto' : 'manual'}
      testId="auto-mode-chip"
      options={[
        { id: 'manual', label: t('tasksComputer.scope.manual'), hint: t('tasksComputer.scope.manual.desc') },
        { id: 'auto', label: t('tasksComputer.scope.auto'), hint: t('tasksComputer.scope.auto.desc'), disabled: blocked }
      ]}
      onSelect={pick}
    />
  )
}

function ClassicAutoModeChip(): React.JSX.Element | null {
  const t = useT()
  const settings = useTasks((s) => s.autoMode?.settings)
  const folder = useTasks((s) => s.folder)
  const activeTaskId = useTasks((s) => s.activeTaskId)
  const notice = useTasks((s) => s.autoApprovedNotice)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<'folder' | 'task' | null>(null)
  const [showNotice, setShowNotice] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!notice) return
    setShowNotice(true)
    const timer = setTimeout(() => setShowNotice(false), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (!settings?.enabled) return null

  const folderOn = !!folder && settings.folders.includes(folder)
  const taskOn = !!activeTaskId && settings.tasks.includes(activeTaskId)
  const active = folderOn || taskOn

  const toggleFolder = (): void => {
    if (!folder) return
    setBusy('folder')
    void setAutoModeSettings({ folder: { path: folder, on: !folderOn } }).finally(() => setBusy(null))
  }
  const toggleTask = (): void => {
    if (!activeTaskId) return
    setBusy('task')
    void setAutoModeSettings({ task: { sessionId: activeTaskId, on: !taskOn } }).finally(() => setBusy(null))
  }

  if (showNotice && notice) {
    return (
      <span
        role="status"
        className="flex shrink-0 items-center gap-1.5 rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent"
        title={notice.summary}
      >
        <Check size={12} /> {t('tasksComputer.auto.approved', { summary: notice.summary })}
      </span>
    )
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={t('tasksComputer.auto.title')}
        className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium transition hover:opacity-80 ${
          active ? 'border-accent/40 bg-accent-soft text-accent' : 'border-border bg-hover text-muted'
        }`}
      >
        <Zap size={12} /> {UI_LABELS.autoMode}
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-1 w-72 rounded-xl border border-border bg-elevated p-1 text-sm text-fg shadow-lg">
          <button
            type="button"
            onClick={toggleFolder}
            disabled={!folder || busy === 'folder'}
            className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-hover disabled:opacity-50"
          >
            <FolderClosed size={15} className="mt-0.5 shrink-0 text-muted" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{t('tasksComputer.auto.folder')}</span>
              <span className="block text-xs text-muted">{t('tasksComputer.auto.folderDesc')}</span>
            </span>
            {busy === 'folder' ? (
              <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin" />
            ) : (
              folderOn && <Check size={15} className="mt-0.5 shrink-0 text-accent" />
            )}
          </button>
          <button
            type="button"
            onClick={toggleTask}
            disabled={!activeTaskId || busy === 'task'}
            className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-hover disabled:opacity-50"
          >
            <Eye size={15} className="mt-0.5 shrink-0 text-muted" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{t('tasksComputer.auto.task')}</span>
              <span className="block text-xs text-muted">
                {activeTaskId ? t('tasksComputer.auto.taskDesc') : t('tasksComputer.auto.taskNone')}
              </span>
            </span>
            {busy === 'task' ? (
              <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin" />
            ) : (
              taskOn && <Check size={15} className="mt-0.5 shrink-0 text-accent" />
            )}
          </button>
        </div>
      )}
    </div>
  )
}
