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
import { ArrowUp, FileText, FolderPlus, Image as ImageIcon, Loader2, Paperclip, ShieldAlert, Square, X } from 'lucide-react'
import { VoiceDictationButton } from '../../../components/VoiceDictationButton'
import { sandboxModelNotice } from '@shared/sandbox-providers'
import { useT } from '../../../lib/i18n'
import { isRemoteSurface, platformCaps } from '../../../lib/platform'
import { TASKS_TERMS } from '@shared/tasks-glossary'
import { EffortPicker } from '../../../components/EffortPicker'
import { ModelPicker } from '../../../components/ModelPicker'
import { UsageMeter } from '../../../components/UsageMeter'
import { errorMessage } from '../../../lib/opencode'
import { isSubmitKey, useAutosizeTextarea } from '../../../lib/textarea'
import { useSessions, type MessageEntry } from '../../../stores/sessions'
import { useModeModel } from '../../settings/impl/extras'
import { handlePaste, pasteRejectedMessages } from '../../../lib/paste-attachments'
import { attachFiles, pasteFromClipboard, removeAttachment, removeElement, setElementInclude, unlinkFolder } from './actions'
import { ElementChipRow } from '../../browser/ElementChip'
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
  const t = useT()
  const text = useTasks((s) => s.draft)
  const attachments = useTasks((s) => s.attachments)
  const elements = useTasks((s) => s.elements)
  const folder = useTasks((s) => s.folder)
  const activeTaskId = useTasks((s) => s.activeTaskId)
  const saving = useTasks((s) => s.restoreSaving)
  const sending = useTasks((s) => s.sending)
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
  /** Inserta texto dictado en la posición del cursor — mismo patrón que Chat/Code. */
  const insertDictated = (dictated: string): void => {
    const el = ref.current
    const pos = el?.selectionStart ?? text.length
    const needsSpace = pos > 0 && !/\s/.test(text[pos - 1])
    const insert = `${needsSpace ? ' ' : ''}${dictated}`
    const next = text.slice(0, pos) + insert + text.slice(pos)
    const np = pos + insert.length
    setText(next)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(np, np)
    })
  }

  useImperativeHandle(forwardedRef, () => ({ focus: () => ref.current?.focus() }), [])

  useEffect(() => {
    ref.current?.focus()
  }, [autoFocusKey])

  useAutosizeTextarea(ref, text, { max: hero ? 320 : 240 })

  const blocked = aiGate.gate.blocked
  const canSend = !disabled && !blocked && !busy && !saving && !sending && text.trim().length > 0

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
    <div className={`mx-auto w-full max-w-3xl px-6 desk:max-w-[calc(var(--measure-prose)+48px)] ${hero ? '' : 'pb-4'}`}>
      <NoAiBanner gate={aiGate.gate} freeModel={aiGate.free} onUseFree={setTaskModel} />
      <div
        className={`rounded-2xl border border-border bg-elevated shadow-sm transition focus-within:border-border-strong desk:border-transparent desk:shadow-[var(--elev-edge),var(--shadow-md)] desk:focus-within:border-accent/40${
          hero ? ' desk:rounded-[20px]' : ''
        }`}
      >
        <ElementChipRow
          elements={elements}
          className="px-3 pt-3"
          onRemove={(id) => {
            removeElement(id)
            ref.current?.focus()
          }}
          onInclude={setElementInclude}
        />
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
                    title={t('tasks.comp.removeAttachment')}
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
                  <span className="shrink-0 rounded bg-warning/15 px-1.5 py-px text-[11px] desk:text-meta font-medium text-warning">
                    {TASKS_TERMS.readOnly}
                  </span>
                )}
                <button
                  type="button"
                  title={t('tasks.comp.unlinkTitle', { name: f.name })}
                  aria-label={t('tasks.comp.unlinkAria', { name: f.name })}
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
          data-kb-composer=""
          value={text}
          rows={hero ? 3 : 1}
          disabled={disabled || blocked || sending}
          placeholder={blocked ? t('tasks.comp.phNoAi') : (placeholder ?? t('tasks.comp.phMessage'))}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            // Sin carpeta no hay dónde guardar el adjunto: se deja el pegado normal (texto).
            if (!folder || disabled || blocked || sending || isRemoteSurface()) return
            handlePaste(e, {
              scope: 'any',
              // Los archivos que Chromium sí entrega también se guardan por el canal de main (que lee el portapapeles real
              // y los valida): en Tareas el adjunto es un archivo dentro de la carpeta, no bytes del renderer.
              addFiles: () => {
                void pasteFromClipboard().then(
                  (r) => {
                    if (r.rejected.length > 0) setError(pasteRejectedMessages(r.rejected).join(' '))
                  },
                  (err: unknown) => setError(errorMessage(err))
                )
              },
              readFallback: async () => {
                const r = await pasteFromClipboard()
                return { files: [], rejected: r.rejected, handled: r.added > 0 }
              },
              onErrors: (msgs) => setError(msgs.join(' '))
            })
          }}
          onKeyDown={(e) => {
            if (isSubmitKey(e)) {
              e.preventDefault()
              submit()
            }
          }}
          className={`block w-full resize-none bg-transparent px-4 pt-3.5 pb-1 outline-none placeholder:text-subtle disabled:opacity-60 desk:leading-6 desk:placeholder:text-muted ${
            hero ? 'min-h-[84px] text-base desk:min-h-[66px]' : 'text-[15px]'
          }`}
        />
        <div className="flex items-center gap-1.5 px-2.5 pb-2.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {platformCaps().nativeDialogs && (
              <button
                type="button"
                onClick={attach}
                disabled={!folder || attaching}
                title={folder ? t('tasks.comp.attach') : t('tasks.comp.pickFolder')}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition hover:bg-hover hover:text-fg disabled:opacity-40"
              >
                {attaching ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
              </button>
            )}
            <VoiceDictationButton onText={insertDictated} size={15} className="h-7 w-7 rounded-lg" />
            {hero && <FolderMenu variant="chip" placement="bottom" />}
            <AutoModeChip />
            {extra}
            <ModelPicker value={model} onChange={setTaskModel} />
          </div>
          <EffortPicker model={model} variant={variant} onChange={setTaskVariant} />
          <UsageMeter messages={entries} model={model} />
          {sending ? (
            <button
              type="button"
              disabled
              data-testid="composer-sending"
              title={t('tasks.comp.sending')}
              aria-label={t('tasks.comp.sending')}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg opacity-70"
            >
              <Loader2 size={17} className="animate-spin" />
            </button>
          ) : busy ? (
            <button
              type="button"
              onClick={onAbort}
              title={t('tasks.comp.stop')}
              aria-label={t('tasks.comp.stop')}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-fg text-bg transition hover:opacity-85"
            >
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              title={t('tasks.comp.sendTitle')}
              aria-label={t('tasks.comp.send')}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg transition hover:opacity-90 disabled:opacity-35 desk:disabled:bg-hover desk:disabled:text-muted desk:disabled:opacity-100"
            >
              <ArrowUp size={17} />
            </button>
          )}
        </div>
      </div>
      {sending && !saving && (
        <p role="status" data-testid="composer-sending-note" className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
          <Loader2 size={12} className="animate-spin" /> {requestedFull ? t('tasks.comp.sendingFull') : t('tasks.comp.sendingSandbox')}
        </p>
      )}
      {saving && (
        <p role="status" data-testid="restore-saving" className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
          <Loader2 size={12} className="animate-spin" /> {t('tasks.comp.saving')}
        </p>
      )}
      {providerNotice && (
        <p
          role="status"
          data-testid="sandbox-provider-notice"
          className="mt-1.5 text-xs text-warning desk:mt-2.5 desk:flex desk:gap-2.5 desk:rounded-ctl desk:bg-warning/10 desk:px-3 desk:py-2.5 desk:text-ui desk:text-fg desk:ring-1 desk:ring-warning/45 desk:ring-inset"
        >
          <ShieldAlert size={16} aria-hidden className="hidden shrink-0 desk:block desk:text-warning" />
          {providerNotice}
        </p>
      )}
      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
    </div>
  )
})
