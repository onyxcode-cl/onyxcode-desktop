/**
 * «Plan · 3 de 5 listos»: la lista de tareas del agente como tarjeta en la conversación de Code (escritorio).
 * Se actualiza en vivo (`todo.updated`), se pliega con un clic en el título y se pliega sola al terminar.
 * El cronómetro del paso en curso cuenta desde que el cliente lo vio pasar a «en curso».
 */
import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { useT } from '../../../lib/i18n'
import { useCode } from './store'
import { activeKey, derivePlan, formatElapsed, type PlanView } from './plan-logic'

function Marker({ state }: { state: 'done' | 'active' | 'pending' }): React.JSX.Element {
  if (state === 'done')
    return (
      <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-success text-white" data-state="done">
        <Check size={12} strokeWidth={3} />
      </span>
    )
  if (state === 'active')
    return (
      <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full border-2 border-accent" data-state="active">
        <span className="size-1.5 rounded-full bg-accent" />
      </span>
    )
  return <span className="size-[18px] shrink-0 rounded-full border-2 border-border" data-state="pending" />
}

/** Milisegundos desde que el paso en curso cambió (en el cliente); se reinicia al cambiar de paso. */
function useElapsed(key: string | null): number {
  const startRef = useRef<{ key: string | null; at: number }>({ key, at: Date.now() })
  if (startRef.current.key !== key) startRef.current = { key, at: Date.now() }
  const [, tick] = useState(0)
  useEffect(() => {
    if (!key) return
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [key])
  return key ? Date.now() - startRef.current.at : 0
}

export function PlanCardView({
  view,
  open,
  onToggle,
  elapsedMs
}: {
  view: PlanView
  open: boolean
  onToggle: () => void
  elapsedMs: number
}): React.JSX.Element {
  const t = useT()
  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-2 desk:max-w-[var(--measure-prose)]" data-testid="plan-card">
      <div className="rounded-xl border border-border bg-elevated px-4 py-3 text-[14px]">
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-baseline gap-1.5 text-left">
          <span className="font-semibold text-fg">{t('code.plan.title')}</span>
          <span className="text-muted">· {t('code.plan.progress', { done: view.done, total: view.total })}</span>
        </button>
        {open && (
          <ul className="mt-2 space-y-1.5">
            {view.steps.map((s, i) => (
              <li key={i} className="flex min-w-0 items-center gap-2.5">
                <Marker state={s.state} />
                <span className={`min-w-0 flex-1 truncate ${s.state === 'pending' ? 'text-muted' : 'text-fg'}`} title={s.content}>
                  {s.content}
                </span>
                {s.state === 'active' && (
                  <span className="shrink-0 text-[13px] tabular-nums text-muted">
                    {t('code.plan.working', { time: formatElapsed(elapsedMs) })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export function PlanCard({ sessionID }: { sessionID: string }): React.JSX.Element | null {
  const todos = useCode((s) => s.todos[sessionID])
  const view = derivePlan(todos)
  const [manual, setManual] = useState<boolean | null>(null)
  const elapsed = useElapsed(activeKey(view))
  const wasComplete = useRef(false)
  // Al terminar todo se pliega solo; si luego llegan pasos nuevos vuelve a abrirse.
  const complete = view?.complete ?? false
  useEffect(() => {
    if (complete !== wasComplete.current) {
      wasComplete.current = complete
      setManual(null)
    }
  }, [complete])
  if (!view) return null
  const open = manual ?? !view.complete
  return <PlanCardView view={view} open={open} onToggle={() => setManual(!open)} elapsedMs={elapsed} />
}
