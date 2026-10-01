import { useEffect, useRef, useState, type ReactNode } from 'react'
import { fitTextarea, isSubmitKey, useAutosizeTextarea } from '../../lib/textarea'
import { ArrowUp, Paperclip, Square } from 'lucide-react'
import { useT } from '../../lib/i18n'

interface Props {
  /** Devolver `false` (o rechazar) indica que no se envió: el borrador se restaura. */
  onSend: (text: string) => void | boolean | Promise<void | boolean>
  onAbort?: () => void
  busy: boolean
  disabled?: boolean
  placeholder?: string
  /** Controles extra a la izquierda del pie (p.ej. ModelPicker). */
  footer?: ReactNode
  autoFocusKey?: string | null
  /**
   * Botón de adjuntar. Sin `onAttach` se muestra deshabilitado como "próximamente".
   * Por defecto no se muestra.
   */
  showAttach?: boolean
  onAttach?: () => void
  /** Inserta texto en el borrador (p.ej. desde chips de sugerencias). Cambiar `key` para re-aplicar. */
  insert?: { text: string; key: number } | null
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
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [autoFocusKey])

  useEffect(() => {
    if (!insert) return
    setText(insert.text)
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      el.setSelectionRange(insert.text.length, insert.text.length)
    })
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

  const canSend = !disabled && !busy && text.trim().length > 0

  const submit = (): void => {
    if (!canSend) return
    const value = text.trim()
    setText('')
    const restore = (): void => setText((cur) => (cur.trim() ? cur : value))
    // H3: el borrador se vacía al instante pero vuelve si el envío falla.
    void Promise.resolve()
      .then(() => onSend(value))
      .then((ok) => {
        if (ok === false) restore()
      }, restore)
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-4">
      <div
        className={`rounded-[20px] border bg-elevated shadow-md transition-[border-color,box-shadow] duration-200 ${disabled ? 'border-border' : 'border-border focus-within:border-accent/40 focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_14%,transparent),var(--shadow-md)]'}`}
        onMouseDown={(e) => {
          // Clic en el "marco" enfoca el textarea.
          if (e.target === e.currentTarget) {
            e.preventDefault()
            ref.current?.focus()
          }
        }}
      >
        <textarea
          ref={ref}
          value={text}
          rows={1}
          disabled={disabled}
          placeholder={placeholder ?? t('chat.placeholder.message')}
          onChange={(e) => setText(e.target.value)}
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
              onClick={onAttach}
              disabled={!onAttach || disabled}
              title={onAttach ? t('chat.composer.attach') : t('chat.composer.attachSoon')}
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
      {hint !== false && (
        <p className="mt-2 text-center text-[11px] text-subtle">
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
