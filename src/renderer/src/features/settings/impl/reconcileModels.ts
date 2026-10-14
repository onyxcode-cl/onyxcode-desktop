import { reconcileChoices, type ModelChoices, type ProviderLike } from '@shared/ai-availability'
import { t } from '@shared/i18n'
import type { OpencodeClient } from '../../../lib/opencode'
import { useProviders } from '../../../stores/providers'
import { useSettings } from '../../../stores/settings'
import { useExtrasPrefs } from './extras'

/** Aviso breve tras reconciliar las elecciones de modelo: `undo` devuelve las elecciones anteriores. */
export interface SwitchNotice {
  text: string
  undo: () => Promise<void>
}

/** Ids de los proveedores cargados ahora (antes de una acción de conexión): del almacén si ya cargó; si no, se piden al motor. */
export async function snapshotProviderIds(client: OpencodeClient): Promise<string[] | null> {
  const st = useProviders.getState()
  if (st.loaded && st.client === client) return st.providers.map((p) => p.id)
  try {
    const res = await client.config.providers()
    return res.data ? res.data.providers.map((p) => p.id) : null
  } catch {
    return null
  }
}

function currentChoices(): ModelChoices {
  return {
    defaultModel: useSettings.getState().settings.defaultModel,
    modelsByMode: useExtrasPrefs.getState().prefs.modelsByMode
  }
}

async function applyChoices(choices: ModelChoices): Promise<void> {
  const cur = currentChoices()
  const d = choices.defaultModel
  if (cur.defaultModel.providerID !== d.providerID || cur.defaultModel.modelID !== d.modelID) {
    await useSettings.getState().update({ defaultModel: d })
  }
  if (JSON.stringify(cur.modelsByMode) !== JSON.stringify(choices.modelsByMode)) {
    await useExtrasPrefs.getState().update({ modelsByMode: choices.modelsByMode })
  }
}

/**
 * Tras conectar o desconectar un proveedor: revisa `settings.defaultModel` y `modelsByMode` contra los proveedores actuales
 * (`reconcileChoices`) y, si hay que cambiarlos, los persiste y devuelve el aviso «Ahora usas …» con la opción de deshacer.
 * Nunca lanza: si el motor no responde, las elecciones se quedan como estaban.
 */
export async function reconcileAfterProviderChange(client: OpencodeClient, previousIds: string[] | null): Promise<SwitchNotice | null> {
  try {
    const res = await client.config.providers()
    if (res.error || !res.data) return null
    const providers = res.data.providers
    const out = reconcileChoices(currentChoices(), providers as unknown as ProviderLike[], res.data.default, previousIds)
    if (!out.changed) return null
    await applyChoices(out.choices)
    const target = out.switchedTo
    if (!target) return null
    const name = providers.find((p) => p.id === target.providerID)?.name ?? target.providerID
    return { text: t('models.switched.now', { name }), undo: () => applyChoices(out.previous) }
  } catch {
    return null
  }
}
