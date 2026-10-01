// Debe ir PRIMERO: migra localStorage antes de que cualquier store lo lea al cargar su módulo.
import './migrations/local-storage'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { APP_NAME } from '@shared/brand'
import { App } from './app/App'
import { AccountGate } from './features/account'
import { LangRoot } from './app/LangRoot'
import { initLang } from './lib/i18n'
import { installModalFocus } from './lib/modal-focus'
import './app/globals.css'

document.title = APP_NAME
initLang()
installModalFocus()

// Ganchos del harness E2E: solo en DEV y con el flag en localStorage (tree-shaken en producción).
if (import.meta.env.DEV) {
  try {
    if (localStorage.getItem('onyx.e2e') === '1') void import('./e2e-hooks')
  } catch {
    /* localStorage no disponible */
  }
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <LangRoot
      render={() => (
        <AccountGate>
          <App />
        </AccountGate>
      )}
    />
  </StrictMode>
)
