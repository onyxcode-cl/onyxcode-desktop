import { Info } from 'lucide-react'

/** Nota informativa de una función que esta plataforma no tiene (p. ej. Tareas en Windows). No es un error. */
export function PlatformNote({ children, title }: { children: React.ReactNode; title?: string }): React.JSX.Element {
  return (
    <div
      role="note"
      className="flex items-start gap-2.5 rounded-xl border border-border bg-inset px-3.5 py-3 text-xs leading-relaxed text-muted"
    >
      <Info size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
      <div>
        {title && <p className="mb-1 text-[12.5px] font-medium text-fg">{title}</p>}
        {children}
      </div>
    </div>
  )
}
