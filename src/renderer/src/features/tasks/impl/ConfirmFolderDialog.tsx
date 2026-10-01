import { useEffect } from 'react'
import { FolderLock, ShieldCheck } from 'lucide-react'
import { Button } from '../../../components/Button'
import { useT } from '../../../lib/i18n'

interface Props {
  folder: string
  onConfirm: () => void
  onCancel: () => void
}

/** "¿Permitir Tareas en {carpeta}?" */
export function ConfirmFolderDialog({ folder, onConfirm, onCancel }: Props): React.JSX.Element {
  const t = useT()
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  const name = folder.split('/').filter(Boolean).pop() ?? folder
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onMouseDown={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tasks-confirm-title"
        className="w-full max-w-md rounded-2xl border border-border bg-elevated p-6 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <FolderLock size={22} />
        </div>
        <h2 id="tasks-confirm-title" className="text-lg font-semibold">
          {t('tasksComputer.confirm.title', { name })}
        </h2>
        <p className="mt-1 truncate font-mono text-xs text-subtle" title={folder}>
          {folder}
        </p>
        <ul className="mt-4 space-y-2 text-sm text-muted">
          <li className="flex gap-2">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-accent" />
            {t('tasksComputer.confirm.b1')}
          </li>
          <li className="flex gap-2">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-accent" />
            {t('tasksComputer.confirm.b2')}
          </li>
          <li className="flex gap-2">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-accent" />
            {t('tasksComputer.confirm.b3')}
          </li>
        </ul>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {t('tasksComputer.confirm.cancel')}
          </Button>
          <Button variant="primary" onClick={onConfirm} autoFocus>
            {t('tasksComputer.confirm.allow')}
          </Button>
        </div>
      </div>
    </div>
  )
}
