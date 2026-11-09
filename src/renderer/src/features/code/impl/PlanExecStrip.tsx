/**
 * D2: franja de «Planear con A · Ejecutar con B» (solo si hay modelo propio para planear o ejecutar) y aviso cuando el modelo elegido
 * ya no existe o no tiene clave y se usó el de la conversación. El aviso no bloquea y se cierra con «Entendido».
 */
import { X } from 'lucide-react'
import type { PlanExecModels } from '@shared/plan-exec-models'
import type { ModelRef } from '@shared/types'
import { useT } from '../../../lib/i18n'
import { useProviders } from '../../../stores/providers'
import { useExtrasPrefs } from '../../settings/impl/extras'
import { modelLabel } from '../../settings/impl/ModelSelect'
import { useCode } from './store'

const NONE: PlanExecModels = {}

/** Modelos de planear/ejecutar vigentes en la sesión (ajustes + cambios hechos en la conversación). */
export function useRoleModels(sessionID: string | null): PlanExecModels {
  const config = useExtrasPrefs((s) => s.prefs.planExecModels) ?? NONE
  const override = useCode((s) => s.roleModels[sessionID ?? ''] ?? s.roleModels[''])
  return { plan: override?.plan ?? config.plan, exec: override?.exec ?? config.exec }
}

export function PlanExecStrip({ sessionID }: { sessionID: string | null }): React.JSX.Element | null {
  const t = useT()
  const agent = useCode((s) => s.agent)
  const providers = useProviders((s) => s.providers)
  const roles = useRoleModels(sessionID)
  const notice = useCode((s) => (sessionID ? s.roleNotices[sessionID] : undefined))
  const dismiss = useCode((s) => s.dismissRoleNotice)
  const label = (m: ModelRef | undefined): string => (m ? modelLabel(providers, m) : t('code.planExec.strip.conversation'))
  const roleName = (r: 'plan' | 'exec'): string => t(r === 'plan' ? 'code.planExec.role.plan' : 'code.planExec.role.exec')
  const any = !!(roles.plan || roles.exec)
  if (!any && !notice) return null
  return (
    <div className="mx-auto mb-2 w-full max-w-3xl px-6 desk:max-w-[var(--measure-prose)]">
      {any && (
        <p
          role="status"
          aria-label={t('code.planExec.strip.aria')}
          data-plan-exec-strip=""
          className="flex flex-wrap items-center gap-x-1 text-xs text-muted desk:text-meta"
        >
          <span className={agent === 'plan' ? 'font-medium text-accent' : ''}>
            {roleName('plan')}: {label(roles.plan)}
          </span>
          <span aria-hidden>·</span>
          <span className={agent === 'plan' ? '' : 'font-medium text-accent'}>
            {roleName('exec')}: {label(roles.exec)}
          </span>
        </p>
      )}
      {notice && (
        <div
          role="alert"
          data-plan-exec-notice=""
          className="mt-1 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-fg desk:text-meta"
        >
          <span className="min-w-0 flex-1">
            {t('code.planExec.fallback', {
              role: roleName(notice.role).toLowerCase(),
              wanted: modelLabel(providers, notice.wanted),
              used: modelLabel(providers, notice.used)
            })}
          </span>
          <button
            type="button"
            onClick={() => dismiss(sessionID ?? '')}
            aria-label={t('code.planExec.fallback.dismiss')}
            title={t('code.planExec.fallback.dismiss')}
            className="shrink-0 rounded-md p-1 text-muted hover:bg-hover hover:text-fg"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
