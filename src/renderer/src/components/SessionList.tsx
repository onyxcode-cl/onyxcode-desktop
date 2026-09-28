import { useEffect, useRef, useState } from 'react'
import type { Session } from '@opencode-ai/sdk/v2/client'
import { Check, Loader2, MoreHorizontal, Pencil, Trash2, X } from 'lucide-react'

interface Props {
  sessions: Session[]
  activeId: string | null
  busyIds?: Set<string>
  loading?: boolean
  emptyText?: string
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void | Promise<void>
  onDelete: (id: string) => void | Promise<void>
}

function groupLabel(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (ts >= startOfDay) return 'Hoy'
  if (ts >= startOfDay - 86_400_000) return 'Ayer'
  if (ts >= startOfDay - 7 * 86_400_000) return 'Últimos 7 días'
  if (ts >= startOfDay - 30 * 86_400_000) return 'Últimos 30 días'
  return d.toLocaleDateString('es', { month: 'long', year: 'numeric' })
}

function Row({
  session,
  active,
  busy,
  onSelect,
  onRename,
  onDelete
}: {
  session: Session
  active: boolean
  busy: boolean
  onSelect: () => void
  onRename: (title: string) => void
  onDelete: () => void
}): React.JSX.Element {
  const [menu, setMenu] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [draft, setDraft] = useState(session.title)
  const inputRef = useRef<HTMLInputElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent): void => {
      if (rowRef.current && !rowRef.current.contains(e.target as Node)) {
        setMenu(false)
        setConfirmDelete(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menu])

  const commit = (): void => {
    const t = draft.trim()
    setEditing(false)
    if (t && t !== session.title) onRename(t)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1 rounded-lg bg-active px-2 py-1">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setEditing(false)
          }}
          onBlur={commit}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
        <Check size={14} className="text-muted" />
      </div>
    )
  }

  return (
    <div ref={rowRef} className="group relative">
      <button
        type="button"
        onClick={onSelect}
        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm ${active ? 'bg-active text-fg' : 'text-muted hover:bg-hover hover:text-fg'}`}
      >
        <span className="flex-1 truncate">{session.title || 'Sin título'}</span>
        {busy && <Loader2 size={13} className="shrink-0 animate-spin" />}
      </button>
      <button
        type="button"
        onClick={() => setMenu((m) => !m)}
        aria-label="Opciones"
        className={`absolute top-1/2 right-1 -translate-y-1/2 rounded-md p-1 text-muted hover:bg-hover hover:text-fg ${menu ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
      >
        <MoreHorizontal size={15} />
      </button>
      {menu && (
        <div className="absolute top-full right-0 z-40 mt-1 w-44 overflow-hidden rounded-lg border border-border bg-elevated py-1 text-sm shadow-lg">
          <button
            type="button"
            onClick={() => {
              setMenu(false)
              setDraft(session.title)
              setEditing(true)
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-hover"
          >
            <Pencil size={14} /> Renombrar
          </button>
          {confirmDelete ? (
            <div className="flex items-center gap-1 px-2 py-1">
              <button
                type="button"
                onClick={() => {
                  setMenu(false)
                  setConfirmDelete(false)
                  onDelete()
                }}
                className="flex-1 rounded-md bg-danger px-2 py-1 text-xs font-medium text-white"
              >
                Confirmar
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-md p-1 text-muted hover:bg-hover"
                aria-label="Cancelar"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-danger hover:bg-hover"
            >
              <Trash2 size={14} /> Eliminar
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Lista de sesiones agrupada por fecha, con renombrar/eliminar. */
export function SessionList({
  sessions,
  activeId,
  busyIds,
  loading,
  emptyText,
  onSelect,
  onRename,
  onDelete
}: Props): React.JSX.Element {
  if (loading && sessions.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted">
        <Loader2 size={14} className="animate-spin" /> Cargando…
      </div>
    )
  }
  if (sessions.length === 0) {
    return <div className="px-3 py-2 text-sm text-subtle">{emptyText ?? 'No hay conversaciones'}</div>
  }
  const groups: { label: string; items: Session[] }[] = []
  for (const s of sessions) {
    const label = groupLabel(s.time.updated)
    const g = groups[groups.length - 1]
    if (g && g.label === label) g.items.push(s)
    else groups.push({ label, items: [s] })
  }
  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => (
        <div key={g.label}>
          <div className="px-2.5 pb-1 text-[11px] font-medium text-subtle">{g.label}</div>
          <div className="flex flex-col gap-0.5">
            {g.items.map((s) => (
              <Row
                key={s.id}
                session={s}
                active={s.id === activeId}
                busy={busyIds?.has(s.id) ?? false}
                onSelect={() => onSelect(s.id)}
                onRename={(t) => void onRename(s.id, t)}
                onDelete={() => void onDelete(s.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
