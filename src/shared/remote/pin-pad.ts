/**
 * Lógica pura del teclado de PIN de la capa ligera (`pwa/src/ui.ts`): añadir cifra, borrar, completar y, al crear el PIN, los
 * dos pasos (escribirlo y repetirlo). El PIN solo vive en este estado (memoria del cierre), nunca en el DOM.
 */
export const PIN_LENGTH = 6

export type PinMode = 'verify' | 'set'

export interface PinPadState {
  readonly mode: PinMode
  /** Paso 1: escribir; paso 2 (solo al crear): repetir. */
  readonly step: 1 | 2
  readonly digits: string
  /** PIN del paso 1, mientras se escribe el paso 2. */
  readonly first: string
  /** Último fallo local (los dos PIN no coincidieron). Se limpia con la siguiente pulsación. */
  readonly error: 'mismatch' | null
}

export type PinKey = { k: 'digit'; d: string } | { k: 'delete' } | { k: 'clear' }

export interface PinPress {
  state: PinPadState
  /** PIN completo listo para enviar (verificar, o crear con los dos pasos iguales). */
  submit?: string
}

export function pinInit(mode: PinMode): PinPadState {
  return { mode, step: 1, digits: '', first: '', error: null }
}

/** Traduce `KeyboardEvent.key` a una tecla del teclado (0-9, Backspace); el resto se ignora. */
export function pinKeyFromEvent(key: string): PinKey | null {
  if (/^[0-9]$/.test(key)) return { k: 'digit', d: key }
  if (key === 'Backspace') return { k: 'delete' }
  return null
}

export function pinPress(state: PinPadState, key: PinKey): PinPress {
  const base: PinPadState = state.error ? { ...state, error: null } : state
  if (key.k === 'clear') return { state: { ...base, digits: '' } }
  if (key.k === 'delete') return { state: { ...base, digits: base.digits.slice(0, -1) } }
  if (!/^[0-9]$/.test(key.d) || base.digits.length >= PIN_LENGTH) return { state: base }
  const digits = base.digits + key.d
  if (digits.length < PIN_LENGTH) return { state: { ...base, digits } }
  // Seis cifras: se completa el paso.
  if (base.mode === 'verify') return { state: { ...base, digits: '' }, submit: digits }
  if (base.step === 1) return { state: { ...base, step: 2, first: digits, digits: '' } }
  if (digits === base.first) return { state: { ...base, digits: '', first: '' }, submit: digits }
  return { state: { ...base, step: 1, first: '', digits: '', error: 'mismatch' } }
}
