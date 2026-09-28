import type { LucideIcon } from 'lucide-react'

interface Props {
  icon: LucideIcon
  title: string
  description: string
  phase?: string
}

/** Vista provisoria / estado vacío genérico. */
export function PlaceholderView({ icon: Icon, title, description, phase }: Props): React.JSX.Element {
  return (
    <div className="flex h-full animate-rise-in flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="relative mb-1">
        <div className="absolute inset-0 -z-10 scale-150 rounded-full bg-accent/10 blur-2xl" />
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/15 bg-accent-soft text-accent shadow-sm">
          <Icon size={26} strokeWidth={1.75} />
        </div>
      </div>
      <h2 className="font-display text-xl font-semibold tracking-tight">{title}</h2>
      <p className="max-w-md text-sm leading-relaxed text-muted">{description}</p>
      {phase && (
        <span className="rounded-full border border-border bg-elevated px-3 py-1 text-xs text-subtle">{phase}</span>
      )}
    </div>
  )
}
