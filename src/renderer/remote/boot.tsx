import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { APP_NAME } from '@shared/brand'
import { App } from '@renderer/app/App'
import { LangRoot } from '@renderer/app/LangRoot'
import { initLang, useLang } from '@renderer/lib/i18n'
import { installModalFocus } from '@renderer/lib/modal-focus'
import { watchThemeSync } from '@renderer/app/mobile/theme-sync'
import '@renderer/app/globals.css'
import '@renderer/app/mobile/mobile-tokens.css'

/**
 * Monta la MISMA interfaz de escritorio (`src/renderer/src`). Sin `AccountGate`: la cuenta es del Mac (que ya tiene sesión
 * abierta para poder aceptar al celular); el celular no inicia ni cierra sesión (`account:*` son «prohibido» en la política).
 */
export function mountRemoteApp(): void {
  document.title = APP_NAME
  initLang()
  installModalFocus()
  // Recuerda el tema del Mac (para la capa ligera) y ajusta `theme-color`: ver docs/MOBILE-UI.md.
  watchThemeSync()
  let host = document.getElementById('root')
  if (!host) {
    host = document.createElement('div')
    host.id = 'root'
    document.body.append(host)
  }
  const root = createRoot(host)
  let n = 0
  const render = (): void =>
    root.render(
      <StrictMode>
        <LangRoot key={n} render={() => <App />} />
      </StrictMode>
    )
  render()
  // Avisa al arranque ligero cuando ya pintó (retira su pantalla de carga).
  const g = globalThis as { __onyxAppMounted?: () => void }
  requestAnimationFrame(() => requestAnimationFrame(() => g.__onyxAppMounted?.()))
  // Si más tarde se cambia a inglés (el diccionario inglés va aparte), se baja y se vuelve a pintar una vez.
  useLang.subscribe((s) => {
    if (s.lang !== 'en') return
    void import('./en-dict').then((m) => {
      if (m.englishInstalled()) return
      m.installEnglish()
      n++
      render()
    })
  })
}
