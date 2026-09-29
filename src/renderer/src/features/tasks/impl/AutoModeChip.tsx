/**
 * Chip "Modo auto" del compositor: visible SOLO si el interruptor maestro está activo (Ajustes ›
 * Modo auto). Muestra si está encendido para la carpeta/tarea actuales y deja activarlo/desactivarlo
 * sin salir de la conversación. Cuando el Modo auto aprueba algo, el chip muestra brevemente
 * "Aprobado por el modo auto: …" (evento `tasks:auto:approved`, vía el store).
 */
import { useEffect, useRef, useState } from 'react'
import { Check, Eye, FolderClosed, Loader2, Zap } from 'lucide-react'
import { setAutoModeSettings, useCowork } from './store'

const NOTICE_MS = 5000

export function AutoModeChip(): React.JSX.Element | null {
  const settings = useCowork((s) => s.autoMode?.settings)
  const folder = useCowork((s) => s.folder)
  const activeTaskId = useCowork((s) => s.activeTaskId)
  const notice = useCowork((s) => s.autoApprovedNotice)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<'folder' | 'task' | null>(null)
  const [showNotice, setShowNotice] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!notice) return
    setShowNotice(true)
    const t = setTimeout(() => setShowNotice(false), NOTICE_MS)
    return () => clearTimeout(t)
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
        <Check size={12} /> Aprobado por el modo auto: {notice.summary}
      </span>
    )
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Modo auto: aprueba en automático lo de bajo riesgo para esta carpeta o tarea"
        className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium transition hover:opacity-80 ${
          active ? 'border-accent/40 bg-accent-soft text-accent' : 'border-border bg-hover text-muted'
        }`}
      >
        <Zap size={12} /> Modo auto
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
              <span className="block font-medium">Activarlo en esta carpeta</span>
              <span className="block text-xs text-muted">Vale para todas las tareas de esta carpeta.</span>
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
              <span className="block font-medium">Activarlo solo en esta tarea</span>
              <span className="block text-xs text-muted">
                {activeTaskId ? 'Vale mientras exista esta tarea.' : 'Abre o empieza una tarea primero.'}
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
