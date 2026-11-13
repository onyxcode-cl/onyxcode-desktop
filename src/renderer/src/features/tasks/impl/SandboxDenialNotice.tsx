import { useState } from 'react'
import { TASKS_TERMS } from '@shared/tasks-glossary'
import type { SandboxDenialKind } from '@shared/ipc-tasks'
import type { MsgKey } from '@shared/i18n'
import { useT } from '../../../lib/i18n'
import { errorMessage } from '../../../lib/opencode'
import { Button } from '../../../components/Button'
import { setDeleteGrantAllowed } from './actions'
import { useTasks } from './store'

const LABELS: Record<SandboxDenialKind, MsgKey> = {
  delete: 'tasks.denial.delete',
  write: 'tasks.denial.write',
  read: 'tasks.denial.read',
  network: 'tasks.denial.network',
  'git-hooks': 'tasks.denial.git-hooks',
  other: 'tasks.denial.other'
}

/** Ámbito explícito: Seatbelt identifica el servidor de carpeta, nunca una sesión o comando concreto. */
export function SandboxDenialNotice(): React.JSX.Element | null {
  const t = useT()
  const folder = useTasks((s) => s.folder)
  const conn = useTasks((s) => s.conn)
  const events = useTasks((s) => (folder ? s.sandboxDenials[folder] : undefined))
  const unavailable = useTasks((s) => (folder ? s.denialMonitorUnavailable[folder] : false))
  const enabled = useTasks((s) => s.prefs?.sandboxDenialNotices ?? true)
  const allowed = useTasks((s) => s.deleteGrant)
  const busy = useTasks((s) => s.deleteGrantBusy)
  const [error, setError] = useState<string | null>(null)
  if (!enabled || (!events?.length && !unavailable)) return null
  const kinds = [...new Set((events ?? []).map((e) => e.kind))]
  const canAllow = allowed === false && events?.some((e) => e.canAllowDelete)
  const enable = async (): Promise<void> => {
    setError(null)
    try {
      await setDeleteGrantAllowed(true, { folder, conn })
    } catch (err) {
      setError(errorMessage(err))
    }
  }
  return (
    <aside className="rounded-lg border border-border p-3 text-xs text-muted" aria-live="polite">
      {unavailable && <p>{t('tasks.denial.unavailable')}</p>}
      {kinds.map((kind) => (
        <p key={kind}>{t(LABELS[kind])}</p>
      ))}
      <p className="mt-1 text-subtle">{t('tasks.denial.scope')}</p>
      {canAllow && (
        <div className="mt-2">
          <p>{t('tasks.denial.allowHint')}</p>
          <Button variant="ghost" disabled={busy} onClick={() => void enable()}>
            {TASKS_TERMS.deleteGrant}
          </Button>
        </div>
      )}
      {error && <p className="mt-1 text-danger">{error}</p>}
    </aside>
  )
}
