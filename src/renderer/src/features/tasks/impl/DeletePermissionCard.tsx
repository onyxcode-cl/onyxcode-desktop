/** La aprobación del motor no puede levantar el aislamiento: primero se cambia el permiso de carpeta. */
import { useRef, useState } from 'react'
import type { PermissionRequest, ToolPart } from '@opencode-ai/sdk/v2/client'
import { Trash2 } from 'lucide-react'
import { hasHiddenChars } from '../../../components/permission/PermissionShell'
import { Button } from '../../../components/Button'
import { useT } from '../../../lib/i18n'
import { errorMessage } from '../../../lib/opencode'
import { replyPermission } from './actions'
import { enableDeleteAndRetry } from './delete-grant-retry'
import { useTasks } from './store'

export function DeletePermissionCard({
  request,
  command,
  bar = false,
  onDismiss
}: {
  request: PermissionRequest | ToolPart
  command: string
  bar?: boolean
  onDismiss?: () => void
}): React.JSX.Element {
  const t = useT()
  const grant = useTasks((s) => s.deleteGrant)
  const grantBusy = useTasks((s) => s.deleteGrantBusy)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lock = useRef(false)
  const id = `${bar ? 'delete-bar' : 'perm'}-${request.id}`
  const respond = async (enable: boolean): Promise<void> => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    try {
      if (enable) await enableDeleteAndRetry(request)
      else if ('type' in request) onDismiss?.()
      else await replyPermission(request.id, 'reject')
    } catch (err) {
      const message = errorMessage(err)
      setError(message)
      // El reinicio puede desmontar esta tarjeta: el fallo también debe seguir visible en la tarea.
      useTasks.setState({ error: message })
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <div
      id={id}
      tabIndex={-1}
      role="alertdialog"
      aria-modal="false"
      aria-labelledby={`${id}-delete-title`}
      aria-describedby={`${id}-delete-body`}
      className="rounded-xl border border-warning/40 bg-warning/5 p-4 outline-none"
    >
      <h3 id={`${id}-delete-title`} className="flex items-center gap-2 text-sm font-semibold">
        <Trash2 size={16} />
        {t('tasksComputer.delete.permissionTitle')}
      </h3>
      <p id={`${id}-delete-body`} className="mt-2 text-sm text-muted">
        {t('tasksComputer.delete.permissionBody')}
      </p>
      <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-code p-3 font-mono text-xs whitespace-pre-wrap">{command}</pre>
      {hasHiddenChars(command) && <p className="mt-2 text-sm text-danger">{t('tasksComputer.perm.hidden')}</p>}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy || grantBusy} onClick={() => void respond(false)}>
          {t('tasksComputer.cancel')}
        </Button>
        <Button variant="danger" disabled={busy || grantBusy || grant == null} onClick={() => void respond(true)}>
          {t('tasksComputer.delete.enableRetry')}
        </Button>
      </div>
    </div>
  )
}
