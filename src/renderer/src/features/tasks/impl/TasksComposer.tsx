/**
 * Compositor propio de Tareas: texto controlado por el store (para rellenarlo desde
 * sugerencias/seguimientos), adjuntos copiados a la carpeta, chip de carpeta, chips de carpetas
 * adicionales, modelo y esfuerzo por tarea, y medidor de uso de la tarea activa.
 *
 * Expone un `ref` con `focus()` para que quien inserte texto desde fuera (p.ej. «Añadir al
 * chat» del navegador integrado, Lote D) pueda devolver el foco al compositor sin robárselo
 * al resto de la interfaz.
 */
import { NoAiBanner } from '../../../components/NoAiBanner'
import { useAiGate } from '../../../lib/ai-gate'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { ArrowUp, FileText, FolderPlus, Image as ImageIcon, Loader2, Paperclip, Square, X } from 'lucide-react'
import { sandboxModelNotice } from '@shared/sandbox-providers'
import { TASKS_TERMS } from '@shared/tasks-glossary'
import { EffortPicker } from '../../../components/EffortPicker'
import { ModelPicker } from '../../../components/ModelPicker'
import { UsageMeter } from '../../../components/UsageMeter'
import { errorMessage } from '../../../lib/opencode'
import { isSubmitKey, useAutosizeTextarea } from '../../../lib/textarea'
import { useSessions, type MessageEntry } from '../../../stores/sessions'
import { useModeModel } from '../../settings/impl/extras'
import { attachFiles, removeAttachment, unlinkFolder } from './actions'
import { AutoModeChip } from './AutoModeChip'
import { FolderMenu } from './FolderMenu'
import { currentTasksModel, currentTasksVariant, setTaskModel, setTaskVariant, useTasks } from './store'
import { extOf } from './util'

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic'])
/** Referencia estable para "sin mensajes" (evita re-renders del selector de zustand). */
const NO_MESSAGES: MessageEntry[] = []

interface Props {
  onSend: (text: string) => void | Promise<void>
  onAbort?: () => void
  busy: boolean
  disabled?: boolean
  placeholder?: string
  autoFocusKey?: string | null
  /** Variante grande de la pantalla de inicio (con chip de carpeta). */
  hero?: boolean
  /** Controles extra en el pie (p.ej. selector de modo). */
  extra?: React.ReactNode
}

/** Método imperativo expuesto por `TasksComposer` (ver el comentario del archivo). */
export interface TasksComposerHandle {
  focus: () => void
}

export const TasksComposer = forwardRef<TasksComposerHandle, Props>(function TasksComposer(
  { onSend, onAbort, busy, disabled, placeholder, autoFocusKey, hero, extra },
  forwardedRef
) {
  const text = useTasks((s) => s.draft)
  const attachments = useTasks((s) => s.attachments)
  const folder = useTasks((s) => s.folder)
  const activeTaskId = useTasks((s) => s.activeTaskId)
  const saving = useTasks((s) => s.restoreSaving)
  const linked = useTasks((s) => s.folderSet?.linked)
  const entries = useSessions((s) => (activeTaskId ? s.messages[activeTaskId] : undefined)) ?? NO_MESSAGES
  // Suscripción reactiva al modelo/esfuerzo de la tarea; el valor sale de las funciones del store.
  useTasks((s) => s.taskModel)
  useTasks((s) => s.taskVariant)
  useModeModel('tasks')
  const wantedModel = currentTasksModel()
  const aiGate = useAiGate(wantedModel)
  const model = aiGate.effective ?? wantedModel
  const variant = currentTasksVariant()
  const conn = useTasks((s) => s.conn)
  const requestedFull = useTasks((s) => s.fullAccess)
  const sandboxed = conn ? conn.sandboxed && !conn.fullAccess : !requestedFull
  const providerNotice = sandboxModelNotice(sandboxed, model.providerID)
  const [attaching, setAttaching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  const setText = (draft: string): void => useTasks.setState({ draft })

  useImperativeHandle(forwardedRef, () => ({ focus: () => ref.current?.focus() }), [])

  useEffect(() => {
    ref.current?.focus()
  }, [autoFocusKey])

  useAutosizeTextarea(ref, text, { max: hero ? 320 : 240 })

  const blocked = aiGate.gate.blocked
  const canSend = !disabled && !blocked && !busy && !saving && text.trim().length > 0

  const submit = (): void => {
    if (!canSend) return
    void onSend(text.trim())
  }

  const attach = (): void => {
    setError(null)
    setAttaching(true)
    attachFiles()
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => {
        setAttaching(false)
        ref.current?.focus()
      })
  }

  return (
    <div className={`mx-auto w-full max-w-3xl px-6 ${hero ? '' : 'pb-4'}`}>
      <NoAiBanner gate={aiGate.gate} freeModel={aiGate.free} onUseFree={setTaskModel} />
      <div className="rounded-2xl border border-border bg-elevated shadow-sm transition focus-within:border-border-strong">
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-3">
            {attachments.map((a) => {
              const Icon = IMAGE_EXT.has(extOf(a.path)) ? ImageIcon : FileText
              return (
                <span
                  key={a.path}
                  title={a.path}
                  className="flex max-w-[220px] items-center gap-1.5 rounded-lg border border-border bg-hover px-2 py-1 text-xs"
                >
                  <Icon size={13} className="shrink-0 text-muted" />
                  <span className="truncate">{a.relPath}</span>
                  <button
                    type="button"
                    title="Quitar (el archivo sigue en la carpeta)"
                    className="shrink-0 rounded text-subtle hover:text-fg"
                    onClick={() => removeAttachment(a.path)}
                  >
                    <X size={12} />
                  </button>
                </span>
              )
            })}
          </div>
        )}
        {linked && linked.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-3 pt-3" aria-label={TASKS_TERMS.linkedFolders}>
            {linked.map((f) => (
              <span
                key={f.path}
                title={`${f.path} · ${f.mode === 'ro' ? TASKS_TERMS.readOnly : TASKS_TERMS.readWrite}`}
                className="flex max-w-[260px] items-center gap-1.5 rounded-lg border border-border bg-hover px-2 py-1 text-xs"
              >
                <FolderPlus size={13} className="shrink-0 text-muted" />
                <span className="truncate">{f.name}</span>
                {f.mode === 'ro' && (
                  <span className="shrink-0 rounded bg-warning/15 px-1.5 py-px text-[11px] font-medium text-warning">
                    {TASKS_TERMS.readOnly}
                  </span>
                )}
                <button
                  type="button"
                  title={`Quitar «${f.name}» de las carpetas adicionales`}
                  aria-label={`Quitar la carpeta adicional ${f.name}`}
                  className="shrink-0 rounded text-subtle hover:text-fg"
                  onClick={() => void unlinkFolder(f.path)}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={ref}
          value={text}
          rows={hero ? 3 : 1}
          disabled={disabled || blocked}
          placeholder={blocked ? 'Conecta una IA para empezar' : (placeholder ?? 'Escribe un mensaje…')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (isSubmitKey(e)) {
              e.preventDefault()
              submit()
            }
          }}
          className={`block w-full resize-none bg-transparent px-4 pt-3.5 pb-1 outline-none placeholder:text-subtle disabled:opacity-60 ${
            hero ? 'min-h-[84px] text-base' : 'text-[15px]'
          }`}
        />
        <div className="flex items-center gap-1.5 px-2.5 pb-2.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={attach}
              disabled={!folder || attaching}
              title={folder ? 'Adjuntar archivos (se copian a la carpeta)' : 'Elige primero una carpeta'}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition hover:bg-hover hover:text-fg disabled:opacity-40"
            >
              {attaching ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
            </button>
            {hero && <FolderMenu variant="chip" placement="bottom" />}
            <AutoModeChip />
            {extra}
            <ModelPicker value={model} onChange={setTaskModel} />
          </div>
          <EffortPicker model={model} variant={variant} onChange={setTaskVariant} />
          <UsageMeter messages={entries} model={model} />
          {busy ? (
            <button
              type="button"
              onClick={onAbort}
              title="Detener"
              aria-label="Detener"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-fg text-bg transition hover:opacity-85"
            >
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              title="Enviar (Enter)"
              aria-label="Enviar"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg transition hover:opacity-90 disabled:opacity-35"
            >
              <ArrowUp size={17} />
            </button>
          )}
        </div>
      </div>
      {saving && (
        <p role="status" data-testid="restore-saving" className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
          <Loader2 size={12} className="animate-spin" /> Guardando punto de restauración…
        </p>
      )}
      {providerNotice && (
        <p role="status" data-testid="sandbox-provider-notice" className="mt-1.5 text-xs text-warning">
          {providerNotice}
        </p>
      )}
      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
    </div>
  )
})
