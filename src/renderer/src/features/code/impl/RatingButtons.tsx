import { useEffect, useRef, useState } from 'react'
import { ThumbsDown, ThumbsUp } from 'lucide-react'
import type { RatingEntry, RatingInput, RatingValue } from '@shared/ratings'
import { RATING_COMMENT_MAX } from '@shared/ratings'
import { useT } from '../../../lib/i18n'
import { call } from '../../../lib/api'
import { announce } from '../../../lib/announce'
import type { CodeMessage } from './types'

/** Datos de la respuesta que acompañan a la valoración (ids y números; nunca el texto ni rutas). */
export type RatingContext = Omit<RatingInput, 'value' | 'comment'>

/** Arma el contexto de la última respuesta del asistente de un turno (suma tokens y mide la duración del turno). */
export function ratingContextOf(assistant: CodeMessage[]): RatingContext | null {
  const infos = assistant.flatMap((m) => (m.info.role === 'assistant' ? [m.info] : []))
  const last = [...infos].reverse().find((i) => !i.summary) ?? infos[infos.length - 1]
  if (!last) return null
  const tokens = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
  for (const i of infos) {
    tokens.input += i.tokens?.input ?? 0
    tokens.output += i.tokens?.output ?? 0
    tokens.reasoning += i.tokens?.reasoning ?? 0
    tokens.cacheRead += i.tokens?.cache?.read ?? 0
    tokens.cacheWrite += i.tokens?.cache?.write ?? 0
  }
  const started = Math.min(...infos.map((i) => i.time.created))
  const done = last.time.completed
  return {
    sessionId: last.sessionID,
    messageId: last.id,
    model: last.modelID || 'desconocido',
    service: last.providerID || 'desconocido',
    mode: last.mode || last.agent || 'desconocido',
    ...(done && done >= started ? { durationMs: done - started } : {}),
    tokens
  }
}

// Valoraciones ya guardadas, por conversación (se piden una vez y se mantienen al día con lo que la persona marca).
const cache = new Map<string, Promise<Map<string, RatingEntry>>>()
function load(sessionId: string): Promise<Map<string, RatingEntry>> {
  let p = cache.get(sessionId)
  if (!p) {
    p = call('rating:list', { sessionId })
      .then((list) => new Map(list.map((e) => [e.messageId, e])))
      .catch(() => new Map<string, RatingEntry>())
    cache.set(sessionId, p)
  }
  return p
}
/** Solo para pruebas. */
export function resetRatingCache(): void {
  cache.clear()
}

/**
 * Pulgar arriba / abajo al final de una respuesta de Code. La valoración se guarda solo en este equipo. Con «mala» aparece un campo
 * opcional de una línea. Volver a pulsar el mismo pulgar quita la valoración.
 */
export function RatingButtons({ context }: { context: RatingContext }): React.JSX.Element {
  const t = useT()
  const { sessionId, messageId } = context
  const [entry, setEntry] = useState<RatingEntry | null>(null)
  const [asking, setAsking] = useState(false)
  const [comment, setComment] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    void load(sessionId).then((m) => {
      if (live) setEntry(m.get(messageId) ?? null)
    })
    return () => {
      live = false
    }
  }, [sessionId, messageId])
  useEffect(() => {
    if (asking) input.current?.focus()
  }, [asking])

  const save = async (value: RatingValue | null, text?: string): Promise<void> => {
    const res = await call('rating:set', { ...context, value, ...(text ? { comment: text } : {}) }).catch(() => ({ saved: false }))
    if (!res.saved) return
    const map = await load(sessionId)
    if (value === null) map.delete(messageId)
    else map.set(messageId, { messageId, value, ...(text ? { comment: text } : {}) })
    setEntry(value === null ? null : { messageId, value, ...(text ? { comment: text } : {}) })
    announce(t(value === null ? 'code.rate.removed' : 'code.rate.saved'))
  }

  const press = (v: RatingValue): void => {
    if (entry?.value === v) {
      setAsking(false)
      void save(null)
      return
    }
    if (v === 'bad') {
      setComment(entry?.comment ?? '')
      setAsking(true)
    } else setAsking(false)
    void save(v)
  }

  const btn = (v: RatingValue, label: string, Icon: typeof ThumbsUp): React.JSX.Element => (
    <button
      type="button"
      onClick={() => press(v)}
      aria-pressed={entry?.value === v}
      aria-label={label}
      title={label}
      data-testid={`rate-${v}`}
      className={`no-drag inline-flex items-center rounded-md px-1.5 py-1 desk:justify-center desk:min-h-6 desk:min-w-6 transition-colors hover:bg-hover hover:text-fg ${entry?.value === v ? 'text-fg' : 'text-muted'}`}
    >
      <Icon size={13} fill={entry?.value === v ? 'currentColor' : 'none'} />
    </button>
  )

  return (
    <div role="group" aria-label={t('code.rate.group')} className="flex items-center gap-0.5">
      {btn('good', t('code.rate.good'), ThumbsUp)}
      {btn('bad', t('code.rate.bad'), ThumbsDown)}
      {asking && entry?.value === 'bad' && (
        <form
          className="ml-1 flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault()
            setAsking(false)
            void save('bad', comment.trim())
          }}
        >
          <input
            ref={input}
            type="text"
            value={comment}
            maxLength={RATING_COMMENT_MAX}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setAsking(false)
            }}
            aria-label={t('code.rate.commentLabel')}
            placeholder={t('code.rate.commentPlaceholder')}
            className="no-drag h-6 w-56 rounded-md border border-border bg-transparent px-2 text-xs text-fg placeholder:text-muted"
          />
          <button type="submit" className="no-drag rounded-md px-1.5 py-1 text-xs text-muted hover:bg-hover hover:text-fg">
            {t('code.rate.send')}
          </button>
        </form>
      )}
    </div>
  )
}
