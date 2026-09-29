/**
 * Consulta lateral: panel con una conversación aparte (sesión hija de la tarea, agente `chat`) para
 * preguntar por lo que hizo el agente sin tocar la tarea. Las respuestas salen de los mensajes de la
 * sesión hija en `useSessions`; el envío y el cierre los hacen `sendSideChat` / `closeSideChat`.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, ArrowUp, Info, Loader2, MessagesSquare, X } from 'lucide-react'
import { TASKS_TERMS } from '@shared/tasks-glossary'
import { Markdown } from '../../../components/Markdown'
import { errorMessage } from '../../../lib/opencode'
import { isSubmitKey } from '../../../lib/textarea'
import { useSessions, type MessageEntry } from '../../../stores/sessions'
import { closeSideChat, sendSideChat } from './actions'
import { useTasks } from './store'
import { splitAttachments, visibleTextParts } from './transcript'

const EMPTY: MessageEntry[] = []

/** Texto visible de un mensaje de la consulta (el del usuario sin bloque de adjuntos). */
function messageText(entry: MessageEntry): string {
  const raw = visibleTextParts(entry)
    .map((p) => p.text)
    .join('\n')
  return entry.info.role === 'user' ? splitAttachments(raw).text : raw.trim()
}

export function SideChat(): React.JSX.Element | null {
  const side = useTasks((s) => s.sideChat)
  const sessionId = side?.sessionId ?? null
  const entries = useSessions((s) => (sessionId ? (s.messages[sessionId] ?? EMPTY) : EMPTY))
  const run = useSessions((s) => (sessionId ? s.status[sessionId] : undefined))
  const storeError = useSessions((s) => (sessionId ? s.errors[sessionId] : null))
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const busy = sending || (!!run && run !== 'idle')

  const messages = useMemo(() => {
    const out: Array<{ id: string; role: 'user' | 'assistant'; text: string; failed?: string }> = []
    for (const e of entries) {
      const text = messageText(e)
      const failed =
        e.info.role === 'assistant' && e.info.error && e.info.error.name !== 'MessageAbortedError' ? errorMessage(e.info.error) : undefined
      if (text || failed) out.push({ id: e.info.id, role: e.info.role, text, failed })
    }
    return out
  }, [entries])

  useEffect(() => {
    taRef.current?.focus()
  }, [side?.taskId])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, busy])

  if (!side) return null

  const send = async (): Promise<void> => {
    const text = draft.trim()
    if (!text || busy) return
    setError(null)
    setSending(true)
    setDraft('')
    try {
      await sendSideChat(text)
    } catch (err) {
      setError(errorMessage(err))
      setDraft(text)
    } finally {
      setSending(false)
    }
  }

  const last = messages[messages.length - 1]
  const showThinking = busy && (!last || last.role === 'user' || !last.text)

  return (
    <aside aria-label={TASKS_TERMS.sideChat} className="flex w-80 shrink-0 flex-col border-l border-border bg-bg lg:w-96">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <MessagesSquare size={15} className="shrink-0 text-accent" />
          <span className="truncate">{TASKS_TERMS.sideChat}</span>
        </span>
        <button
          type="button"
          title="Cerrar la consulta lateral"
          aria-label="Cerrar la consulta lateral"
          className="rounded p-1 text-muted hover:bg-hover hover:text-fg"
          onClick={closeSideChat}
        >
          <X size={14} />
        </button>
      </div>

      <p className="flex shrink-0 items-start gap-1.5 border-b border-border bg-accent-soft/50 px-4 py-2 text-xs text-muted">
        <Info size={13} className="mt-0.5 shrink-0 text-accent" />
        <span>
          <strong className="font-medium text-fg">No modifica la tarea.</strong> Pregunta sobre lo que hizo el agente; esta conversación va
          aparte.
        </span>
      </p>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
        {messages.length === 0 && !busy ? (
          <p className="text-xs text-subtle">
            Por ejemplo: «¿Qué archivos has cambiado?», «Explícame por qué elegiste ese enfoque» o «¿Qué queda por hacer?».
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[90%] rounded-2xl bg-user px-3.5 py-2 text-sm whitespace-pre-wrap">{m.text}</div>
                </div>
              ) : (
                <div key={m.id} className="text-sm">
                  {m.text && <Markdown text={m.text} />}
                  {m.failed && (
                    <div className="mt-1 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-xs text-danger">
                      <AlertCircle size={13} className="mt-0.5 shrink-0" />
                      <span>{m.failed}</span>
                    </div>
                  )}
                </div>
              )
            )}
            {showThinking && (
              <div className="flex items-center gap-2 text-xs text-muted">
                <Loader2 size={13} className="animate-spin" /> Pensando…
              </div>
            )}
          </div>
        )}
        {(error || storeError) && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-xs text-danger">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <span>{error ?? storeError}</span>
          </div>
        )}
      </div>

      <form
        className="shrink-0 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <div className="flex items-end gap-2 rounded-xl border border-border bg-elevated px-3 py-2 focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-ring)]">
          <textarea
            ref={taRef}
            value={draft}
            rows={1}
            aria-label="Pregunta de la consulta lateral"
            placeholder="Pregunta sobre esta tarea…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (isSubmitKey(e)) {
                e.preventDefault()
                void send()
              }
            }}
            className="field-sizing-content max-h-32 min-h-6 min-w-0 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-subtle"
          />
          <button
            type="submit"
            title="Enviar"
            aria-label="Enviar pregunta"
            disabled={busy || !draft.trim()}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg transition hover:bg-accent-hover disabled:opacity-40"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={14} />}
          </button>
        </div>
      </form>
    </aside>
  )
}
