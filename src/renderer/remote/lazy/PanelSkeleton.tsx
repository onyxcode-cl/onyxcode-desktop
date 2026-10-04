/** Esqueleto de 3 filas mientras se baja un panel perezoso (solo opacidad: barato y sin parpadeo de pantalla vacía). */
export function PanelSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 p-4" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-10 animate-pulse rounded-lg bg-hover" />
      ))}
    </div>
  )
}
