/**
 * «Comparar modelos» no existe en el celular (`compareApi()` es null en la superficie remota): este módulo sustituye al índice
 * `features/compare` en la build de la PWA y evita que su interfaz (columnas, diálogo, tienda, Markdown en vivo, diff…) viaje en el
 * arranque. Misma forma pública que `features/compare/index.ts`; `swaps.test.ts` exige que no le falte ninguna exportación y
 * `no-compare.test.tsx` que el contrato de tipos y el comportamiento inerte se mantengan.
 */
import type { CompareMode } from '@shared/ipc-code'
import type * as Real from '../../src/features/compare'

type State = { armed: Record<string, never>; manifests: never[]; loaded: boolean }
const EMPTY: State = { armed: {}, manifests: [], loaded: false }

type UseCompare = (<T>(selector: (s: State) => T) => T) & { getState: () => State }
export const useCompare: UseCompare = Object.assign(<T,>(selector: (s: State) => T): T => selector(EMPTY), {
  getState: (): State => EMPTY
})

export function CompareControls(_p: Parameters<typeof Real.CompareControls>[0]): null {
  return null
}
export function CompareConfirmDialog(_p: Parameters<typeof Real.CompareConfirmDialog>[0]): null {
  return null
}
export function CompareView(_p: Parameters<typeof Real.CompareView>[0]): null {
  return null
}
export function RecoveryBanner(_p: Parameters<typeof Real.RecoveryBanner>[0]): null {
  return null
}
export const compareAvailable = (): boolean => false
export const maybeInterceptSubmit = (): boolean => false
export const requestCompare = (): Promise<boolean> => Promise.resolve(false)
export const isHiddenCompareSession = (): boolean => false
export function useCompareBoot(): void {}
export function useCompareArmed(_mode: CompareMode, _directory: string | null): { armed: boolean; count: number } {
  return { armed: false, count: 0 }
}
export function useShownCompare(_mode: CompareMode, _directory: string | null): string | null {
  return null
}
export function useHiddenCompareSession(): () => boolean {
  return () => false
}
