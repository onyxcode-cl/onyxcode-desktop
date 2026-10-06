// Debe ir PRIMERO: migra localStorage antes de que cualquier store lo lea al cargar su módulo.
import './migrations/local-storage'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { DISPLAY_NAME } from '@shared/brand'
import { App } from './app/App'
import { LangRoot } from './app/LangRoot'
import { initLang } from './lib/i18n'
import { installModalFocus } from './lib/modal-focus'
import './app/globals.css'
// Capa visual solo de escritorio: DESPUÉS de globals.css; la PWA (remote/boot.tsx) no la carga. Ver app/desktop/index.css.
import './app/desktop/index.css'
import { currentPlatform } from './lib/platform'

document.title = DISPLAY_NAME
// Marca el escritorio: activa los tokens y la variante desk (data-shell) y los ajustes por sistema (data-platform: darwin|win32).
document.documentElement.dataset.shell = 'desktop'
document.documentElement.dataset.platform = currentPlatform()
initLang()
installModalFocus()

// Ganchos del harness E2E: solo en DEV y con el flag en localStorage (tree-shaken en producción).
if (import.meta.env.DEV) {
  try {
    if (localStorage.getItem('lazunox.e2e') === '1') void import('./e2e-hooks')
  } catch {
    /* localStorage no disponible */
  }
}

// Kit de UI (solo desarrollo): `#ui-kit` + `localStorage['lazunox.uikit'] = '1'`. Chunk perezoso; la PWA no pasa por aquí.
function wantsUiKit(): boolean {
  try {
    return location.hash === '#ui-kit' && localStorage.getItem('lazunox.uikit') === '1'
  } catch {
    return false
  }
}

const root = createRoot(document.getElementById('root') as HTMLElement)
if (wantsUiKit()) {
  void import('./app/dev/UiKit').then(({ default: UiKit }) => root.render(<UiKit />))
} else {
  root.render(
    <StrictMode>
      <LangRoot render={() => <App />} />
    </StrictMode>
  )
}
