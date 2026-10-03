/**
 * Único manejador de atajos de la aplicación (F8-B46): traduce el `keydown` a un atajo normalizado, resuelve qué acciones
 * lo tienen asignado ahora (atajos por defecto + overrides del usuario) y ejecuta la primera disponible.
 *
 * Reglas: no hace nada si otro manejador ya consumió el evento (`defaultPrevented`), durante la composición de un IME, con
 * AltGr, ni mientras se graba un atajo en Ajustes. Los atajos con modificador funcionan también con el foco en un campo de
 * texto (como siempre: ⌘K con el cursor en el compositor); los «desnudos» (Esc, Shift+Tab) solo donde su acción lo permite.
 */
import { actionsFor, allowedAtFocus, eventToBinding, type FocusKind, type KeyEventLike } from '@shared/keybindings'
import { useEffect } from 'react'
import { currentEffective, kbPlatform } from './bindings'
import { handlerFor } from './runtime'

let suspended = 0

/** Ajustes lo activa mientras graba un atajo: nada se dispara. Devuelve la función que lo libera. */
export function suspendKeybindings(): () => void {
  suspended++
  let released = false
  return () => {
    if (!released) {
      released = true
      suspended--
    }
  }
}

export function focusKindOf(target: EventTarget | null): FocusKind {
  if (!(target instanceof HTMLElement)) return 'idle'
  if (target.closest('[data-kb-composer]')) return 'composer'
  const editable =
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    !!target.closest('.xterm')
  return editable ? 'editable' : 'idle'
}

function legacyFields(e: KeyboardEvent): KeyEventLike {
  return {
    key: e.key,
    code: e.code,
    ctrlKey: e.ctrlKey,
    metaKey: e.metaKey,
    altKey: e.altKey,
    shiftKey: e.shiftKey,
    isComposing: e.isComposing,
    keyCode: e.keyCode
  }
}

/** Procesa un evento; devuelve `true` si ejecutó una acción. Exportado para las pruebas. */
export function handleKeydown(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || suspended > 0) return false
  const platform = kbPlatform()
  const binding = eventToBinding(e, platform)
  if (!binding) return false
  const focus = focusKindOf(e.target)
  const effective = currentEffective()
  // Compatibilidad: en macOS los atajos con ⌘ siempre respondieron también a Ctrl+tecla (p. ej. Ctrl+K); se conserva como
  // alternativa solo si el Ctrl literal no coincide con ninguna acción (⌃Tab y compañía siguen siendo Ctrl literal).
  const legacy =
    platform === 'mac' && e.ctrlKey && !e.metaKey ? eventToBinding({ ...legacyFields(e), ctrlKey: false, metaKey: true }, platform) : null
  for (const candidate of legacy && legacy !== binding ? [binding, legacy] : [binding]) {
    for (const action of actionsFor(candidate, effective)) {
      if (!allowedAtFocus(action, candidate, focus)) continue
      const handler = handlerFor(action.id)
      if (!handler) continue
      if (handler.enabled && !handler.enabled()) continue
      if (handler.run() === false) continue
      if (handler.consume !== false) e.preventDefault()
      return true
    }
  }
  return false
}

/** Instala el manejador global (una sola vez, en `App`). */
export function useKeybindings(): void {
  useEffect(() => {
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [])
}
