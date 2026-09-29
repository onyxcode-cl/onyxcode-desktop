import { useEffect, useMemo, useRef, useState } from 'react'
import type { Provider } from '@opencode-ai/sdk/v2/client'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import type { ModelRef } from '@shared/types'

import { PREFERRED_PROVIDER, sortProviders } from '../../../stores/providers'

export { sortProviders }

export function modelKey(ref: ModelRef): string {
  return `${ref.providerID}/${ref.modelID}`
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

/** Selector de modelo en popover (reemplaza al <select> nativo; misma API). */
export function ModelSelect({ providers, value, onChange, defaultLabel, className = '', ...rest }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const sorted = useMemo(() => sortProviders(providers), [providers])
  const current = value ? modelKey(value) : ''
  const known = !value || sorted.some((p) => p.id === value.providerID && value.modelID in p.models)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sorted
      .map((p) => ({
        provider: p,
        models: Object.values(p.models)
          .filter((m) => m.status !== 'deprecated' || modelKey({ providerID: p.id, modelID: m.id }) === current)
          .filter((m) => !q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
          .sort((a, b) => a.name.localeCompare(b.name, 'es'))
      }))
      .filter((g) => g.models.length > 0)
  }, [sorted, query, current])

  const label = value ? (known ? modelLabel(sorted, value) : `${current} (no disponible)`) : (defaultLabel ?? 'Elegir modelo')

  const pick = (v: ModelRef | null): void => {
    onChange(v)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-label={rest['aria-label']}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center gap-2 rounded-lg border bg-bg px-3 py-1.5 text-left text-sm transition-colors hover:border-border-strong ${open ? 'border-accent' : 'border-border'} ${!value ? 'text-muted' : 'text-fg'}`}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronsUpDown size={14} className="shrink-0 text-subtle" />
      </button>
      {open && (
        <div
          className="absolute right-0 z-50 mt-1.5 w-full min-w-72 origin-top animate-pop-in overflow-hidden rounded-xl border border-border bg-elevated shadow-xl"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              setOpen(false)
            }
          }}
        >
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search size={14} className="text-subtle" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar modelo…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-subtle"
            />
          </div>
          <div role="listbox" className="max-h-72 overflow-y-auto p-1">
            {defaultLabel !== undefined && !query && (
              <Option selected={!value} onClick={() => pick(null)}>
                <span className="text-muted italic">{defaultLabel}</span>
              </Option>
            )}
            {groups.length === 0 && <div className="px-3 py-4 text-center text-sm text-muted">Sin resultados</div>}
            {groups.map(({ provider, models }) => (
              <div key={provider.id}>
                <div className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-subtle uppercase">
                  {provider.id === PREFERRED_PROVIDER ? `${provider.name} ★` : provider.name}
                </div>
                {models.map((m) => {
                  const key = `${provider.id}/${m.id}`
                  return (
                    <Option key={key} selected={key === current} onClick={() => pick({ providerID: provider.id, modelID: m.id })}>
                      <span className="flex-1 truncate">{m.name}</span>
                      {(m.status === 'alpha' || m.status === 'beta') && (
                        <span className="rounded-md bg-gold-soft px-1 text-[10px] text-gold">{m.status}</span>
                      )}
                    </Option>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Option({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-hover ${selected ? 'font-medium text-fg' : 'text-muted hover:text-fg'}`}
    >
      {children}
      {selected ? <Check size={14} className="shrink-0 text-accent" /> : <span className="w-3.5 shrink-0" />}
    </button>
  )
}
