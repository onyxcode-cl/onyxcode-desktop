/**
 * «Usar el motor incluido»: deja de preferir un OpenCode elegido aparte (`settings.opencodeBin`). No descarga ni
 * crea ningún binario: solo suelta la ruta guardada para que la resolución normal vuelva al motor que viene en la app.
 * Las dependencias se inyectan para poder probarlo sin Electron.
 */
import type { OpencodeInfo, UseBundledEngineResult } from '@shared/types'
import type { ResolvedOpencode } from './binary'

export interface UseBundledDeps {
  /** Motor incluido en la app (null si no hay: app sin empaquetar). */
  bundled: () => string | null
  /** `OPENCODE_BIN` del proceso. */
  envBin: () => string | undefined
  isExecutable: (path: string) => boolean
  /** Olvida `settings.opencodeBin`. */
  clearConfigured: () => void
  /** Resolución con los ajustes ya limpios. */
  resolve: () => Promise<ResolvedOpencode | null>
  describe: (resolved: ResolvedOpencode | null) => Promise<OpencodeInfo>
}

export async function useBundledEngine(d: UseBundledDeps): Promise<UseBundledEngineResult> {
  if (!d.bundled()) return { status: 'unavailable' }
  const env = d.envBin()
  // Una variable de entorno gana a los ajustes: soltar la ruta no cambiaría nada, y decir «listo» sería mentir.
  if (env && d.isExecutable(env)) return { status: 'pinned' }
  d.clearConfigured()
  const resolved = await d.resolve()
  return { status: 'ok', info: await d.describe(resolved) }
}
