/**
 * Envoltorio de `window.api.code.compare`. En la superficie remota (PWA del celular) devuelve `null`: el celular no usa los
 * canales `compare:*` (son clase X en la política del control remoto) y la función no se muestra allí.
 */
import type { CodeApi } from '@shared/ipc-code'
import { isRemoteSurface } from '../../lib/platform'

export type CompareApi = CodeApi['compare']

export function compareApi(): CompareApi | null {
  if (isRemoteSurface()) return null
  const w = (globalThis as { window?: { api?: { code?: Partial<CodeApi> } } }).window
  const c = w?.api?.code?.compare
  return c && typeof c.list === 'function' && typeof c.start === 'function' ? c : null
}

/** ¿Se ofrece «Comparar modelos» en esta superficie? (escritorio con la API nativa; nunca en el celular). */
export const compareAvailable = (): boolean => compareApi() !== null
