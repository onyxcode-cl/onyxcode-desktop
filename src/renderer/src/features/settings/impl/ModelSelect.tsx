import type { Provider } from '@opencode-ai/sdk/v2/client'
import type { ModelRef } from '@shared/types'
import { Select } from './ui'

const PREFERRED = 'opencode-go'

export function sortProviders(list: Provider[]): Provider[] {
  return [...list].sort((a, b) =>
    a.id === PREFERRED ? -1 : b.id === PREFERRED ? 1 : a.name.localeCompare(b.name, 'es')
  )
}

export function modelKey(ref: ModelRef): string {
  return `${ref.providerID}/${ref.modelID}`
}

/** providerID nunca contiene "/", modelID sí puede. */
export function parseModelKey(key: string): ModelRef | null {
  const i = key.indexOf('/')
  if (i <= 0) return null
  return { providerID: key.slice(0, i), modelID: key.slice(i + 1) }
}

export function modelLabel(providers: Provider[], ref: ModelRef): string {
  const p = providers.find((x) => x.id === ref.providerID)
  const m = p?.models[ref.modelID]
  return m ? `${m.name} · ${p?.name ?? ref.providerID}` : modelKey(ref)
}

interface Props {
  providers: Provider[]
  value: ModelRef | null
  onChange: (value: ModelRef | null) => void
  /** Texto de la opción "usar predeterminado" (si se da, se permite null). */
  defaultLabel?: string
  className?: string
  'aria-label'?: string
}

export function ModelSelect({ providers, value, onChange, defaultLabel, className, ...rest }: Props): React.JSX.Element {
  const sorted = sortProviders(providers)
  const current = value ? modelKey(value) : ''
  const known = !value || sorted.some((p) => p.id === value.providerID && value.modelID in p.models)

  return (
    <Select
      aria-label={rest['aria-label']}
      className={className}
      value={current}
      onChange={(e) => onChange(e.target.value ? parseModelKey(e.target.value) : null)}
    >
      {defaultLabel !== undefined && <option value="">{defaultLabel}</option>}
      {!known && value && <option value={current}>{current} (no disponible)</option>}
      {sorted.map((p) => (
        <optgroup key={p.id} label={p.id === PREFERRED ? `${p.name} ★` : p.name}>
          {Object.values(p.models)
            .filter((m) => m.status !== 'deprecated' || modelKey({ providerID: p.id, modelID: m.id }) === current)
            .sort((a, b) => a.name.localeCompare(b.name, 'es'))
            .map((m) => (
              <option key={m.id} value={`${p.id}/${m.id}`}>
                {m.name}
                {m.status === 'alpha' || m.status === 'beta' ? ` (${m.status})` : ''}
              </option>
            ))}
        </optgroup>
      ))}
    </Select>
  )
}
