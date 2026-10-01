import { useState } from 'react'
import type { ReasoningPart } from '@opencode-ai/sdk/v2/client'
import { Brain, ChevronRight, Lightbulb } from 'lucide-react'
import { t } from '@shared/i18n'
import { useLang } from '../../lib/i18n'

/** Etiqueta del bloque de razonamiento: en vivo, con duración (mín. 1 s) o genérica. */
export function reasoningLabel(part: Pick<ReasoningPart, 'time'>, live: boolean): string {
  if (live && !part.time.end) return t('chat.reasoning.live')
  const seconds = part.time.end ? Math.max(1, Math.round((part.time.end - part.time.start) / 1000)) : null
  return seconds ? t('chat.reasoning.seconds', { seconds }) : t('chat.reasoning.generic')
}

/** Razonamiento plegable. `chat`: bombilla dorada con shimmer; `code`: cerebro con pulso. */
export function Reasoning({
  part,
  live,
  variant
}: {
  part: ReasoningPart
  live: boolean
  variant: 'chat' | 'code'
}): React.JSX.Element | null {
  useLang((s) => s.lang) // re-pinta al cambiar de idioma
  const [open, setOpen] = useState(false)
  if (!part.text.trim()) return null
  const thinking = live && !part.time.end
  const label = reasoningLabel(part, live)
  if (variant === 'chat') {
    return (
      <div className="my-1 text-[13px]">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="-ml-1 flex items-center gap-1.5 rounded-md px-1 py-0.5 text-muted transition-colors hover:bg-hover hover:text-fg"
        >
          <Lightbulb size={13} className={thinking ? 'text-gold' : ''} />
          <span className={thinking ? 'text-shimmer' : ''}>{label}</span>
          <ChevronRight size={13} className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
        </button>
        {open && (
          <div className="mt-1.5 ml-1.5 animate-fade-in border-l-2 border-gold/40 pl-3 leading-relaxed whitespace-pre-wrap text-muted">
            {part.text}
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="text-[13px]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="-mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-1 text-muted hover:bg-hover hover:text-fg"
      >
        <Brain size={14} className={thinking ? 'animate-pulse text-accent' : 'text-subtle'} />
        {label}
        <ChevronRight size={13} className={`text-subtle transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="mt-1 ml-2 border-l-2 border-border pl-3 text-[13px] leading-relaxed whitespace-pre-wrap text-muted">
          {part.text}
        </div>
      )}
    </div>
  )
}
