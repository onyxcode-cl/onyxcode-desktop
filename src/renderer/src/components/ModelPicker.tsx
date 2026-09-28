import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Loader2, Search } from 'lucide-react'
import type { ModelRef } from '@shared/types'
import { useProviders } from '../stores/providers'
import { useServer } from '../stores/server'

interface Props {
  value: ModelRef
  onChange: (model: ModelRef) => void
  /** Hacia dónde se abre el menú. */
  placement?: 'top' | 'bottom'
}

/** Selector de modelo con los proveedores/modelos del servidor (`config.providers`). */
export function ModelPicker({ value, onChange, placement = 'top' }: Props): React.JSX.Element {
  const client = useServer((s) => s.client)
  const { providers, loading, error, load } = useProviders()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (client) void load(client)
  }, [client, load])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const currentName = useMemo(() => {
    const p = providers.find((x) => x.id === value.providerID)
    return p?.models[value.modelID]?.name ?? value.modelID
  }, [providers, value])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    return providers
      .map((p) => ({
        provider: p,
        models: Object.values(p.models)
          .filter((m) => m.status !== 'deprecated')
          .filter((m) => !q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q))
          .sort((a, b) => a.name.localeCompare(b.name))
      }))
      .filter((g) => g.models.length > 0)
  }, [providers, query])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="no-drag flex max-w-[260px] items-center gap-1 rounded-lg px-2 py-1 text-[13px] text-muted hover:bg-hover hover:text-fg"
        title={`${value.providerID}/${value.modelID}`}
      >
        <span className="truncate">{currentName}</span>
        <ChevronDown size={14} className="shrink-0" />
      </button>
      {open && (
        <div
          className={`absolute left-0 z-50 w-80 overflow-hidden rounded-xl border border-border bg-elevated shadow-xl ${placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'}`}
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
          <div className="max-h-80 overflow-y-auto py-1">
            {loading && (
              <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted">
                <Loader2 size={14} className="animate-spin" /> Cargando modelos…
              </div>
            )}
            {error && <div className="px-3 py-2 text-sm text-danger">{error}</div>}
            {!loading && !error && groups.length === 0 && (
              <div className="px-3 py-2 text-sm text-muted">Sin resultados</div>
            )}
            {groups.map(({ provider, models }) => (
              <div key={provider.id}>
                <div className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-subtle uppercase">
                  {provider.name}
                </div>
                {models.map((m) => {
                  const selected = provider.id === value.providerID && m.id === value.modelID
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        onChange({ providerID: provider.id, modelID: m.id })
                        setOpen(false)
                        setQuery('')
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-hover ${selected ? 'text-fg' : 'text-muted'}`}
                    >
                      <span className="flex-1 truncate">{m.name}</span>
                      {m.capabilities.reasoning && (
                        <span className="rounded border border-border px-1 text-[10px] text-subtle">razona</span>
                      )}
                      {selected && <Check size={14} className="text-accent" />}
                    </button>
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
