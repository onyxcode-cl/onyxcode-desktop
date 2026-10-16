import { SquareTerminal, X } from 'lucide-react'
import { useT } from '../../../lib/i18n'
import type { PendingTerminalOutput } from './terminal-output'

/** Pastilla «Salida … · N líneas · sin claves ✕» del compositor: se ADJUNTA al siguiente mensaje; la ✕ la quita. */
export function TerminalOutputPill({
  item,
  onRemove,
  className = ''
}: {
  item: PendingTerminalOutput
  onRemove: () => void
  className?: string
}): React.JSX.Element {
  const t = useT()
  return (
    <div className={`flex ${className}`}>
      <span
        data-testid="terminal-output-pill"
        className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border bg-bg py-1 pl-2.5 pr-1 text-xs text-fg desk:text-meta"
      >
        <SquareTerminal size={13} className="shrink-0 text-subtle" />
        <span className="min-w-0 truncate">
          {t(item.source === 'command' ? 'code.run.pill.command' : 'code.run.pill.terminal', { count: item.lineCount })}
        </span>
        <button
          type="button"
          aria-label={t('code.run.pill.remove')}
          title={t('code.run.pill.remove')}
          onClick={onRemove}
          className="no-drag inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg"
        >
          <X size={13} />
        </button>
      </span>
    </div>
  )
}
