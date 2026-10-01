/**
 * Modo Tareas: tareas autónomas sobre una carpeta de Tareas, ejecutadas por el agente
 * `tasks` en un `opencode serve` dedicado y sandboxeado (sandbox-exec), o por el agente
 * `computer` en un servidor de Control total (control del Mac).
 *
 * Diseño: tareas a la izquierda (barra lateral del shell) · inicio / conversación al centro ·
 * Plan, Entregables y Actividad (o la Consulta lateral) a la derecha (colapsable).
 */
import { ErrorNotice } from '../../../components/conversation/ErrorNotice'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  CalendarClock,
  FileDown,
  FolderOpen,
  Globe,
  Loader2,
  MessagesSquare,
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Sparkles,
  Wand2,
  Workflow,
  type LucideIcon
} from 'lucide-react'
import type { PermissionRequest } from '@opencode-ai/sdk/v2/client'
import type { BrowserOwner, BrowserToChat } from '@shared/ipc-browser'
import type { TasksDeliverable } from '@shared/ipc-tasks'
import { TASKS_TERMS } from '@shared/tasks-glossary'
import { Button } from '../../../components/Button'
import { TranscriptLoader } from '../../../components/TranscriptLoader'
import { BrowserPanel, hasBrowserBridge, onBrowser } from '../../browser'
import { useSessions, type MessageEntry } from '../../../stores/sessions'
import {
  abortBusyTasks,
  abortTask,
  approvePending,
  cancelPending,
  chooseFolder,
  closeSideChat,
  continueInNewTask,
  createSkillFromTask,
  exportTaskMarkdown,
  loadFolders,
  openSideChat,
  reveal,
  scheduleActiveTask,
  selectFolder,
  sendToTask,
  stopComputerControl
} from './actions'
import {
  AccessModeSwitch,
  ComputerPermissionsCard,
  ControlBanner,
  FullAccessDialog,
  PlanAccessCard,
  VisionModelHint
} from './ComputerAccess'
import { hasTasksBridge, onTasks } from './bridge'
import { ConfirmFolderDialog } from './ConfirmFolderDialog'
import { hideRevertedEntries } from './conversation-logic'
import { TasksComposer, type TasksComposerHandle } from './TasksComposer'
import { DeleteGrantHintCard } from './DeleteGrant'
import { EscalateCard } from './EscalateCard'
import { Home } from './Home'
import { NetworkBlockedCards } from './NetworkBlocked'
import { RestoreNotices } from './RestoreNotices'
import { ApprovalBar } from './PermissionPrompt'
import { QuestionCard } from './QuestionPrompt'
import { ProgressPanel } from './ProgressPanel'
import { ProjectPanel } from './ProjectPanel'
import { SideChat } from './SideChat'
import { TaskConversation } from './TaskConversation'
import { StatusIcon } from './TaskList'
import {
  addNetworkBlocked,
  clearUnseen,
  currentTasksModel,
  disconnect,
  lastFolder,
  resync,
  setPanelOpen,
  syncAccessRequests,
  syncAutoMode,
  syncKillState,
  useTasks,
  isPlanPending,
  isUsingComputer
} from './store'
import {
  extOf,
  formatDuration,
  isTasksSource,
  permissionBelongsTo,
  sessionBelongsTo,
  taskStatus,
  TASK_STATUS_LABEL,
  turnTiming,
  type TaskStatus
} from './util'

const EMPTY: MessageEntry[] = []
const EMPTY_FILES: TasksDeliverable[] = []

/** Ancho del `aside` cuando la pestaña activa es «Navegador» (persistido; Progreso queda fijo). */
const ASIDE_BROWSER_WIDTH_KEY = 'tasks.browserWidth'

function readAsideBrowserWidth(): number {
  try {
    const v = Number(localStorage.getItem(ASIDE_BROWSER_WIDTH_KEY))
    if (v >= 360 && v <= 900) return v
  } catch {
    // sin storage
  }
  return 560
}

const PILL_TONE: Record<TaskStatus, string> = {
  running: 'border-accent/40 bg-accent-soft text-accent',
  waiting: 'border-warning/50 bg-warning/10 text-warning',
  question: 'border-accent/40 bg-accent-soft text-accent',
  done: 'border-border bg-hover text-muted',
  error: 'border-danger/40 bg-danger/10 text-danger',
  idle: 'border-border text-muted',
  using_computer: 'border-accent/40 bg-accent-soft text-accent',
  plan_ready: 'border-warning/50 bg-warning/10 text-warning',
  archived: 'border-border text-muted'
}

function StatusPill({ status }: { status: TaskStatus }): React.JSX.Element {
  return (
    <span className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${PILL_TONE[status]}`}>
      <StatusIcon status={status} size={11} />
      {TASK_STATUS_LABEL[status]}
    </span>
  )
}

/** Tiempo del último turno (en vivo mientras trabaja). */
function Elapsed({ entries, live }: { entries: MessageEntry[]; live: boolean }): React.JSX.Element | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [live])
  const { start, end } = turnTiming(entries)
  if (!start) return null
  const stop = live ? now : (end ?? null)
  if (!stop) return null
  return (
    <span className="shrink-0 font-mono text-[11px] text-subtle tabular-nums" title="Duración de la última ejecución">
      {formatDuration(stop - start)}
    </span>
  )
}

interface MenuItem {
  icon: LucideIcon
  label: string
  hint?: string
  disabled?: boolean
  run: () => void
}

/**
 * Menú «…» de la cabecera de la tarea: exportar, continuar, crear skill, consulta lateral y programar.
 * Accesible con teclado (flechas, Inicio/Fin, Esc devuelve el foco al botón).
 */
function TaskMenu({ items }: { items: MenuItem[] }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    if (!open) return
    refs.current.find((el) => el && !el.disabled)?.focus()
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const close = (refocus: boolean): void => {
    setOpen(false)
    if (refocus) btnRef.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close(true)
      return
    }
    if (e.key === 'Tab') {
      setOpen(false)
      return
    }
    const enabled = refs.current.filter((el): el is HTMLButtonElement => !!el && !el.disabled)
    if (enabled.length === 0) return
    const idx = enabled.findIndex((el) => el === document.activeElement)
    let next = -1
    if (e.key === 'ArrowDown') next = (idx + 1) % enabled.length
    else if (e.key === 'ArrowUp') next = (idx - 1 + enabled.length) % enabled.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = enabled.length - 1
    if (next >= 0) {
      e.preventDefault()
      enabled[next].focus()
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={btnRef}
        type="button"
        title="Más acciones"
        aria-label="Más acciones de la tarea"
        aria-haspopup="menu"
        aria-expanded={open}
        className="rounded p-1 hover:bg-hover hover:text-fg"
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal size={15} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Acciones de la tarea"
          onKeyDown={onKeyDown}
          className="absolute right-0 z-30 mt-1 w-64 rounded-lg border border-border bg-elevated p-1 shadow-lg"
        >
          {items.map((it, i) => {
            const Icon = it.icon
            return (
              <button
                key={it.label}
                ref={(el) => {
                  refs.current[i] = el
                }}
                type="button"
                role="menuitem"
                disabled={it.disabled}
                title={it.hint}
                onClick={() => {
                  close(false)
                  it.run()
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-fg hover:bg-hover focus-visible:bg-hover focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
              >
                <Icon size={14} className="shrink-0 text-muted" />
                {it.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function followUpsFor(files: TasksDeliverable[], fullAccess: boolean): string[] {
  if (fullAccess) return ['Hazlo otra vez', 'Explícame paso a paso lo que hiciste', 'Deshaz el último cambio']
  const exts = new Set(files.map((f) => extOf(f.path)))
  const out: string[] = []
  if (exts.has('md') || exts.has('txt') || exts.has('html')) out.push('Convertir a Word')
  if (exts.has('md') || exts.has('docx') || exts.has('html')) out.push('Crear una versión en PDF')
  if (exts.has('csv')) out.push('Crear gráficos con estos datos')
  out.push('Resumir en 5 puntos', 'Revisar y mejorar la redacción')
  if (files.length === 0) out.push('Guarda el resultado en un documento')
  return out.slice(0, 5)
}

const FOLLOW_UP_PROMPTS: Record<string, string> = {
  'Convertir a Word': 'Convierte el documento principal que entregaste a Word (.docx) con buen formato.',
  'Crear una versión en PDF': 'Genera una versión en PDF del documento principal que entregaste.',
  'Crear gráficos con estos datos': 'Crea gráficos PNG con los datos entregados y añádelos a un informe .md.',
  'Resumir en 5 puntos': 'Resume el resultado en 5 puntos clave.',
  'Revisar y mejorar la redacción': 'Revisa y mejora la redacción y el formato de los entregables, sin cambiar el contenido.',
  'Guarda el resultado en un documento': 'Guarda el resultado de esta tarea en un documento .md bien formateado.',
  'Hazlo otra vez': 'Repite la tarea anterior.',
  'Explícame paso a paso lo que hiciste': 'Explícame paso a paso lo que hiciste en el Mac.',
  'Deshaz el último cambio': 'Deshaz el último cambio que hiciste, si es posible.'
}

function FollowUps({ items, onPick }: { items: string[]; onPick: (text: string) => void }): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {items.map((label) => (
        <button
          key={label}
          type="button"
          onClick={() => onPick(FOLLOW_UP_PROMPTS[label] ?? label)}
          className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-muted transition hover:border-accent/50 hover:bg-accent-soft hover:text-accent"
        >
          <Sparkles size={11} /> {label}
        </button>
      ))}
    </div>
  )
}

export function TasksWorkspace(): React.JSX.Element {
  const bridge = hasTasksBridge()
  const folder = useTasks((s) => s.folder)
  const phase = useTasks((s) => s.phase)
  const conn = useTasks((s) => s.conn)
  const error = useTasks((s) => s.error)
  const pending = useTasks((s) => s.pendingApproval)
  const activeId = useTasks((s) => s.activeTaskId)
  const permissions = useTasks((s) => s.permissions)
  const questions = useTasks((s) => s.questions)
  const panelOpen = useTasks((s) => s.panelOpen)
  const files = useTasks((s) => (activeId ? (s.deliverables[activeId] ?? EMPTY_FILES) : EMPTY_FILES))
  const sessions = useSessions((s) => s.sessions)
  const session = activeId ? sessions[activeId] : undefined
  const allEntries = useSessions((s) => (activeId ? (s.messages[activeId] ?? EMPTY) : EMPTY))
  const run = useSessions((s) => (activeId ? s.status[activeId] : undefined))
  const taskError = useSessions((s) => (activeId ? s.errors[activeId] : null))
  const requestedFullAccess = useTasks((s) => s.fullAccess)
  const sideChat = useTasks((s) => s.sideChat)
  // «Editar y reintentar» deja los mensajes deshechos en la lista hasta el siguiente prompt: se ocultan.
  const revertMessageID = session?.revert?.messageID
  const entries = useMemo(() => hideRevertedEntries(allEntries, revertMessageID), [allEntries, revertMessageID])
  const [sendError, setSendError] = useState<unknown>(null)
  const [note, setNote] = useState<string | null>(null)
  const fullAccess = conn?.fullAccess === true
  // Navegador integrado del `aside`: pestaña "Progreso | Navegador" y ancho redimensionable.
  const composerRef = useRef<TasksComposerHandle>(null)
  const [asideTab, setAsideTab] = useState<'progress' | 'browser'>('progress')
  const [browserMounted, setBrowserMounted] = useState(false)
  const [browserWidth, setBrowserWidth] = useState(readAsideBrowserWidth)
  const asideDrag = useRef<{ x: number; w: number } | null>(null)
  const browserOwner: BrowserOwner | null = folder ? { kind: 'tasks', folder } : null

  /** «Añadir al chat» del navegador integrado: inserta el texto en el compositor (v1 sin imagen). */
  const addPageToComposer = (item: BrowserToChat): void => {
    const current = useTasks.getState().draft
    useTasks.setState({ draft: current ? `${current}\n\n${item.text}` : item.text })
    composerRef.current?.focus()
  }

  const onAsideResizeDown = (e: React.PointerEvent): void => {
    asideDrag.current = { x: e.clientX, w: browserWidth }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onAsideResizeMove = (e: React.PointerEvent): void => {
    if (!asideDrag.current) return
    const next = Math.min(900, Math.max(360, asideDrag.current.w + (asideDrag.current.x - e.clientX)))
    setBrowserWidth(next)
  }
  const onAsideResizeUp = (): void => {
    asideDrag.current = null
    try {
      localStorage.setItem(ASIDE_BROWSER_WIDTH_KEY, String(browserWidth))
    } catch {
      // sin storage
    }
  }
  const busy = !!run && run !== 'idle'
  // Solo sesiones de un servidor de Tareas (F6-B1, F7-B37): no cuenta Code/Chat (origen principal), pero sí el otro servidor de Tareas.
  const folderBusy = useSessions((s) =>
    Object.keys(s.status).some(
      (id) => s.status[id] !== 'idle' && !!folder && s.sessions[id]?.directory === folder && isTasksSource(s.sessionSource[id])
    )
  )

  // Carga inicial: carpetas autorizadas y reconexión a la última usada.
  useEffect(() => {
    if (!bridge) return
    void (async () => {
      await loadFolders()
      const st = useTasks.getState()
      if (st.folder) {
        if (st.phase !== 'ready') void selectFolder(st.folder)
        return
      }
      const last = lastFolder()
      if (last && st.folders.some((f) => f.path === last)) void selectFolder(last)
    })()
  }, [bridge])

  // Si el servidor de la carpeta se cae, mostrar el error (con "Reintentar").
  useEffect(
    () =>
      onTasks('tasks:server', (info) => {
        const st = useTasks.getState()
        const sameServer = (info.fullAccess ?? false) === (st.conn?.fullAccess ?? false)
        if (info.folder === st.folder && sameServer && info.state === 'error' && st.phase === 'ready') {
          disconnect()
          useTasks.setState({ phase: 'error', error: info.error ?? 'El servidor de las tareas se detuvo' })
        }
      }),
    []
  )

  // Control del Mac: última acción del agente y parada (botón Detener o atajo global ⌘⇧Esc).
  // La parada (abortar sesiones, matar helpers) la ejecuta el proceso principal; aquí solo se
  // refleja su estado (`syncKillState` se suscribe a `computer:killState` una vez).
  useEffect(() => {
    void syncKillState()
    syncAccessRequests()
    // Modo auto (Lote C): sin esto, `useTasks().autoMode` nunca se rellena y el chip del
    // compositor y la vía rápida de `permission.asked` quedan muertos aunque esté activo en Ajustes.
    syncAutoMode()
    const offAction = onTasks('computer:action', (ev) => {
      if (useTasks.getState().conn?.fullAccess) useTasks.setState({ lastAction: ev })
    })
    const offStopped = onTasks('computer:stopped', (ev) => {
      if (!useTasks.getState().conn?.fullAccess) return
      useTasks.setState({ controlStoppedAt: ev.at || Date.now() })
      void abortBusyTasks()
    })
    return () => {
      offAction()
      offStopped()
    }
  }, [])

  // Proxy de egress: el servidor sandboxeado bloqueó una conexión de red durante una tarea.
  useEffect(() => onTasks('tasks:networkBlocked', (ev) => addNetworkBlocked(ev)), [])

  // Navegador integrado: mantiene la pestaña montada tras la primera visita (como la Terminal de Code).
  useEffect(() => {
    if (asideTab === 'browser') setBrowserMounted(true)
  }, [asideTab])

  // El agente (o una tarjeta de aprobación) pide mostrar la pestaña del navegador, sin robar el foco.
  useEffect(() => {
    if (!hasBrowserBridge()) return
    return onBrowser('browser:reveal', (ev) => {
      if (ev.owner.kind !== 'tasks' || ev.owner.folder !== useTasks.getState().folder) return
      setPanelOpen(true)
      setAsideTab('browser')
    })
  }, [])

  // «Añadir al chat» desde la ventana «Navegador» aparte (sin compositor propio): main lo reenvía aquí.
  useEffect(() => {
    if (!hasBrowserBridge()) return
    return onBrowser('browser:toChat', (item) => {
      if (item.owner.kind !== 'tasks' || item.owner.folder !== useTasks.getState().folder) return
      addPageToComposer(item)
    })
  }, [])

  // ⌘⇧Esc con la ventana enfocada (el main registra además el atajo global).
  useEffect(() => {
    if (!fullAccess) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && e.shiftKey && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void stopComputerControl()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [fullAccess])

  // La tarea activa se considera "vista" al volver a la ventana.
  useEffect(() => {
    const onFocus = (): void => {
      const id = useTasks.getState().activeTaskId
      if (id) clearUnseen(id)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const pendingForTask: PermissionRequest[] = useMemo(
    () => (activeId ? Object.values(permissions).filter((p) => permissionBelongsTo(p, activeId, sessions)) : []),
    [permissions, activeId, sessions]
  )
  const pendingQuestionsForTask = useMemo(
    () => (activeId ? Object.values(questions).filter((q) => sessionBelongsTo(q.sessionID, activeId, sessions)) : []),
    [questions, activeId, sessions]
  )

  const status = activeId
    ? taskStatus({
        run,
        waiting: pendingForTask.length > 0,
        hasQuestion: pendingQuestionsForTask.length > 0,
        error: taskError,
        entries,
        usingComputer: isUsingComputer(activeId),
        planPending: isPlanPending(activeId)
      })
    : 'idle'

  // La Consulta lateral pertenece a una tarea: al cambiar de tarea se cierra.
  useEffect(() => {
    const side = useTasks.getState().sideChat
    if (side && side.taskId !== activeId) closeSideChat()
  }, [activeId])

  // Aviso breve tras una acción del menú (p. ej. la ruta del Markdown exportado).
  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(null), 6000)
    return () => clearTimeout(t)
  }, [note])

  /** Ejecuta una acción del menú mostrando sus errores junto a la conversación. */
  const guarded = (fn: () => Promise<void> | void): void => {
    setSendError(null)
    setNote(null)
    Promise.resolve()
      .then(fn)
      .catch((err: unknown) => setSendError(err))
  }

  const menuItems: MenuItem[] = activeId
    ? [
        {
          icon: FileDown,
          label: 'Exportar a Markdown',
          run: () =>
            guarded(async () => {
              const path = await exportTaskMarkdown(activeId)
              if (path) setNote(`Conversación guardada en ${path}`)
            })
        },
        {
          icon: Workflow,
          label: 'Continuar en una tarea nueva',
          hint: 'Empieza una tarea nueva con el encargo original y lo último que se concluyó',
          disabled: phase !== 'ready',
          run: () => guarded(() => continueInNewTask(activeId))
        },
        {
          icon: Wand2,
          label: 'Crear skill de esta tarea',
          hint: 'Le pide al agente que guarde lo aprendido como una skill reutilizable',
          disabled: phase !== 'ready' || busy,
          run: () => guarded(() => createSkillFromTask(activeId))
        },
        {
          icon: MessagesSquare,
          label: TASKS_TERMS.sideChat,
          hint: 'Pregunta sobre la tarea sin modificarla',
          disabled: phase !== 'ready',
          run: () => openSideChat(activeId)
        },
        {
          icon: CalendarClock,
          label: 'Programar',
          hint: 'Repetir esta tarea con una rutina',
          run: () => guarded(() => scheduleActiveTask())
        }
      ]
    : []

  const send = async (text: string): Promise<void> => {
    setSendError(null)
    if (!useTasks.getState().folder) {
      await chooseFolder()
      return
    }
    try {
      await sendToTask(text, currentTasksModel())
    } catch (err) {
      setSendError(err)
      if (!useTasks.getState().draft) useTasks.setState({ draft: text })
    }
  }

  if (!bridge) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-danger">
        <AlertCircle size={16} className="mr-2" /> Falta `window.api.tasks` en el preload.
      </div>
    )
  }

  const phaseBanners = (
    <>
      {phase === 'ready' && requestedFullAccess && conn && !conn.fullAccess && (
        <div className="mx-auto mt-3 flex w-full max-w-3xl items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          El servidor no activó el Control total para esta carpeta; se usa el modo Sandbox.
        </div>
      )}
      {phase === 'error' && folder && (
        <div className="mx-auto mt-3 flex w-full max-w-3xl items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">{error}</span>
          <Button variant="ghost" onClick={() => void selectFolder(folder)}>
            <RefreshCw size={14} /> Reintentar
          </Button>
        </div>
      )}
      {error && !(phase === 'error' && folder) && (
        <div
          role="alert"
          className="mx-auto mt-3 flex w-full max-w-3xl items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">{error}</span>
          <Button variant="ghost" onClick={() => useTasks.setState({ error: null })}>
            Cerrar
          </Button>
        </div>
      )}
    </>
  )

  const sideOpen = !!activeId && sideChat?.taskId === activeId
  const showPanel = !!activeId && panelOpen && !sideOpen

  return (
    <div className="flex h-full min-h-0">
      {/* Centro */}
      <main className="flex min-w-0 flex-1 flex-col">
        {activeId && (
          <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-4">
            <span className="min-w-0 truncate text-sm font-medium" title={session?.title}>
              {session?.title || 'Tarea'}
            </span>
            <StatusPill status={status} />
            <Elapsed entries={entries} live={busy} />
            <span className="ml-auto flex items-center gap-1.5 text-xs text-muted">
              {phase === 'starting' && <Loader2 size={12} className="animate-spin" />}
              {(phase === 'ready' || phase === 'error') && <AccessModeSwitch disabled={folderBusy} />}
              <TaskMenu items={menuItems} />
              {folder && (
                <button
                  type="button"
                  title="Abrir carpeta en Finder"
                  className="rounded p-1 hover:bg-hover hover:text-fg"
                  onClick={() => void reveal(folder)}
                >
                  <FolderOpen size={15} />
                </button>
              )}
              <button
                type="button"
                title={panelOpen && !sideOpen ? 'Ocultar panel' : 'Mostrar plan y entregables'}
                aria-label={panelOpen && !sideOpen ? 'Ocultar panel de progreso' : 'Mostrar plan y entregables'}
                className="rounded p-1 hover:bg-hover hover:text-fg"
                onClick={() => {
                  if (sideOpen) {
                    closeSideChat()
                    setPanelOpen(true)
                  } else setPanelOpen(!panelOpen)
                }}
              >
                {panelOpen && !sideOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
              </button>
            </span>
          </header>
        )}

        <ControlBanner />
        {phaseBanners}

        {activeId ? (
          <>
            <ComputerPermissionsCard />
            <TranscriptLoader sessionId={activeId} />
            <TaskConversation
              taskId={activeId}
              entries={entries}
              busy={busy}
              error={taskError}
              permissions={pendingForTask}
              footer={
                <>
                  {activeId && <RestoreNotices taskId={activeId} />}
                  {activeId && <NetworkBlockedCards taskId={activeId} />}
                  {!fullAccess && <DeleteGrantHintCard key={`grant-${activeId}`} entries={entries} />}
                  {!fullAccess && status === 'done' && activeId && (
                    <EscalateCard key={`escalate-${activeId}`} taskId={activeId} entries={entries} />
                  )}
                  {pendingQuestionsForTask.map((q) => (
                    <QuestionCard key={q.id} request={q} />
                  ))}
                  {status === 'done' && entries.length > 0 && (
                    <FollowUps items={followUpsFor(files, fullAccess)} onPick={(t) => void send(t)} />
                  )}
                </>
              }
            />
            <PlanAccessCard />
            <ApprovalBar requests={pendingForTask} />
            {sendError != null && (
              <div className="mx-auto mb-2 w-full max-w-3xl px-6">
                <ErrorNotice error={sendError} />
              </div>
            )}
            {note && (
              <p role="status" className="mx-auto mb-2 w-full max-w-3xl px-6 text-xs break-all text-muted">
                {note}
              </p>
            )}
            <VisionModelHint />
            <TasksComposer
              ref={composerRef}
              onSend={send}
              onAbort={() => void (fullAccess ? stopComputerControl() : abortTask())}
              busy={busy}
              disabled={phase !== 'ready'}
              autoFocusKey={activeId}
              placeholder={busy ? 'El agente está trabajando…' : 'Responde o pide un cambio…'}
            />
          </>
        ) : (
          <Home onSend={send} sendError={sendError} folderBusy={folderBusy} />
        )}
      </main>

      {/* Derecha: Consulta lateral, o bien Plan · Entregables · Actividad */}
      {sideOpen && <SideChat />}
      {showPanel && (
        <aside
          className="relative hidden shrink-0 flex-col border-l border-border lg:flex"
          style={{ width: asideTab === 'browser' ? browserWidth : 320 }}
        >
          {asideTab === 'browser' && (
            <div
              onPointerDown={onAsideResizeDown}
              onPointerMove={onAsideResizeMove}
              onPointerUp={onAsideResizeUp}
              className="absolute top-0 bottom-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-accent/20"
            />
          )}
          <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-3 text-sm font-medium">
            <button
              type="button"
              onClick={() => setAsideTab('progress')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                asideTab === 'progress' ? 'bg-active text-fg' : 'text-muted hover:bg-hover hover:text-fg'
              }`}
            >
              Progreso
            </button>
            <button
              type="button"
              onClick={() => setAsideTab('browser')}
              disabled={!browserOwner}
              title={TASKS_TERMS.browser}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition disabled:opacity-40 ${
                asideTab === 'browser' ? 'bg-active text-fg' : 'text-muted hover:bg-hover hover:text-fg'
              }`}
            >
              <Globe size={12} /> {TASKS_TERMS.browser}
            </button>
            <span className="ml-auto flex items-center gap-0.5">
              {asideTab === 'progress' && (
                <button
                  type="button"
                  title="Sincronizar"
                  className="rounded p-1 text-muted hover:bg-hover hover:text-fg"
                  onClick={() => void resync()}
                >
                  <RefreshCw size={13} />
                </button>
              )}
              <button
                type="button"
                title="Ocultar panel"
                className="rounded p-1 text-muted hover:bg-hover hover:text-fg"
                onClick={() => setPanelOpen(false)}
              >
                <PanelRightClose size={14} />
              </button>
            </span>
          </div>
          <div className={`min-h-0 flex-1 ${asideTab === 'progress' ? 'flex flex-col' : 'hidden'}`}>
            <ProgressPanel sessionID={activeId} busy={busy} />
          </div>
          {browserOwner && browserMounted && (
            <div className={`min-h-0 flex-1 ${asideTab === 'browser' ? 'flex flex-col' : 'hidden'}`}>
              <BrowserPanel owner={browserOwner} product="tasks" visible={asideTab === 'browser'} onAddToChat={addPageToComposer} />
            </div>
          )}
        </aside>
      )}

      <FullAccessDialog />
      <ProjectPanel />

      {pending && <ConfirmFolderDialog folder={pending} onConfirm={() => void approvePending()} onCancel={cancelPending} />}
    </div>
  )
}

export default TasksWorkspace
