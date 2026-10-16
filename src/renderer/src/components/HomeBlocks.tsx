/**
 * Bloques de las pantallas de inicio de Chat y Code para retomar trabajo: «En curso / Esperando tu aprobación», «Retomar» y el
 * interruptor de las ideas de ejemplo. Solo presentación: quien los usa decide qué filas llegan (ver `chat-home.ts`, `code-home.ts`).
 */
import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { StateDot, type SessionState } from './SidebarTree'

export interface HomeRow {
  id: string
  title: string
  state: SessionState | null
  /** Segunda línea: «Trabajando», «Terminado · hace 5 min»… */
  meta: string
}

function Dot({ state }: { state: SessionState | null }): React.JSX.Element {
  return state ? <StateDot state={state} /> : <span aria-hidden="true" className="size-[7px] shrink-0" />
}

/** Tarjeta de arriba: lo que está en marcha o parado esperando al usuario. Cada fila lleva un botón «Abrir». */
export function HomeAttentionCard({
  titleId,
  title,
  rows,
  tone,
  openLabel,
  openAria,
  moreText,
  onOpen
}: {
  titleId: string
  title: string
  rows: HomeRow[]
  tone: 'warning' | 'accent'
  openLabel: string
  openAria: (title: string) => string
  moreText?: string
  onOpen: (id: string) => void
}): React.JSX.Element | null {
  if (rows.length === 0) return null
  return (
    <section
      aria-labelledby={titleId}
      className={`mb-5 rounded-xl border bg-elevated p-2 text-left shadow-sm desk:rounded-card ${tone === 'warning' ? 'border-warning/40' : 'border-accent/40'}`}
    >
      <h2 id={titleId} className="px-2 pt-1 pb-1.5 text-sm font-medium text-fg">
        {title}
      </h2>
      <ul className="m-0 list-none p-0">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-hover desk:rounded-ctl">
            <Dot state={r.state} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-fg">{r.title}</span>
              <span className={`block truncate text-xs ${tone === 'warning' ? 'text-warning' : 'text-muted'}`}>{r.meta}</span>
            </span>
            <button
              type="button"
              aria-label={openAria(r.title)}
              onClick={() => onOpen(r.id)}
              className="no-drag shrink-0 rounded-lg border border-border bg-elevated px-3 py-1 text-xs font-medium text-fg transition hover:border-border-strong hover:bg-hover desk:rounded-ctl"
            >
              {openLabel}
            </button>
          </li>
        ))}
      </ul>
      {moreText && <p className="px-2 pt-1 pb-1 text-xs text-muted">{moreText}</p>}
    </section>
  )
}

/** Bloque «Retomar»: filas de dos líneas (título + estado y hora). */
export function HomeResume({
  titleId,
  title,
  rows,
  onOpen
}: {
  titleId: string
  title: string
  rows: HomeRow[]
  onOpen: (id: string) => void
}): React.JSX.Element | null {
  if (rows.length === 0) return null
  return (
    <section aria-labelledby={titleId} className="mt-6 text-left">
      <h2 id={titleId} className="mb-2 px-1 text-xs font-medium text-muted">
        {title}
      </h2>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {rows.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onOpen(r.id)}
              className="no-drag flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-hover desk:rounded-card"
            >
              <Dot state={r.state} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-fg">{r.title}</span>
                <span className="block truncate text-xs text-muted">{r.meta}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function readFlag(key: string): boolean | null {
  try {
    const v = localStorage.getItem(key)
    return v === '1' ? true : v === '0' ? false : null
  } catch {
    return null
  }
}

/**
 * Las ideas de ejemplo son secundarias cuando ya hay trabajo: salen plegadas tras un botón. La primera vez (`secondary` falso)
 * salen abiertas y sin botón, como siempre. Si la persona eligió una vez, se respeta su elección.
 */
export function HomeIdeas({
  storageKey,
  className = '',
  secondary,
  label,
  showLabel,
  hideLabel,
  children
}: {
  storageKey: string
  /** Ancho y márgenes de la cabecera plegable (solo cuando es secundaria). */
  className?: string
  secondary: boolean
  label: string
  showLabel: string
  hideLabel: string
  children: React.ReactNode
}): React.JSX.Element {
  const [stored, setStored] = useState<boolean | null>(() => readFlag(storageKey))
  if (!secondary) return <>{children}</>
  const hidden = stored ?? true
  const toggle = (): void => {
    setStored(!hidden)
    try {
      localStorage.setItem(storageKey, !hidden ? '1' : '0')
    } catch {
      // sin storage: la elección no se recuerda
    }
  }
  return (
    <div className={`mt-6 w-full ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <h2 className="text-xs font-medium text-muted">{label}</h2>
        <button
          type="button"
          onClick={toggle}
          aria-pressed={hidden}
          className="no-drag flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted transition hover:bg-hover hover:text-fg"
        >
          {hidden ? <Eye size={13} /> : <EyeOff size={13} />}
          {hidden ? showLabel : hideLabel}
        </button>
      </div>
      {!hidden && children}
    </div>
  )
}
