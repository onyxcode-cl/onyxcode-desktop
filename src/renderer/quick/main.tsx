import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowUp, MessageSquarePlus } from 'lucide-react'
import type { ExtrasApi } from '@shared/ipc-extras'
import './quick.css'

const extras = (window as unknown as { api?: { extras?: ExtrasApi } }).api?.extras

function QuickEntry(): React.JSX.Element {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    if (!extras) return
    return extras.on('extras:quick-shown', () => {
      setError(null)
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [])

  const submit = async (): Promise<void> => {
    const value = text.trim()
    if (!value || !extras) return
    try {
      await extras.invoke('extras:quickSubmit', { text: value })
      setText('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const hide = (): void => {
    void extras?.invoke('extras:quickHide')
  }

  return (
    <div className="drag flex h-full w-full items-center p-1.5">
      <div className="flex h-full w-full items-center gap-3 rounded-2xl border border-q-border bg-q-bg px-4 text-q-fg shadow-xl backdrop-blur-xl">
        <MessageSquarePlus size={20} className="shrink-0 text-q-muted" aria-hidden />
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void submit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              if (text) setText('')
              else hide()
            }
          }}
          placeholder={error ?? '¿En qué puedo ayudarte?'}
          aria-label="Escribe un mensaje para el chat"
          spellCheck={false}
          className={`no-drag min-w-0 flex-1 bg-transparent text-[17px] outline-none placeholder:text-q-muted ${error ? 'placeholder:text-red-500' : ''}`}
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!text.trim()}
          aria-label="Enviar"
          title="Enviar (Enter)"
          className="no-drag inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-q-accent text-q-accent-fg transition disabled:opacity-30"
        >
          <ArrowUp size={16} />
        </button>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <QuickEntry />
  </StrictMode>
)
