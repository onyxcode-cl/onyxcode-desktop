import { useSyncExternalStore } from 'react'
import { getFault, shouldThrow, subscribeFault } from '../e2e-fault'

/** Solo DEV (harness E2E): lanza al renderizar si `window.__onyxE2E.throwIn(mode)` coincide con su modo. */
export function E2EFault({ mode }: { mode: string }): null {
  const flag = useSyncExternalStore(subscribeFault, getFault)
  if (shouldThrow(flag, mode)) throw new Error(`E2E injected fault (${mode})`)
  return null
}
