/**
 * Punto de entrada de «Comparar modelos» (lado renderer). Code y Chat lo importan desde aquí: el botón y el chip del
 * compositor, el gancho de envío, la vista de columnas y la franja de recuperación. Nada de esto existe en el celular.
 */
import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { CompareMode } from '@shared/ipc-code'
import { bootCompare, ctxKey, isHiddenCompareSession, selectShown, useCompare } from './store'

export { CompareControls } from './CompareControls'
export { CompareConfirmDialog } from './CompareConfirmDialog'
export { CompareView } from './CompareView'
export type { AdoptedInfo } from './CompareView'
export { RecoveryBanner } from './RecoveryBanner'
export { compareAvailable } from './api'
export { maybeInterceptSubmit, requestCompare, isHiddenCompareSession, useCompare } from './store'
export type { CompareRequestCtx } from './store'

/** Activa la sincronización de comparaciones (manifiestos y eventos del motor) mientras el componente está montado. */
export function useCompareBoot(): void {
  useEffect(() => bootCompare(), [])
}

/** ¿Hay una comparación armada en este contexto? (el compositor cambia el título del botón de enviar). */
export function useCompareArmed(mode: CompareMode, directory: string | null): { armed: boolean; count: number } {
  return useCompare(
    useShallow((s) => {
      const models = s.armed[ctxKey(mode, directory)]
      return { armed: !!models, count: models?.length ?? 0 }
    })
  )
}

/** Id de la comparación con vista abierta en este contexto, o `null`. */
export function useShownCompare(mode: CompareMode, directory: string | null): string | null {
  return useCompare((s) => selectShown(s, mode, directory)?.id ?? null)
}

/** Predicado para la lista de Chat: ¿esta sesión pertenece a una comparación sin elegir (y debe ocultarse)? */
export function useHiddenCompareSession(): (session: { id: string; metadata?: Record<string, unknown> }) => boolean {
  const manifests = useCompare((s) => s.manifests)
  const loaded = useCompare((s) => s.loaded)
  return (session) => isHiddenCompareSession(session, { manifests, loaded })
}
