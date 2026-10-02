/**
 * Idioma del renderer. `useLang` guarda el idioma efectivo; al cambiar, se actualiza el idioma global de
 * `@shared/i18n` (lo usan `t()` y las etiquetas calculadas fuera de React), `<html lang>` y todo el
 * árbol se vuelve a pintar (ver `LangRoot`). La preferencia se recuerda en localStorage para no
 * parpadear en otro idioma mientras llegan los ajustes del disco.
 */
import { create } from 'zustand'
import {
  getLang,
  localeTag,
  resolveLang,
  setI18nPlatform,
  setLang,
  translate,
  type Lang,
  type LangPref,
  type MsgKey,
  type Params,
  isLangPref
} from '@shared/i18n'
import { useSettings } from '../stores/settings'
import { currentPlatform } from './platform'

// Variantes de texto por plataforma (`x.win`): antes de pintar nada.
setI18nPlatform(currentPlatform())

const CACHE_KEY = 'onyx.langPref'

function systemLanguages(): string[] {
  try {
    return [...(navigator.languages?.length ? navigator.languages : [navigator.language])].filter(Boolean)
  } catch {
    return []
  }
}

function cachedPref(): LangPref {
  try {
    const v = localStorage.getItem(CACHE_KEY)
    if (isLangPref(v)) return v
  } catch {
    // sin storage
  }
  return 'system'
}

function apply(lang: Lang): void {
  setLang(lang)
  try {
    document.documentElement.lang = lang
  } catch {
    // sin document (tests)
  }
}

interface LangState {
  lang: Lang
}

export const useLang = create<LangState>(() => ({ lang: resolveLang(cachedPref(), systemLanguages()) }))
apply(useLang.getState().lang)

/** Aplica la preferencia del usuario (ajuste `language`). */
export function applyLangPref(pref: LangPref): void {
  try {
    localStorage.setItem(CACHE_KEY, pref)
  } catch {
    // ignorar
  }
  const lang = resolveLang(pref, systemLanguages())
  apply(lang)
  if (useLang.getState().lang !== lang) useLang.setState({ lang })
}

let wired = false

/** Engancha los ajustes al idioma (una vez; idempotente). */
export function initLang(): void {
  if (wired) return
  wired = true
  const sync = (s: ReturnType<typeof useSettings.getState>): void => {
    if (s.loaded) applyLangPref(s.settings.language)
  }
  sync(useSettings.getState())
  useSettings.subscribe(sync)
}

/** `t` ligada al idioma activo; el componente se vuelve a pintar al cambiarlo. */
export function useT(): (key: MsgKey, params?: Params) => string {
  const lang = useLang((s) => s.lang)
  return (key, params) => translate(lang, key, params)
}

/** Etiqueta BCP 47 del idioma activo (para `toLocaleString`, `Intl.*`). */
export function useLocale(): string {
  return localeTag(useLang((s) => s.lang))
}

export { getLang, localeTag }

/**
 * Configuración regional para fechas y números en Code, Tareas y Rutinas: con español se conserva
 * `es-CL` (el producto no cambia); con inglés, `en-US`. Se lee en el momento de formatear.
 */
export function dateLocale(): string {
  return getLang() === 'en' ? 'en-US' : 'es-CL'
}
