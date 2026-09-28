/**
 * Modo Code: agente de programación sobre una carpeta (sesiones OpenCode con `directory` = proyecto).
 *
 *  ┌ sesiones ┬──────────── chat ────────────┬─ panel derecho ─┐
 *  │          │ toolbar (agente, acciones)    │ Cambios          │
 *  │          │ mensajes + permisos           │ Terminal         │
 *  │          │ composer (Plan / Build)       │ Archivos         │
 *  └──────────┴──────────────────────────────┴──────────────────┘
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Session } from '@opencode-ai/sdk/v2/client'
import {
  ChevronDown,
  FileCode2,
  FolderOpen,
  GitCompare,
  ListTodo,
  Loader2,
  Square,
  SquareTerminal,
  Undo2,
  X
} from 'lucide-react'
import { IconButton } from '../../../components/IconButton'
import { useClient } from './client'
import { Composer } from './Composer'
import { MessageStream } from './MessageStream'
import { ChangesPanel } from './panels/ChangesPanel'
import { FilesPanel } from './panels/FilesPanel'
import { TerminalPanel } from './panels/TerminalPanel'
import { ProjectPicker, baseName, pickAndOpenFolder } from './ProjectPicker'
import { SessionList } from './SessionList'
import { ensureCodeSubscription, rootSessionID, useCode } from './store'
import { TodoList } from './ToolCard'
import type { RightPanel } from './types'

const PANEL_LABEL: Record<RightPanel, string> = { changes: 'Cambios', terminal: 'Terminal', files: 'Archivos' }
const PANEL_WIDTH_KEY = 'code.panelWidth'

function readWidth(): number {
  try {
    const v = Number(localStorage.getItem(PANEL_WIDTH_KEY))
    if (v >= 280 && v <= 1200) return v
  } catch {
    // ignorar
  }
  return 460
}

function TodoBar({ sessionID }: { sessionID: string }): React.JSX.Element | null {
  const todos = useCode((s) => s.todos[sessionID])
  const [open, setOpen] = useState(false)
  if (!todos || todos.length === 0) return null
  const done = todos.filter((t) => t.status === 'completed').length
  if (done === todos.length && !open) return null
  const current = todos.find((t) => t.status === 'in_progress')
  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-2">
      <div className="rounded-xl border border-border bg-elevated text-[13px]">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-muted hover:text-fg"
        >
          <ListTodo size={14} />
          <span className="font-medium text-fg">
            Tareas {done}/{todos.length}
          </span>
          {current && !open && <span className="truncate">· {current.content}</span>}
          <ChevronDown size={13} className={`ml-auto shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <div className="max-h-48 overflow-y-auto border-t border-border px-3 py-2">
            <TodoList todos={todos} />
          </div>
        )}
      </div>
    </div>
  )
}

function SidePanels({ directory }: { directory: string }): React.JSX.Element | null {
  const panel = useCode((s) => s.panel)
  const togglePanel = useCode((s) => s.togglePanel)
  const [width, setWidth] = useState(readWidth)
  // La terminal se mantiene montada tras abrirse para conservar el shell.
  const [terminalMounted, setTerminalMounted] = useState(panel === 'terminal')
  useEffect(() => {
    if (panel === 'terminal') setTerminalMounted(true)
  }, [panel])
  useEffect(() => {
    setTerminalMounted(panel === 'terminal')
    // Al cambiar de proyecto se descarta la terminal anterior (solo depende de `directory`).
  }, [directory]) // eslint-disable-line react-hooks/exhaustive-deps

  const dragging = useRef<{ x: number; w: number } | null>(null)
  const onPointerDown = (e: React.PointerEvent): void => {
    dragging.current = { x: e.clientX, w: width }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    if (!dragging.current) return
    const next = Math.min(1200, Math.max(280, dragging.current.w + (dragging.current.x - e.clientX)))
    setWidth(next)
  }
  const onPointerUp = (): void => {
    dragging.current = null
    try {
      localStorage.setItem(PANEL_WIDTH_KEY, String(width))
    } catch {
      // ignorar
    }
  }

  if (!panel && !terminalMounted) return null
  return (
    <div
      className={`relative flex h-full min-h-0 shrink-0 flex-col border-l border-border bg-bg ${panel ? '' : 'hidden'}`}
      style={{ width }}
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="absolute top-0 bottom-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-accent/20"
      />
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
        {(Object.keys(PANEL_LABEL) as RightPanel[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => p !== panel && togglePanel(p)}
            className={`no-drag rounded-md px-2 py-1 text-xs font-medium ${p === panel ? 'bg-active text-fg' : 'text-muted hover:bg-hover hover:text-fg'}`}
          >
            {PANEL_LABEL[p]}
          </button>
        ))}
        <IconButton label="Cerrar panel" className="ml-auto h-7 w-7" onClick={() => panel && togglePanel(panel)}>
          <X size={14} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1">
        {panel === 'changes' && <ChangesPanel directory={directory} />}
        {panel === 'files' && <FilesPanel directory={directory} />}
        {terminalMounted && (
          <div className={panel === 'terminal' ? 'h-full' : 'hidden'}>
            <TerminalPanel key={directory} directory={directory} visible={panel === 'terminal'} />
          </div>
        )}
      </div>
    </div>
  )
}

function Toolbar({ directory }: { directory: string }): React.JSX.Element {
  const activeSessionID = useCode((s) => s.activeSessionID)
  const session = useCode((s) => (s.activeSessionID ? s.sessions[s.activeSessionID] : undefined))
  const run = useCode((s) => (s.activeSessionID ? s.runState[s.activeSessionID] : undefined))
  const hasUserMessages = useCode((s) =>
    s.activeSessionID ? (s.messages[s.activeSessionID] ?? []).some((m) => m.info.role === 'user') : false
  )
  const panel = useCode((s) => s.panel)
  const togglePanel = useCode((s) => s.togglePanel)
  const abort = useCode((s) => s.abort)
  const revertLast = useCode((s) => s.revertLast)
  const busy = run === 'busy' || run === 'retry'
  const [reverting, setReverting] = useState(false)

  return (
    <div className="drag flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
      <button
        type="button"
        onClick={() => void pickAndOpenFolder()}
        title={`${directory}\nCambiar de carpeta`}
        className="no-drag flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium hover:bg-hover"
      >
        <FolderOpen size={15} className="shrink-0 text-accent" />
        <span className="truncate">{baseName(directory)}</span>
      </button>
      {session && (
        <>
          <span className="text-subtle">/</span>
          <span className="min-w-0 truncate text-sm text-muted">{session.title || 'Sesión sin título'}</span>
        </>
      )}
      <div className="ml-auto flex items-center gap-1">
        {busy && (
          <button
            type="button"
            onClick={() => void abort()}
            className="no-drag flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-danger hover:bg-hover"
          >
            <Square size={11} fill="currentColor" /> Abortar
          </button>
        )}
        <IconButton
          label="Revertir último cambio"
          disabled={!activeSessionID || !hasUserMessages || busy || reverting}
          onClick={() => {
            setReverting(true)
            void revertLast().finally(() => setReverting(false))
          }}
        >
          {reverting ? <Loader2 size={16} className="animate-spin" /> : <Undo2 size={16} />}
        </IconButton>
        <span className="mx-1 h-5 w-px bg-border" />
        <IconButton label="Cambios" active={panel === 'changes'} onClick={() => togglePanel('changes')}>
          <GitCompare size={16} />
        </IconButton>
        <IconButton label="Terminal" active={panel === 'terminal'} onClick={() => togglePanel('terminal')}>
          <SquareTerminal size={16} />
        </IconButton>
        <IconButton label="Archivos" active={panel === 'files'} onClick={() => togglePanel('files')}>
          <FileCode2 size={16} />
        </IconButton>
      </div>
    </div>
  )
}

function belongs(sessions: Record<string, Session>, sessionID: string, active: string): boolean {
  const root = rootSessionID(sessions, sessionID)
  return root === active || !sessions[root]
}

function ChatColumn({ directory }: { directory: string }): React.JSX.Element {
  const sid = useCode((s) => s.activeSessionID)
  const entries = useCode((s) => (sid ? s.messages[sid] : undefined))
  const run = useCode((s) => (sid ? s.runState[sid] : undefined))
  const error = useCode((s) => (sid ? (s.errors[sid] ?? null) : null))
  const loading = useCode((s) => (sid ? !!s.loadingMessages[sid] : false))
  const revertID = useCode((s) => (sid ? s.sessions[sid]?.revert?.messageID : undefined))
  const globalError = useCode((s) => s.globalError)
  const setGlobalError = useCode((s) => s.setGlobalError)
  const unrevert = useCode((s) => s.unrevert)
  const permissionsAll = useCode(useShallow((s) => Object.values(s.permissions)))
  const questionsAll = useCode(useShallow((s) => Object.values(s.questions)))
  const sessions = useCode((s) => s.sessions)
  const permissions = useMemo(
    // Permisos de sesiones desconocidas (subagentes aún no listados) se muestran en la sesión activa.
    () => permissionsAll.filter((p) => !!sid && belongs(sessions, p.sessionID, sid)),
    [permissionsAll, sessions, sid]
  )
  const questions = useMemo(
    () => questionsAll.filter((q) => !!sid && belongs(sessions, q.sessionID, sid)),
    [questionsAll, sessions, sid]
  )
  const client = useClient()
  const busy = run === 'busy' || run === 'retry'

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <Toolbar directory={directory} />
      {globalError && (
        <div className="flex items-center gap-2 border-b border-danger/30 bg-danger/10 px-4 py-1.5 text-xs text-danger">
          <span className="min-w-0 flex-1 truncate">{globalError}</span>
          <button type="button" onClick={() => setGlobalError(null)} className="shrink-0 hover:underline">
            Cerrar
          </button>
        </div>
      )}
      {sid && entries && entries.length > 0 ? (
        <MessageStream
          entries={entries}
          busy={busy}
          error={error}
          root={directory}
          permissions={permissions}
          questions={questions}
          revertMessageID={revertID}
          onUnrevert={() => void unrevert()}
          loading={loading}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
          {loading ? (
            <Loader2 size={18} className="animate-spin text-muted" />
          ) : (
            <>
              <h2 className="text-lg font-semibold">¿Qué construimos en {baseName(directory)}?</h2>
              <p className="mt-1 max-w-md text-sm text-muted">
                Usa <b>Plan</b> para explorar y diseñar sin tocar archivos, o <b>Build</b> para que el agente edite y
                ejecute comandos. Se te pedirá permiso cuando haga falta.
              </p>
              {error && <p className="mt-3 text-sm text-danger">{error}</p>}
            </>
          )}
        </div>
      )}
      {sid && <TodoBar sessionID={sid} />}
      <Composer busy={busy} disabled={!client} />
    </div>
  )
}

interface CodeWorkspaceProps {
  /**
   * Muestra la lista de sesiones como columna interna. Desactivar si el layout ya la
   * muestra en la barra lateral global (usando `CodeSidebar`).
   */
  showSessionList?: boolean
}

export function CodeWorkspace({ showSessionList = true }: CodeWorkspaceProps): React.JSX.Element {
  const client = useClient()
  const directory = useCode((s) => s.directory)
  const openProject = useCode((s) => s.openProject)

  useEffect(() => ensureCodeSubscription(), [])

  // Al conectar (o reconectar con un cliente nuevo), recarga el proyecto abierto.
  const loadedFor = useRef<unknown>(null)
  useEffect(() => {
    if (!client) return
    const dir = useCode.getState().directory
    if (!dir || loadedFor.current === client) return
    loadedFor.current = client
    void openProject(dir)
  }, [client, openProject])

  if (!directory) return <ProjectPicker />

  return (
    <div className="flex h-full min-h-0 w-full bg-bg text-fg">
      {showSessionList && (
        <div className="flex w-60 shrink-0 flex-col border-r border-border bg-sidebar pt-2">
          <SessionList />
        </div>
      )}
      <ChatColumn directory={directory} />
      <SidePanels directory={directory} />
    </div>
  )
}

/** Contenido para la barra lateral global del modo Code (sesiones del proyecto actual). */
export function CodeSidebar(): React.JSX.Element | null {
  useEffect(() => ensureCodeSubscription(), [])
  return <SessionList />
}

/** Acción "nueva sesión" para el botón principal de la barra lateral. */
export function newCodeSession(): void {
  const { directory, newSession } = useCode.getState()
  if (directory) void newSession()
  else void pickAndOpenFolder()
}

export default CodeWorkspace
