import { vi } from 'vitest'
import { setLang } from '@shared/i18n'

/**
 * Devuelve el `window`/`document`/`localStorage` reales de jsdom (setup.ts los sustituye por falsos). Debe evaluarse ANTES de
 * importar `react-dom`: React decide al cargarse si el navegador soporta el evento `input`, y con el `document` falso creería que no.
 */
vi.unstubAllGlobals()
vi.stubGlobal('navigator', { userAgent: navigator.userAgent, language: 'es', languages: ['es'] })
// El `navigator` real de jsdom dice en-US: las pruebas corren siempre en español (como en setup.ts).
setLang('es')
