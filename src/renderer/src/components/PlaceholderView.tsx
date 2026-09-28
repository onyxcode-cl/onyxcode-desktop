import type { LucideIcon } from 'lucide-react'

interface Props {
  icon: LucideIcon
  title: string
  description: string
  phase?: string
}

/** Vista provisoria para módulos aún no implementados. */
export function PlaceholderView({ icon: Icon, title, description, phase }: Props): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        <Icon size={28} />
      </div>
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="max-w-md text-sm text-muted">{description}</p>
      {phase && <span className="rounded-full border border-border px-3 py-1 text-xs text-subtle">{phase}</span>}
    </div>
  )
}
