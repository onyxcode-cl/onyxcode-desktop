/**
 * Botón «Comparar» del compositor (Code y Chat), su lanzador (2–4 modelos) y el chip «Comparar ×N» con el que se arma la
 * comparación. En el celular no existe (devuelve `null`).
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, Columns3, Search, X } from 'lucide-react'
import { COMPARE_MODELS_MAX } from '@shared/ipc-code'
import type { CompareMode, CompareModelRef } from '@shared/ipc-code'
import type { ModelRef } from '@shared/types'
import { Button } from '../../components/Button'
import { useT } from '../../lib/i18n'
import { sortProviders, useProviders } from '../../stores/providers'
import { useServer } from '../../stores/server'
import { compareAvailable } from './api'
import { isLimitedProvider, isActiveManifest, modelKey, validateSelection } from './model'
import { armModels, ctxKey, disarm, useCompare } from './store'

interface Row {
  ref: CompareModelRef
  name: string
  provider: string
}

export function CompareControls({
  mode,
  directory,
  current,
  variant,
  disabled,
  align = 'left'
}: {
  mode: CompareMode
  directory: string | null
  current: ModelRef
  variant?: string | null
  disabled?: boolean
  /** Hacia qué lado se abre el lanzador respecto al botón (en la derecha del compositor, `right`). */
  align?: 'left' | 'right'
}): React.JSX.Element | null {
  const t = useT()
  const key = ctxKey(mode, directory)
  const armed = useCompare((s) => s.armed[key])
  const busy = useCompare((s) => Object.values(s.manifests).some(isActiveManifest))
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  if (!compareAvailable()) return null
  const close = (focus = true): void => {
    setOpen(false)
    if (focus) requestAnimationFrame(() => triggerRef.current?.focus())
  }
  return (
    <div className="relative flex items-center gap-1" data-testid="compare-controls">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled || busy}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={busy ? t('compare.launcher.busy') : t('compare.action.title')}
        aria-label={t('compare.action.title')}
        className={`no-drag flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium transition-colors disabled:opacity-50 ${open || armed ? 'bg-hover text-fg' : 'text-muted hover:bg-hover hover:text-fg'}`}
      >
        <Columns3 size={14} aria-hidden />
        {t('compare.action')}
      </button>
      {armed && <ArmedChip count={armed.length} onRemove={() => disarm(mode, directory)} />}
      {open && <Launcher mode={mode} directory={directory} current={current} variant={variant} align={align} onClose={close} />}
    </div>
  )
}

/** Chip «Comparar ×N» del compositor, con su ✕ para quitar la comparación armada. */
export function ArmedChip({ count, onRemove }: { count: number; onRemove: () => void }): React.JSX.Element {
  const t = useT()
  return (
    <span
      data-testid="compare-chip"
      className="flex h-6 items-center gap-1 rounded-full bg-accent-soft pr-1 pl-2.5 text-[12px] font-medium text-accent"
    >
      {t('compare.chip', { count })}
      <button
        type="button"
        onClick={onRemove}
        title={t('compare.chip.remove')}
        aria-label={t('compare.chip.remove')}
        className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-accent/15"
      >
        <X size={11} />
      </button>
    </span>
  )
}

function Launcher({
  mode,
  directory,
  current,
  variant,
  align,
  onClose
}: {
  mode: CompareMode
  directory: string | null
  current: ModelRef
  variant?: string | null
  align: 'left' | 'right'
  onClose: (focus?: boolean) => void
}): React.JSX.Element {
  const t = useT()
  const uid = useId()
  const client = useServer((s) => s.client)
  const { providers, loading, load, loaded } = useProviders()
  const armed = useCompare((s) => s.armed[ctxKey(mode, directory)])
  const [selected, setSelected] = useState<CompareModelRef[]>(() => armed ?? [{ ...current, ...(variant ? { variant } : {}) }])
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (client) void load(client)
  }, [client, load])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase()
    return sortProviders(providers).flatMap((p) =>
      Object.values(p.models)
        .filter((m) => m.status !== 'deprecated')
        .filter((m) => !q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name, 'es'))
        .map((m) => ({ ref: { providerID: p.id, modelID: m.id }, name: m.name, provider: p.name }))
    )
  }, [providers, query])

  const isOn = (r: CompareModelRef): boolean => selected.some((s) => s.providerID === r.providerID && s.modelID === r.modelID)
  const toggle = (r: CompareModelRef): void =>
    setSelected((cur) => {
      if (cur.some((s) => s.providerID === r.providerID && s.modelID === r.modelID)) {
        return cur.filter((s) => !(s.providerID === r.providerID && s.modelID === r.modelID))
      }
      if (cur.length >= COMPARE_MODELS_MAX) return cur
      // El esfuerzo elegido en el compositor solo acompaña al modelo actual.
      const v = variant && r.providerID === current.providerID && r.modelID === current.modelID ? { variant } : {}
      return [...cur, { ...r, ...v }]
    })

  const issue = validateSelection(selected)
  const submit = (): void => {
    if (issue) return
    armModels(mode, directory, selected)
    onClose(true)
  }

  const move = (delta: number): void => {
    setCursor((c) => {
      const n = Math.max(0, Math.min(rows.length - 1, c + delta))
      requestAnimationFrame(() => listRef.current?.querySelector(`[data-idx="${n}"]`)?.scrollIntoView({ block: 'nearest' }))
      return n
    })
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose(true)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      move(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      move(-1)
    } else if (
      (e.key === ' ' && e.target === listRef.current) ||
      (e.key === 'Enter' && (e.target === listRef.current || e.target === inputRef.current))
    ) {
      const r = rows[cursor]
      if (r) {
        e.preventDefault()
        toggle(r.ref)
      }
    }
  }

  const hint =
    issue === 'min'
      ? t('compare.launcher.min')
      : selected.length >= COMPARE_MODELS_MAX
        ? t('compare.launcher.max')
        : t('compare.launcher.hint')

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={t('compare.launcher.title')}
      data-testid="compare-launcher"
      onKeyDown={onKeyDown}
      className={`absolute bottom-full z-50 mb-2 w-[340px] max-w-[calc(100vw-2rem)] animate-pop-in rounded-xl border border-border bg-elevated shadow-lg ${align === 'right' ? 'right-0 origin-bottom-right' : 'left-0 origin-bottom-left'}`}
    >
      <div className="flex h-9 items-center gap-2 px-3 pt-1">
        <span className="text-[13px] font-medium">{t('compare.launcher.title')}</span>
        <span role="status" aria-live="polite" className="ml-auto text-[11.5px] text-subtle">
          {hint}
        </span>
      </div>
      <div className="flex items-center gap-2 border-y border-border px-3 py-2">
        <Search size={13} className="text-subtle" aria-hidden />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setCursor(0)
          }}
          placeholder={t('common.modelPicker.searchPlaceholder')}
          aria-label={t('common.modelPicker.search')}
          aria-controls={`${uid}-list`}
          className="w-full bg-transparent text-[13px] outline-none placeholder:text-subtle"
        />
      </div>
      <div
        ref={listRef}
        id={`${uid}-list`}
        role="listbox"
        aria-multiselectable="true"
        aria-label={t('compare.launcher.list')}
        aria-activedescendant={rows[cursor] ? `${uid}-o${cursor}` : undefined}
        tabIndex={0}
        className="max-h-72 overflow-y-auto p-1 outline-none"
      >
        {!loaded && loading && <div className="px-3 py-3 text-[13px] text-muted">{t('compare.launcher.loading')}</div>}
        {loaded && rows.length === 0 && <div className="px-3 py-3 text-[13px] text-muted">{t('compare.launcher.empty')}</div>}
        {rows.map((r, i) => {
          const on = isOn(r.ref)
          const full = !on && selected.length >= COMPARE_MODELS_MAX
          return (
            <div
              key={modelKey(r.ref)}
              id={`${uid}-o${i}`}
              role="option"
              aria-selected={on}
              aria-disabled={full || undefined}
              data-idx={i}
              onMouseEnter={() => setCursor(i)}
              onClick={() => toggle(r.ref)}
              className={`flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-3 ${i === cursor ? 'bg-hover' : ''} ${full ? 'opacity-50' : ''}`}
            >
              <span
                aria-hidden
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-accent bg-accent text-accent-fg' : 'border-border-strong'}`}
              >
                {on && <Check size={11} strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px]">{r.name}</span>
              {isLimitedProvider(r.ref.providerID) && (
                <span className="shrink-0 text-[10.5px] tracking-[0.06em] text-subtle uppercase">{t('compare.launcher.goLimit')}</span>
              )}
              <span className="max-w-[90px] shrink-0 truncate text-[11.5px] text-subtle">{r.provider}</span>
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-2 border-t border-border p-2.5">
        <p className="min-w-0 flex-1 text-[11.5px] leading-snug text-subtle">{t('compare.launcher.note')}</p>
        <Button size="sm" variant="primary" disabled={!!issue} onClick={submit}>
          {t('compare.launcher.submit', { count: selected.length })}
        </Button>
      </div>
    </div>
  )
}
