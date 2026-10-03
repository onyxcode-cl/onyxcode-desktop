/**
 * Entrada de la PWA completa (celular). La carga el arranque ligero DESPUÉS de autenticar (vinculación, PIN y confirmación
 * del Mac) y le pasa su enlace con el Mac en `globalThis.__onyxLink`. Primero se instalan los shims (`window.api`, `fetch`) y
 * solo entonces se importa la interfaz, que lee `window.api` al evaluarse.
 */
import { isLangPref, resolveLang, type LangPref } from '@shared/i18n'
import type { RemoteLink } from '@shared/remote/link'
import { installRemoteRuntime } from './install'

const link = (globalThis as { __onyxLink?: RemoteLink }).__onyxLink
if (!link) throw new Error('Falta el enlace con el Mac (arranque ligero).')

const runtime = installRemoteRuntime(link)

/** Idioma que se va a necesitar al pintar: el ajuste del Mac, o el recordado en este celular, o el del sistema. */
async function wantsEnglish(): Promise<boolean> {
  let pref: LangPref = 'system'
  try {
    const cached = localStorage.getItem('onyx.langPref')
    if (isLangPref(cached)) pref = cached
  } catch {
    /* sin almacenamiento */
  }
  try {
    const r = await runtime.api.invoke('settings:get')
    if (r.ok && isLangPref(r.data.language)) pref = r.data.language
  } catch {
    /* sin ajustes: se usa lo que hay */
  }
  return resolveLang(pref, [...(navigator.languages?.length ? navigator.languages : [navigator.language])]) === 'en'
}

void (async () => {
  if (await wantsEnglish()) (await import('./en-dict')).installEnglish()
  const boot = await import('./boot')
  boot.mountRemoteApp()
})()
