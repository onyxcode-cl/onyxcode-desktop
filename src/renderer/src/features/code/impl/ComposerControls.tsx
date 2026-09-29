/**
 * Controles de la barra inferior del compositor de Code (estilo de los clientes de escritorio de referencia):
 * modo de permisos, esfuerzo del modelo, selector de modelo y medidor de uso.
 * Los menús se abren hacia arriba porque el compositor vive al fondo de la ventana.
 */
import { useEffect, useRef, useState } from 'react'
import { Brain, Check, CircleSlash, ListChecks, PencilLine, Shield, Wand2 } from 'lucide-react'
import { ModelPicker } from '../../../components/ModelPicker'
import { UsageMeter } from '../../../components/UsageMeter'
import { useProviders } from '../../../stores/providers'
import { useSettings } from '../../../stores/settings'
import { useCode } from './store'
import type { PermissionMode } from './types'

const PERMISSION_MODES: { id: PermissionMode; label: string; hint: string; icon: React.JSX.Element }[] = [
  { id: 'manual', label: 'Manual', hint: 'Pregunta antes de cualquier acción', icon: <Shield size={14} /> },
  {
    id: 'acceptEdits',
    label: 'Aceptar ediciones',
    hint: 'Edita archivos sin preguntar; el resto pregunta',
    icon: <PencilLine size={14} />
  },
  { id: 'plan', label: 'Plan', hint: 'Solo explora y propone; no modifica nada', icon: <ListChecks size={14} /> },
  { id: 'auto', label: 'Auto', hint: 'Ediciones y comandos seguros sin preguntar; pregunta lo riesgoso', icon: <Wand2 size={14} /> },
  { id: 'bypass', label: 'Bypass', hint: 'Permite todo sin preguntar (incluye bash). Úsalo con cuidado.', icon: <CircleSlash size={14} /> }
]

/** Cierra al hacer clic fuera o con Esc. */
function useDismiss(open: boolean, close: () => void): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])
  return ref
}

const chip = 'no-drag flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium transition-colors'

function MenuItem({
  active,
  icon,
  label,
  hint,
  onClick
}: {
  active: boolean
  icon?: React.ReactNode
  label: string
  hint?: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      onClick={onClick}
      className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-hover ${active ? 'text-fg' : 'text-muted'}`}
    >
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium">{label}</span>
        {hint && <span className="block text-[11.5px] leading-snug text-subtle">{hint}</span>}
      </span>
      {active && <Check size={14} className="mt-0.5 shrink-0 text-accent" />}
    </button>
  )
}

/** Modo de permisos de la sesión activa. */
export function PermissionChip(): React.JSX.Element {
  const mode = useCode((s) => s.permissionMode)
  const setPermissionMode = useCode((s) => s.setPermissionMode)
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))
  const current = PERMISSION_MODES.find((m) => m.id === mode) ?? PERMISSION_MODES[0]

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Modo de permisos"
        className={`${chip} ${mode === 'bypass' ? 'bg-danger/10 text-danger' : 'text-muted hover:bg-hover hover:text-fg'} ${open ? 'bg-hover text-fg' : ''}`}
      >
        {current.icon}
        {current.label}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-50 mb-2 w-72 animate-pop-in origin-bottom-left rounded-xl border border-border bg-elevated p-1 shadow-xl"
        >
          {PERMISSION_MODES.map((m) => (
            <MenuItem
              key={m.id}
              active={mode === m.id}
              icon={m.icon}
              label={m.label}
              hint={m.hint}
              onClick={() => {
                setOpen(false)
                void setPermissionMode(m.id)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Esfuerzo del modelo (variantes de razonamiento). No se muestra si el modelo no tiene variantes. */
export function EffortChip(): React.JSX.Element | null {
  const model = useCode((s) => s.model)
  const variant = useCode((s) => s.variant)
  const setVariant = useCode((s) => s.setVariant)
  const defaultModel = useSettings((s) => s.settings.defaultModel)
  const providers = useProviders((s) => s.providers)
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))

  const effective = model ?? defaultModel
  const info = providers.find((p) => p.id === effective.providerID)?.models[effective.modelID]
  const variants = info?.variants ? Object.keys(info.variants) : []
  if (variants.length === 0) return null

  const pick = (v: string | null): void => {
    setVariant(v)
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Esfuerzo del modelo"
        className={`${chip} text-muted hover:bg-hover hover:text-fg ${open ? 'bg-hover text-fg' : ''}`}
      >
        <Brain size={14} />
        <span className="capitalize">{variant ?? 'Estándar'}</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 bottom-full z-50 mb-2 w-48 animate-pop-in origin-bottom-right rounded-xl border border-border bg-elevated p-1 shadow-xl"
        >
          <div className="px-2.5 pt-1.5 pb-1 text-[11.5px] text-subtle">Esfuerzo de razonamiento</div>
          <MenuItem active={!variant} label="Estándar" onClick={() => pick(null)} />
          {variants.map((v) => (
            <MenuItem key={v} active={variant === v} label={v.charAt(0).toUpperCase() + v.slice(1)} onClick={() => pick(v)} />
          ))}
        </div>
      )}
    </div>
  )
}

/** Grupo derecho de la barra: modelo · esfuerzo · uso. */
export function ModelControls(): React.JSX.Element {
  const model = useCode((s) => s.model)
  const setModel = useCode((s) => s.setModel)
  const activeSessionID = useCode((s) => s.activeSessionID)
  const messages = useCode((s) => (activeSessionID ? s.messages[activeSessionID] : undefined))
  const defaultModel = useSettings((s) => s.settings.defaultModel)
  const effective = model ?? defaultModel

  return (
    <div className="flex items-center gap-0.5">
      {/* El menú del selector se alinea a la derecha para no salirse del compositor. */}
      <div className="no-drag [&_.absolute]:right-0 [&_.absolute]:left-auto [&_.absolute]:origin-bottom-right">
        <ModelPicker value={effective} onChange={setModel} placement="top" />
      </div>
      <EffortChip />
      <UsageMeter messages={messages ?? []} model={effective} />
    </div>
  )
}
