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
import { Button } from '../../../components/Button'
import { errorMessage } from '../../../lib/opencode'
import { sendToTask } from './actions'
import { cw, onCowork } from './bridge'
import { useCowork } from './store'

/** Descripción en español de un paso registrado (solo para mostrar; `text` se omite si `includeTyped` es falso). */
function describeStep(step: RecordedStep, includeTyped: boolean): string {
  const app = step.app ? ` (en ${step.app.name})` : ''
  const target = [step.element?.title, step.element?.description, step.element?.role].find((x) => !!x?.trim())
  const on = target ? ` sobre «${target}»` : ''
  switch (step.type) {
    case 'click':
      return `${step.button === 'right' ? 'Clic derecho' : 'Clic'}${on}${app}`
    case 'key':
      return `Pulsó ${step.keys ?? 'una tecla'}${app}`
    case 'text':
      return includeTyped && step.text ? `Escribió «${step.text}»${app}` : `Escribió texto${app} (no incluido)`
    case 'app':
      return `Cambió a ${step.app?.name ?? 'otra app'}`
    case 'scroll':
      return `Desplazó la vista${on}${app}`
    case 'warning':
      return `Aviso: ${step.text ?? 'evento no registrado del todo'}`
    default:
      return `Acción${app}`
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
        <Video size={14} /> Grabar una skill
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
              Grabar una skill
            </h2>
            <p className="mt-1 text-sm text-muted">
              Grabaremos tu pantalla por pasos y, si quieres, tu voz; nada se envía hasta que lo revises.
            </p>
            <label className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
              <span className="flex items-center gap-2 text-sm font-medium">
                {mic ? <Mic size={15} className="text-accent" /> : <MicOff size={15} className="text-muted" />} Narrar con el micrófono
              </span>
              <MiniToggle checked={mic} onChange={() => setMic((v) => !v)} label="Narrar con el micrófono" />
            </label>
            <p className="mt-2 text-xs text-subtle">
              macOS puede pedir permiso de Micrófono y de Reconocimiento de voz la primera vez. Si algo falla, la grabación sigue sin audio.
            </p>
            {error && <p className="mt-3 text-xs text-danger">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                Cancelar
              </Button>
              <Button variant="primary" onClick={start} disabled={busy}>
                {busy && <Loader2 size={14} className="animate-spin" />} Empezar a grabar
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
  const [rec, setRec] = useState<SkillRecording | null>(null)
  const [includeTyped, setIncludeTyped] = useState(false)
  const [busy, setBusy] = useState<'send' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(
    () =>
      onCowork('computer:recordDone', (r) => {
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
    const folder = useCowork.getState().folder
    if (!folder) {
      setError('Abre una carpeta de trabajo para enviárselo al agente.')
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
            Revisar la grabación
          </h2>
          <button
            type="button"
            onClick={discard}
            disabled={!!busy}
            className="rounded-md p-1 text-muted hover:bg-hover hover:text-fg disabled:opacity-50"
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <p className="text-xs text-muted">
            {rec.steps.length} paso{rec.steps.length === 1 ? '' : 's'} · {Math.max(0, Math.round(rec.durationMs / 1000))}s
            {rec.mic === 'recorded'
              ? ' · con narración'
              : rec.mic === 'denied'
                ? ' · sin micrófono (se denegó el permiso)'
                : ' · sin micrófono'}
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
              <p className="mb-1 text-xs font-medium text-muted">Narración transcrita (puede tener errores)</p>
              <p className="rounded-lg border border-border bg-hover/40 px-3 py-2 text-sm text-fg italic">«{rec.transcript}»</p>
            </div>
          )}
          {rec.transcriptError && <p className="text-xs text-warning">No se pudo transcribir la narración: {rec.transcriptError}</p>}
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <span className="text-sm font-medium">Incluir el texto que tecleé</span>
            <MiniToggle checked={includeTyped} onChange={() => setIncludeTyped((v) => !v)} label="Incluir el texto que tecleé" />
          </label>
          <p className="text-xs text-subtle">
            Desactivado por defecto: lo que tecleaste durante la grabación (que puede incluir datos sensibles) no se envía al agente salvo
            que lo actives.
          </p>
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" onClick={discard} disabled={!!busy}>
            Descartar
          </Button>
          <Button variant="primary" onClick={send} disabled={!!busy}>
            {busy === 'send' && <Loader2 size={14} className="animate-spin" />} Enviar al agente
          </Button>
        </footer>
      </div>
    </div>
  )
}
