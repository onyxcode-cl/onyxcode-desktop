import type { ReactNode } from 'react'

/** Estado vacío de la barra lateral de escritorio: recuadro suave de 40 px con el icono, texto de 13 px y una pista corta. */
export function SidebarEmpty({ icon, text, hint }: { icon: ReactNode; text: string; hint?: string }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-card bg-hover text-subtle" aria-hidden="true">
        {icon}
      </div>
      <p className="mt-1 text-ui text-muted">{text}</p>
      {hint && <p className="max-w-[200px] text-meta text-subtle">{hint}</p>}
    </div>
  )
}
