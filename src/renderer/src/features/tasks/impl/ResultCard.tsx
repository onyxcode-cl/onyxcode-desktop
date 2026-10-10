/** Tarjeta de resultado al final de una tarea terminada: los archivos que dejó el agente, con su icono, tamaño y accesos directos. */
import { CheckCircle2, ExternalLink, FolderOpen } from 'lucide-react'
import type { TasksDeliverable } from '@shared/ipc-tasks'
import { useT } from '../../../lib/i18n'
import { isRemoteSurface } from '../../../lib/platform'
import { fileIcon } from './Deliverables'
import { openPath, reveal } from './actions'
import { useTasks } from './store'
import { baseName, formatSize } from './util'

const MAX_ROWS = 3

/** Archivos de trabajo del agente (spec.json de las skills, la carpeta interna `.lazunox`, temporales de Office): no son «lo que dejé». */
export function isHelperFile(f: { relPath: string; path: string }): boolean {
  const name = baseName(f.path)
  return /(^|\/)\.lazunox\//.test(f.relPath) || /^spec[-_.a-z0-9]*\.json$/i.test(name) || name.startsWith('~$') || name.endsWith('.pyc')
}

export function ResultCard({ taskId }: { taskId: string }): React.JSX.Element | null {
  const t = useT()
  const files = useTasks((s) => s.deliverables[taskId]) as TasksDeliverable[] | undefined
  // Abrir y mostrar en Finder son acciones del Mac: el celular no las ofrece.
  const visible = (files ?? []).filter((f) => !isHelperFile(f))
  if (isRemoteSurface() || visible.length === 0) return null
  const shown = [...visible].sort((a, b) => b.mtime - a.mtime).slice(0, MAX_ROWS)
  const more = visible.length - shown.length
  return (
    <section
      data-testid="result-card"
      aria-label={t('tasks.result.title')}
      className="animate-rise-in rounded-card border border-success/30 bg-success/5 p-3 shadow-sm"
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <CheckCircle2 size={16} className="shrink-0 text-success" aria-hidden />
        {t('tasks.result.title')}
      </div>
      <ul className="mt-2 grid gap-1.5">
        {shown.map((f) => {
          const { icon: Icon, tone } = fileIcon(f.path)
          return (
            <li key={f.path} className="flex items-center gap-2.5 rounded-ctl bg-elevated px-2.5 py-2 ring-1 ring-inset ring-border">
              <Icon size={18} className={`shrink-0 ${tone}`} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm" title={f.path}>
                {baseName(f.path)}
              </span>
              <span className="shrink-0 text-meta text-subtle tabular-nums">{formatSize(f.size)}</span>
              <button
                type="button"
                onClick={() => void openPath(f.path)}
                className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-accent-soft"
              >
                <ExternalLink size={12} /> {t('tasks.deliv.open')}
              </button>
              <button
                type="button"
                onClick={() => void reveal(f.path)}
                title={t('tasks.deliv.reveal')}
                aria-label={t('tasks.deliv.reveal')}
                className="flex shrink-0 items-center rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg"
              >
                <FolderOpen size={14} />
              </button>
            </li>
          )
        })}
      </ul>
      {more > 0 && <p className="mt-1.5 px-1 text-meta text-muted">{t('tasks.result.more', { n: more })}</p>}
    </section>
  )
}
