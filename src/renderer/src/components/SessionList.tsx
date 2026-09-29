import { useEffect, useRef, useState } from 'react'
import type { Session } from '@opencode-ai/sdk/v2/client'
import { Check, Loader2, MessagesSquare, MoreHorizontal, Pencil, Search, Trash2, X } from 'lucide-react'

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
      <div className="flex items-center gap-1 rounded-lg bg-elevated px-2 py-1 ring-2 ring-accent/40">
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
        aria-current={active ? 'true' : undefined}
        className={`relative flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13.5px] transition-colors duration-150 ${active ? 'bg-active font-medium text-fg' : 'text-muted hover:bg-hover hover:text-fg'} ${menu ? 'bg-hover' : ''}`}
      >
        {active && <span className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full bg-accent" aria-hidden />}
        <span className="flex-1 truncate group-hover:pr-5">{session.title || 'Sin título'}</span>
        {busy && <Loader2 size={13} className="shrink-0 animate-spin text-accent group-hover:opacity-0" />}
      </button>
      <button
        type="button"
        onClick={() => setMenu((m) => !m)}
        aria-label="Opciones"
        className={`absolute top-1/2 right-1 -translate-y-1/2 rounded-md p-1 text-muted transition-opacity hover:bg-active hover:text-fg focus-visible:opacity-100 ${menu ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
      >
        <MoreHorizontal size={15} />
      </button>
      {menu && (
        <div className="absolute top-full right-0 z-40 mt-1 w-44 origin-top-right animate-pop-in overflow-hidden rounded-xl border border-border bg-elevated p-1 text-sm shadow-lg">
          <button
            type="button"
            onClick={() => {
              setMenu(false)
              setDraft(session.title)
              setEditing(true)
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-hover"
          >
            <Pencil size={14} className="text-muted" /> Renombrar
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
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-danger hover:bg-danger/10"
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
  const [filter, setFilter] = useState('')
  if (loading && sessions.length === 0) {
    return (
      <div className="flex flex-col gap-1.5 px-1 py-1" aria-busy="true" aria-label="Cargando">
        {[70, 55, 80, 45].map((w, i) => (
          <div key={i} className="h-7 animate-pulse rounded-lg bg-hover/70" style={{ width: `${w}%` }} />
        ))}
      </div>
    )
  }
  if (sessions.length === 0) {
    return (
      <div className="mx-1 mt-6 flex flex-col items-center gap-2 px-4 text-center">
        <MessagesSquare size={18} className="text-subtle" />
        <span className="text-xs text-subtle">{emptyText ?? 'No hay conversaciones'}</span>
      </div>
    )
  }
  const q = filter.trim().toLowerCase()
  const visible = q ? sessions.filter((s) => (s.title || '').toLowerCase().includes(q)) : sessions
  const groups: { label: string; items: Session[] }[] = []
  for (const s of visible) {
    const label = groupLabel(s.time.updated)
    const g = groups[groups.length - 1]
    if (g && g.label === label) g.items.push(s)
    else groups.push({ label, items: [s] })
  }
  return (
    <div className="flex flex-col gap-4">
      {sessions.length > 8 && (
        <div className="mx-0.5 flex items-center gap-2 rounded-lg border border-transparent bg-hover/60 px-2.5 py-1 transition-colors focus-within:border-accent/40 focus-within:bg-elevated">
          <Search size={13} className="shrink-0 text-subtle" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setFilter('')}
            placeholder="Buscar…"
            aria-label="Buscar conversaciones"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-subtle"
          />
          {filter && (
            <button type="button" onClick={() => setFilter('')} aria-label="Limpiar búsqueda" className="text-subtle hover:text-fg">
              <X size={12} />
            </button>
          )}
        </div>
      )}
      {q && groups.length === 0 && <div className="px-2.5 text-xs text-subtle">Sin coincidencias</div>}
      {groups.map((g) => (
        <div key={g.label}>
          <div className="px-2.5 pb-1 text-[10.5px] font-semibold tracking-[0.06em] text-subtle uppercase">{g.label}</div>
          <div className="flex flex-col gap-px">
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
