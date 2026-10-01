/**
 * Tarjeta "Se bloqueó el acceso a {host}" cuando el proxy de egress de un servidor sandboxeado
 * bloquea una conexión de red durante una tarea (evento `tasks:networkBlocked`, ver
 * `src/main/tasks/proxy.ts` + `proxy-policy.ts`). Acciones: permitir esta vez (solo para los
 * servidores ya arrancados de esta carpeta), permitir siempre (lista blanca persistida) o
 * mantener bloqueado (se registra como bloqueado explícito y se descarta la tarjeta).
 */
import { useState } from 'react'
import { Check, Loader2, ShieldOff } from 'lucide-react'
import { Button } from '../../../components/Button'
import { useT } from '../../../lib/i18n'
import { errorMessage } from '../../../lib/opencode'
import { retryAfterNetworkAllow } from './actions'
import { cw } from './bridge'
import { dismissNetworkBlocked, resolveNetworkBlocked, useTasks, type NetworkBlockedEntry } from './store'

type Busy = 'once' | 'always' | 'block' | null

function ResolvedRow({ taskId, entry }: { taskId: string; entry: NetworkBlockedEntry }): React.JSX.Element {
  const t = useT()
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-hover/40 px-3 py-2 text-xs text-muted">
      <Check size={13} className="shrink-0 text-accent" />
      <span className="min-w-0 flex-1">
        {t('tasksComputer.net.allowed')} <span className="font-medium text-fg">{entry.host}</span>
        {entry.resolved === 'always' ? t('tasksComputer.net.always') : t('tasksComputer.net.once')}.
      </span>
      <Button
        className="!px-2.5 !py-1 text-xs"
        onClick={() => {
          dismissNetworkBlocked(taskId, entry.host)
          void retryAfterNetworkAllow(taskId, entry.host)
        }}
      >
        {t('tasksComputer.net.retry')}
      </Button>
    </div>
  )
}

function PendingRow({ taskId, entry }: { taskId: string; entry: NetworkBlockedEntry }): React.JSX.Element {
  const t = useT()
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)

  const allowOnce = async (): Promise<void> => {
    setBusy('once')
    setError(null)
    try {
      await cw('tasks:network:allowOnce', { folder: useTasks.getState().folder ?? '', host: entry.host })
      resolveNetworkBlocked(taskId, entry.host, 'once')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const allowAlways = async (): Promise<void> => {
    setBusy('always')
    setError(null)
    try {
      await cw('tasks:network:setHost', { host: entry.host, decision: 'allow' })
      resolveNetworkBlocked(taskId, entry.host, 'always')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const keepBlocked = async (): Promise<void> => {
    setBusy('block')
    setError(null)
    try {
      await cw('tasks:network:setHost', { host: entry.host, decision: 'block' })
      dismissNetworkBlocked(taskId, entry.host)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(null)
    }
  }

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3.5">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 [[data-theme=dark]_&]:text-amber-400">
          <ShieldOff size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t('tasksComputer.net.blocked', { host: entry.host })}</p>
          <p className="mt-0.5 text-xs text-muted">{t('tasksComputer.net.explain')}</p>
          {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={!!busy} onClick={() => void allowOnce()}>
              {busy === 'once' && <Loader2 size={14} className="animate-spin" />} {t('tasksComputer.net.allowOnce')}
            </Button>
            <Button disabled={!!busy} onClick={() => void allowAlways()}>
              {busy === 'always' && <Loader2 size={14} className="animate-spin" />} {t('tasksComputer.perm.always')}
            </Button>
            <Button variant="ghost" disabled={!!busy} onClick={() => void keepBlocked()}>
              {busy === 'block' && <Loader2 size={14} className="animate-spin" />} {t('tasksComputer.net.keepBlocked')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Tarjetas de red bloqueada de una tarea (una por host, deduplicadas). */
export function NetworkBlockedCards({ taskId }: { taskId: string }): React.JSX.Element | null {
  const entries = useTasks((s) => s.networkBlocked[taskId])
  if (!entries || entries.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      {entries.map((e) =>
        e.resolved ? <ResolvedRow key={e.host} taskId={taskId} entry={e} /> : <PendingRow key={e.host} taskId={taskId} entry={e} />
      )}
    </div>
  )
}
