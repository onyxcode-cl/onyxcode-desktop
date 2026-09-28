/**
 * Modo Cowork: tareas autónomas sobre una carpeta autorizada, ejecutadas por el agente
 * `cowork` en un `opencode serve` dedicado y sandboxeado (sandbox-exec).
 */
import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Archive,
  ChevronDown,
  FolderOpen,
  FolderPlus,
  Loader2,
  Plus,
  RefreshCw,
  Shield,
  ShieldOff,
  Trash2,
  Users
} from 'lucide-react'
import type { PermissionRequest } from '@opencode-ai/sdk/v2/client'
import { Button } from '../../../components/Button'
import { Composer } from '../../../components/Composer'
import { MessageList } from '../../../components/MessageList'
import { ModelPicker } from '../../../components/ModelPicker'
import { errorMessage } from '../../../lib/opencode'
import { selectSessionsForDirectory, useSessions, type MessageEntry } from '../../../stores/sessions'
import { useSettings } from '../../../stores/settings'
import {
  abortTask,
  approvePending,
  archiveTask,
  cancelPending,
  chooseFolder,
  forgetFolder,
  loadFolders,
  newTask,
  openTask,
  reveal,
  selectFolder,
  sendToTask
} from './actions'
import { hasCoworkBridge, onCowork } from './bridge'
import { ConfirmFolderDialog } from './ConfirmFolderDialog'
import { PermissionPrompt } from './PermissionPrompt'
import { ProgressPanel } from './ProgressPanel'
import { disconnect, lastFolder, resync, useCowork } from './store'

const EMPTY: MessageEntry[] = []

const SUGGESTIONS = [
  'Resume todos los documentos de esta carpeta en un informe resumen.md',
  'Ordena los archivos en subcarpetas por tipo y dame un índice',
  'Convierte los datos de los .csv en un informe en Word (.docx)',
  'Revisa la ortografía de los .md y crea versiones corregidas'
]

function baseName(p: string): string {
  return p.split('/').filter(Boolean).pop() ?? p
}

function relTime(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.round(diff / 60_000)
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  return new Date(ts).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })
}

function FolderMenu(): React.JSX.Element {
  const folders = useCowork((s) => s.folders)
  const folder = useCowork((s) => s.folder)
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-lg border border-border bg-elevated px-2.5 py-2 text-left text-sm hover:bg-hover"
      >
        <FolderOpen size={15} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate font-medium">{folder ? baseName(folder) : 'Elegir carpeta'}</span>
        <ChevronDown size={14} className="shrink-0 text-muted" />
      </button>
      {open && (
        <div
          className="absolute top-full right-0 left-0 z-20 mt-1 rounded-xl border border-border bg-elevated p-1 shadow-lg"
          onMouseLeave={() => setOpen(false)}
        >
          {folders.map((f) => (
            <div key={f.path} className="group flex items-center rounded-lg hover:bg-hover">
              <button
                type="button"
                className="min-w-0 flex-1 px-2 py-1.5 text-left"
                title={f.path}
                onClick={() => {
                  setOpen(false)
                  void selectFolder(f.path)
                }}
              >
                <div className={`truncate text-sm ${f.path === folder ? 'font-semibold text-accent' : ''}`}>{f.name}</div>
                <div className="truncate font-mono text-[10px] text-subtle">{f.path}</div>
              </button>
              <button
                type="button"
                title="Quitar autorización"
                className="mr-1 hidden rounded p-1 text-subtle group-hover:block hover:text-danger"
                onClick={() => {
                  setOpen(false)
                  if (window.confirm(`¿Quitar la autorización de Cowork para «${f.name}»? No se borra ningún archivo.`)) {
                    void forgetFolder(f.path)
                  }
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {folders.length > 0 && <div className="my-1 border-t border-border" />}
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-hover"
            onClick={() => {
              setOpen(false)
              void chooseFolder()
            }}
          >
            <FolderPlus size={14} /> Elegir otra carpeta…
          </button>
        </div>
      )}
    </div>
  )
}

function TaskList(): React.JSX.Element {
  const folder = useCowork((s) => s.folder)
  const activeId = useCowork((s) => s.activeTaskId)
  const loading = useCowork((s) => s.listLoading)
  const sessions = useSessions((s) => s.sessions)
  const status = useSessions((s) => s.status)
  const tasks = useMemo(() => (folder ? selectSessionsForDirectory(sessions, folder) : []), [sessions, folder])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-1 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">
        Tareas
        {loading && <Loader2 size={12} className="animate-spin" />}
      </div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {tasks.length === 0 && !loading && <p className="px-1 py-2 text-xs text-subtle">Aún no hay tareas en esta carpeta.</p>}
        {tasks.map((t) => {
          const busy = (status[t.id] ?? 'idle') !== 'idle'
          return (
            <div
              key={t.id}
              className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${t.id === activeId ? 'bg-active' : 'hover:bg-hover'}`}
            >
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => void openTask(t.id)}>
                <div className="truncate">{t.title || 'Tarea sin título'}</div>
                <div className="text-[11px] text-subtle">{relTime(t.time.updated)}</div>
              </button>
              {busy ? (
                <Loader2 size={13} className="shrink-0 animate-spin text-accent" />
              ) : (
                <button
                  type="button"
                  title="Archivar"
                  className="hidden shrink-0 rounded p-0.5 text-subtle group-hover:block hover:text-fg"
                  onClick={() => void archiveTask(t.id).catch(() => undefined)}
                >
                  <Archive size={13} />
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function EmptyFolderState(): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        <Users size={28} />
      </div>
      <h2 className="text-2xl font-medium tracking-tight">Cowork</h2>
      <p className="max-w-md text-sm text-muted">
        Delega tareas de oficina sobre una carpeta de documentos: el agente planifica, trabaja de forma autónoma en un
        sandbox y te entrega los archivos listos.
      </p>
      <Button variant="primary" onClick={() => void chooseFolder()}>
        <FolderPlus size={16} /> Elegir carpeta
      </Button>
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
  const session = useSessions((s) => (activeId ? s.sessions[activeId] : undefined))
  const entries = useSessions((s) => (activeId ? (s.messages[activeId] ?? EMPTY) : EMPTY))
  const busy = useSessions((s) => (activeId ? (s.status[activeId] ?? 'idle') !== 'idle' : false))
  const taskError = useSessions((s) => (activeId ? s.errors[activeId] : null))
  const model = useSettings((s) => s.settings.defaultModel)
  const updateSettings = useSettings((s) => s.update)
  const [sendError, setSendError] = useState<string | null>(null)

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

  // Si el servidor sandboxeado de la carpeta se cae, mostrar el error (con "Reintentar").
  useEffect(
    () =>
      onCowork('cowork:server', (info) => {
        const st = useCowork.getState()
        if (info.folder === st.folder && info.state === 'error' && st.phase === 'ready') {
          disconnect()
          useCowork.setState({ phase: 'error', error: info.error ?? 'El servidor de Cowork se detuvo' })
        }
      }),
    []
  )

  const pendingForTask: PermissionRequest[] = useMemo(
    () => Object.values(permissions).filter((p) => !activeId || p.sessionID === activeId),
    [permissions, activeId]
  )

  const send = async (text: string): Promise<void> => {
    setSendError(null)
    try {
      await sendToTask(text, model)
    } catch (err) {
      setSendError(errorMessage(err))
    }
  }

  if (!bridge) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-danger">
        <AlertCircle size={16} className="mr-2" /> Falta `window.api.cowork` en el preload.
      </div>
    )
  }

  const composer = (
    <Composer
      onSend={send}
      onAbort={() => void abortTask()}
      busy={busy}
      disabled={phase !== 'ready'}
      autoFocusKey={activeId ?? folder}
      placeholder={activeId ? 'Responde o da más instrucciones…' : 'Describe la tarea que quieres delegar…'}
      footer={<ModelPicker value={model} onChange={(m) => void updateSettings({ defaultModel: m })} />}
    />
  )

  return (
    <div className="flex h-full min-h-0">
      {/* Columna izquierda: carpeta + tareas */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-border px-3 pt-3 pb-3">
        <FolderMenu />
        {folder && (
          <Button variant="secondary" className="mt-2 w-full" onClick={newTask} disabled={phase !== 'ready'}>
            <Plus size={15} /> Nueva tarea
          </Button>
        )}
        {folder && <TaskList />}
      </aside>

      {/* Centro: conversación */}
      <main className="flex min-w-0 flex-1 flex-col">
        {!folder ? (
          <EmptyFolderState />
        ) : (
          <>
            <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
              <span className="truncate text-sm font-medium">{activeId ? session?.title || 'Tarea' : 'Nueva tarea'}</span>
              <span className="ml-auto flex items-center gap-2 text-xs text-muted">
                {phase === 'starting' && (
                  <span className="flex items-center gap-1">
                    <Loader2 size={12} className="animate-spin" /> Iniciando sandbox…
                  </span>
                )}
                {phase === 'ready' && conn && (
                  <span
                    className={`flex items-center gap-1 rounded-full border px-2 py-0.5 ${conn.sandboxed ? 'border-accent/40 text-accent' : 'border-danger/40 text-danger'}`}
                    title={conn.sandboxed ? 'Escrituras limitadas a esta carpeta (sandbox-exec)' : 'Sin sandbox en esta plataforma'}
                  >
                    {conn.sandboxed ? <Shield size={12} /> : <ShieldOff size={12} />}
                    {conn.sandboxed ? 'Sandbox activo' : 'Sin sandbox'}
                  </span>
                )}
                <button
                  type="button"
                  title="Abrir carpeta en Finder"
                  className="rounded p-1 hover:bg-hover hover:text-fg"
                  onClick={() => void reveal(folder)}
                >
                  <FolderOpen size={15} />
                </button>
              </span>
            </header>

            {phase === 'error' && (
              <div className="m-4 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">{error}</span>
                <Button variant="ghost" onClick={() => void selectFolder(folder)}>
                  <RefreshCw size={14} /> Reintentar
                </Button>
              </div>
            )}

            {activeId ? (
              <>
                <div className="flex min-h-0 flex-1 flex-col">
                  <MessageList entries={entries} busy={busy} error={taskError} />
                </div>
                {pendingForTask.map((p) => (
                  <PermissionPrompt key={p.id} request={p} />
                ))}
                {sendError && <p className="mx-auto mb-2 max-w-3xl px-6 text-xs text-danger">{sendError}</p>}
                {composer}
              </>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto">
                <div className="mx-auto w-full max-w-3xl px-6">
                  <h1 className="mb-1 text-3xl font-medium tracking-tight">¿Qué hacemos en «{baseName(folder)}»?</h1>
                  <p className="mb-6 text-sm text-muted">
                    Describe el resultado que esperas. El agente planificará, trabajará solo y te pedirá permiso antes de borrar
                    nada.
                  </p>
                </div>
                {sendError && <p className="mx-auto mb-2 max-w-3xl px-6 text-xs text-danger">{sendError}</p>}
                {composer}
                <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-2 px-6 sm:grid-cols-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={phase !== 'ready'}
                      onClick={() => void send(s)}
                      className="rounded-xl border border-border px-3 py-2 text-left text-sm text-muted transition hover:bg-hover hover:text-fg disabled:opacity-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Derecha: progreso */}
      {folder && (
        <aside className="hidden w-72 shrink-0 flex-col border-l border-border lg:flex">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4 text-sm font-medium">
            Progreso
            <button type="button" title="Sincronizar" className="rounded p-1 text-muted hover:bg-hover hover:text-fg" onClick={() => void resync()}>
              <RefreshCw size={13} />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <ProgressPanel sessionID={activeId} />
          </div>
        </aside>
      )}

      {pending && (
        <ConfirmFolderDialog folder={pending} onConfirm={() => void approvePending()} onCancel={cancelPending} />
      )}
    </div>
  )
}

export default CoworkWorkspace
