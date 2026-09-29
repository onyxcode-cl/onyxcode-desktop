import type { ReactNode } from 'react'

/** Cabecera de página de 48 px (zona arrastrable): título, metadatos opcionales y acciones a la derecha. */
export function PageHeader({ title, meta, actions }: { title: string; meta?: ReactNode; actions?: ReactNode }): React.JSX.Element {
  return (
    <header className="drag flex h-12 shrink-0 items-center gap-3 border-b border-border/70 px-6">
      <h1 className="truncate text-[14px] font-semibold tracking-tight">{title}</h1>
      {meta}
      {actions && <div className="no-drag ml-auto flex items-center gap-2">{actions}</div>}
    </header>
  )
}
