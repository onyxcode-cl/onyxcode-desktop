/** Aviso en una pestaña nueva/vacía: servidores de desarrollo detectados, con acceso directo. */
import { Circle } from 'lucide-react'
import type { DevServerCandidate } from '@shared/ipc-browser'
import { useT } from '../../lib/i18n'

export function DevServerHint({
  candidates,
  onUse
}: {
  candidates: DevServerCandidate[]
  onUse: (url: string) => void
}): React.JSX.Element | null {
  const t = useT()
  if (candidates.length === 0) return null
  return (
    <div className="mx-auto mt-8 flex w-full max-w-sm flex-col gap-1.5 px-4">
      {candidates.map((c) => (
        <button
          key={c.url}
          type="button"
          onClick={() => onUse(c.url)}
          className="flex items-center gap-2 rounded-lg border border-border bg-elevated px-3 py-2 text-left text-[13px] transition hover:border-border-strong hover:bg-hover"
        >
          <Circle size={7} className={c.running ? 'shrink-0 fill-success text-success' : 'shrink-0 fill-subtle text-subtle'} />
          <span className="min-w-0 flex-1 truncate text-muted">
            {t('browser.dev.detected')} <span className="font-mono text-fg">{c.url}</span>
          </span>
          <span className="shrink-0 font-medium text-accent">{t('browser.dev.use')}</span>
        </button>
      ))}
    </div>
  )
}
