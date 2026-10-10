/**
 * Idioma de las páginas de las ventanas secundarias (Quick Entry, overlay, píldora, guía). Esas
 * ventanas tienen un preload mínimo propio que no se toca: main carga la página con `?lang=es|en`
 * (`extras/windows.ts › loadLocalizedPage`) y aquí se lee. También fija la plataforma de las variantes `.win`. Importar este módulo ANTES que cualquier
 * otro que use `t()`. Sin parámetro válido, español.
 */
import { getI18nPlatform, isLang, setI18nPlatform, setLang, type Lang } from '@shared/i18n'

function readLang(): Lang {
  try {
    const v = new URLSearchParams(location.search).get('lang')
    return isLang(v) ? v : 'es'
  } catch {
    return 'es'
  }
}

export const pageLang: Lang = readLang()
setLang(pageLang)
try {
  document.documentElement.lang = pageLang
} catch {
  // sin document
}

// Variantes de texto por plataforma (`x.win`): estas ventanas no pasan por `lib/i18n`, así que se deduce del agente de usuario de Electron.
try {
  if (!getI18nPlatform() && /Windows/i.test(navigator.userAgent)) setI18nPlatform('win32')
} catch {
  // sin navigator
}
