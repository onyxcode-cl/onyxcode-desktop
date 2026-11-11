import { useEffect, useState } from 'react'
import type { BrowserOwner } from '@shared/ipc-browser'
import { onBrowser } from './bridge'

/** La ventana mantiene su dueño; abrir una tarjeta pendiente la lleva expresamente a ese dueño. */
export function useAssignedOwner(): BrowserOwner | null {
  const [owner, setOwner] = useState<BrowserOwner | null>(null)
  useEffect(() => {
    const offState = onBrowser('browser:state', (state) => setOwner((prev) => prev ?? state.owner))
    const offReveal = onBrowser('browser:reveal', (ev) => setOwner((prev) => (ev.reason === 'approval' ? ev.owner : (prev ?? ev.owner))))
    return () => {
      offState()
      offReveal()
    }
  }, [])
  return owner
}
