/** Tarjeta de resultado al final de una tarea terminada: los archivos que dejó el agente, con su icono, tamaño y accesos directos. */
import { useState } from 'react'
import { CheckCircle2, ExternalLink, FolderOpen } from 'lucide-react'
import type { TasksDeliverable } from '@shared/ipc-tasks'
import { useT } from '../../../lib/i18n'
import { isRemoteSurface } from '../../../lib/platform'
import { fileIcon } from './Deliverables'
import { FileReview } from './FileReview'
import { openPath, reveal } from './actions'
import { useTasks } from './store'
import { baseName, formatSize, isHelperFile, splitVersions } from './util'

const MAX_ROWS = 3

export { isHelperFile }

/** Una fila de archivo de la tarjeta. */
function ResultRow({ f }: { f: TasksDeliverable }): React.JSX.Element {
  const t = useT()
  const { icon: Icon, tone } = fileIcon(f.path)
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 rounded-ctl bg-elevated px-2.5 py-2 ring-1 ring-inset ring-border">
      <Icon size={18} className={`shrink-0 ${tone}`} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm" title={f.path}>
        {baseName(f.path)}
      </span>
      <button
        type="button"
        onClick={() => void reveal(f.path)}
        title={t('tasks.deliv.reveal')}
        aria-label={t('tasks.deliv.reveal')}
        className="flex shrink-0 items-center rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg"
      >
        <FolderOpen size={14} />
      </button>
      {/* Segunda línea: el nombre del archivo tiene la primera para él solo. */}
      <span className="basis-full h-0" aria-hidden />
      <span className="ml-7 shrink-0 text-meta text-subtle tabular-nums">{formatSize(f.size)}</span>
      <button
        type="button"
        onClick={() => void openPath(f.path)}
        className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-accent-soft"
      >
        <ExternalLink size={12} /> {t('tasks.deliv.open')}
      </button>
      <FileReview file={f} />
    </li>
  )
}

export function ResultCard({ taskId }: { taskId: string }): React.JSX.Element | null {
  const t = useT()
  const [showOlder, setShowOlder] = useState(false)
  const files = useTasks((s) => s.deliverables[taskId]) as TasksDeliverable[] | undefined
  // Abrir y mostrar en Finder son acciones del Mac: el celular no las ofrece.
  const visible = (files ?? []).filter((f) => !isHelperFile(f))
  if (isRemoteSurface() || visible.length === 0) return null
  // Los borradores (`informe.docx`, `informe-v2.docx`…) quedan tras «Ver versiones anteriores»: solo se ve la última de cada documento.
  const { latest, older } = splitVersions(visible)
  const shown = [...latest].sort((a, b) => b.mtime - a.mtime).slice(0, MAX_ROWS)
  const more = latest.length - shown.length
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
      <ul className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-1.5">
        {shown.map((f) => (
          <ResultRow key={f.path} f={f} />
        ))}
      </ul>
      {more > 0 && <p className="mt-1.5 px-1 text-meta text-muted">{t('tasks.result.more', { n: more })}</p>}
      {older.length > 0 && (
        <>
          <button
            type="button"
            data-testid="result-older-toggle"
            aria-expanded={showOlder}
            onClick={() => setShowOlder((o) => !o)}
            className="mt-1.5 rounded-md px-1 py-0.5 text-meta text-muted hover:bg-hover hover:text-fg"
          >
            {showOlder ? t('tasks.result.olderHide') : t('tasks.result.older', { n: older.length })}
          </button>
          {showOlder && (
            <ul className="mt-1.5 grid grid-cols-[minmax(0,1fr)] gap-1.5" data-testid="result-older">
              {[...older]
                .sort((a, b) => b.mtime - a.mtime)
                .map((f) => (
                  <ResultRow key={f.path} f={f} />
                ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
