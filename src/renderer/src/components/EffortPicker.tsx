import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Brain, Check, ChevronDown } from 'lucide-react'
import type { MsgKey } from '@shared/i18n'
import type { ModelRef } from '@shared/types'
import { useT } from '../lib/i18n'
import { isMacPlatform, isRemoteSurface } from '../lib/platform'
import { portalPosition } from '../lib/portal-position'
import { isSubmitKey } from '../lib/textarea'
import { useProviders } from '../stores/providers'

const LEVELS: Record<string, MsgKey> = {
  minimal: 'common.effort.level.minimal',
  low: 'common.effort.level.low',
  medium: 'common.effort.level.medium',
  high: 'common.effort.level.high',
  xhigh: 'common.effort.level.xhigh',
  max: 'common.effort.level.max',
  none: 'common.effort.level.none'
}

interface Props {
  model: ModelRef
  variant: string | null | undefined
  onChange: (variant: string | null) => void
  placement?: 'top' | 'bottom'
  /** Solo los compositores que lo necesiten ocultan texto/flecha por ancho de su contenedor. */
  collapseClass?: string
  chevronClass?: string
}

/** Control de escritorio; la hoja del celular conserva el esfuerzo dentro de ModelPicker. */
export function EffortPicker({
  model,
  variant,
  onChange,
  placement = 'top',
  collapseClass = '',
  chevronClass = ''
}: Props): React.JSX.Element | null {
  const t = useT()
  const variants = useProviders((s) => s.providers.find((p) => p.id === model.providerID)?.models[model.modelID]?.variants)
  const available = !isRemoteSurface() && !!variants && Object.keys(variants).length > 0
  const options = [
    { id: null, label: t('common.effort.standard') },
    ...Object.keys(variants ?? {}).map((id) => ({
      id,
      label: Object.hasOwn(LEVELS, id) ? t(LEVELS[id]) : id.charAt(0).toUpperCase() + id.slice(1)
    }))
  ]
  const value = options.find((o) => o.id === variant) ?? options[0]
  const currentIndex = options.indexOf(value)
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<ReturnType<typeof portalPosition> | null>(null)
  const label = `${t('common.effort.title')}: ${value.label}`

  useEffect(() => {
    setOpen(false)
  }, [model.providerID, model.modelID, available])

  useEffect(() => {
    if (!available) return
    const openMenu = (): void => {
      setCursor(currentIndex)
      setOpen(true)
    }
    const inScope = (target: EventTarget | null): boolean =>
      target instanceof Node && !!rootRef.current?.closest('[data-effort-scope]')?.contains(target)
    const onKey = (e: KeyboardEvent): void => {
      if (!(isMacPlatform() ? e.metaKey : e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'e') return
      const target = e.target
      if (!(target instanceof HTMLElement)) return
      if (
        panelRef.current?.contains(target) ||
        (inScope(target) && target.matches('textarea, [contenteditable="true"], [data-model-picker]'))
      ) {
        e.preventDefault()
        openMenu()
      }
    }
    const fromModel = (e: Event): void => {
      if (inScope(e.target)) {
        e.preventDefault()
        openMenu()
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('model-effort-open', fromModel)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('model-effort-open', fromModel)
    }
  }, [available, currentIndex])

  useEffect(() => {
    if (!open) return
    panelRef.current?.querySelector<HTMLElement>(`[data-effort-idx="${cursor}"]`)?.focus()
  }, [open, cursor])

  useEffect(() => {
    if (!open) return
    const close = (): void => setOpen(false)
    const onDown = (e: MouseEvent): void => {
      if (e.target instanceof Node && !rootRef.current?.contains(e.target) && !panelRef.current?.contains(e.target)) close()
    }
    const onScroll = (e: Event): void => {
      if (e.target instanceof Node && !panelRef.current?.contains(e.target)) close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  useLayoutEffect(() => {
    const panel = panelRef.current
    const anchor = triggerRef.current?.getBoundingClientRect()
    if (!open || !panel || !anchor) return
    setPosition(
      portalPosition({
        anchor,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        height: panel.scrollHeight,
        width: 208,
        placement,
        topInset: 48,
        gap: 8
      })
    )
  }, [open, variants, placement, label])

  const close = (): void => {
    setOpen(false)
    triggerRef.current?.focus()
  }
  const choose = (id: string | null): void => {
    if (id !== value.id) onChange(id)
    close()
  }
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'Tab') setOpen(false)
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => (c + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length)
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      setCursor(e.key === 'Home' ? 0 : options.length - 1)
    } else if (/^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const option = options[Number(e.key) - 1]
      if (option) {
        e.preventDefault()
        choose(option.id)
      }
    } else if (isSubmitKey(e, { allowShift: true })) {
      e.preventDefault()
      choose(options[cursor].id)
    }
  }

  if (!available) return null
  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        data-testid="effort-picker"
        aria-label={label}
        title={`${label} (${isMacPlatform() ? '⌘E' : 'Ctrl+E'})`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setCursor(options.indexOf(value))
          setOpen((v) => !v)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setCursor(options.indexOf(value))
            setOpen(true)
          }
        }}
        className={`no-drag flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] transition-colors ${open ? 'bg-hover text-fg' : 'text-muted hover:bg-hover hover:text-fg'}`}
      >
        <Brain size={14} className="shrink-0" aria-hidden />
        <span className={`whitespace-nowrap font-medium ${collapseClass}`}>{value.label}</span>
        <ChevronDown
          size={13}
          aria-hidden
          className={`shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''} ${chevronClass}`}
        />
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label={t('common.effort.menu')}
            onKeyDown={onKeyDown}
            style={
              position
                ? { top: position.top, bottom: position.bottom, left: position.left, width: position.width, maxHeight: position.maxHeight }
                : undefined
            }
            className={`no-drag [&_*]:[-webkit-app-region:no-drag] fixed z-50 w-52 animate-pop-in overflow-y-auto rounded-xl border border-border bg-elevated p-1 shadow-xl desk:rounded-card desk:shadow-pop ${position?.side === 'top' ? 'origin-bottom-right' : 'origin-top-right'}`}
          >
            {options.map((o, i) => (
              <button
                key={o.id ?? 'standard'}
                type="button"
                role="menuitemradio"
                aria-checked={o.id === value.id}
                data-option={o.id ?? 'standard'}
                data-effort-idx={i}
                tabIndex={i === cursor ? 0 : -1}
                onClick={() => choose(o.id)}
                onMouseMove={() => setCursor(i)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm font-medium outline-none hover:bg-hover focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-accent desk:h-8 desk:rounded-ctl desk:py-0 desk:text-ui ${o.id === value.id ? 'text-fg' : 'text-muted'}`}
              >
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {i < 9 && (
                  <kbd className="rounded border border-border px-1 font-sans text-[10.5px] leading-4 text-subtle desk:text-meta">
                    {i + 1}
                  </kbd>
                )}
                {o.id === value.id ? <Check size={14} className="text-accent" aria-hidden /> : <span className="w-3.5" />}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  )
}
