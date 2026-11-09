/**
 * Ajustes › Modelos › «Modelo de respaldo» (paquete B6): hasta 3 modelos GRATUITOS a los que el motor cambia solo cuando el modelo gratuito en
 * uso se queda sin cuota. «Otro servicio» está apagado por defecto y avisa de que la conversación se manda a otro lado. Lo escrito vive en
 * `Settings.modelFallback` (normalizado en `@shared/model-fallback`) y reinicia el motor cuando no hay turnos en curso.
 */
import { useMemo } from 'react'
import type { Provider } from '@opencode-ai/sdk/v2/client'
import { X } from 'lucide-react'
import { MODEL_FALLBACK_MAX, normalizeModelFallback } from '@shared/model-fallback'
import { useT } from '../../../lib/i18n'
import { useSettings } from '../../../stores/settings'
import { ModelSelect } from './ModelSelect'
import { Card, Row, SubTitle, Toggle } from './ui'

/** Solo modelos de coste 0 declarado (el motor lo vuelve a comprobar), sin los ya elegidos ni los retirados. */
export function freeProviders(providers: Provider[], chosen: readonly string[]): Provider[] {
  return providers
    .map((p) => ({
      ...p,
      models: Object.fromEntries(
        Object.entries(p.models).filter(([id, m]) => {
          const c = m.cost
          return !!c && c.input === 0 && c.output === 0 && m.status !== 'deprecated' && !chosen.includes(`${p.id}/${id}`)
        })
      )
    }))
    .filter((p) => Object.keys(p.models).length > 0)
}

/** Nombre para mostrar de `proveedor/modelo`; si el catálogo no lo trae, el texto tal cual. */
function labelOf(providers: Provider[], ref: string): string {
  const i = ref.indexOf('/')
  const p = providers.find((x) => x.id === ref.slice(0, i))
  const m = p?.models[ref.slice(i + 1)]
  return m ? `${m.name} · ${p?.name ?? p?.id}` : ref
}

export function ModelFallbackBlock({ providers }: { providers: Provider[] }): React.JSX.Element {
  const t = useT()
  const { settings, update } = useSettings()
  const current = normalizeModelFallback(settings.modelFallback)
  const options = useMemo(() => freeProviders(providers, current.models), [providers, current.models])
  const save = (next: { models?: string[]; otherProvider?: boolean }): void => {
    void update({ modelFallback: normalizeModelFallback({ ...current, ...next }) })
  }
  return (
    <div data-testid="model-fallback">
      <SubTitle>{t('models.fallback.title')}</SubTitle>
      <Card>
        <Row
          label={t('models.fallback.label')}
          description={t('models.fallback.description', { max: MODEL_FALLBACK_MAX })}
          layout="stack-narrow"
        >
          <div className="flex flex-col gap-2">
            {current.models.map((ref) => (
              <div key={ref} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate" title={ref}>
                  {labelOf(providers, ref)}
                </span>
                <button
                  type="button"
                  className="shrink-0 rounded-md p-1 text-muted hover:bg-hover hover:text-fg"
                  aria-label={t('models.fallback.remove', { model: labelOf(providers, ref) })}
                  onClick={() => save({ models: current.models.filter((m) => m !== ref) })}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            {current.models.length === 0 && <div className="text-xs text-muted">{t('models.fallback.none')}</div>}
            {current.models.length < MODEL_FALLBACK_MAX && (
              <ModelSelect
                aria-label={t('models.fallback.add.aria')}
                className="w-80 desk:@max-[34rem]:w-full"
                providers={options}
                value={null}
                onChange={(v) => v && save({ models: [...current.models, `${v.providerID}/${v.modelID}`] })}
              />
            )}
          </div>
        </Row>
        <Row label={t('models.fallback.other.label')} description={t('models.fallback.other.description')}>
          <Toggle checked={current.otherProvider} onChange={(v) => save({ otherProvider: v })} label={t('models.fallback.other.label')} />
        </Row>
      </Card>
      {current.otherProvider && (
        <p role="note" className="mt-2 text-xs text-warning">
          {t('models.fallback.other.warn')}
        </p>
      )}
    </div>
  )
}
