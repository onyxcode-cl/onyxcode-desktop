/**
 * Tarjeta de preguntas estructuradas (herramienta `question` de OpenCode) compartida por Code y Chat:
 * opciones de un solo valor (radio) o múltiples (casillas), texto libre si `custom` y Responder / Omitir.
 * No conoce ningún store: quien la usa le pasa `onReply` / `onReject`. En el celular los controles miden 44 px.
 */
import { useState } from 'react'
import { HelpCircle } from 'lucide-react'
import type { QuestionInfo } from '@opencode-ai/sdk/v2/client'
import { m } from '../app/mobile/m'
import { useT } from '../lib/i18n'
import { errorMessage } from '../lib/opencode'
import { isRemoteSurface } from '../lib/platform'
import { Button } from './Button'

export function QuestionCard({
  questions,
  onReply,
  onReject
}: {
  questions: QuestionInfo[]
  /** Respuestas por pregunta (cada una: las etiquetas elegidas y/o el texto libre). */
  onReply: (answers: string[][]) => Promise<unknown> | void
  onReject: () => Promise<unknown> | void
}): React.JSX.Element {
  const t = useT()
  const remote = isRemoteSurface()
  const [answers, setAnswers] = useState<string[][]>(() => questions.map(() => []))
  const [custom, setCustom] = useState<string[]>(() => questions.map(() => ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (qi: number, label: string, multiple: boolean): void => {
    setAnswers((prev) =>
      prev.map((a, i) => {
        if (i !== qi) return a
        if (!multiple) return [label]
        return a.includes(label) ? a.filter((x) => x !== label) : [...a, label]
      })
    )
  }

  const final = answers.map((a, i) => (custom[i].trim() ? [...a, custom[i].trim()] : a))
  const ready = final.every((a) => a.length > 0)

  const run = (fn: () => Promise<unknown> | void): void => {
    setBusy(true)
    setError(null)
    void Promise.resolve()
      .then(fn)
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setBusy(false))
  }

  return (
    <div
      {...m('pending-card')}
      className={`my-2 rounded-xl border border-accent/40 bg-elevated px-3.5 py-3 shadow-sm ${remote ? '' : 'ring-4 ring-accent/5'}`}
    >
      {questions.map((q, qi) => (
        <div key={qi} className="mb-3">
          <div className="flex items-start gap-2 text-sm">
            <HelpCircle size={16} className="mt-0.5 shrink-0 text-accent" />
            <div>
              {q.header && <div className="text-xs font-medium tracking-wide text-muted uppercase">{q.header}</div>}
              <div className="font-medium">{q.question}</div>
            </div>
          </div>
          <div className="mt-2 ml-6 flex flex-wrap gap-2" role={q.multiple ? 'group' : 'radiogroup'}>
            {q.options.map((o) => {
              const selected = answers[qi]?.includes(o.label)
              return (
                <button
                  key={o.label}
                  type="button"
                  role={q.multiple ? 'checkbox' : 'radio'}
                  aria-checked={!!selected}
                  title={o.description || undefined}
                  onClick={() => toggle(qi, o.label, !!q.multiple)}
                  className={`rounded-lg border px-2.5 py-1 text-left text-sm transition ${remote ? 'min-h-11 px-4' : ''} ${selected ? 'border-accent bg-accent-soft text-fg' : 'border-border hover:bg-hover'}`}
                >
                  <span className="block">{o.label}</span>
                  {o.description && <span className="block text-xs font-normal text-muted">{o.description}</span>}
                </button>
              )
            })}
          </div>
          {q.custom !== false && (
            <input
              value={custom[qi]}
              onChange={(e) => setCustom((prev) => prev.map((c, i) => (i === qi ? e.target.value : c)))}
              placeholder={t('code.question.other')}
              className={`mt-2 ml-6 w-[calc(100%-1.5rem)] rounded-lg border border-border bg-bg px-2.5 py-1 text-sm outline-none focus:border-accent ${remote ? 'min-h-11' : ''}`}
            />
          )}
        </div>
      ))}
      {error && <p className="mb-2 text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button
          variant="primary"
          className={remote ? 'min-h-11 flex-1' : undefined}
          disabled={busy || !ready}
          onClick={() => run(() => onReply(final))}
        >
          {t('code.question.answer')}
        </Button>
        <Button variant="ghost" className={remote ? 'min-h-11 flex-1' : undefined} disabled={busy} onClick={() => run(() => onReject())}>
          {t('code.question.skip')}
        </Button>
      </div>
    </div>
  )
}
