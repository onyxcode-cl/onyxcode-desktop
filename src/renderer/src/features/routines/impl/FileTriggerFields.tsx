/** Campos del disparador «cuando aparezca un archivo en esta carpeta» del editor de Rutinas. */
import { FolderOpen, Info } from 'lucide-react'
import type { RoutineFileSchedule, RoutineInput, RoutineSchedule } from '@shared/ipc-tasks'
import { useT } from '../../../lib/i18n'
import { baseName } from '../../../lib/paths'

const inputCls =
  'w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none transition focus:border-border-strong focus:ring-2 focus:ring-accent/15 placeholder:text-subtle desk:h-8 desk:rounded-ctl desk:border-border-strong desk:py-0 desk:text-sm desk:ring-0 desk:focus:shadow-focus'

export function defaultFileSchedule(folder: string | null | undefined): RoutineFileSchedule {
  return { kind: 'file', folder: folder ?? '', patterns: [], on: 'create', settleSec: 5, maxPerHour: 6 }
}

export function FileTriggerFields({
  value,
  routineFolder,
  mode,
  onChange,
  onPick
}: {
  value: RoutineFileSchedule
  routineFolder: string | null
  mode: RoutineInput['mode']
  onChange: (s: RoutineSchedule) => void
  onPick: () => Promise<string | null>
}): React.JSX.Element {
  const t = useT()
  const set = (p: Partial<RoutineFileSchedule>): void => onChange({ ...value, ...p })
  const watched = value.folder || routineFolder || ''
  return (
    <div className="space-y-3" data-testid="file-trigger-fields">
      <div>
        <span className="mb-1.5 block text-xs font-medium text-muted">{t('routines.file.folder')}</span>
        <div className="flex items-center gap-2">
          <div
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2 text-sm desk:h-8 desk:rounded-ctl desk:py-0"
            title={watched}
          >
            <FolderOpen size={14} className="shrink-0 text-muted" />
            <span className="truncate">{watched ? baseName(watched) : t('routines.file.noFolder')}</span>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:border-border-strong hover:text-fg"
            onClick={async () => {
              const picked = await onPick()
              if (picked) set({ folder: picked })
            }}
          >
            {t('routines.file.pick')}
          </button>
        </div>
        {mode !== 'chat' && <p className="mt-1 text-[11px] desk:text-meta text-subtle">{t('routines.file.insideRoutine')}</p>}
      </div>

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-muted">{t('routines.file.patterns')}</span>
        <input
          className={inputCls}
          value={value.patterns.join(', ')}
          placeholder="*.pdf, factura-*.csv"
          spellCheck={false}
          aria-label={t('routines.file.patterns')}
          onChange={(e) => set({ patterns: e.target.value.split(',').map((x) => x.trim()) })}
        />
      </label>

      <div className="grid grid-cols-3 gap-2">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">{t('routines.file.on')}</span>
          <select
            className={inputCls}
            value={value.on}
            aria-label={t('routines.file.on')}
            onChange={(e) => set({ on: e.target.value as 'create' | 'both' })}
          >
            <option value="create">{t('routines.file.onCreate')}</option>
            <option value="both">{t('routines.file.onBoth')}</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">{t('routines.file.settle')}</span>
          <input
            type="number"
            min={1}
            max={120}
            className={inputCls}
            value={value.settleSec}
            aria-label={t('routines.file.settle')}
            onChange={(e) => set({ settleSec: Math.max(1, Math.min(120, Math.round(Number(e.target.value) || 1))) })}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">{t('routines.file.cap')}</span>
          <input
            type="number"
            min={1}
            max={60}
            className={inputCls}
            value={value.maxPerHour}
            aria-label={t('routines.file.cap')}
            onChange={(e) => set({ maxPerHour: Math.max(1, Math.min(60, Math.round(Number(e.target.value) || 1))) })}
          />
        </label>
      </div>

      <div className="flex items-start gap-2 rounded-lg bg-hover/60 p-2.5 text-[11.5px] desk:text-meta text-muted">
        <Info size={13} className="mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p>{t('routines.file.help')}</p>
          <p>
            {t('routines.file.vars')} <code className="font-mono">{'{{archivo}}'}</code>,{' '}
            <code className="font-mono">{'{{archivos}}'}</code>, <code className="font-mono">{'{{carpeta}}'}</code>
          </p>
          <p>{t('routines.file.safety')}</p>
        </div>
      </div>
    </div>
  )
}
