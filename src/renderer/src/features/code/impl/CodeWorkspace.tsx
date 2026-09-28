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
  Code2,
  FileCode2,
  FolderOpen,
  FolderSearch,
  GitBranch,
  GitCompare,
  LayoutGrid,
  ListTodo,
  Loader2,
  Square,
  SquareTerminal,
  X
} from 'lucide-react'
import { IconButton } from '../../../components/IconButton'
import { ModelPicker } from '../../../components/ModelPicker'
import { useSettings } from '../../../stores/settings'
import { getCodeApi, nativeCode, useClient } from './client'
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
import { AgentSegmented, MOD, Tip, isEditableTarget } from './ui'

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
  const done = todos.filter((t) => t.status === 'completed' || t.status === 'cancelled').length
  if (done === todos.length && !open) return null
  const current = todos.find((t) => t.status === 'in_progress') ?? todos.find((t) => t.status === 'pending')
  const pct = Math.round((done / todos.length) * 100)
  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-2">
      <div className="overflow-hidden rounded-xl border border-border bg-elevated text-[13px] shadow-sm">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-muted hover:text-fg"
        >
          <ListTodo size={14} className="shrink-0 text-accent" />
          <span className="shrink-0 font-medium text-fg">Tareas</span>
          <span className="shrink-0 text-xs tabular-nums text-subtle">
            {done}/{todos.length}
          </span>
          {current && !open && <span className="min-w-0 truncate">{current.content}</span>}
          <span className="ml-auto flex shrink-0 items-center gap-2">
            <span className="h-1 w-16 overflow-hidden rounded-full bg-hover">
              <span className="block h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
            </span>
            <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </span>
        </button>
        {open && (
          <div className="max-h-56 overflow-y-auto border-t border-border px-3 py-2">
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
        {(Object.keys(PANEL_LABEL) as RightPanel[]).map((p, i) => (
          <Tip key={p} label={PANEL_LABEL[p]} shortcut={`${MOD}${i + 1}`}>
            <button
              type="button"
              onClick={() => p !== panel && togglePanel(p)}
              className={`no-drag rounded-md px-2.5 py-1 text-xs font-medium transition ${p === panel ? 'bg-active text-fg' : 'text-muted hover:bg-hover hover:text-fg'}`}
            >
              {PANEL_LABEL[p]}
            </button>
          </Tip>
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

interface BranchInfo {
  branch: string | null
  ahead: number
  behind: number
  changes: number
  upstream: string | null
}

/** Rama actual + ahead/behind (se refresca cuando cambian archivos). */
function useBranch(directory: string): BranchInfo | null {
  const fsVersion = useCode((s) => s.fsVersion)
  const [info, setInfo] = useState<BranchInfo | null>(null)
  useEffect(() => {
    let cancelled = false
    const api = nativeCode()
    const load = async (): Promise<BranchInfo | null> => {
      if (api) {
        const st = await api.git.status(directory)
        if (!st.isRepo) return null
        return { branch: st.detached ? (st.head?.slice(0, 7) ?? null) : st.branch, ahead: st.ahead, behind: st.behind, changes: st.files.length, upstream: st.upstream }
      }
      const st = await getCodeApi().gitStatus(directory)
      return { branch: st.branch, ahead: st.ahead, behind: st.behind, changes: st.files.length, upstream: null }
    }
    load()
      .then((i) => !cancelled && setInfo(i))
      .catch(() => !cancelled && setInfo(null))
    return () => {
      cancelled = true
    }
  }, [directory, fsVersion])
  return info
}

function ProjectMenu({ directory }: { directory: string }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const closeProject = useCode((s) => s.closeProject)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  const item = 'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-muted hover:bg-hover hover:text-fg'
  const native = nativeCode()
  return (
    <div ref={ref} className="no-drag relative max-w-48 min-w-12 shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={directory}
        className="flex max-w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-md px-1.5 py-1 text-sm font-semibold hover:bg-hover"
      >
        <FolderOpen size={15} className="shrink-0 text-accent" />
        <span className="truncate">{baseName(directory)}</span>
        <ChevronDown size={13} className="shrink-0 text-subtle" />
      </button>
      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 w-64 overflow-hidden rounded-xl border border-border bg-elevated py-1 shadow-xl">
          <div className="truncate px-3 py-1.5 font-mono text-[11px] text-subtle" title={directory}>
            {directory.replace(/^\/Users\/[^/]+/, '~')}
          </div>
          <button type="button" className={item} onClick={() => (setOpen(false), void pickAndOpenFolder())}>
            <FolderOpen size={14} /> Abrir otra carpeta…
          </button>
          <button type="button" className={item} onClick={() => (setOpen(false), closeProject())}>
            <LayoutGrid size={14} /> Proyectos recientes
          </button>
          {native && (
            <>
              <div className="my-1 h-px bg-border" />
              <button type="button" className={item} onClick={() => (setOpen(false), void native.dialog.revealInFinder(directory))}>
                <FolderSearch size={14} /> Mostrar en Finder
              </button>
              <button type="button" className={item} onClick={() => (setOpen(false), void native.dialog.openInEditor(directory))}>
                <Code2 size={14} /> Abrir en el editor
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function BranchPill({ directory }: { directory: string }): React.JSX.Element | null {
  const info = useBranch(directory)
  const togglePanel = useCode((s) => s.togglePanel)
  const panel = useCode((s) => s.panel)
  if (!info || !info.branch) return null
  const sync = info.ahead > 0 || info.behind > 0
  const tip = [
    `Rama ${info.branch}`,
    info.upstream ? `sigue a ${info.upstream}` : 'sin upstream',
    info.changes ? `${info.changes} archivos con cambios` : 'sin cambios'
  ].join(' · ')
  return (
    <Tip label={tip}>
      <button
        type="button"
        onClick={() => panel !== 'changes' && togglePanel('changes')}
        className="no-drag flex max-w-52 items-center gap-1.5 rounded-full border border-border bg-bg px-2 py-0.5 font-mono text-[11px] text-muted hover:border-border-strong hover:text-fg"
      >
        <GitBranch size={12} className="shrink-0" />
        <span className="truncate">{info.branch}</span>
        {sync && (
          <span className="flex shrink-0 items-center gap-1 text-subtle">
            {info.ahead > 0 && <span>↑{info.ahead}</span>}
            {info.behind > 0 && <span>↓{info.behind}</span>}
          </span>
        )}
        {info.changes > 0 && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />}
      </button>
    </Tip>
  )
}

const PANEL_META: { id: RightPanel; label: string; key: string; icon: React.JSX.Element }[] = [
  { id: 'changes', label: 'Cambios', key: '1', icon: <GitCompare size={16} /> },
  { id: 'terminal', label: 'Terminal', key: '2', icon: <SquareTerminal size={16} /> },
  { id: 'files', label: 'Archivos', key: '3', icon: <FileCode2 size={16} /> }
]

function Toolbar({ directory }: { directory: string }): React.JSX.Element {
  const session = useCode((s) => (s.activeSessionID ? s.sessions[s.activeSessionID] : undefined))
  const run = useCode((s) => (s.activeSessionID ? s.runState[s.activeSessionID] : undefined))
  const panel = useCode((s) => s.panel)
  const togglePanel = useCode((s) => s.togglePanel)
  const abort = useCode((s) => s.abort)
  const agent = useCode((s) => s.agent)
  const setAgent = useCode((s) => s.setAgent)
  const model = useCode((s) => s.model)
  const setModel = useCode((s) => s.setModel)
  const defaultModel = useSettings((s) => s.settings.defaultModel)
  const busy = run === 'busy' || run === 'retry'

  return (
    <div className="drag flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
      <ProjectMenu directory={directory} />
      <BranchPill directory={directory} />
      {session && (
        <span className="hidden min-w-0 items-center gap-2 text-sm text-muted lg:flex">
          <span className="text-subtle">/</span>
          <span className="truncate">{session.title || 'Sesión sin título'}</span>
        </span>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {busy && (
          <Tip label="Detener" shortcut="esc">
            <button
              type="button"
              onClick={() => void abort()}
              className="no-drag flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-danger hover:bg-danger/10"
            >
              <Square size={10} fill="currentColor" /> Detener
            </button>
          </Tip>
        )}
        <AgentSegmented value={agent} onChange={setAgent} size="sm" />
        {/* El menú del selector se alinea a la derecha para no salirse de la ventana. */}
        <div className="no-drag [&_.absolute]:right-0 [&_.absolute]:left-auto">
          <ModelPicker value={model ?? defaultModel} onChange={setModel} placement="bottom" />
        </div>
        <span className="mx-0.5 h-5 w-px bg-border" />
        {PANEL_META.map((p) => (
          <Tip key={p.id} label={p.label} shortcut={`${MOD}${p.key}`} align={p.id === 'files' ? 'end' : 'center'}>
            <button
              type="button"
              aria-label={p.label}
              aria-pressed={panel === p.id}
              onClick={() => togglePanel(p.id)}
              className={`no-drag inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${panel === p.id ? 'bg-active text-fg' : 'text-muted hover:bg-hover hover:text-fg'}`}
            >
              {p.icon}
            </button>
          </Tip>
        ))}
      </div>
    </div>
  )
}

const SUGGESTIONS: { label: string; prompt: string; agent: 'plan' | 'build' }[] = [
  { label: 'Explícame este proyecto', prompt: 'Explícame la estructura de este proyecto: qué hace, cómo está organizado y cuáles son sus piezas principales.', agent: 'plan' },
  { label: 'Revisa los cambios sin commitear', prompt: 'Revisa los cambios sin commitear (git diff) y dime si ves bugs, riesgos o mejoras.', agent: 'plan' },
  { label: 'Busca y corrige errores de tipos', prompt: 'Ejecuta el chequeo de tipos/lint del proyecto y corrige los errores que encuentres.', agent: 'build' },
  { label: 'Escribe tests para lo más crítico', prompt: 'Identifica la lógica más crítica sin tests y escribe tests para ella siguiendo las convenciones del proyecto.', agent: 'build' }
]

function EmptySession({ directory, error }: { directory: string; error: string | null }): React.JSX.Element {
  const send = useCode((s) => s.send)
  const setAgent = useCode((s) => s.setAgent)
  const client = useClient()
  return (
    <div className="w-full max-w-xl">
      <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        <Code2 size={22} />
      </div>
      <h2 className="text-xl font-semibold tracking-tight">¿Qué construimos en {baseName(directory)}?</h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted">
        Usa <b className="font-medium text-fg">Plan</b> para explorar y diseñar sin tocar archivos, o{' '}
        <b className="font-medium text-fg">Build</b> para que el agente edite y ejecute comandos. Te pedirá permiso cuando haga falta.
      </p>
      <div className="mt-6 grid grid-cols-1 gap-2 text-left sm:grid-cols-2">
        {SUGGESTIONS.map((sug) => (
          <button
            key={sug.label}
            type="button"
            disabled={!client}
            onClick={() => {
              setAgent(sug.agent)
              void send(sug.prompt)
            }}
            className="group flex items-start gap-2 rounded-xl border border-border bg-elevated px-3 py-2.5 text-sm transition hover:border-border-strong hover:bg-hover disabled:opacity-50"
          >
            <span className={`mt-0.5 shrink-0 rounded px-1 text-[10px] font-semibold uppercase ${sug.agent === 'plan' ? 'bg-accent-soft text-accent' : 'bg-hover text-muted'}`}>
              {sug.agent}
            </span>
            <span className="text-fg/90">{sug.label}</span>
          </button>
        ))}
      </div>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
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
            <EmptySession directory={directory} error={error} />
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

  // Atajos: ⌘1 Cambios · ⌘2 Terminal · ⌘3 Archivos · Esc detiene (fuera de campos de texto).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const st = useCode.getState()
      if (!st.directory) return
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && ['1', '2', '3'].includes(e.key)) {
        const p = (['changes', 'terminal', 'files'] as RightPanel[])[Number(e.key) - 1]
        e.preventDefault()
        st.togglePanel(p)
        return
      }
      if (e.key === 'Escape' && !e.defaultPrevented && !isEditableTarget(e.target)) {
        const sid = st.activeSessionID
        const run = sid ? st.runState[sid] : undefined
        if (run === 'busy' || run === 'retry') void st.abort()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
