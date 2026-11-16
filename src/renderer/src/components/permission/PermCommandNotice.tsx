import type { hardCommandNotice } from '@shared/auto-review'
import { useT } from '../../lib/i18n'

/** El motivo siempre queda visible, también con los detalles plegados. */
export function PermCommandNotice({ notice }: { notice: ReturnType<typeof hardCommandNotice> }): React.JSX.Element | null {
  const t = useT()
  return notice ? (
    <p role="note" className="text-meta text-warning">
      {t(`perm.commandNotice.${notice}`)}
    </p>
  ) : null
}
