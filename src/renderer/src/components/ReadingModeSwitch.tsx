import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Eye } from 'lucide-react'
import { useT } from '../lib/i18n'
import { READING_MODES, useReadingMode, useWorkView, type ReadingMode, type WorkSurface } from '../lib/reading-mode'
import { useDismiss } from '../lib/use-dismiss'

/**
 * Selector «Resumida / Con pasos / Detallada» (vista del trabajo) de la cabecera de la conversación (solo escritorio).
 * La preferencia es por superficie (`lib/reading-mode.ts`): Chat tiene la suya; Code y Overdrive comparten la de Code.
 * Si la cabecera (contenedor `@container`) mide menos de 44rem no cabe el selector segmentado: en su lugar
 * sale un botón compacto (ojo + modo actual) que abre un menú con los tres modos.
 */
export function ReadingModeSwitch({ surface }: { surface: WorkSurface }): React.JSX.Element {
  const t = useT()
  const mode = useWorkView(surface)
  const setMode = (m: ReadingMode): void => useReadingMode.getState().setView(surface, m)
  return (
    <>
      <div
        role="radiogroup"
        aria-label={t('code.reading.label')}
        className="no-drag hidden shrink-0 items-center gap-0.5 rounded-lg bg-hover/60 p-0.5 desk:flex desk:@max-[44rem]:hidden"
      >
        {READING_MODES.map((id: ReadingMode) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={mode === id}
            onClick={() => setMode(id)}
            className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${mode === id ? 'bg-active text-fg' : 'text-muted hover:text-fg'}`}
          >
            {t(`code.reading.${id}` as const)}
          </button>
        ))}
      </div>
      <ReadingModeMenu surface={surface} />
    </>
  )
}

/** Variante compacta (cabeceras angostas): botón con el modo actual y menú de selección única. */
function ReadingModeMenu({ surface }: { surface: WorkSurface }): React.JSX.Element {
  const t = useT()
  const mode = useWorkView(surface)
  const setMode = (m: ReadingMode): void => useReadingMode.getState().setView(surface, m)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const ref = useDismiss(open, close)
  const btnRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  // Al abrir, el foco va al modo activo (flechas para moverse, Esc cierra y devuelve el foco al botón).
  useEffect(() => {
    if (open) itemRefs.current[READING_MODES.indexOf(mode)]?.focus()
  }, [open, mode])

  const onMenuKey = (e: React.KeyboardEvent): void => {
    const cur = itemRefs.current.findIndex((el) => el === document.activeElement)
    const n = READING_MODES.length
    let next = -1
    if (e.key === 'ArrowDown') next = (cur + 1) % n
    else if (e.key === 'ArrowUp') next = (cur - 1 + n) % n
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = n - 1
    else if (e.key === 'Escape') {
      e.stopPropagation()
      close()
      btnRef.current?.focus()
      return
    } else if (e.key === 'Tab') {
      close()
      return
    }
    if (next >= 0) {
      e.preventDefault()
      itemRefs.current[next]?.focus()
    }
  }

  return (
    <div ref={ref} className="no-drag relative hidden shrink-0 desk:@max-[44rem]:block">
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('code.reading.menu', { mode: t(`code.reading.${mode}` as const) })}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-7 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-xs font-medium transition-colors hover:text-fg ${open ? 'bg-active text-fg' : 'bg-hover/60 text-muted'}`}
      >
        <Eye size={14} className="shrink-0" aria-hidden />
        <span className="block desk:@max-[30rem]:hidden">{t(`code.reading.${mode}` as const)}</span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t('code.reading.label')}
          onKeyDown={onMenuKey}
          className="absolute right-0 top-full z-50 mt-1.5 flex w-40 flex-col gap-0.5 rounded-xl border border-border bg-elevated p-1 shadow-lg"
        >
          {READING_MODES.map((id: ReadingMode, i) => (
            <button
              key={id}
              ref={(el) => {
                itemRefs.current[i] = el
              }}
              type="button"
              role="menuitemradio"
              aria-checked={mode === id}
              tabIndex={mode === id ? 0 : -1}
              onClick={() => {
                setMode(id)
                close()
                btnRef.current?.focus()
              }}
              className={`flex w-full items-center justify-between gap-2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-hover ${mode === id ? 'font-medium text-fg' : 'text-muted'}`}
            >
              {t(`code.reading.${id}` as const)}
              {mode === id && <Check size={14} className="shrink-0 text-accent" aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
