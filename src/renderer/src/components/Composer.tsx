import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUp, Square } from 'lucide-react'

interface Props {
  onSend: (text: string) => void | Promise<void>
  onAbort?: () => void
  busy: boolean
  disabled?: boolean
  placeholder?: string
  /** Controles extra a la izquierda del pie (p.ej. ModelPicker). */
  footer?: ReactNode
  autoFocusKey?: string | null
}

export function Composer({ onSend, onAbort, busy, disabled, placeholder, footer, autoFocusKey }: Props): React.JSX.Element {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [autoFocusKey])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 280)}px`
  }, [text])

  const canSend = !disabled && !busy && text.trim().length > 0

  const submit = (): void => {
    if (!canSend) return
    const value = text.trim()
    setText('')
    void onSend(value)
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-5">
      <div className="rounded-2xl border border-border bg-elevated shadow-sm transition focus-within:border-border-strong">
        <textarea
          ref={ref}
          value={text}
          rows={1}
          disabled={disabled}
          placeholder={placeholder ?? 'Escribe un mensaje…'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          className="block max-h-[280px] w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] outline-none placeholder:text-subtle disabled:opacity-60"
        />
        <div className="flex items-center gap-2 px-2.5 pb-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-1">{footer}</div>
          {busy ? (
            <button
              type="button"
              onClick={onAbort}
              title="Detener"
              aria-label="Detener"
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-fg text-bg transition hover:opacity-85"
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
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-fg transition hover:opacity-90 disabled:opacity-35"
            >
              <ArrowUp size={17} />
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 text-center text-[11px] text-subtle">Enter para enviar · Shift+Enter para nueva línea</p>
    </div>
  )
}
