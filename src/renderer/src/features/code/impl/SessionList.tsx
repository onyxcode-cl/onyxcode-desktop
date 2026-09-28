import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { FolderOpen, Loader2, MessageSquarePlus, ShieldAlert, Trash2 } from 'lucide-react'
import { baseName, pickAndOpenFolder } from './ProjectPicker'
import { rootSessionID, selectProjectSessions, useCode } from './store'

function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return 'ahora'
  const m = Math.round(s / 60)
  if (m < 60) return `hace ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.round(h / 24)
  return d === 1 ? 'ayer' : `hace ${d} días`
}

/**
 * Lista de sesiones del proyecto actual. Pensada tanto para la columna interna de
 * `CodeWorkspace` como para `SidebarContent` del modo en la barra lateral global.
 */
export function SessionList({ compact = false }: { compact?: boolean }): React.JSX.Element | null {
  const directory = useCode((s) => s.directory)
  const { sessions, sessionProject } = useCode(useShallow((s) => ({ sessions: s.sessions, sessionProject: s.sessionProject })))
  const activeSessionID = useCode((s) => s.activeSessionID)
  const runState = useCode((s) => s.runState)
  const permissions = useCode((s) => s.permissions)
  const loading = useCode((s) => s.loadingSessions)
  const selectSession = useCode((s) => s.selectSession)
  const newSession = useCode((s) => s.newSession)
  const deleteSession = useCode((s) => s.deleteSession)

  const list = useMemo(
    () => (directory ? selectProjectSessions({ sessions, sessionProject }, directory) : []),
    [sessions, sessionProject, directory]
  )
  const waiting = useMemo(
    () => new Set(Object.values(permissions).map((p) => rootSessionID(sessions, p.sessionID))),
    [permissions, sessions]
  )

  if (!directory) return null

  return (
    <div className="flex min-h-0 flex-col">
      {!compact && (
        <button
          type="button"
          onClick={() => void pickAndOpenFolder()}
          title={directory}
          className="no-drag mx-2 mb-1 flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-hover"
        >
          <FolderOpen size={15} className="shrink-0 text-accent" />
          <span className="truncate font-medium">{baseName(directory)}</span>
        </button>
      )}
      <button
        type="button"
        onClick={() => void newSession()}
        className="no-drag mx-2 mb-2 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted hover:bg-hover hover:text-fg"
      >
        <MessageSquarePlus size={15} /> Nueva sesión
      </button>
      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        {loading && list.length === 0 && (
          <div className="flex items-center gap-2 px-2 py-1 text-xs text-subtle">
            <Loader2 size={12} className="animate-spin" /> Cargando sesiones…
          </div>
        )}
        {!loading && list.length === 0 && <div className="px-2 py-1 text-xs text-subtle">Sin sesiones todavía.</div>}
        {list.map((s) => {
          const st = runState[s.id]
          return (
            <div
              key={s.id}
              className={`group flex items-center gap-1 rounded-lg ${s.id === activeSessionID ? 'bg-active' : 'hover:bg-hover'}`}
            >
              <button
                type="button"
                onClick={() => void selectSession(s.id)}
                className="no-drag flex min-w-0 flex-1 flex-col items-start px-2 py-1.5 text-left"
              >
                <span className="flex w-full items-center gap-1.5 text-[13px]">
                  {waiting.has(s.id) ? (
                    <ShieldAlert size={12} className="shrink-0 text-accent" />
                  ) : st === 'busy' || st === 'retry' ? (
                    <Loader2 size={12} className="shrink-0 animate-spin text-muted" />
                  ) : null}
                  <span className="truncate">{s.title || 'Sesión sin título'}</span>
                </span>
                <span className="text-[11px] text-subtle">
                  {timeAgo(s.time.updated)}
                  {s.summary && s.summary.files > 0 && (
                    <>
                      {' · '}
                      <span className="text-success">+{s.summary.additions}</span>{' '}
                      <span className="text-danger">-{s.summary.deletions}</span>
                    </>
                  )}
                </span>
              </button>
              <button
                type="button"
                title="Eliminar sesión"
                onClick={() => {
                  if (confirm(`¿Eliminar la sesión "${s.title || 'sin título'}"?`)) void deleteSession(s.id)
                }}
                className="no-drag mr-1 hidden h-6 w-6 shrink-0 items-center justify-center rounded-md text-subtle group-hover:flex hover:bg-bg hover:text-danger"
              >
                <Trash2 size={13} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
