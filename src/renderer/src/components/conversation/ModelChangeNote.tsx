import type { ModelChanged } from '@shared/model-change'
import { useProviders } from '../../stores/providers'
import { useT } from '../../lib/i18n'

/** Aviso compartido de Código y Tareas: nombre del catálogo, siempre como texto plano. */
export function ModelChangeNote({ change, ...props }: { change: ModelChanged } & React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  const t = useT()
  const providers = useProviders((s) => s.providers)
  const model = providers.find((p) => p.id === change.nuevo.providerID)?.models[change.nuevo.modelID]?.name ?? change.nuevo.modelID
  return (
    <div {...props} data-testid="model-change-note" className="flex items-center gap-1.5 text-xs text-muted">
      {t('code.msg.modelChanged', { model })}
    </div>
  )
}
