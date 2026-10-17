/**
 * El trabajo de una respuesta, plegado en una línea («Trabajó durante 6 s · 4 pasos ›»). Lo comparten Chat y Code.
 *  - En vivo está abierto y animado (el giro es `animate-spin`, que la regla de movimiento reducido NO apaga: es la señal de
 *    que el agente sigue trabajando, y el PC de pruebas con Windows informa movimiento reducido).
 *  - Al terminar se pliega solo, salvo que la persona lo haya abierto. «Detallada» lo deja abierto de entrada.
 *  - Los pasos con un permiso pendiente o un error NUNCA quedan dentro del plegado: salen debajo de la línea.
 *  - Con la vista «Con pasos», plegado, dice qué hizo y deja a la vista los archivos editados.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ToolPart } from '@opencode-ai/sdk/v2/client'
import { ChevronRight, Loader2 } from 'lucide-react'
import { useLocale, useT } from '../../../lib/i18n'
import { countSteps, workDoneAnnouncement, workDurationMs, workTitle, type TimedFacts } from '../../../lib/conversation/work'
import type { ReadingMode } from '../../../lib/reading-mode'
import { EditChip, summarizeSteps, toolKind } from './ToolCard'

/** Reloj de un segundo mientras `active`; parado devuelve la última hora leída. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}

export interface WorkFoldProps {
  /** Todas las partes del tramo (herramientas, razonamiento, texto): sirven para medir el tiempo. */
  parts: readonly TimedFacts[]
  /** Las llamadas a herramienta del tramo, en orden. */
  tools: ToolPart[]
  /** El agente sigue trabajando en este tramo (aún no empezó la respuesta final). */
  live: boolean
  view: ReadingMode
  root: string | null
  /** Pasos con permiso pendiente o error: se ven siempre, también con el trabajo plegado. */
  attention: ToolPart[]
  /** Cómo se pinta un paso de `attention` (fila + su tarjeta de permiso). */
  renderStep: (part: ToolPart) => ReactNode
  /** La lista completa del trabajo (se llama solo con el plegado abierto). */
  renderList: () => ReactNode
}

export function WorkFold({ parts, tools, live, view, root, attention, renderStep, renderList }: WorkFoldProps): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const open = userOpen ?? (live || view === 'detailed')
  const listId = useId()
  const now = useNow(live)
  const steps = countSteps(parts)
  const ms = useMemo(() => workDurationMs(parts, live, now), [parts, live, now])
  // `locale` fuerza recalcular los textos al cambiar de idioma.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const title = useMemo(() => workTitle(steps, ms, live), [steps, ms, live, locale])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const summary = useMemo(() => (view === 'normal' ? summarizeSteps(tools) : ''), [tools, view, locale])

  // Aviso moderado para lectores de pantalla solo cuando ESTE trabajo pasa de «trabajando» a «terminó».
  const [announce, setAnnounce] = useState('')
  const wasLive = useRef(live)
  useEffect(() => {
    if (wasLive.current && !live && steps > 0) setAnnounce(workDoneAnnouncement(steps))
    else if (live) setAnnounce('')
    wasLive.current = live
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo reacciona al paso de en vivo a terminado
  }, [live])

  const attentionIds = new Set(attention.map((p) => p.id))
  const edits = view === 'normal' ? tools.filter((p) => toolKind(p.tool) === 'edit' && !attentionIds.has(p.id)) : []

  return (
    <div className="-mx-1.5" data-work-fold="" data-live={live ? 'true' : 'false'}>
      <button
        type="button"
        onClick={() => setUserOpen(!open)}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        className="group/work flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] text-muted hover:bg-hover hover:text-fg"
      >
        {live && <Loader2 size={14} className="shrink-0 animate-spin text-accent" aria-hidden />}
        <span className={`min-w-0 truncate font-medium tabular-nums ${live ? 'text-shimmer' : 'text-fg/90'}`}>{title}</span>
        <ChevronRight size={13} className={`shrink-0 text-subtle transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
      </button>
      {open ? (
        <div id={listId} className="ml-[13px] border-l border-border pl-2">
          {renderList()}
        </div>
      ) : (
        <>
          {summary && <div className="truncate px-1.5 pb-0.5 text-xs text-subtle">{summary}</div>}
          {edits.length > 0 && (
            <div className="ml-[13px] border-l border-border pl-2">
              {edits.map((p) => (
                <EditChip key={p.id} part={p} root={root} />
              ))}
            </div>
          )}
          {attention.length > 0 && (
            <div
              role="group"
              aria-label={t('work.attention')}
              className="ml-[13px] border-l-2 border-danger/50 pl-2"
              data-work-attention=""
            >
              {attention.map((p) => (
                <div key={p.id}>{renderStep(p)}</div>
              ))}
            </div>
          )}
        </>
      )}
      <span role="status" aria-live="polite" className="sr-only">
        {announce}
      </span>
    </div>
  )
}
