/**
 * Atajos efectivos en el renderer: lee los overrides de las preferencias de extras (`keybindings`), los resuelve contra los
 * valores por defecto de la plataforma y ofrece utilidades puras de estado (sin tocar los stores de los modos, así que
 * Ajustes y la barra lateral pueden importarlo sin ciclos).
 */
import { useMemo } from 'react'
import { bindingDisplay, effectiveBindings, kbPlatformOf, type KbPlatform, type KeybindingOverrides } from '@shared/keybindings'
import { t } from '@shared/i18n'
import { useExtrasPrefs } from '../features/settings/impl/extras'
import { currentPlatform } from '../lib/platform'

export function kbPlatform(): KbPlatform {
  return kbPlatformOf(currentPlatform())
}

let lastOverrides: KeybindingOverrides | null = null
let lastEffective: Record<string, string | null> = {}

/** Atajos efectivos ahora mismo (memoizado por la identidad de los overrides). */
export function currentEffective(): Record<string, string | null> {
  const ov = useExtrasPrefs.getState().prefs.keybindings
  if (ov !== lastOverrides) {
    lastOverrides = ov
    lastEffective = effectiveBindings(ov, kbPlatform())
  }
  return lastEffective
}

export function useEffectiveBindings(): Record<string, string | null> {
  const ov = useExtrasPrefs((s) => s.prefs.keybindings)
  return useMemo(() => effectiveBindings(ov, kbPlatform()), [ov])
}

/** Teclas legibles de un atajo (`['⌘', 'K']`), con «Espacio» traducido. */
export function displayParts(binding: string): string[] {
  return bindingDisplay(binding, kbPlatform(), t('settings.shortcuts.space'))
}

/** Texto corto de un atajo para pistas (`⌘K`, `Ctrl+K`); vacío si la acción no tiene atajo. */
export function hintText(binding: string | null | undefined): string {
  if (!binding) return ''
  return displayParts(binding).join(kbPlatform() === 'mac' ? '' : '+')
}

/** Pista del atajo de una acción (se actualiza al cambiarlo en Ajustes). */
export function useBindingHint(actionId: string): string {
  const eff = useEffectiveBindings()
  return hintText(eff[actionId])
}

/** « (⌘K)» o vacío: para añadir al final de un título/tooltip. */
export function hintSuffix(hint: string): string {
  return hint ? ` (${hint})` : ''
}
