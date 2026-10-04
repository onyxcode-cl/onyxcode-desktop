import { t } from '@shared/i18n'

/** Esqueleto de lista del celular (filas de `--m-row` con dos barras): ocupa el lugar de lo que se descarga. */
export function MobileSkeleton({ rows = 5, label }: { rows?: number; label?: string }): React.JSX.Element {
  return (
    <div role="status" aria-busy="true" aria-label={label ?? t('mobile.list.loadingSlow')} data-m="skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-[var(--m-row)] flex-col justify-center gap-2 px-4">
          <div className="h-3.5 animate-pulse rounded bg-hover" style={{ width: `${[60, 72, 52, 66, 58][i % 5]}%` }} />
          <div className="h-3 animate-pulse rounded bg-hover/70" style={{ width: `${[35, 28, 40, 30, 34][i % 5]}%` }} />
        </div>
      ))}
    </div>
  )
}
