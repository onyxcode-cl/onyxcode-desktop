/**
 * Preguntas estructuradas de Tareas (herramienta `question`): una tarjeta por solicitud, con
 * una o más preguntas (opciones de un solo valor, múltiples, y/o texto libre si `custom`).
 */
import { useState } from 'react'
import type { QuestionInfo, QuestionRequest } from '@opencode-ai/sdk/v2/client'
import { HelpCircle, X } from 'lucide-react'
import { Button } from '../../../components/Button'
import { errorMessage } from '../../../lib/opencode'
import { rejectQuestion, replyQuestion } from './actions'

function QuestionField({
  q,
  value,
  onChange
}: {
  q: QuestionInfo
  value: string[]
  onChange: (next: string[]) => void
}): React.JSX.Element {
  const [freeText, setFreeText] = useState('')
  const toggle = (label: string): void => {
    if (q.multiple) {
      onChange(value.includes(label) ? value.filter((v) => v !== label) : [...value, label])
    } else {
      onChange([label])
    }
  }
  return (
    <div className="rounded-lg border border-border bg-elevated/50 p-3">
      {q.header && <p className="text-[10px] font-semibold tracking-wide text-subtle uppercase">{q.header}</p>}
      <p className="mt-0.5 text-sm font-medium">{q.question}</p>
      {q.options.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {q.options.map((opt) => {
            const checked = value.includes(opt.label)
            return (
              <button
                key={opt.label}
                type="button"
                onClick={() => toggle(opt.label)}
                className={`flex w-full items-start gap-2 rounded-lg border px-2.5 py-1.5 text-left text-sm transition ${
                  checked ? 'border-accent bg-accent-soft/50' : 'border-border hover:bg-hover'
                }`}
              >
                <span
                  className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center border ${
                    q.multiple ? 'rounded' : 'rounded-full'
                  } ${checked ? 'border-accent bg-accent' : 'border-border-strong'}`}
                >
                  {checked && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block">{opt.label}</span>
                  {opt.description && <span className="block text-xs text-muted">{opt.description}</span>}
                </span>
              </button>
            )
          })}
        </div>
      )}
      {q.custom && (
        <input
          value={freeText}
          onChange={(e) => {
            setFreeText(e.target.value)
            onChange(e.target.value.trim() ? [e.target.value] : [])
          }}
          placeholder={q.options.length > 0 ? 'O escribe tu propia respuesta…' : 'Escribe tu respuesta…'}
          className="mt-2 w-full rounded-lg border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-subtle focus:border-border-strong"
        />
      )}
    </div>
  )
}

/** Tarjeta de una solicitud de pregunta (puede traer varias preguntas encadenadas). */
export function QuestionCard({ request }: { request: QuestionRequest }): React.JSX.Element {
  const [answers, setAnswers] = useState<string[][]>(() => request.questions.map(() => []))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = (): void => {
    setBusy(true)
    setError(null)
    replyQuestion(
      request.id,
      answers.map((a) => (a.length > 0 ? a : ['Sin respuesta']))
    )
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setBusy(false))
  }

  const skip = (): void => {
    setBusy(true)
    setError(null)
    rejectQuestion(request.id)
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setBusy(false))
  }

  return (
    <div id={`question-${request.id}`} className="rounded-xl border border-accent/40 bg-accent-soft/20 p-3.5">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <HelpCircle size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">El agente necesita más información</p>
          <div className="mt-2 space-y-2">
            {request.questions.map((q, i) => (
              <QuestionField
                key={i}
                q={q}
                value={answers[i] ?? []}
                onChange={(next) =>
                  setAnswers((prev) => {
                    const copy = [...prev]
                    copy[i] = next
                    return copy
                  })
                }
              />
            ))}
          </div>
          {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
          <div className="mt-3 flex items-center gap-2">
            <Button variant="primary" disabled={busy} onClick={submit}>
              Enviar respuesta
            </Button>
            <Button variant="ghost" disabled={busy} onClick={skip} title="No responder esta pregunta">
              <X size={13} /> Omitir
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
