/**
 * "Grabar una skill": grabación por pasos (clics, teclas, texto, cambio de app, capturas) más,
 * opcionalmente, narración por voz (`cu-helper record`), para que el agente proponga generalizarla
 * a una skill reutilizable. Dos piezas:
 * - `RecordSkillButton`: el diálogo de inicio (interruptor del micrófono).
 * - `RecordSkillReview`: siempre montada (no depende de ningún panel abierto), escucha
 *   `computer:recordDone` y muestra la tarjeta de revisión (pasos, transcripción, «Incluir el texto
 *   que tecleé» desactivado por defecto, «Enviar al agente» y «Descartar»).
 * Mientras la grabación está en curso, "Terminar"/"Descartar" viven en la píldora de la ventana
 * `assist` (fuera de este archivo): aquí solo se inicia y, al terminar, se revisa.
 */
import { useEffect, useState } from 'react'
import { Loader2, Mic, MicOff, Sparkles, Video, X } from 'lucide-react'
import type { RecordedStep, SkillRecording } from '@shared/ipc-tasks'
import { t } from '@shared/i18n'
import { Button } from '../../../components/Button'
import { useT } from '../../../lib/i18n'
import { errorMessage } from '../../../lib/opencode'
import { sendToTask } from './actions'
import { cw, onTasks } from './bridge'
import { useTasks } from './store'

/** Descripción (en el idioma activo) de un paso registrado (solo para mostrar; `text` se omite si `includeTyped` es falso). */
function describeStep(step: RecordedStep, includeTyped: boolean): string {
  const app = step.app ? t('tasksComputer.rec.inApp', { app: step.app.name }) : ''
  const target = [step.element?.title, step.element?.description, step.element?.role].find((x) => !!x?.trim())
  const on = target ? t('tasksComputer.rec.on', { target }) : ''
  switch (step.type) {
    case 'click':
      return `${step.button === 'right' ? t('tasksComputer.rec.rightClick') : t('tasksComputer.rec.click')}${on}${app}`
    case 'key':
      return `${t('tasksComputer.rec.pressed', { keys: step.keys ?? t('tasksComputer.rec.aKey') })}${app}`
    case 'text':
      return includeTyped && step.text
        ? `${t('tasksComputer.rec.typed', { text: step.text })}${app}`
        : `${t('tasksComputer.rec.typedText')}${app}${t('tasksComputer.rec.notIncluded')}`
    case 'app':
      return t('tasksComputer.rec.switched', { app: step.app?.name ?? t('tasksComputer.rec.otherApp') })
    case 'scroll':
      return `${t('tasksComputer.rec.scrolled')}${on}${app}`
    case 'warning':
      return t('tasksComputer.rec.warning', { text: step.text ?? t('tasksComputer.rec.warningDefault') })
    default:
      return `${t('tasksComputer.rec.action')}${app}`
  }
}

// ───────────────────────────── Interruptor simple (sin depender de Ajustes) ─────────────────────────────

function MiniToggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ${checked ? 'bg-accent' : 'bg-border-strong'}`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${checked ? 'translate-x-4.5' : 'translate-x-0.5'}`}
      />
    </button>
  )
}

// ───────────────────────────── Entrada: "Grabar una skill" ─────────────────────────────

export function RecordSkillButton(): React.JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [mic, setMic] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = (): void => {
    setBusy(true)
    setError(null)
    cw('computer:record:start', { mic })
      .then(() => setOpen(false))
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setBusy(false))
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Video size={14} /> {t('tasksComputer.rec.record')}
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onMouseDown={() => !busy && setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="record-skill-title"
            className="w-full max-w-md rounded-2xl border border-border bg-elevated p-6 shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <Video size={20} />
            </div>
            <h2 id="record-skill-title" className="text-lg font-semibold">
              {t('tasksComputer.rec.record')}
            </h2>
            <p className="mt-1 text-sm text-muted">{t('tasksComputer.rec.intro')}</p>
            <label className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
              <span className="flex items-center gap-2 text-sm font-medium">
                {mic ? <Mic size={15} className="text-accent" /> : <MicOff size={15} className="text-muted" />}{' '}
                {t('tasksComputer.rec.narrate')}
              </span>
              <MiniToggle checked={mic} onChange={() => setMic((v) => !v)} label={t('tasksComputer.rec.narrate')} />
            </label>
            <p className="mt-2 text-xs text-subtle">{t('tasksComputer.rec.micNote')}</p>
            {error && <p className="mt-3 text-xs text-danger">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                {t('tasksComputer.cancel')}
              </Button>
              <Button variant="primary" onClick={start} disabled={busy}>
                {busy && <Loader2 size={14} className="animate-spin" />} {t('tasksComputer.rec.start')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ───────────────────────────── Revisión (siempre montada) ─────────────────────────────

export function RecordSkillReview(): React.JSX.Element | null {
  const t = useT()
  const [rec, setRec] = useState<SkillRecording | null>(null)
  const [includeTyped, setIncludeTyped] = useState(false)
  const [busy, setBusy] = useState<'send' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(
    () =>
      onTasks('computer:recordDone', (r) => {
        setRec(r)
        setIncludeTyped(false)
        setError(null)
      }),
    []
  )

  useEffect(() => {
    if (!rec) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) setRec(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [rec, busy])

  if (!rec) return null

  const discard = (): void => {
    if (busy) return
    setRec(null)
  }

  const send = (): void => {
    const folder = useTasks.getState().folder
    if (!folder) {
      setError(t('tasksComputer.rec.needFolder'))
      return
    }
    setBusy('send')
    setError(null)
    cw('computer:record:prepare', { id: rec.id, folder, includeTyped })
      .then(({ prompt }) => sendToTask(prompt))
      .then(() => setRec(null))
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setBusy(null))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onMouseDown={discard}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="record-review-title"
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-border bg-elevated shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center gap-2.5 border-b border-border px-5 py-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Sparkles size={15} />
          </span>
          <h2 id="record-review-title" className="min-w-0 flex-1 text-base font-semibold">
            {t('tasksComputer.rec.review')}
          </h2>
          <button
            type="button"
            onClick={discard}
            disabled={!!busy}
            className="rounded-md p-1 text-muted hover:bg-hover hover:text-fg disabled:opacity-50"
            aria-label={t('tasksComputer.shot.close')}
          >
            <X size={16} />
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <p className="text-xs text-muted">
            {t('tasksComputer.rec.steps', { count: rec.steps.length })} · {Math.max(0, Math.round(rec.durationMs / 1000))}s
            {rec.mic === 'recorded'
              ? t('tasksComputer.rec.withNarration')
              : rec.mic === 'denied'
                ? t('tasksComputer.rec.micDenied')
                : t('tasksComputer.rec.noMic')}
          </p>
          {rec.steps.length > 0 && (
            <ol className="list-decimal space-y-1.5 rounded-lg border border-border bg-hover/40 px-4 py-3 pl-8 text-sm text-fg">
              {rec.steps.map((s, i) => (
                <li key={i}>{describeStep(s, includeTyped)}</li>
              ))}
            </ol>
          )}
          {rec.transcript && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted">{t('tasksComputer.rec.transcript')}</p>
              <p className="rounded-lg border border-border bg-hover/40 px-3 py-2 text-sm text-fg italic">«{rec.transcript}»</p>
            </div>
          )}
          {rec.transcriptError && (
            <p className="text-xs text-warning">{t('tasksComputer.rec.transcriptError', { error: rec.transcriptError })}</p>
          )}
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <span className="text-sm font-medium">{t('tasksComputer.rec.includeTyped')}</span>
            <MiniToggle checked={includeTyped} onChange={() => setIncludeTyped((v) => !v)} label={t('tasksComputer.rec.includeTyped')} />
          </label>
          <p className="text-xs text-subtle">{t('tasksComputer.rec.includeTypedNote')}</p>
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" onClick={discard} disabled={!!busy}>
            {t('tasksComputer.rec.discard')}
          </Button>
          <Button variant="primary" onClick={send} disabled={!!busy}>
            {busy === 'send' && <Loader2 size={14} className="animate-spin" />} {t('tasksComputer.rec.send')}
          </Button>
        </footer>
      </div>
    </div>
  )
}
