import { useEffect, useRef, useState, type ReactNode } from 'react'
import { fitTextarea, isSubmitKey, useAutosizeTextarea } from '../../lib/textarea'
import { ArrowUp, FileText, Paperclip, Square, X } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { useDraft } from '../../stores/drafts'
import { attachmentBytes, toChatAttachment, validateFiles, type ChatAttachment } from '../../lib/attachments'

const NO_ATTACHMENTS: ChatAttachment[] = []

interface Props {
  /** Devolver `false` (o rechazar) indica que no se envió: el borrador se restaura. */
  onSend: (text: string, files: ChatAttachment[]) => void | boolean | Promise<void | boolean>
  onAbort?: () => void
  busy: boolean
  disabled?: boolean
  placeholder?: string
  /** Controles extra a la izquierda del pie (p.ej. ModelPicker). */
  footer?: ReactNode
  autoFocusKey?: string | null
  /**
   * Botón de adjuntar (imágenes, PDF y texto como partes `file` con URL `data:`). Sin `showAttach` no se muestra.
   * Si se pasa `onAttach` se llama en vez de abrir el selector de archivos.
   */
  showAttach?: boolean
  onAttach?: () => void
  /** Inserta texto (y, si se indica, adjuntos) en el borrador (chips de sugerencias, restauración tras un fallo). Cambiar `key` para re-aplicar. */
  insert?: { text: string; key: number; attachments?: ChatAttachment[] } | null
  /** Texto de ayuda bajo el compositor; `false` lo oculta. */
  hint?: ReactNode | false
}

const MAX_HEIGHT = 280

export function ChatComposer({
  onSend,
  onAbort,
  busy,
  disabled,
  placeholder,
  footer,
  autoFocusKey,
  showAttach,
  onAttach,
  insert,
  hint
}: Props): React.JSX.Element {
  const t = useT()
  // F8-B32: el borrador vive por conversación en un almacén externo; sobrevive a cambiar de modo.
  const [text, setText] = useDraft(`chat:${autoFocusKey ?? 'new'}`, '')
  const [attachments, setAttachments] = useDraft(`chat-att:${autoFocusKey ?? 'new'}`, NO_ATTACHMENTS)
  const [attachError, setAttachError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [autoFocusKey])

  useEffect(() => {
    if (!insert) return
    setText(insert.text)
    if (insert.attachments) setAttachments(insert.attachments)
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      el.setSelectionRange(insert.text.length, insert.text.length)
    })
    // `setText` cambia con la conversación: no debe re-aplicar la sugerencia al cambiar de chat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insert])

  // Autoajuste de alto: al cambiar el texto y cuando cambia el ancho disponible.
  useAutosizeTextarea(ref, text, { max: MAX_HEIGHT, manageOverflow: true })

  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let lastWidth = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === lastWidth) return
      lastWidth = el.clientWidth
      fitTextarea(el, MAX_HEIGHT, true)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const canSend = !disabled && !busy && (text.trim().length > 0 || attachments.length > 0)

  const addFiles = (list: FileList | File[]): void => {
    const files = Array.from(list)
    if (files.length === 0 || disabled) return
    const { accepted, errors } = validateFiles(files, {
      count: attachments.length,
      bytes: attachments.reduce((n, a) => n + attachmentBytes(a), 0)
    })
    setAttachError(errors.length ? errors.join(' ') : null)
    if (accepted.length === 0) return
    void Promise.all(accepted.map((i) => toChatAttachment(files[i]))).then(
      (added) => setAttachments((cur) => [...cur, ...added]),
      (err: unknown) => setAttachError(err instanceof Error ? err.message : String(err))
    )
  }

  const submit = (): void => {
    if (!canSend) return
    const value = text.trim()
    const files = attachments
    setText('')
    setAttachments([])
    setAttachError(null)
    const restore = (): void => {
      setText((cur) => (cur.trim() ? cur : value))
      setAttachments((cur) => (cur.length ? cur : files))
    }
    // H3: el borrador se vacía al instante pero vuelve si el envío falla.
    void Promise.resolve()
      .then(() => onSend(value, files))
      .then((ok) => {
        if (ok === false) restore()
      }, restore)
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-4">
      <div
        className={`rounded-[20px] border bg-elevated shadow-md transition-[border-color,box-shadow] duration-200 ${disabled ? 'border-border' : 'border-border focus-within:border-accent/40 focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_14%,transparent),var(--shadow-md)]'}`}
        onDragOver={(e) => {
          if (!showAttach || disabled || !e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
        }}
        onDrop={(e) => {
          setDragging(false)
          if (!showAttach || disabled || e.dataTransfer.files.length === 0) return
          e.preventDefault()
          addFiles(e.dataTransfer.files)
        }}
        onMouseDown={(e) => {
          // Clic en el "marco" enfoca el textarea.
          if (e.target === e.currentTarget) {
            e.preventDefault()
            ref.current?.focus()
          }
        }}
      >
        {showAttach && attachments.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 px-4 pt-3" aria-label={t('chat.composer.attach')}>
            {attachments.map((a) => (
              <li
                key={a.id}
                className="group/att relative flex h-14 max-w-[9rem] min-w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-bg"
              >
                {a.mime.startsWith('image/') ? (
                  <img src={a.url} alt={a.name} className="h-full w-14 object-cover" />
                ) : (
                  <span className="flex min-w-0 flex-col items-center gap-0.5 px-2 text-[10px] text-muted">
                    <FileText size={16} className="text-accent" />
                    <span className="max-w-full truncate">{a.name}</span>
                  </span>
                )}
                <button
                  type="button"
                  title={t('chat.attach.remove', { name: a.name })}
                  aria-label={t('chat.attach.remove', { name: a.name })}
                  onClick={() => setAttachments((cur) => cur.filter((x) => x.id !== a.id))}
                  className="absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-fg/70 text-bg opacity-0 transition group-hover/att:opacity-100 focus-visible:opacity-100"
                >
                  <X size={10} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {showAttach && (
          <input
            ref={fileInputRef}
            type="file"
            multiple
            tabIndex={-1}
            aria-hidden="true"
            data-testid="chat-file-input"
            accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/*,.md,.csv,.json,.yml,.yaml,.log"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files)
              e.target.value = ''
            }}
          />
        )}
        <textarea
          ref={ref}
          data-kb-composer=""
          value={text}
          rows={1}
          disabled={disabled}
          placeholder={placeholder ?? t('chat.placeholder.message')}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            if (!showAttach) return
            const pasted = Array.from(e.clipboardData.items)
              .filter((it) => it.kind === 'file')
              .map((it) => it.getAsFile())
              .filter((f): f is File => !!f)
            if (pasted.length === 0) return
            e.preventDefault()
            addFiles(pasted)
          }}
          onKeyDown={(e) => {
            // M5: Esc detiene la respuesta en curso (como en Code y Tareas).
            if (e.key === 'Escape' && busy && onAbort && !e.nativeEvent.isComposing) {
              e.preventDefault()
              onAbort()
              return
            }
            if (isSubmitKey(e)) {
              e.preventDefault()
              submit()
            }
          }}
          className="block max-h-[280px] w-full resize-none bg-transparent px-4 pt-3.5 pb-1.5 text-[15px] leading-relaxed outline-none placeholder:text-subtle disabled:opacity-60"
        />
        <div className="flex items-center gap-1.5 px-2 pb-2">
          {showAttach && (
            <button
              type="button"
              onClick={onAttach ?? (() => fileInputRef.current?.click())}
              disabled={disabled}
              title={t('chat.composer.attach')}
              aria-label={t('chat.composer.attach')}
              className="no-drag inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <Paperclip size={16} />
            </button>
          )}
          <div className="flex min-w-0 flex-1 items-center gap-1">{footer}</div>
          {busy ? (
            <button
              type="button"
              onClick={onAbort}
              title={t('chat.composer.stop')}
              aria-label={t('chat.composer.stop')}
              className="flex h-8 w-8 shrink-0 animate-pop-in items-center justify-center rounded-full bg-fg text-bg transition hover:opacity-85 active:scale-95"
            >
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              title={t('chat.composer.sendTitle')}
              aria-label={t('chat.composer.send')}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-[background-color,color,transform,box-shadow] duration-200 active:scale-95 ${canSend ? 'bg-accent text-accent-fg shadow-sm hover:bg-accent-hover' : 'bg-hover text-subtle'}`}
            >
              <ArrowUp size={17} strokeWidth={2.25} />
            </button>
          )}
        </div>
      </div>
      {attachError && (
        <p role="alert" className="mt-2 text-center text-[12px] text-danger">
          {attachError}
        </p>
      )}
      {dragging && (
        <p className="mt-2 text-center text-[12px] text-accent" role="status">
          {t('chat.attach.drop')}
        </p>
      )}
      {hint !== false && (
        <p data-mobile="hide" className="mt-2 text-center text-[11px] text-subtle">
          {hint ?? (
            <>
              <kbd className="kbd">Enter</kbd>
              {` ${t('chat.composer.hintSend')} · `}
              <kbd className="kbd">⇧ Enter</kbd>
              {` ${t('chat.composer.hintNewline')}`}
            </>
          )}
        </p>
      )}
    </div>
  )
}
