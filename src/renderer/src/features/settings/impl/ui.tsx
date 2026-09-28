import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

export function SectionHeader({ title, description }: { title: string; description?: ReactNode }): React.JSX.Element {
  return (
    <div className="mb-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
    </div>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }): React.JSX.Element {
  return <div className={`rounded-xl border border-border bg-elevated ${className}`}>{children}</div>
}

/** Fila etiqueta/descripción + control, separada por bordes dentro de una Card. */
export function Row({
  label,
  description,
  children
}: {
  label: ReactNode
  description?: ReactNode
  children?: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {description && <div className="mt-0.5 text-xs text-muted">{description}</div>}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  )
}

export function SubTitle({ children }: { children: ReactNode }): React.JSX.Element {
  return <h3 className="mt-8 mb-3 text-sm font-semibold">{children}</h3>
}

type Tone = 'ok' | 'warn' | 'error' | 'muted' | 'accent'

const TONES: Record<Tone, string> = {
  ok: 'bg-emerald-500/12 text-emerald-600 border-emerald-500/30',
  warn: 'bg-amber-500/12 text-amber-600 border-amber-500/30',
  error: 'bg-danger/10 text-danger border-danger/30',
  muted: 'bg-hover text-muted border-border',
  accent: 'bg-accent-soft text-accent border-accent/30'
}

export function Badge({ tone = 'muted', children }: { tone?: Tone; children: ReactNode }): React.JSX.Element {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONES[tone]}`}>
      {children}
    </span>
  )
}

const FIELD =
  'w-full rounded-lg border border-border bg-bg px-3 py-1.5 text-sm text-fg outline-none placeholder:text-subtle focus:border-accent'

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  const { className = '', ...rest } = props
  return <input {...rest} className={`${FIELD} ${className}`} />
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>): React.JSX.Element {
  const { className = '', ...rest } = props
  return <textarea {...rest} className={`${FIELD} font-mono text-xs ${className}`} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  const { className = '', ...rest } = props
  return <select {...rest} className={`${FIELD} pr-8 ${className}`} />
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }): React.JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-subtle">{hint}</span>}
    </label>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:opacity-40 ${checked ? 'bg-accent' : 'bg-border-strong'}`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${checked ? 'translate-x-4.5' : 'translate-x-0.5'}`}
      />
    </button>
  )
}

export function ErrorText({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs whitespace-pre-wrap text-danger">{children}</div>
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('es-CL').format(Math.round(n))
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString('es-CL', { maximumFractionDigits: 2 })} M`
  if (n >= 1_000) return `${(n / 1_000).toLocaleString('es-CL', { maximumFractionDigits: 1 })} k`
  return formatNumber(n)
}

export function formatCost(n: number): string {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'USD', maximumFractionDigits: n < 1 ? 4 : 2 }).format(n)
}
