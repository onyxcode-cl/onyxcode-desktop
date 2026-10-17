import { useEffect, useMemo, useRef, useState } from 'react'
import { Brain, Check, ChevronDown, ChevronLeft, ChevronRight, Loader2, Search } from 'lucide-react'
import type { ModelRef } from '@shared/types'
import { PREFERRED_PROVIDER, sortProviders, useProviders } from '../stores/providers'
import { useServer } from '../stores/server'
import { isSubmitKey } from '../lib/textarea'
import { useT } from '../lib/i18n'
import { isMacPlatform, isRemoteSurface } from '../lib/platform'
import { useSettings } from '../stores/settings'
import { Sheet } from './mobile/Sheet'

interface Props {
  value: ModelRef
  onChange: (model: ModelRef) => void
  /** Hacia dónde se abre el menú. */
  placement?: 'top' | 'bottom'
  /** El modelo elegido no está en la lista: se muestra su id marcado como «no disponible» (no se sustituye por otro). */
  unavailable?: boolean
  /**
   * Esfuerzo del modelo (variantes de razonamiento) como submenú «Esfuerzo» dentro de este mismo menú. Las variantes se leen del
   * proveedor del modelo mostrado; si no tiene, no aparece nada. `null`/`undefined` = estándar (el predeterminado): en el chip
   * solo se ve el valor cuando es distinto de él. Atajo: ⌘E / Ctrl+E abre el submenú con el menú abierto.
   */
  effort?: { variant: string | null | undefined; onChange: (variant: string | null) => void }
}

const cap = (v: string): string => v.charAt(0).toUpperCase() + v.slice(1)

/** Selector de modelo con los proveedores/modelos del servidor (`config.providers`). */
export function ModelPicker({ value, onChange, placement = 'top', unavailable = false, effort }: Props): React.JSX.Element {
  const t = useT()
  // En el celular el selector es una hoja a pantalla completa (no un popover): filas de 48 px y el teclado no lo tapa.
  const sheet = isRemoteSurface()
  const client = useServer((s) => s.client)
  const defaultModel = useSettings((s) => s.settings.defaultModel)
  const mod = isMacPlatform() ? '⌘' : 'Ctrl+'
  const { providers, loading, error, load, loaded } = useProviders()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  // Submenú «Esfuerzo»: abierto o no, y la fila enfocada dentro (0 = estándar, 1… = variantes).
  const [sub, setSub] = useState(false)
  const [subCursor, setSubCursor] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const subRef = useRef<HTMLDivElement>(null)

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

  const effortVariants = useMemo(() => {
    const info = providers.find((x) => x.id === value.providerID)?.models[value.modelID]
    return effort && info?.variants ? Object.keys(info.variants) : []
  }, [providers, value, effort])
  const hasEffort = effortVariants.length > 0
  const effortValue = effort?.variant ?? null
  const effortOptions: Array<{ id: string | null; label: string }> = [
    { id: null, label: t('common.effort.standard') },
    ...effortVariants.map((v) => ({ id: v, label: cap(v) }))
  ]

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
    setSub(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${cursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  // Dentro del submenú el foco vive en la fila actual (así el teclado del menú sigue funcionando).
  useEffect(() => {
    if (!sub) return
    subRef.current?.querySelector<HTMLElement>(`[data-sub-idx="${subCursor}"]`)?.focus()
  }, [sub, subCursor])

  const openSub = (): void => {
    const i = effortOptions.findIndex((o) => o.id === effortValue)
    setSubCursor(i >= 0 ? i : 0)
    setSub(true)
  }
  const closeSub = (): void => {
    setSub(false)
    setCursor(flat.length)
  }
  const chooseEffort = (v: string | null): void => {
    if (v !== effortValue) effort?.onChange(v)
    setOpen(false)
    setSub(false)
    setQuery('')
  }

  const choose = (ref: ModelRef): void => {
    onChange(ref)
    setOpen(false)
    setQuery('')
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const mod = isMacPlatform() ? e.metaKey : e.ctrlKey
    if (hasEffort && mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'e') {
      // ⌘E / Ctrl+E: abre (o cierra) el submenú «Esfuerzo».
      e.preventDefault()
      if (sub) closeSub()
      else openSub()
      return
    }
    if (sub) {
      const n = effortOptions.length
      if (e.key === 'Escape' || e.key === 'ArrowLeft') {
        e.preventDefault()
        e.stopPropagation()
        closeSub()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSubCursor((c) => (c + 1) % n)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSubCursor((c) => (c - 1 + n) % n)
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault()
        setSubCursor(e.key === 'Home' ? 0 : n - 1)
      } else if (/^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const o = effortOptions[Number(e.key) - 1]
        if (o) {
          e.preventDefault()
          chooseEffort(o.id)
        }
      } else if (isSubmitKey(e, { allowShift: true })) {
        e.preventDefault()
        const o = effortOptions[subCursor]
        if (o) chooseEffort(o.id)
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    } else if ((isMacPlatform() ? e.metaKey : e.ctrlKey) && /^[1-9]$/.test(e.key)) {
      // ⌘1…⌘9 / Ctrl+1…9: elige el modelo de esa posición sin soltar el cuadro de búsqueda.
      const r = flat[Number(e.key) - 1]
      if (r) {
        e.preventDefault()
        choose(r)
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      // Con esfuerzo disponible, una fila más al final: la del submenú «Esfuerzo».
      setCursor((c) => Math.min(hasEffort ? flat.length : flat.length - 1, c + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(0, c - 1))
    } else if (isSubmitKey(e, { allowShift: true })) {
      e.preventDefault()
      if (hasEffort && cursor === flat.length) {
        openSub()
        return
      }
      const r = flat[cursor]
      if (r) choose(r)
    } else if (e.key === 'ArrowRight' && hasEffort && cursor === flat.length) {
      e.preventDefault()
      openSub()
    }
  }

  // El esfuerzo se ve en el chip solo cuando NO es el predeterminado (estándar) y el modelo lo admite.
  const showEffort = hasEffort && effortValue !== null && effortVariants.includes(effortValue)
  const modelText = unavailable
    ? `${value.modelID} · ${t('common.modelPicker.unavailable')}`
    : (current.name ?? t('common.modelPicker.choose'))
  const triggerLabel = `${t('common.modelPicker.sheetTitle')}: ${modelText}${showEffort ? `, ${t('common.effort.title')}: ${cap(effortValue!)}` : ''}`

  let idx = -1

  const body =
    !open && !sheet ? null : (
      <>
        <div
          {...(sheet ? { 'data-model-search': '' } : {})}
          className="flex items-center gap-2 border-b border-border px-3 py-2.5 desk:h-10 desk:gap-2.5 desk:py-0"
        >
          <Search size={sheet ? 16 : 14} className="text-subtle" />
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
        <div
          ref={listRef}
          role="listbox"
          aria-label={t('common.modelPicker.sheetTitle')}
          className={sheet ? 'p-1' : 'max-h-[min(20rem,calc(100vh-14rem))] overflow-y-auto p-1'}
        >
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
              <div
                {...(sheet ? { 'data-model-provider': '' } : {})}
                className="flex items-center gap-1.5 px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-subtle uppercase desk:pt-3 desk:text-meta desk:font-medium desk:tracking-normal desk:normal-case"
              >
                {provider.name}
                {provider.id === PREFERRED_PROVIDER && (
                  <span className="rounded-full bg-gold-soft px-1.5 text-[9.5px] desk:text-meta tracking-normal text-gold-text normal-case desk:rounded-md desk:bg-accent-soft desk:text-caption desk:text-accent">
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
                    {...(sheet ? { 'data-model-row': '' } : { onMouseMove: () => cursor !== i && setCursor(i) })}
                    onClick={() => choose({ providerID: provider.id, modelID: m.id })}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm transition-colors ${sheet ? 'min-h-12 py-2.5' : 'py-1.5'} desk:h-8 desk:rounded-ctl desk:py-0 desk:text-ui ${focused ? 'bg-hover text-fg' : selected ? 'text-fg' : 'text-muted'}`}
                  >
                    <span className={`flex-1 truncate ${selected ? 'font-medium' : ''}`}>{m.name}</span>
                    {m.capabilities.reasoning && (
                      <span
                        className="inline-flex items-center gap-0.5 rounded-md bg-hover px-1 py-px text-[10px] desk:text-meta text-subtle desk:text-muted desk:bg-active desk:px-1.5 desk:text-caption"
                        title={t('common.modelPicker.reasoningTitle')}
                      >
                        <Brain size={10} /> {t('common.modelPicker.reasons')}
                      </span>
                    )}
                    {m.id === defaultModel.modelID && provider.id === defaultModel.providerID && (
                      <span className="rounded-md bg-hover px-1.5 text-caption text-subtle">{t('common.modelPicker.default')}</span>
                    )}
                    {!sheet && i < 9 && (
                      <kbd className="rounded border border-border px-1 font-sans text-[10.5px] leading-4 text-subtle desk:text-meta">{`${mod}${i + 1}`}</kbd>
                    )}
                    {selected ? (
                      <Check size={sheet ? 18 : 14} className="text-accent" />
                    ) : (
                      <span className={sheet ? 'w-[18px]' : 'w-3.5'} />
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        {hasEffort && (
          <div className="border-t border-border p-1">
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={false}
              data-effort-row=""
              onClick={openSub}
              {...(sheet ? {} : { onMouseMove: () => cursor !== flat.length && setCursor(flat.length) })}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm transition-colors ${sheet ? 'min-h-12 py-2.5' : 'py-1.5'} desk:h-8 desk:rounded-ctl desk:py-0 desk:text-ui ${cursor === flat.length ? 'bg-hover text-fg' : 'text-muted'}`}
            >
              <Brain size={sheet ? 16 : 14} className="shrink-0" aria-hidden />
              <span className="flex-1 truncate">{t('common.effort.submenu')}</span>
              <span className="truncate font-medium text-fg">{effortValue ? cap(effortValue) : t('common.effort.standard')}</span>
              {!sheet && (
                <kbd className="rounded border border-border px-1 font-sans text-[10.5px] leading-4 text-subtle desk:text-meta">{`${mod}E`}</kbd>
              )}
              <ChevronRight size={sheet ? 18 : 14} className="shrink-0 text-subtle" aria-hidden />
            </button>
          </div>
        )}
      </>
    )

  const subBody = (
    <div ref={subRef} role="menu" aria-label={t('common.effort.menu')} className="p-1">
      <button
        type="button"
        data-effort-back=""
        onClick={closeSub}
        className={`flex w-full items-center gap-2 rounded-lg px-2.5 text-left text-[11.5px] font-semibold text-subtle hover:bg-hover desk:h-8 desk:rounded-ctl desk:py-0 desk:text-meta ${sheet ? 'min-h-12 py-2.5' : 'py-1.5'}`}
      >
        <ChevronLeft size={sheet ? 18 : 14} aria-hidden />
        {t('common.effort.menu')}
      </button>
      {effortOptions.map((o, n) => {
        const active = effortValue === o.id
        return (
          <button
            key={o.id ?? 'standard'}
            type="button"
            role="menuitemradio"
            aria-checked={active}
            data-sub-idx={n}
            data-option={o.id ?? 'standard'}
            tabIndex={n === subCursor ? 0 : -1}
            onClick={() => chooseEffort(o.id)}
            onMouseMove={() => subCursor !== n && setSubCursor(n)}
            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm font-medium outline-none hover:bg-hover focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-accent desk:h-8 desk:rounded-ctl desk:py-0 desk:text-ui ${sheet ? 'min-h-12 py-2.5' : 'py-1.5'} ${active ? 'text-fg' : 'text-muted'}`}
          >
            <span className="min-w-0 flex-1 truncate">{o.label}</span>
            {!sheet && n < 9 && (
              <kbd className="rounded border border-border px-1 font-sans text-[10.5px] leading-4 text-subtle desk:text-meta">{n + 1}</kbd>
            )}
            {active ? (
              <Check size={sheet ? 18 : 14} className="text-accent" aria-hidden />
            ) : (
              <span className={sheet ? 'w-[18px]' : 'w-3.5'} />
            )}
          </button>
        )
      })}
    </div>
  )

  return (
    <div ref={rootRef} className="relative desk:min-w-0 desk:max-w-full">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`no-drag flex max-w-[280px] items-center desk:max-w-[min(280px,100%)] desk:min-w-0 gap-1.5 rounded-full px-2.5 text-[13px] transition-colors ${sheet ? 'min-h-11 min-w-0 px-3' : 'py-1'} ${open ? 'bg-hover text-fg' : 'text-muted hover:bg-hover hover:text-fg'}`}
        title={`${value.providerID}/${value.modelID}`}
        aria-label={triggerLabel}
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
        {showEffort && (
          <span
            data-testid="model-effort-badge"
            className="flex shrink-0 items-center gap-1 rounded-md bg-hover px-1.5 text-[11.5px] leading-5 font-medium text-fg desk:text-meta"
          >
            <Brain size={11} aria-hidden />
            <span className="inline desk:@max-[41rem]:sr-only">{cap(effortValue!)}</span>
          </span>
        )}
        <ChevronDown size={13} className={`shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {sheet && (
        <Sheet open={open} onClose={() => setOpen(false)} title={t('common.modelPicker.sheetTitle')} size="full">
          <div onKeyDown={onKeyDown}>{sub ? subBody : body}</div>
        </Sheet>
      )}
      {open && !sheet && (
        <div
          className={`absolute left-0 z-50 w-80 animate-pop-in overflow-hidden rounded-xl border border-border bg-elevated shadow-xl desk:rounded-card desk:shadow-pop ${placement === 'top' ? 'bottom-full mb-2 origin-bottom-left' : 'top-full mt-2 origin-top-left'}`}
          onKeyDown={onKeyDown}
        >
          {sub ? subBody : body}
        </div>
      )}
    </div>
  )
}
