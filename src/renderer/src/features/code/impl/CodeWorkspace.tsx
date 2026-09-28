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
import type { AssistantMessage, Session } from '@opencode-ai/sdk/v2/client'
import {
  ChevronDown,
  CircleSlash,
  Code2,
  FileCode2,
  FolderOpen,
  FolderSearch,
  GitBranch,
  GitCompare,
  GitFork,
  Gauge,
  LayoutGrid,
  ListChecks,
  ListTodo,
  Loader2,
  PencilLine,
  Shield,
  Sparkles,
  Square,
  SquareTerminal,
  Wand2,
  X
} from 'lucide-react'
import { IconButton } from '../../../components/IconButton'
import { ModelPicker } from '../../../components/ModelPicker'
import { useSettings } from '../../../stores/settings'
import { useProviders } from '../../../stores/providers'
import { getCodeApi, nativeCode, useClient } from './client'
import { Composer } from './Composer'
import { MessageStream } from './MessageStream'
import { ChangesPanel } from './panels/ChangesPanel'
import { FilesPanel } from './panels/FilesPanel'
import { TerminalPanel } from './panels/TerminalPanel'
import { ProjectPicker, baseName, pickAndOpenFolder, TrustGate } from './ProjectPicker'
import { SessionList } from './SessionList'
import { ensureCodeSubscription, rootSessionID, useCode } from './store'
import { TodoList } from './ToolCard'
import type { PermissionMode, RightPanel } from './types'
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

const PERMISSION_MODE_META: { id: PermissionMode; label: string; hint: string; icon: React.JSX.Element }[] = [
  { id: 'manual', label: 'Manual', hint: 'Pregunta antes de cualquier acción', icon: <Shield size={13} /> },
  { id: 'acceptEdits', label: 'Aceptar ediciones', hint: 'Permite leer/editar archivos sin preguntar; el resto pregunta', icon: <PencilLine size={13} /> },
  { id: 'plan', label: 'Plan', hint: 'Solo explora y propone; no modifica nada', icon: <ListChecks size={13} /> },
  { id: 'auto', label: 'Auto', hint: 'Permite ediciones y comandos seguros; pregunta en lo riesgoso', icon: <Wand2 size={13} /> },
  { id: 'bypass', label: 'Bypass', hint: 'Permite todo sin preguntar (incluye bash). Úsalo con cuidado.', icon: <CircleSlash size={13} /> }
]

/** Selector de modo de permisos de la sesión activa (⌘⇧M). */
function PermissionModeMenu(): React.JSX.Element {
  const mode = useCode((s) => s.permissionMode)
  const setPermissionMode = useCode((s) => s.setPermissionMode)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  const current = PERMISSION_MODE_META.find((m) => m.id === mode) ?? PERMISSION_MODE_META[0]
  return (
    <div ref={ref} className="no-drag relative">
      <Tip label="Modo de permisos" shortcut={`${MOD}⇧M`}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${
            mode === 'bypass' ? 'bg-danger/10 text-danger' : 'text-muted hover:bg-hover hover:text-fg'
          }`}
        >
          {current.icon}
          {current.label}
        </button>
      </Tip>
      {open && (
        <div className="absolute top-full right-0 z-50 mt-1 w-64 overflow-hidden rounded-xl border border-border bg-elevated py-1 shadow-xl">
          {PERMISSION_MODE_META.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setOpen(false)
                void setPermissionMode(m.id)
              }}
              className={`flex w-full items-start gap-2 px-3 py-1.5 text-left text-sm hover:bg-hover ${mode === m.id ? 'text-fg' : 'text-muted'}`}
            >
              <span className="mt-0.5 shrink-0">{m.icon}</span>
              <span className="min-w-0">
                <span className="block font-medium">{m.label}</span>
                <span className="block text-xs text-subtle">{m.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Último mensaje del asistente en la sesión activa (para medidor de contexto). */
function useLastAssistant(sessionID: string | null): AssistantMessage | null {
  const entries = useCode((s) => (sessionID ? s.messages[sessionID] : undefined))
  return useMemo(() => {
    if (!entries) return null
    for (let i = entries.length - 1; i >= 0; i--) {
      const info = entries[i].info
      if (info.role === 'assistant') return info
    }
    return null
  }, [entries])
}

/** Medidor de contexto usado / límite del modelo actual, y selector de variante (esfuerzo) si aplica. */
function ContextAndVariant(): React.JSX.Element | null {
  const client = useClient()
  const directory = useCode((s) => s.directory)
  const activeSessionID = useCode((s) => s.activeSessionID)
  const model = useCode((s) => s.model)
  const variant = useCode((s) => s.variant)
  const setVariant = useCode((s) => s.setVariant)
  const defaultModel = useSettings((s) => s.settings.defaultModel)
  const providers = useProviders((s) => s.providers)
  const loadProviders = useProviders((s) => s.load)
  const last = useLastAssistant(activeSessionID)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (client) void loadProviders(client)
  }, [client, loadProviders])
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const effective = model ?? defaultModel
  const info = providers.find((p) => p.id === effective.providerID)?.models[effective.modelID]
  if (!directory || !info) return null

  const used = last && last.modelID === effective.modelID ? last.tokens.input + last.tokens.cache.read + last.tokens.cache.write : 0
  const limit = info.limit.context
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const variants = info.variants ? Object.keys(info.variants) : []

  return (
    <div className="no-drag flex items-center gap-1.5">
      {used > 0 && (
        <Tip label={`Contexto usado: ${used.toLocaleString('es-CL')} / ${limit.toLocaleString('es-CL')} tokens (${pct}%)`}>
          <span className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-subtle">
            <Gauge size={12} className={pct > 85 ? 'text-danger' : pct > 60 ? 'text-warning' : 'text-subtle'} />
            {pct}%
          </span>
        </Tip>
      )}
      {variants.length > 0 && (
        <div ref={ref} className="relative">
          <Tip label="Esfuerzo del modelo" shortcut={`${MOD}⇧E`}>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-hover hover:text-fg"
            >
              <Sparkles size={12} />
              {variant ?? 'estándar'}
            </button>
          </Tip>
          {open && (
            <div className="absolute top-full right-0 z-50 mt-1 w-40 overflow-hidden rounded-xl border border-border bg-elevated py-1 shadow-xl">
              <button
                type="button"
                onClick={() => {
                  setVariant(null)
                  setOpen(false)
                }}
                className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-hover ${!variant ? 'text-fg' : 'text-muted'}`}
              >
                Estándar
              </button>
              {variants.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => {
                    setVariant(v)
                    setOpen(false)
                  }}
                  className={`block w-full px-3 py-1.5 text-left text-sm capitalize hover:bg-hover ${variant === v ? 'text-fg' : 'text-muted'}`}
                >
                  {v}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Toolbar({ directory }: { directory: string }): React.JSX.Element {
  const session = useCode((s) => (s.activeSessionID ? s.sessions[s.activeSessionID] : undefined))
  const activeSessionID = useCode((s) => s.activeSessionID)
  const run = useCode((s) => (s.activeSessionID ? s.runState[s.activeSessionID] : undefined))
  const panel = useCode((s) => s.panel)
  const togglePanel = useCode((s) => s.togglePanel)
  const abort = useCode((s) => s.abort)
  const agent = useCode((s) => s.agent)
  const setAgent = useCode((s) => s.setAgent)
  const model = useCode((s) => s.model)
  const setModel = useCode((s) => s.setModel)
  const forkSession = useCode((s) => s.forkSession)
  const compactSession = useCode((s) => s.compactSession)
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
        {activeSessionID && (
          <>
            <Tip label="Bifurcar sesión (fork) desde aquí">
              <button
                type="button"
                disabled={busy}
                onClick={() => void forkSession(activeSessionID)}
                className="no-drag flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg disabled:opacity-40"
              >
                <GitFork size={14} />
              </button>
            </Tip>
            <Tip label="Compactar historial (resumir contexto)">
              <button
                type="button"
                disabled={busy}
                onClick={() => void compactSession(activeSessionID)}
                className="no-drag flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg disabled:opacity-40"
              >
                <Sparkles size={14} />
              </button>
            </Tip>
          </>
        )}
        <ContextAndVariant />
        <PermissionModeMenu />
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

/**
 * Tarjeta que aparece cuando el agente "plan" termina de responder: ofrece pasar a Build y pedirle
 * que ejecute lo planificado, sin que el usuario tenga que escribirlo.
 */
function PlanApprovalCard({ sessionID }: { sessionID: string }): React.JSX.Element | null {
  const agent = useCode((s) => s.agent)
  const run = useCode((s) => s.runState[sessionID])
  const entries = useCode((s) => s.messages[sessionID])
  const setAgent = useCode((s) => s.setAgent)
  const send = useCode((s) => s.send)
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)
  const busy = run === 'busy' || run === 'retry'

  const lastAssistant = useMemo(() => {
    if (!entries) return null
    for (let i = entries.length - 1; i >= 0; i--) if (entries[i].info.role === 'assistant') return entries[i]
    return null
  }, [entries])

  if (agent !== 'plan' || busy || !lastAssistant) return null
  const hasText = lastAssistant.parts.some((p) => p.type === 'text' && p.text.trim())
  if (!hasText || dismissedFor === lastAssistant.info.id) return null

  return (
    <div className="mx-auto mb-2 w-full max-w-3xl px-6">
      <div className="flex items-center gap-3 rounded-xl border border-accent/40 bg-accent-soft/40 px-3.5 py-2.5 text-sm">
        <ListChecks size={16} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1 text-fg/90">¿Construyo lo planificado?</span>
        <button
          type="button"
          onClick={() => setDismissedFor(lastAssistant.info.id)}
          className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-hover hover:text-fg"
        >
          Ahora no
        </button>
        <button
          type="button"
          onClick={() => {
            setDismissedFor(lastAssistant.info.id)
            setAgent('build')
            void send('Procede con el plan.')
          }}
          className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg hover:opacity-90"
        >
          Aprobar y construir
        </button>
      </div>
    </div>
  )
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
      {sid && <PlanApprovalCard sessionID={sid} />}
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

  // Título del documento: prefijo "(n)" con sesiones no leídas + marca como leída la activa al recuperar el foco.
  // Nota: esto es lo más parecido a un badge que se puede hacer sin tocar el proceso principal (Electron
  // `Notification`/`app.dock.setBadge` requieren un canal IPC nuevo — ver informe final del agente).
  const unread = useCode((s) => s.unread)
  const sessionProject = useCode((s) => s.sessionProject)
  const markRead = useCode((s) => s.markRead)
  useEffect(() => {
    if (!directory) return
    const count = Object.entries(unread).filter(([sid, v]) => v && sessionProject[sid] === directory).length
    const base = document.title.replace(/^\(\d+\)\s*/, '')
    document.title = count > 0 ? `(${count}) ${base}` : base
  }, [unread, sessionProject, directory])
  useEffect(() => {
    const onFocus = (): void => {
      const st = useCode.getState()
      if (st.activeSessionID) markRead(st.activeSessionID)
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [markRead])

  if (!directory) return <ProjectPicker />

  return (
    <div className="flex h-full min-h-0 w-full bg-bg text-fg">
      <TrustGate />
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
