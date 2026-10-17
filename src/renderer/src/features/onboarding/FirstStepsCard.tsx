/**
 * «Primeros pasos»: tarjeta plegable en el rincón inferior de la lista de la barra lateral (encima del estado de conexión).
 * Muestra 4 pasos con progreso «1 de 4» mientras no estén completos. Cada paso se marca solo cuando la persona lo hace de
 * verdad (ver `stores/first-steps.ts`); la tarjeta se puede ocultar para siempre (se vuelve a mostrar en Ajustes › General) y
 * desaparece sola al completarse, con un mensaje breve.
 */
import { Check, ChevronDown, ChevronUp, Circle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { FIRST_STEP_IDS, firstStepsProgress, firstStepsVisible, type FirstStepId } from '@shared/first-steps'
import type { MsgKey } from '@shared/i18n'
import { useT } from '../../lib/i18n'
import { isRemoteSurface } from '../../lib/platform'
import { useServer } from '../../stores/server'
import { useSessions } from '../../stores/sessions'
import { useUi } from '../../stores/ui'
import { useChat } from '../chat/store'
import { useFirstSteps } from '../../stores/first-steps'

const COLLAPSED_KEY = 'firstSteps.collapsed'
/** Cuánto se ve el mensaje de despedida antes de desaparecer. */
export const FIRST_STEPS_FAREWELL_MS = 6000

const LABEL: Record<FirstStepId, MsgKey> = {
  model: 'firstSteps.step.model',
  message: 'firstSteps.step.message',
  attach: 'firstSteps.step.attach',
  settings: 'firstSteps.step.settings'
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

/** Qué hace pulsar un paso: llevar a donde se hace (nunca lo marca: eso solo lo hace la acción real). */
function goToStep(id: FirstStepId): void {
  const ui = useUi.getState()
  if (id === 'model') ui.openSettingsAt('models')
  else if (id === 'settings') ui.openSettingsAt('instructions')
  else ui.setMode('chat')
}

export function FirstStepsCard(): React.JSX.Element | null {
  const t = useT()
  const state = useFirstSteps((s) => s.state)
  const celebrating = useFirstSteps((s) => s.celebrating)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const ready = useServer((s) => s.status.state === 'ready')
  const listLoading = useChat((s) => s.listLoading)
  const hasConversations = useSessions((s) => Object.values(s.sessions).some((x) => !x.parentID))

  // Quien ya tenía conversaciones antes de esta lista no es «recién llegada»: se oculta una vez que la lista cargó.
  useEffect(() => {
    if (ready && !listLoading) useFirstSteps.getState().seed(hasConversations)
  }, [ready, listLoading, hasConversations])

  // La despedida se va sola.
  useEffect(() => {
    if (!celebrating) return
    const id = setTimeout(() => useFirstSteps.getState().finish(), FIRST_STEPS_FAREWELL_MS)
    return () => clearTimeout(id)
  }, [celebrating])

  if (isRemoteSurface() || !firstStepsVisible(state)) return null
  // Sin comprobar aún si hay conversaciones previas no se pinta (evita un parpadeo en quien actualiza).
  if (!state.seeded && (!ready || listLoading)) return null

  if (celebrating) {
    return (
      <div
        role="status"
        data-testid="first-steps-farewell"
        className="no-drag mx-2.5 mb-2 shrink-0 rounded-[10px] border border-border bg-elevated px-3 py-2.5 text-ui text-fg"
      >
        <span className="flex items-center gap-2">
          <Check size={14} className="shrink-0 text-success" aria-hidden="true" />
          {t('firstSteps.finished')}
        </span>
      </div>
    )
  }

  const { done, total } = firstStepsProgress(state)
  const toggle = (): void => {
    const next = !collapsed
    setCollapsed(next)
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
    } catch {
      // sin storage: no se recuerda
    }
  }
  const listId = 'first-steps-list'
  return (
    <section
      aria-label={t('firstSteps.aria', { done, total })}
      data-testid="first-steps"
      className="no-drag mx-2.5 mb-2 shrink-0 rounded-[10px] border border-border bg-elevated"
    >
      <div className="flex items-center gap-1 pr-1">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls={listId}
          aria-label={`${t(collapsed ? 'firstSteps.expand' : 'firstSteps.collapse')} — ${t('firstSteps.progress', { done, total })}`}
          className="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-[10px] px-3 py-1.5 text-left text-ui font-medium text-fg transition-colors duration-[var(--dur-fast)] hover:bg-hover"
        >
          <span className="min-w-0 flex-1 truncate">{t('firstSteps.title')}</span>
          <span data-testid="first-steps-progress" className="shrink-0 text-meta font-normal text-muted">
            {t('firstSteps.progress', { done, total })}
          </span>
          {collapsed ? (
            <ChevronUp size={14} className="shrink-0 text-muted" aria-hidden="true" />
          ) : (
            <ChevronDown size={14} className="shrink-0 text-muted" aria-hidden="true" />
          )}
        </button>
      </div>
      {!collapsed && (
        <>
          <ul id={listId} className="px-1.5 pb-1">
            {FIRST_STEP_IDS.map((id) => {
              const isDone = state.done.includes(id)
              return (
                <li key={id}>
                  <button
                    type="button"
                    data-step={id}
                    data-done={isDone ? '' : undefined}
                    onClick={() => goToStep(id)}
                    className={`flex min-h-8 w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left text-ui transition-colors duration-[var(--dur-fast)] hover:bg-hover ${isDone ? 'text-muted' : 'text-fg'}`}
                  >
                    {isDone ? (
                      <Check size={14} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
                    ) : (
                      <Circle size={14} className="mt-0.5 shrink-0 text-subtle" aria-hidden="true" />
                    )}
                    <span className={`min-w-0 flex-1 ${isDone ? 'line-through decoration-subtle/60' : ''}`}>{t(LABEL[id])}</span>
                    <span className="sr-only">{t(isDone ? 'firstSteps.stepDone' : 'firstSteps.stepTodo')}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="flex justify-end px-2 pb-1.5">
            <button
              type="button"
              title={t('firstSteps.hideHint')}
              aria-label={t('firstSteps.hideHint')}
              onClick={() => useFirstSteps.getState().hide()}
              className="rounded-md px-2 py-1 text-meta text-muted transition-colors duration-[var(--dur-fast)] hover:bg-hover hover:text-fg"
            >
              {t('firstSteps.hide')}
            </button>
          </div>
        </>
      )}
    </section>
  )
}
