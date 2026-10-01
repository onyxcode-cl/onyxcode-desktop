/**
 * Idioma del proceso principal (bandeja, menú, notificaciones). Sigue `Settings.language`; con `system`
 * usa `app.getPreferredSystemLanguages()`. Los módulos que dibujan texto nativo se suscriben con
 * `onLangChange` (shared/i18n) para reconstruirse al cambiar.
 */
import { app } from 'electron'
import { getLang, resolveLang, setLang, type Lang } from '@shared/i18n'
import { settingsStore } from './store'

export function systemLanguages(): string[] {
  try {
    return app.getPreferredSystemLanguages()
  } catch {
    return []
  }
}

export function applyMainLanguage(): Lang {
  setLang(resolveLang(settingsStore.get().language, systemLanguages()))
  return getLang()
}

let started = false

/** Una vez, con la app lista y ANTES de construir bandeja o menú. */
export function initMainI18n(): void {
  if (started) return
  started = true
  applyMainLanguage()
  settingsStore.onChange(() => applyMainLanguage())
}
