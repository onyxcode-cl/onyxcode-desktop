/**
 * Sección «Cambios en archivos» del panel de progreso: qué cambió la tarea en la carpeta desde el
 * primer punto de restauración (nuevo / modificado / eliminado, con +N −M y la diferencia al
 * desplegar), y el botón «Deshacer los cambios de esta tarea». También «Deshacer desde aquí» en
 * cada mensaje del usuario (ver `TaskConversation.tsx`).
 */
import { useEffect, useState } from 'react'
import { ChevronRight, FileDiff, Loader2, RefreshCw, Undo2 } from 'lucide-react'
import type { TasksRestoreChange } from '@shared/ipc-tasks'
import { Button } from '../../../components/Button'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { DiffView } from '../../../components/DiffView'
import { errorMessage } from '../../../lib/opencode'
import { undoTaskChanges } from './actions'
import { cw } from './bridge'
import { Section } from './PanelSection'
import { firstPoint, notRestorableText } from './restore-logic'
import { useTasks } from './store'

const BADGE: Record<TasksRestoreChange['status'], { label: string; cls: string }> = {
  added: { label: 'Nuevo', cls: 'bg-success/15 text-success' },
  modified: { label: 'Modificado', cls: 'bg-accent-soft text-accent' },
  deleted: { label: 'Eliminado', cls: 'bg-danger/15 text-danger' }
}

interface Loaded {
  changes: TasksRestoreChange[]
  truncated: boolean
  /** No hay ningún punto de restauración guardado para la tarea. */
  noPoint: boolean
}

/** Consulta los cambios al abrir, al terminar un turno y tras crear o aplicar un punto. */
function useChanges(sessionID: string, busy: boolean): { data: Loaded | null; loading: boolean; error: string | null; reload: () => void } {
  const folder = useTasks((s) => s.folder)
  const version = useTasks((s) => s.restoreVersion)
  const [data, setData] = useState<Loaded | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!folder || busy) return
    let alive = true
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const point = firstPoint(await cw('tasks:restore:list', { folder, sessionId: sessionID }))
        if (!point) {
          if (alive) setData({ changes: [], truncated: false, noPoint: true })
          return
        }
        const res = await cw('tasks:restore:changes', { folder, pointId: point.id })
        if (alive) setData({ ...res, noPoint: false })
      } catch (err) {
        if (alive) setError(errorMessage(err))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [folder, sessionID, busy, version, tick])

  // Al cambiar de tarea no se enseñan los cambios de la anterior.
  useEffect(() => setData(null), [sessionID])
  return { data, loading, error, reload: () => setTick((n) => n + 1) }
}

function ChangeRow({ change }: { change: TasksRestoreChange }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const b = BADGE[change.status]
  const name = change.path.split('/').pop() ?? change.path
  const dir = change.path.includes('/') ? change.path.slice(0, change.path.lastIndexOf('/')) : ''
  return (
    <li className="rounded-md border border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={change.path}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs hover:bg-hover"
      >
        <ChevronRight size={12} className={`shrink-0 text-subtle transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium text-fg">{name}</span>
          {dir && <span className="text-subtle"> {dir}</span>}
        </span>
        <span className={`shrink-0 rounded px-1.5 py-px text-[11px] font-medium ${b.cls}`}>{b.label}</span>
        {!change.binary && (
          <span className="shrink-0 text-[11px] tabular-nums">
            <span className="text-success">+{change.additions}</span> <span className="text-danger">−{change.deletions}</span>
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-border">
          {change.patch ? (
            <DiffView patch={change.patch} path={change.path} hideFileHeaders className="max-h-72" />
          ) : change.binary ? (
            <p className="px-3 py-2 text-xs text-subtle">Archivo binario: no se puede mostrar la diferencia.</p>
          ) : (
            <p className="px-3 py-2 text-xs text-subtle">Hay demasiados cambios para mostrar la diferencia de este archivo.</p>
          )}
          {!change.restorable && (
            <p className="border-t border-border px-3 py-1.5 text-[11px] text-warning">{notRestorableText(change.reason)}</p>
          )}
        </div>
      )}
    </li>
  )
}

export function ChangesSection({ sessionID, busy }: { sessionID: string; busy: boolean }): React.JSX.Element {
  const { data, loading, error, reload } = useChanges(sessionID, busy)
  const fullAccess = useTasks((s) => s.conn?.fullAccess === true)
  const [working, setWorking] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const count = data?.changes.length ?? 0

  const undoAll = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: '¿Deshacer los cambios de esta tarea?',
      message:
        'Los archivos de esta carpeta volverán a como estaban antes de que empezara la tarea. Los archivos nuevos irán a la Papelera. Lo que el agente hizo fuera de la carpeta (comandos, webs, otras apps) no se deshace.',
      confirmLabel: 'Deshacer cambios',
      danger: true
    })
    if (!ok) return
    setWorking(true)
    setActionError(null)
    try {
      await undoTaskChanges(sessionID)
    } catch (err) {
      setActionError(errorMessage(err))
    } finally {
      setWorking(false)
    }
  }

  return (
    <Section
      icon={FileDiff}
      title="Cambios en archivos"
      badge={count > 0 ? count : undefined}
      right={
        <button
          type="button"
          title="Actualizar"
          disabled={busy || loading}
          className="rounded p-1 text-subtle hover:bg-hover hover:text-fg disabled:opacity-40"
          onClick={reload}
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        </button>
      }
    >
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : !data ? (
        <p className="text-xs text-subtle">{busy ? 'Los cambios aparecerán cuando el agente termine.' : 'Buscando cambios…'}</p>
      ) : data.noPoint ? (
        <p className="text-xs text-subtle">
          Esta tarea no tiene un punto de restauración guardado, así que no se pueden mostrar ni deshacer los cambios.
        </p>
      ) : data.changes.length === 0 ? (
        <p className="text-xs text-subtle">Sin cambios en los archivos de la carpeta desde que empezó la tarea.</p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {data.changes.map((c) => (
              <ChangeRow key={c.path} change={c} />
            ))}
          </ul>
          {data.truncated && <p className="mt-1.5 text-[11px] text-subtle">Hay más cambios de los que se pueden mostrar aquí.</p>}
          <Button variant="secondary" size="sm" className="mt-3 w-full" disabled={busy || working} onClick={() => void undoAll()}>
            {working ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />} Deshacer los cambios de esta tarea
          </Button>
          {actionError && <p className="mt-1.5 text-xs text-danger">{actionError}</p>}
          {fullAccess && (
            <p className="mt-2 text-[11px] text-subtle">En Control total el agente podría alterar las copias guardadas de los archivos.</p>
          )}
        </>
      )}
    </Section>
  )
}
