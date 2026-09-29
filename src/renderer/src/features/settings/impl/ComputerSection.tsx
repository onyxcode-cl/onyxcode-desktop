/**
 * Ajustes › Control del Mac: cómo usa el agente las apps (en segundo plano por Accessibility API, o
 * con el ratón y el teclado reales), si oculta las demás apps mientras controla la pantalla, y los
 * permisos por app (concesión por app de "computer use", ya existente del Lote A).
 */
import { useEffect, useState } from 'react'
import { Check, Eye, EyeOff, Loader2, MonitorCog } from 'lucide-react'
import { DEFAULT_COMPUTER_PREFS, type ComputerControlMode, type ComputerPrefs } from '@shared/ipc-tasks'
import { TASKS_TERMS } from '@shared/tasks-glossary'
import { cw, hasTasksBridge } from '../../tasks/impl/bridge'
import { ComputerGrantsList } from '../../tasks/impl/ComputerAccess'
import { Card, ErrorText, SectionHeader, SubTitle, Toggle } from './ui'
import { errText } from '../../../lib/format'

/** Fila-botón de una opción del modo (como un radio, pero con la descripción bajo el título). */
function ModeOption({
  active,
  icon,
  title,
  desc,
  onClick
}: {
  active: boolean
  icon: React.ReactNode
  title: string
  desc: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className="flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left last:border-b-0 hover:bg-hover"
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-fg">{title}</span>
        <span className="mt-0.5 block text-xs text-muted">{desc}</span>
      </span>
      {active && <Check size={15} className="mt-0.5 shrink-0 text-accent" />}
    </button>
  )
}

export function ComputerSection(): React.JSX.Element {
  const [prefs, setPrefs] = useState<ComputerPrefs>(DEFAULT_COMPUTER_PREFS)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!hasTasksBridge()) return
    cw('computer:prefs:get')
      .then(setPrefs)
      .catch(() => undefined)
  }, [])

  const update = (patch: Partial<ComputerPrefs>): void => {
    setError(null)
    setBusy(true)
    void cw('computer:prefs:set', patch)
      .then(setPrefs)
      .catch((err: unknown) => setError(errText(err)))
      .finally(() => setBusy(false))
  }

  const setMode = (mode: ComputerControlMode): void => {
    if (mode === prefs.mode) return
    update({ mode })
  }

  return (
    <div>
      <SectionHeader
        title="Control del Mac"
        description="Cuando una tarea tiene el Control total del Mac, así decide el agente cuándo mover el ratón real y qué apps puede usar."
      />

      <SubTitle>Cómo usa el agente las apps</SubTitle>
      <Card>
        <div role="radiogroup" aria-label="Cómo usa el agente las apps">
          <ModeOption
            active={prefs.mode === 'background'}
            icon={<Eye size={16} className="text-accent" />}
            title="En segundo plano"
            desc="Controla las apps por accesibilidad (AX): no mueve el ratón ni roba el foco. Pide el
              control real del ratón y el teclado solo cuando de verdad haga falta (arrastrar,
              atajos complejos…). Recomendado."
            onClick={() => setMode('background')}
          />
          <ModeOption
            active={prefs.mode === 'full'}
            icon={<MonitorCog size={16} className="text-amber-500" />}
            title="Control de la pantalla"
            desc="Mueve el ratón, hace clic y teclea de verdad, a la vista, como lo haría una
              persona."
            onClick={() => setMode('full')}
          />
        </div>
      </Card>

      <SubTitle>Mientras controla la pantalla</SubTitle>
      <Card>
        <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-medium text-fg">
              <EyeOff size={13} className="text-muted" /> Ocultar las demás apps mientras controla
            </div>
            <div className="mt-0.5 text-xs text-muted">
              Oculta el resto de apps abiertas (deja Finder y {TASKS_TERMS.fullControlShort.toLowerCase()} intactos) mientras dura el
              control, para que nadie más pueda tocarlas mientras tanto.
            </div>
          </div>
          <Toggle
            checked={prefs.hideOtherApps}
            onChange={(v) => update({ hideOtherApps: v })}
            label="Ocultar las demás apps mientras controla"
            disabled={busy}
          />
        </div>
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-fg">Mostrarlas de nuevo al terminar</div>
            <div className="mt-0.5 text-xs text-muted">
              Cuando la tarea termina o se detiene, vuelve a mostrar las apps que se ocultaron.
            </div>
          </div>
          <Toggle
            checked={prefs.unhideOnFinish}
            onChange={(v) => update({ unhideOnFinish: v })}
            label="Mostrarlas de nuevo al terminar"
            disabled={busy || !prefs.hideOtherApps}
          />
        </div>
      </Card>
      {busy && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
          <Loader2 size={12} className="animate-spin" /> Guardando…
        </p>
      )}
      {error && (
        <div className="mt-2">
          <ErrorText>{error}</ErrorText>
        </div>
      )}

      <SubTitle>Permisos por app</SubTitle>
      <p className="mb-4 -mt-1 text-sm text-muted">
        El agente solo puede actuar sobre las apps que le hayas concedido, con el nivel que elijas. Las nuevas apps se piden con una tarjeta
        cuando el agente las necesita.
      </p>
      <ComputerGrantsList />
    </div>
  )
}
