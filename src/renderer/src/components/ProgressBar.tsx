/** Barra de progreso del aviso (determinada con porcentaje, o indeterminada). */
export function ProgressBar({ percent, label }: { percent: number | null; label: string }): React.JSX.Element {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      className="relative h-1.5 w-40 shrink-0 overflow-hidden rounded-full bg-accent/20"
    >
      <div
        className={`h-full rounded-full bg-accent ${percent === null ? 'w-1/3 animate-pulse' : 'transition-[width] duration-200'}`}
        style={percent === null ? undefined : { width: `${percent}%` }}
      />
    </div>
  )
}
