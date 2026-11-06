/** Qué modelo usará la traducción (el del Chat) y si es gratuito, para avisar de la calidad. */
import { useProviders } from '../../stores/providers'
import { resolveModelForMode } from '../settings/impl/extras'

export interface ChatModelInfo {
  label: string
  free: boolean
}

export function chatModelInfo(): ChatModelInfo | null {
  const wanted = resolveModelForMode('chat')
  if (!wanted?.modelID) return null
  const model = useProviders.getState().providers.find((p) => p.id === wanted.providerID)?.models[wanted.modelID] as
    { name?: string; cost?: { input?: number; output?: number } } | undefined
  const freeByCost = model?.cost !== undefined && model.cost.input === 0 && model.cost.output === 0
  return { label: model?.name ?? wanted.modelID, free: freeByCost || /-free$/i.test(wanted.modelID) }
}

/** ¿El modelo del Chat lee imágenes? (así la IA puede ver las hojas escaneadas). Si no se sabe, se asume que no. */
export function chatModelSeesImages(): boolean {
  const wanted = resolveModelForMode('chat')
  if (!wanted?.modelID) return false
  const model = useProviders.getState().providers.find((p) => p.id === wanted.providerID)?.models[wanted.modelID] as
    { capabilities?: { input?: { image?: boolean } } } | undefined
  return model?.capabilities?.input?.image === true
}
