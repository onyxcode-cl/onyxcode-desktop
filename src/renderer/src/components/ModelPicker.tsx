import { useEffect, useMemo, useRef, useState } from 'react'
import { Brain, Check, ChevronDown, Loader2, Search } from 'lucide-react'
import type { ModelRef } from '@shared/types'
import { PREFERRED_PROVIDER, sortProviders, useProviders } from '../stores/providers'
import { useServer } from '../stores/server'
import { isSubmitKey } from '../lib/textarea'
import { useT } from '../lib/i18n'
import { isRemoteSurface } from '../lib/platform'
import { Sheet } from './mobile/Sheet'

interface Props {
  value: ModelRef
  onChange: (model: ModelRef) => void
  /** Hacia dónde se abre el menú. */
  placement?: 'top' | 'bottom'
  /** El modelo elegido no está en la lista: se muestra su id marcado como «no disponible» (no se sustituye por otro). */
  unavailable?: boolean
}

/** Selector de modelo con los proveedores/modelos del servidor (`config.providers`). */
export function ModelPicker({ value, onChange, placement = 'top', unavailable = false }: Props): React.JSX.Element {
  const t = useT()
  // En el celular el selector es una hoja a pantalla completa (no un popover): filas de 48 px y el teclado no lo tapa.
  const sheet = isRemoteSurface()
  const client = useServer((s) => s.client)
  const { providers, loading, error, load, loaded } = useProviders()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (client) void load(client)
  }, [client, load])

  useEffect(() => {
    if (!open || sheet) return
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, sheet])

  const current = useMemo(() => {
    const p = providers.find((x) => x.id === value.providerID)
    const model = p?.models[value.modelID]
    // Ya cargados los proveedores y el modelo no está entre ellos: no mostrar un id crudo que no se puede usar.
    return { name: model?.name ?? (loaded ? null : value.modelID) }
  }, [providers, value, loaded])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sortProviders(providers)
      .map((p) => ({
        provider: p,
        models: Object.values(p.models)
          .filter((m) => m.status !== 'deprecated')
          .filter((m) => !q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
          .sort((a, b) => a.name.localeCompare(b.name, 'es'))
      }))
      .filter((g) => g.models.length > 0)
  }, [providers, query])

  const flat = useMemo(() => groups.flatMap((g) => g.models.map((m) => ({ providerID: g.provider.id, modelID: m.id }))), [groups])

  // Al abrir, situar el cursor en el modelo actual.
  useEffect(() => {
    if (!open) return
    const i = flat.findIndex((r) => r.providerID === value.providerID && r.modelID === value.modelID)
    setCursor(i >= 0 ? i : 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${cursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const choose = (ref: ModelRef): void => {
    onChange(ref)
    setOpen(false)
    setQuery('')
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(flat.length - 1, c + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(0, c - 1))
    } else if (isSubmitKey(e, { allowShift: true })) {
      e.preventDefault()
      const r = flat[cursor]
      if (r) choose(r)
    }
  }

  let idx = -1

  const body = !open ? null : (
    <>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <Search size={14} className="text-subtle" />
        <input
          autoFocus={!sheet}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setCursor(0)
          }}
          placeholder={t('common.modelPicker.searchPlaceholder')}
          aria-label={t('common.modelPicker.search')}
          className={`w-full bg-transparent text-sm outline-none placeholder:text-subtle ${sheet ? 'min-h-11' : ''}`}
        />
      </div>
      <div ref={listRef} role="listbox" className={sheet ? 'p-1' : 'max-h-80 overflow-y-auto p-1'}>
        {loading && (
          <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted">
            <Loader2 size={14} className="animate-spin" /> {t('common.modelPicker.loading')}
          </div>
        )}
        {error && <div className="px-3 py-2 text-sm text-danger">{error}</div>}
        {!loading && !error && groups.length === 0 && (
          <div className="px-3 py-6 text-center text-sm text-muted">{t('common.modelPicker.empty')}</div>
        )}
        {groups.map(({ provider, models }) => (
          <div key={provider.id} className="pb-1">
            <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-subtle uppercase">
              {provider.name}
              {provider.id === PREFERRED_PROVIDER && (
                <span className="rounded-full bg-gold-soft px-1.5 text-[9.5px] tracking-normal text-gold-text normal-case">
                  {t('common.modelPicker.recommended')}
                </span>
              )}
            </div>
            {models.map((m) => {
              idx++
              const i = idx
              const selected = provider.id === value.providerID && m.id === value.modelID
              const focused = i === cursor
              return (
                <button
                  key={m.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-idx={i}
                  onMouseMove={() => cursor !== i && setCursor(i)}
                  onClick={() => choose({ providerID: provider.id, modelID: m.id })}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm transition-colors ${sheet ? 'min-h-12 py-2.5' : 'py-1.5'} ${focused ? 'bg-hover text-fg' : selected ? 'text-fg' : 'text-muted'}`}
                >
                  <span className={`flex-1 truncate ${selected ? 'font-medium' : ''}`}>{m.name}</span>
                  {m.capabilities.reasoning && (
                    <span
                      className="inline-flex items-center gap-0.5 rounded-md bg-hover px-1 py-px text-[10px] text-subtle"
                      title={t('common.modelPicker.reasoningTitle')}
                    >
                      <Brain size={10} /> {t('common.modelPicker.reasons')}
                    </span>
                  )}
                  {selected ? <Check size={14} className="text-accent" /> : <span className="w-3.5" />}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </>
  )

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`no-drag flex max-w-[280px] items-center gap-1.5 rounded-full px-2.5 text-[13px] transition-colors ${sheet ? 'min-h-11 min-w-0 px-3' : 'py-1'} ${open ? 'bg-hover text-fg' : 'text-muted hover:bg-hover hover:text-fg'}`}
        title={`${value.providerID}/${value.modelID}`}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${current.name === null || unavailable ? 'bg-warning' : 'bg-accent'}`} />
        {unavailable ? (
          <span className="truncate font-medium text-warning">
            {value.modelID} · {t('common.modelPicker.unavailable')}
          </span>
        ) : current.name === null ? (
          <span className="truncate font-medium text-warning">{t('common.modelPicker.choose')}</span>
        ) : (
          <span className="truncate font-medium">{current.name}</span>
        )}
        <ChevronDown size={13} className={`shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open &&
        (sheet ? (
          <Sheet open onClose={() => setOpen(false)} title={t('common.modelPicker.sheetTitle')} size="full">
            <div onKeyDown={onKeyDown}>{body}</div>
          </Sheet>
        ) : (
          <div
            className={`absolute left-0 z-50 w-80 animate-pop-in overflow-hidden rounded-xl border border-border bg-elevated shadow-xl ${placement === 'top' ? 'bottom-full mb-2 origin-bottom-left' : 'top-full mt-2 origin-top-left'}`}
            onKeyDown={onKeyDown}
          >
            {body}
          </div>
        ))}
    </div>
  )
}
