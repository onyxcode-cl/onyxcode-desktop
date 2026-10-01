/** Sección plegable del panel de progreso (cabecera con icono, insignia y acciones). */
import { useState } from 'react'
import { ChevronRight, type ListChecks } from 'lucide-react'

export function Section({
  icon: Icon,
  title,
  badge,
  right,
  defaultOpen = true,
  children
}: {
  icon: typeof ListChecks
  title: string
  badge?: React.ReactNode
  right?: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-b border-border last:border-b-0">
      <header className="flex items-center gap-2 px-4 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-[13px] font-semibold"
        >
          <ChevronRight size={13} className={`shrink-0 text-subtle transition-transform ${open ? 'rotate-90' : ''}`} />
          <Icon size={14} className="shrink-0 text-muted" />
          <span>{title}</span>
          {badge !== undefined && <span className="rounded-full bg-hover px-1.5 text-[11px] font-medium text-muted">{badge}</span>}
        </button>
        {right}
      </header>
      {open && <div className="px-4 pb-3.5">{children}</div>}
    </section>
  )
}
