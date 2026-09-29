/**
 * Ventana «Navegador» aparte (rol `browserHost`, ver `main/embedded-browser/popout.ts`): la
 * misma página que carga en `lapis://app/browser/index.html`, y que solo renderiza
 * `BrowserPanel` (compartido con Code y Cowork) para el `owner` que main le asigne.
 *
 * Sin preload propio de Code/Cowork ni de extras: no hay tema de usuario que leer aquí (el
 * `browser-host` solo expone `window.api.browser`), así que se sigue la preferencia del
 * sistema. La ventana es única y se reutiliza para el owner que la pida cada vez, así que el
 * `owner` NO viaja en la URL: main lo empuja por el evento `browser:state` en cuanto abre o
 * reutiliza la ventana (`service.ts` → `pushOwnerToPopout`), y aquí solo se escucha.
 */
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { BrowserOwner, BrowserProduct } from '@shared/ipc-browser'
import { BrowserPanel } from '../src/features/browser'
import { onBrowser } from '../src/features/browser/bridge'
import '../src/app/globals.css'

function syncSystemTheme(): void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const apply = (): void => {
    document.documentElement.dataset.theme = mq.matches ? 'dark' : 'light'
  }
  apply()
  mq.addEventListener('change', apply)
}

/** Espera el primer `owner` que main empuje (por `browser:state` o, de respaldo, `browser:reveal`). */
function useAssignedOwner(): BrowserOwner | null {
  const [owner, setOwner] = useState<BrowserOwner | null>(null)
  useEffect(() => {
    const offState = onBrowser('browser:state', (state) => setOwner((prev) => prev ?? state.owner))
    const offReveal = onBrowser('browser:reveal', (ev) => setOwner((prev) => prev ?? ev.owner))
    return () => {
      offState()
      offReveal()
    }
  }, [])
  return owner
}

function BrowserWindowApp(): React.JSX.Element {
  const owner = useAssignedOwner()
  if (!owner) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-bg text-sm text-subtle">
        Abriendo el navegador…
      </div>
    )
  }
  const product: BrowserProduct = owner.kind
  return <BrowserPanel owner={owner} product={product} visible variant="popout" className="h-screen w-screen" />
}

syncSystemTheme()

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <BrowserWindowApp />
  </StrictMode>
)
