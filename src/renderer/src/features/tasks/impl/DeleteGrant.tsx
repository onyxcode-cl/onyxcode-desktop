/**
 * "Permitir borrar, mover y renombrar": concede/retira el permiso de borrado de Seatbelt/WSL
 * para el servidor sandboxeado de la carpeta (`tasks:deleteGrant:*`, ver
 * `src/main/tasks/sandbox-profile.ts`). Como mover o renombrar también es un `unlink` del origen,
 * el mismo permiso cubre las tres cosas. Incluye el interruptor (panel de proyecto) y la tarjeta
 * que aparece tras un intento denegado de cualquier herramienta con evidencia de borrado.
 */
import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { TASKS_TERMS } from '@shared/tasks-glossary'
import { useT } from '../../../lib/i18n'
import { errorMessage } from '../../../lib/opencode'
import type { MessageEntry } from '../../../stores/sessions'
import { setDeleteGrantAllowed } from './actions'
import { useTasks } from './store'
import { looksLikeBlockedDelete, deleteAttemptText } from './blocked-delete'
import { DeletePermissionCard } from './DeletePermissionCard'
import { sdkDirOf } from './path-map'

/** Interruptor «Permitir borrar, mover y renombrar», con la advertencia de que reinicia el servidor de la tarea. */
export function DeleteGrantToggle(): React.JSX.Element | null {
  const t = useT()
  const folder = useTasks((s) => s.folder)
  const allowed = useTasks((s) => s.deleteGrant)
  const busy = useTasks((s) => s.deleteGrantBusy)
  const [error, setError] = useState<string | null>(null)
  if (!folder) return null

  const toggle = async (): Promise<void> => {
    setError(null)
    try {
      await setDeleteGrantAllowed(!allowed)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{TASKS_TERMS.deleteGrant}</p>
          <p className="mt-0.5 text-xs text-subtle">
            {t('tasksComputer.delete.toggleA')} <code className="font-mono">rm</code> {t('tasksComputer.delete.or')}{' '}
            <code className="font-mono">mv</code>
            {t('tasksComputer.delete.toggleB')}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={!!allowed}
          aria-label={TASKS_TERMS.deleteGrant}
          disabled={busy || allowed === null}
          onClick={() => void toggle()}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-40 ${
            allowed ? 'bg-accent' : 'bg-border-strong'
          }`}
        >
          {busy && <Loader2 size={12} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 animate-spin text-white/80" />}
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
              allowed ? 'translate-x-4.5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  )
}

/** La misma tarjeta después de un fallo, aunque el motor no haya pedido permiso antes. */
export function DeleteGrantHintCard({ entries }: { entries: MessageEntry[] }): React.JSX.Element | null {
  const deleteGrant = useTasks((s) => s.deleteGrant)
  const folder = useTasks((s) => s.folder)
  const conn = useTasks((s) => s.conn)
  const folders = useTasks((s) => s.folderSet)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  if (deleteGrant === true || !folder || !conn || conn.fullAccess) return null
  const scope = {
    folder: sdkDirOf(conn, folder),
    additional: [...(folders?.linked ?? []), ...(folders?.trusted ?? [])].map((f) => f.path)
  }
  for (const e of entries) {
    for (const p of e.parts) {
      if (p.type !== 'tool' || dismissed.has(p.id) || !looksLikeBlockedDelete(p, scope)) continue
      return (
        <DeletePermissionCard
          key={p.id}
          request={p}
          command={deleteAttemptText(p)}
          onDismiss={() => setDismissed((s) => new Set(s).add(p.id))}
        />
      )
    }
  }
  return null
}
