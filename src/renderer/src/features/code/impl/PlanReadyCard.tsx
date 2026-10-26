/**
 * «Plan listo»: tarjeta del modo plan del motor propio (2C). Muestra el plan que el agente `plan` dejó en su archivo como TEXTO PLANO
 * plegable (nunca Markdown ni enlaces: lo escribió un modelo a partir de archivos del proyecto) y la pareja de botones que contestan la
 * pregunta pendiente del motor con la respuesta EXACTA: «Aprobar y editar con preguntas» o «Seguir planificando».
 *
 * Solo aparece con la bandera experimental `Settings.modoPlan`; el celular no la ve (escritorio). Aprobar no da permisos nuevos: el
 * asistente pasa a editar y sigue pidiendo permiso como siempre.
 */
import { useId, useState } from 'react'
import { ChevronDown, ChevronRight, ListChecks } from 'lucide-react'
import { findPlanQuestion } from '@shared/plan-mode'
import { useT } from '../../../lib/i18n'
import { useSettings } from '../../../stores/settings'
import { useCode } from './store'

export function PlanReadyCard({ sessionID }: { sessionID: string }): React.JSX.Element | null {
  const t = useT()
  const id = useId()
  const enabled = useSettings((s) => s.settings.modoPlan === true)
  const plan = useCode((s) => s.plans[sessionID])
  const question = useCode((s) => (plan ? findPlanQuestion(plan, Object.values(s.questions)) : undefined))
  const decide = useCode((s) => s.decidePlan)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!enabled || !plan) return null

  const ready = !!question && !busy
  const run = (decision: 'aprobado' | 'seguir'): void => {
    if (!ready) return
    setBusy(true)
    void decide(plan, decision).finally(() => setBusy(false))
  }
  const shownKb = Math.max(1, Math.round(new TextEncoder().encode(plan.contenido).length / 1024))
  const totalKb = Math.max(shownKb, Math.ceil(plan.bytes / 1024))

  return (
    <div className={`mx-auto mb-2 w-full max-w-3xl desk:max-w-[var(--measure-prose)] px-6`}>
      <section
        role="region"
        aria-label={t('code.planReady.aria')}
        data-plan-ready=""
        className="rounded-xl border border-accent/40 bg-accent-soft/40 px-3.5 py-3 text-sm"
      >
        <div className="flex items-start gap-2">
          <ListChecks size={16} className="mt-0.5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">{t('code.planReady.title')}</h3>
            <p className="text-xs text-muted">{t('code.planReady.subtitle')}</p>
            {plan.rutaAbsoluta || plan.ruta ? (
              <p className="mt-1 break-all text-xs text-muted" title={plan.rutaAbsoluta || plan.ruta}>
                {t('code.planReady.path', { path: plan.ruta || plan.rutaAbsoluta })}
              </p>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          onClick={() => setOpen((v) => !v)}
          className="mt-2 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-xs font-medium text-muted hover:bg-hover hover:text-fg"
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {open ? t('code.planReady.collapse') : t('code.planReady.expand')}
        </button>
        <pre
          id={`${id}-body`}
          tabIndex={0}
          className={`mt-1 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-bg/60 p-2.5 font-mono text-xs leading-relaxed ${
            open ? 'max-h-[60vh]' : 'max-h-40'
          }`}
        >
          {plan.contenido}
        </pre>
        {plan.truncado && (
          <p className="mt-1 text-xs text-warning" role="note">
            {t('code.planReady.truncated', { shown: shownKb, total: totalKb })}
          </p>
        )}

        <p className="mt-2 text-xs text-muted">{t('code.planReady.approveHint')}</p>
        {!question && (
          <p role="status" className="mt-1 text-xs text-muted">
            {t('code.planReady.waiting')}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!ready}
            onClick={() => run('aprobado')}
            className="whitespace-nowrap rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            {t('code.planReady.approve')}
          </button>
          <button
            type="button"
            disabled={!ready}
            onClick={() => run('seguir')}
            className="whitespace-nowrap rounded-md border border-border bg-elevated px-3 py-1.5 text-xs font-medium hover:bg-hover disabled:opacity-50"
          >
            {t('code.planReady.keep')}
          </button>
        </div>
      </section>
    </div>
  )
}
