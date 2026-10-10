import type { ReactNode } from 'react'

/**
 * Cabecera de 48 px (zona arrastrable): título, metadatos opcionales y acciones a la derecha.
 * - `variant="page"` (por defecto): páginas (Rutinas, Ajustes), margen de 24 px alineado con su contenido.
 * - `variant="workspace"`: vistas de trabajo (Chat, Code, Tareas, Comparar), margen de 16 px.
 * En escritorio (variante `desk`) suma `--controls-inset` a la derecha (botones de ventana de Windows; 0 en macOS) y `--header-inset` (App.tsx lo publica cuando la barra lateral está oculta) para no quedar bajo el
 * botón flotante ni los semáforos de macOS, y usa un único borde. En el celular el marcado y las clases base no cambian.
 */
export function PageHeader({
  title,
  meta,
  actions,
  leading,
  variant = 'page'
}: {
  title: string
  meta?: ReactNode
  actions?: ReactNode
  leading?: ReactNode
  variant?: 'page' | 'workspace'
}): React.JSX.Element {
  const inset =
    variant === 'workspace'
      ? 'gap-3 desk:pr-[calc(var(--controls-inset,0px)+16px)] desk:pl-[calc(var(--header-inset,0px)+16px)]'
      : 'gap-3 desk:pr-[calc(var(--controls-inset,0px)+24px)] desk:pl-[calc(var(--header-inset,0px)+24px)]'
  return (
    <header className={`drag flex h-12 shrink-0 items-center border-b border-border/70 px-6 desk:border-border ${inset}`}>
      {leading}
      <h1 className="truncate text-[14px] font-semibold tracking-tight desk:leading-5">{title}</h1>
      {meta}
      {actions && <div className="no-drag ml-auto flex items-center gap-2">{actions}</div>}
    </header>
  )
}
