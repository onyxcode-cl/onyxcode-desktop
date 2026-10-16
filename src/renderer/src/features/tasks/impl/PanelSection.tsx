/** Sección plegable del panel de progreso (cabecera con icono, insignia y acciones). */
import { useState } from 'react'
import { ChevronRight, type ListChecks } from 'lucide-react'

export function Section({
  icon: Icon,
  title,
  badge,
  badgeTone,
  right,
  defaultOpen = true,
  children
}: {
  icon: typeof ListChecks
  title: string
  badge?: React.ReactNode
  badgeTone?: 'plain'
  right?: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-b border-border last:border-b-0 desk:border-border/60 desk:px-2 desk:py-1">
      <header className="flex items-center gap-2 px-4 py-2.5 desk:h-10 desk:px-2 desk:py-0">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-[13px] font-semibold"
        >
          <ChevronRight size={13} className={`shrink-0 text-subtle transition-transform desk:size-3.5 ${open ? 'rotate-90' : ''}`} />
          <Icon size={14} className="shrink-0 text-muted desk:size-4" />
          <span>{title}</span>
          {badge !== undefined && (
            <span
              className={`rounded-full bg-hover px-1.5 text-[11px] desk:text-meta font-medium text-muted desk:h-[18px] desk:min-w-[18px] desk:bg-active desk:px-[5px] desk:text-[11px] desk:font-semibold desk:leading-[18px]${
                badgeTone === 'plain' ? ' desk:bg-transparent desk:font-normal desk:text-subtle' : ''
              }`}
            >
              {badge}
            </span>
          )}
        </button>
        {right}
      </header>
      {open && <div className="px-4 pb-3.5 desk:pr-2 desk:pb-3 desk:pl-[30px] desk:text-ui desk:text-muted">{children}</div>}
    </section>
  )
}
