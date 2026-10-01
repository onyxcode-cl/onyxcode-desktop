/**
 * Selector de esfuerzo del modelo (variantes de razonamiento) genérico: no depende del store de ningún modo.
 * Replica el `EffortChip` de Code (menú hacia arriba, variantes leídas del proveedor) pero recibe el modelo,
 * la variante actual y el callback. No se muestra si el modelo no tiene variantes.
 */
import { useEffect, useRef, useState } from 'react'
import { Brain, Check } from 'lucide-react'
import type { ModelRef } from '@shared/types'
import { useT } from '../lib/i18n'
import { useProviders } from '../stores/providers'

interface Props {
  model: ModelRef
  /** Variante elegida (null/undefined = estándar). */
  variant: string | null | undefined
  onChange: (variant: string | null) => void
}

const cap = (v: string): string => v.charAt(0).toUpperCase() + v.slice(1)

export function EffortPicker({ model, variant, onChange }: Props): React.JSX.Element | null {
  const t = useT()
  const providers = useProviders((s) => s.providers)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // Cierra al hacer clic fuera o con Esc (devolviendo el foco al botón).
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const info = providers.find((p) => p.id === model.providerID)?.models[model.modelID]
  const variants = info?.variants ? Object.keys(info.variants) : []
  if (variants.length === 0) return null

  const pick = (v: string | null): void => {
    onChange(v)
    setOpen(false)
    triggerRef.current?.focus()
  }

  const options: Array<{ id: string | null; label: string }> = [
    { id: null, label: t('common.effort.standard') },
    ...variants.map((v) => ({ id: v, label: cap(v) }))
  ]

  return (
    <div ref={rootRef} className="no-drag relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('common.effort.title')}
        className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium transition-colors hover:bg-hover hover:text-fg ${
          open ? 'bg-hover text-fg' : 'text-muted'
        }`}
      >
        <Brain size={14} />
        <span>{variant ? cap(variant) : t('common.effort.standard')}</span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t('common.effort.menu')}
          className="absolute right-0 bottom-full z-50 mb-2 w-48 origin-bottom-right animate-pop-in rounded-xl border border-border bg-elevated p-1 shadow-xl"
        >
          <div className="px-2.5 pt-1.5 pb-1 text-[11.5px] text-subtle">{t('common.effort.menu')}</div>
          {options.map((o) => {
            const active = (variant ?? null) === o.id
            return (
              <button
                key={o.id ?? 'standard'}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => pick(o.id)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium hover:bg-hover ${
                  active ? 'text-fg' : 'text-muted'
                }`}
              >
                <span className="min-w-0 flex-1">{o.label}</span>
                {active && <Check size={14} className="shrink-0 text-accent" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
