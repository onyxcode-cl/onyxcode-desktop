import '../src/lib/page-lang'
import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowUp } from 'lucide-react'
import { LogoMark } from '../src/components/Logo'
import { isSubmitKey } from '../src/lib/textarea'
import type { ExtrasApi } from '@shared/ipc-extras'
import { t } from '@shared/i18n'
import './quick.css'

const extras = (window as unknown as { api?: { extras?: ExtrasApi } }).api?.extras

function QuickEntry(): React.JSX.Element {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [shownKey, setShownKey] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    if (!extras) return
    return extras.on('extras:quick-shown', () => {
      setError(null)
      setShownKey((k) => k + 1)
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

  const canSend = !!text.trim()

  return (
    <div className="drag flex h-full w-full items-center p-2">
      <div
        key={shownKey}
        className="q-shell q-in flex h-full w-full items-center gap-3 rounded-[18px] bg-q-bg pr-2.5 pl-4 text-q-fg backdrop-blur-xl"
      >
        <LogoMark size={24} />
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            if (error) setError(null)
          }}
          onKeyDown={(e) => {
            if (isSubmitKey(e, { allowShift: true })) {
              e.preventDefault()
              void submit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              if (text) setText('')
              else hide()
            }
          }}
          placeholder={error ?? t('ovl.quick.placeholder')}
          aria-label={t('ovl.quick.aria')}
          spellCheck={false}
          className={`no-drag min-w-0 flex-1 bg-transparent text-[18px] tracking-[-0.01em] outline-none placeholder:text-q-muted ${error ? 'placeholder:text-q-danger' : ''}`}
        />
        {!canSend && (
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-q-muted" aria-hidden>
            {/* i18n-ignore: nombre de tecla */}
            <kbd className="rounded-md bg-q-kbd px-1.5 py-0.5 font-sans">esc</kbd>
            {t('ovl.quick.close')}
          </span>
        )}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSend}
          aria-label={t('ovl.quick.send')}
          title={t('ovl.quick.sendTitle')}
          className={`no-drag inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-[background-color,color,opacity,transform] duration-150 active:scale-95 ${canSend ? 'bg-q-accent text-q-accent-fg' : 'bg-q-kbd text-q-muted'}`}
        >
          <ArrowUp size={17} strokeWidth={2.25} />
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
