/**
 * Aviso en el hilo cuando el agente pidió una app BLOQUEADA (evento `computer:blockedApps`, sin tarjeta de permiso).
 * Nunca dice solo «bloqueada»: dice quién la bloqueó, por qué y los pasos exactos. Tres casos:
 *  - 'user': la bloqueó la persona (Ajustes › Bloqueadas por ti) → botón «Desbloquear…» que abre ese bloque de Ajustes.
 *  - 'fixed': lista de seguridad de Lazunox (p. ej. gestores de claves) → SIN botón: no se puede desbloquear desde la app.
 *  - 'session': dijo que no solo en esta tarea → solo texto (no hay vía limpia para reabrir la solicitud sin canal nuevo).
 */
import { Ban, ShieldAlert } from 'lucide-react'
import { Button } from '../../../components/Button'
import { useT } from '../../../lib/i18n'
import { useUi } from '../../../stores/ui'
import { useTasks, type BlockedAppEntry } from './store'

export function BlockedRow({ entry }: { entry: BlockedAppEntry }): React.JSX.Element {
  const t = useT()
  const Icon = entry.kind === 'fixed' ? ShieldAlert : Ban
  return (
    <div
      role="status"
      data-blocked-kind={entry.kind}
      className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs desk:rounded-ctl desk:border-transparent desk:text-ui desk:ring-1 desk:ring-inset desk:ring-warning/45"
    >
      <Icon size={14} className="mt-0.5 shrink-0 text-warning" />
      <p className="min-w-0 flex-1">{t(`tasksComputer.blocked.${entry.kind}`, { app: entry.name })}</p>
      {entry.kind === 'user' && (
        <Button className="!px-2.5 !py-1 text-xs" onClick={() => useUi.getState().openSettingsAt('computer')}>
          {t('tasksComputer.blocked.unlock')}
        </Button>
      )}
    </div>
  )
}

/** Avisos de apps bloqueadas de una tarea (uno por app). */
export function BlockedAppNotices({ taskId }: { taskId: string }): React.JSX.Element | null {
  const entries = useTasks((s) => s.blockedApps[taskId])
  if (!entries || entries.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      {entries.map((e) => (
        <BlockedRow key={`${e.bundleId}:${e.kind}`} entry={e} />
      ))}
    </div>
  )
}
