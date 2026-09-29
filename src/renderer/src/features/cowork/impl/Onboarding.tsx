/**
 * Tarjeta de primer uso de Cowork (se muestra desde `Home` hasta que se descarta; el estado vive en
 * localStorage `cowork.onboarded`): 3 pasos y una sección «Cómo usar Cowork de forma segura».
 */
import { useState } from 'react'
import { Check, ChevronDown, FolderOpen, MonitorCog, Play, Shield, X } from 'lucide-react'
import { COWORK_TERMS } from '@shared/cowork-glossary'
import { chooseFolder } from './actions'
import { useCowork } from './store'

/** Tarea de prueba segura: solo lee y resume, no modifica nada. */
export const ONBOARDING_SAMPLE_PROMPT =
  'Primero revisa esta carpeta y muéstrame un resumen de qué hay (tipos de archivo y para qué parece servir cada parte); luego propón tres tareas útiles que podríamos hacer aquí; no modifiques nada todavía.'

const SAFETY_TIPS = [
  `Empieza en ${COWORK_TERMS.sandbox}: solo toca la carpeta elegida y las carpetas adicionales que añadas. Usa ${COWORK_TERMS.fullControl} solo cuando de verdad lo necesites.`,
  'Pide primero un resumen y un plan: «Primero revisa… y muéstrame un resumen; luego propón…; cuando lo apruebe, hazlo».',
  `Mover, renombrar y borrar piden el permiso «${COWORK_TERMS.deleteGrant}». Concédelo solo en carpetas que tengas respaldadas.`,
  'Lee cada tarjeta de permiso antes de aprobar. El motivo que muestra lo dice el agente y no está verificado.',
  `En ${COWORK_TERMS.fullControl} revisa el plan antes de aprobarlo y no dejes datos sensibles a la vista. Detén al agente en cualquier momento con ⌘⇧Esc.`,
  'No pegues contraseñas ni claves en la tarea: el agente puede escribirlas en archivos o enviarlas a los sitios que permitas.'
]

function Step({
  n,
  done,
  title,
  children,
  action
}: {
  n: number
  done?: boolean
  title: string
  children: React.ReactNode
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
          done ? 'bg-success/15 text-success' : 'bg-accent-soft text-accent'
        }`}
      >
        {done ? <Check size={13} /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <div className="mt-0.5 text-[13px] leading-snug text-muted">{children}</div>
        {action && <div className="mt-2">{action}</div>}
      </div>
    </li>
  )
}

const stepBtn =
  'flex items-center gap-1.5 rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs font-medium text-fg transition hover:border-border-strong hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50'

export function Onboarding({ onDismiss }: { onDismiss: () => void }): React.JSX.Element {
  const folder = useCowork((s) => s.folder)
  const phase = useCowork((s) => s.phase)
  const [safeOpen, setSafeOpen] = useState(false)

  const trySample = (): void => {
    useCowork.setState({ draft: ONBOARDING_SAMPLE_PROMPT })
  }

  return (
    <section
      aria-labelledby="cowork-onboarding-title"
      className="mx-6 mb-5 rounded-2xl border border-border bg-elevated p-4 shadow-sm sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="cowork-onboarding-title" className="font-display text-base font-medium">
            Así funciona Cowork
          </h2>
          <p className="mt-0.5 text-[13px] text-muted">Tres pasos para delegar tu primera tarea con tranquilidad.</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          title="Descartar (no volverá a aparecer)"
          aria-label="Descartar la guía de primer uso"
          className="shrink-0 rounded-md p-1 text-subtle transition hover:bg-hover hover:text-fg"
        >
          <X size={15} />
        </button>
      </div>

      <ol className="mt-4 grid gap-4 md:grid-cols-3">
        <Step
          n={1}
          done={!!folder}
          title="Elige una carpeta"
          action={
            <button type="button" className={stepBtn} onClick={() => void chooseFolder()}>
              <FolderOpen size={13} /> {folder ? 'Cambiar carpeta' : 'Elegir carpeta'}
            </button>
          }
        >
          El agente trabaja dentro de ella. Puedes añadir carpetas adicionales, de lectura y escritura o de solo lectura.
        </Step>

        <Step n={2} title="Qué puede y qué no hacer">
          <span className="flex items-start gap-1.5">
            <Shield size={13} className="mt-0.5 shrink-0 text-accent" />
            <span>
              <strong className="font-medium text-fg">{COWORK_TERMS.sandbox}:</strong> lee y escribe solo en tus carpetas, no ve tus claves
              y pide permiso para borrar, mover o renombrar.
            </span>
          </span>
          <span className="mt-1.5 flex items-start gap-1.5">
            <MonitorCog size={13} className="mt-0.5 shrink-0 text-warning" />
            <span>
              <strong className="font-medium text-fg">{COWORK_TERMS.fullControl}:</strong> sin sandbox; usa ratón, teclado y pantalla y
              puede tocar cualquier archivo. Exige aprobar un plan.
            </span>
          </span>
        </Step>

        <Step
          n={3}
          title="Prueba una tarea"
          action={
            <button type="button" className={stepBtn} disabled={!folder || phase === 'starting'} onClick={trySample}>
              <Play size={13} /> Rellenar una tarea de prueba
            </button>
          }
        >
          Una que solo lee y resume: no modifica nada. {!folder && 'Elige antes una carpeta.'}
        </Step>
      </ol>

      <div className="mt-4 border-t border-border pt-3">
        <button
          type="button"
          onClick={() => setSafeOpen((o) => !o)}
          aria-expanded={safeOpen}
          aria-controls="cowork-safe-use"
          className="flex items-center gap-1.5 text-[13px] font-medium text-accent transition hover:underline"
        >
          Cómo usar Cowork de forma segura
          <ChevronDown size={14} className={`transition-transform ${safeOpen ? 'rotate-180' : ''}`} />
        </button>
        {safeOpen && (
          <ul id="cowork-safe-use" className="mt-2 list-disc space-y-1 pl-5 text-[13px] leading-snug text-muted marker:text-subtle">
            {SAFETY_TIPS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted transition hover:bg-hover hover:text-fg"
        >
          Entendido, no mostrar más
        </button>
      </div>
    </section>
  )
}
