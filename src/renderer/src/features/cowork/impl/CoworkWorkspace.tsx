/**
 * Modo Cowork: tareas autónomas sobre una carpeta autorizada, ejecutadas por el agente
 * `cowork` en un `opencode serve` dedicado y sandboxeado (sandbox-exec), o por el agente
 * `computer` en un servidor de acceso total (control del Mac).
 *
 * Diseño: tareas a la izquierda · inicio / conversación al centro · Plan, Entregables y
 * Actividad a la derecha (colapsable).
 */
import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  BookText,
  CalendarClock,
  FolderOpen,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Sparkles
} from 'lucide-react'
import type { PermissionRequest } from '@opencode-ai/sdk/v2/client'
import type { CoworkDeliverable } from '@shared/ipc-cowork'
import { Button } from '../../../components/Button'
import { errorMessage } from '../../../lib/opencode'
import { useSessions, type MessageEntry } from '../../../stores/sessions'
import { useSettings } from '../../../stores/settings'
import {
  abortBusyTasks,
  abortTask,
  approvePending,
  cancelPending,
  chooseFolder,
  loadFolders,
  newTask,
  reveal,
  scheduleActiveTask,
  selectFolder,
  sendToTask,
  stopComputerControl
} from './actions'
import { AccessModeSwitch, ComputerPermissionsCard, ControlBanner, FullAccessDialog, PlanAccessCard, VisionModelHint } from './ComputerAccess'
import { hasCoworkBridge, onCowork } from './bridge'
import { ConfirmFolderDialog } from './ConfirmFolderDialog'
import { CoworkComposer } from './CoworkComposer'
import { DeleteGrantHintCard } from './DeleteGrant'
import { FolderMenu } from './FolderMenu'
import { Home } from './Home'
import { NetworkBlockedCards } from './NetworkBlocked'
import { ApprovalBar } from './PermissionPrompt'
import { QuestionCard } from './QuestionPrompt'
import { ProgressPanel } from './ProgressPanel'
import { ProjectPanel } from './ProjectPanel'
import { TaskConversation } from './TaskConversation'
import { StatusIcon, TaskList } from './TaskList'
import {
  addNetworkBlocked,
  clearUnseen,
  disconnect,
  lastFolder,
  resync,
  setPanelOpen,
  setProjectPanelOpen,
  syncAccessRequests,
  syncKillState,
  useCowork
} from './store'
import {
  extOf,
  formatDuration,
  permissionBelongsTo,
  sessionBelongsTo,
  taskStatus,
  TASK_STATUS_LABEL,
  turnTiming,
  type TaskStatus
} from './util'

const EMPTY: MessageEntry[] = []
const EMPTY_FILES: CoworkDeliverable[] = []

const PILL_TONE: Record<TaskStatus, string> = {
  running: 'border-accent/40 bg-accent-soft text-accent',
  waiting: 'border-amber-500/50 bg-amber-500/10 text-amber-600 [[data-theme=dark]_&]:text-amber-400',
  question: 'border-accent/40 bg-accent-soft text-accent',
  done: 'border-border bg-hover text-muted',
  error: 'border-danger/40 bg-danger/10 text-danger',
  idle: 'border-border text-muted'
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

function followUpsFor(files: CoworkDeliverable[], fullAccess: boolean): string[] {
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

export function CoworkWorkspace(): React.JSX.Element {
  const bridge = hasCoworkBridge()
  const folder = useCowork((s) => s.folder)
  const phase = useCowork((s) => s.phase)
  const conn = useCowork((s) => s.conn)
  const error = useCowork((s) => s.error)
  const pending = useCowork((s) => s.pendingApproval)
  const activeId = useCowork((s) => s.activeTaskId)
  const permissions = useCowork((s) => s.permissions)
  const questions = useCowork((s) => s.questions)
  const panelOpen = useCowork((s) => s.panelOpen)
  const files = useCowork((s) => (activeId ? (s.deliverables[activeId] ?? EMPTY_FILES) : EMPTY_FILES))
  const sessions = useSessions((s) => s.sessions)
  const session = activeId ? sessions[activeId] : undefined
  const entries = useSessions((s) => (activeId ? (s.messages[activeId] ?? EMPTY) : EMPTY))
  const run = useSessions((s) => (activeId ? s.status[activeId] : undefined))
  const taskError = useSessions((s) => (activeId ? s.errors[activeId] : null))
  const requestedFullAccess = useCowork((s) => s.fullAccess)
  const model = useSettings((s) => s.settings.defaultModel)
  const [sendError, setSendError] = useState<string | null>(null)
  const fullAccess = conn?.fullAccess === true
  const busy = !!run && run !== 'idle'
  const folderBusy = useSessions((s) =>
    Object.keys(s.status).some((id) => s.status[id] !== 'idle' && !!folder && s.sessions[id]?.directory === folder)
  )

  // Carga inicial: carpetas autorizadas y reconexión a la última usada.
  useEffect(() => {
    if (!bridge) return
    void (async () => {
      await loadFolders()
      const st = useCowork.getState()
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
      onCowork('cowork:server', (info) => {
        const st = useCowork.getState()
        const sameServer = (info.fullAccess ?? false) === (st.conn?.fullAccess ?? false)
        if (info.folder === st.folder && sameServer && info.state === 'error' && st.phase === 'ready') {
          disconnect()
          useCowork.setState({ phase: 'error', error: info.error ?? 'El servidor de Cowork se detuvo' })
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
    const offAction = onCowork('computer:action', (ev) => {
      if (useCowork.getState().conn?.fullAccess) useCowork.setState({ lastAction: ev })
    })
    const offStopped = onCowork('computer:stopped', (ev) => {
      if (!useCowork.getState().conn?.fullAccess) return
      useCowork.setState({ controlStoppedAt: ev.at || Date.now() })
      void abortBusyTasks()
    })
    return () => {
      offAction()
      offStopped()
    }
  }, [])

  // Proxy de egress: el servidor sandboxeado bloqueó una conexión de red durante una tarea.
  useEffect(() => onCowork('cowork:networkBlocked', (ev) => addNetworkBlocked(ev)), [])

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
      const id = useCowork.getState().activeTaskId
      if (id) clearUnseen(id)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  // ⌘N = nueva tarea.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key.toLowerCase() === 'n' && e.metaKey && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        newTask()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
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
        entries
      })
    : 'idle'

  const send = async (text: string): Promise<void> => {
    setSendError(null)
    if (!useCowork.getState().folder) {
      await chooseFolder()
      return
    }
    try {
      await sendToTask(text, model)
    } catch (err) {
      setSendError(errorMessage(err))
      if (!useCowork.getState().draft) useCowork.setState({ draft: text })
    }
  }

  if (!bridge) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-danger">
        <AlertCircle size={16} className="mr-2" /> Falta `window.api.cowork` en el preload.
      </div>
    )
  }

  const phaseBanners = (
    <>
      {phase === 'ready' && requestedFullAccess && conn && !conn.fullAccess && (
        <div className="mx-auto mt-3 flex w-full max-w-3xl items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          El servidor no activó el acceso total para esta carpeta; se usa el modo sandbox.
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
    </>
  )

  const showPanel = !!activeId && panelOpen

  return (
    <div className="flex h-full min-h-0">
      {/* Izquierda: nueva tarea + carpeta + lista */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-border px-3 pt-3 pb-3">
        <Button variant="primary" className="w-full" onClick={newTask} title="Nueva tarea (⌘N)">
          <Plus size={15} /> Nueva tarea
        </Button>
        <div className="mt-2">
          <FolderMenu variant="block" />
        </div>
        {folder && (
          <button
            type="button"
            onClick={() => setProjectPanelOpen(true)}
            title="Instrucciones y memoria de esta carpeta"
            className="mt-1.5 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-muted hover:bg-hover hover:text-fg"
          >
            <BookText size={13} /> Proyecto e instrucciones
          </button>
        )}
        <TaskList />
      </aside>

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
              <button
                type="button"
                title="Programar esta tarea (repetirla con una rutina)"
                className="rounded p-1 hover:bg-hover hover:text-fg"
                onClick={() => void scheduleActiveTask()}
              >
                <CalendarClock size={15} />
              </button>
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
                title={panelOpen ? 'Ocultar panel' : 'Mostrar plan y entregables'}
                className="rounded p-1 hover:bg-hover hover:text-fg"
                onClick={() => setPanelOpen(!panelOpen)}
              >
                {panelOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
              </button>
            </span>
          </header>
        )}

        <ControlBanner />
        {phaseBanners}

        {activeId ? (
          <>
            <ComputerPermissionsCard />
            <TaskConversation
              entries={entries}
              busy={busy}
              error={taskError}
              permissions={pendingForTask}
              footer={
                <>
                  {activeId && <NetworkBlockedCards taskId={activeId} />}
                  {!fullAccess && <DeleteGrantHintCard key={activeId} entries={entries} />}
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
            {sendError && <p className="mx-auto mb-2 w-full max-w-3xl px-6 text-xs text-danger">{sendError}</p>}
            <VisionModelHint />
            <CoworkComposer
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

      {/* Derecha: Plan · Entregables · Actividad */}
      {showPanel && (
        <aside className="hidden w-80 shrink-0 flex-col border-l border-border lg:flex">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4 text-sm font-medium">
            Progreso
            <span className="flex items-center gap-0.5">
              <button
                type="button"
                title="Sincronizar"
                className="rounded p-1 text-muted hover:bg-hover hover:text-fg"
                onClick={() => void resync()}
              >
                <RefreshCw size={13} />
              </button>
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
          <div className="min-h-0 flex-1">
            <ProgressPanel sessionID={activeId} busy={busy} />
          </div>
        </aside>
      )}

      <FullAccessDialog />
      <ProjectPanel />

      {pending && <ConfirmFolderDialog folder={pending} onConfirm={() => void approvePending()} onCancel={cancelPending} />}
    </div>
  )
}

export default CoworkWorkspace
