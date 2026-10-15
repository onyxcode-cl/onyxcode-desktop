import { useT } from '../lib/i18n'
import { READING_MODES, useReadingMode, type ReadingMode } from '../lib/reading-mode'

/**
 * Selector segmentado «Resumen / Normal / Detallado» de la cabecera de la conversación (solo escritorio).
 * La preferencia es global (`lib/reading-mode.ts`) y la comparten Code, Chat y Overdrive.
 */
export function ReadingModeSwitch(): React.JSX.Element {
  const t = useT()
  const mode = useReadingMode((s) => s.mode)
  const setMode = useReadingMode((s) => s.setMode)
  return (
    <div
      role="radiogroup"
      aria-label={t('code.reading.label')}
      className="no-drag hidden shrink-0 items-center gap-0.5 rounded-lg bg-hover/60 p-0.5 desk:flex desk:@max-[44rem]:hidden"
    >
      {READING_MODES.map((id: ReadingMode) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={mode === id}
          onClick={() => setMode(id)}
          className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${mode === id ? 'bg-active text-fg' : 'text-muted hover:text-fg'}`}
        >
          {t(`code.reading.${id}` as const)}
        </button>
      ))}
    </div>
  )
}
