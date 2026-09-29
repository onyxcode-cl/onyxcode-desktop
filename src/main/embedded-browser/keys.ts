/**
 * Tabla de teclas para la herramienta `press_key` (Lote D, B.6). Traduce un nombre de tecla o una
 * combinación ("Enter", "ArrowDown", "Control+A", "Meta+C"…) a los eventos CDP
 * `Input.dispatchKeyEvent` (keyDown/keyUp) que envía `tools.ts`.
 *
 * Bloquea las combinaciones reservadas del sistema que el agente nunca debe poder disparar por su
 * cuenta: `Meta+Q` (cerrar la app) y `Meta+W` (cerrar pestaña/ventana). El resto de atajos
 * reservados de la superficie (⌘L, ⌘T, ⌘R…) los intercepta `surface.ts` (D1) sobre la entrada
 * REAL del usuario; esto es aparte: una lista blanca de lo que el agente puede pedir por CDP.
 */

export interface KeyEventParams {
  type: 'keyDown' | 'keyUp' | 'rawKeyDown' | 'char'
  key: string
  code?: string
  windowsVirtualKeyCode?: number
  nativeVirtualKeyCode?: number
  text?: string
  unmodifiedText?: string
  modifiers?: number
  autoRepeat?: boolean
  isKeypad?: boolean
  location?: number
}

/** Bits de `modifiers` para `Input.dispatchKeyEvent`/`dispatchMouseEvent` (orden de CDP). */
const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 } as const

interface KeyDef {
  key: string
  code: string
  keyCode: number
  /** Solo si la tecla inserta texto por sí misma (letras, espacio…). */
  text?: string
  shiftText?: string
}

const NAMED_KEYS: Record<string, KeyDef> = {
  enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  return: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  del: { key: 'Delete', code: 'Delete', keyCode: 46 },
  space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  home: { key: 'Home', code: 'Home', keyCode: 36 },
  end: { key: 'End', code: 'End', keyCode: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  insert: { key: 'Insert', code: 'Insert', keyCode: 45 },
  f1: { key: 'F1', code: 'F1', keyCode: 112 },
  f2: { key: 'F2', code: 'F2', keyCode: 113 },
  f3: { key: 'F3', code: 'F3', keyCode: 114 },
  f4: { key: 'F4', code: 'F4', keyCode: 115 },
  f5: { key: 'F5', code: 'F5', keyCode: 116 },
  f6: { key: 'F6', code: 'F6', keyCode: 117 },
  f7: { key: 'F7', code: 'F7', keyCode: 118 },
  f8: { key: 'F8', code: 'F8', keyCode: 119 },
  f9: { key: 'F9', code: 'F9', keyCode: 120 },
  f10: { key: 'F10', code: 'F10', keyCode: 121 },
  f11: { key: 'F11', code: 'F11', keyCode: 122 },
  f12: { key: 'F12', code: 'F12', keyCode: 123 }
}

/** Alias de nombre de modificador → canónico. */
const MOD_ALIASES: Record<string, keyof typeof MOD> = {
  control: 'ctrl',
  ctrl: 'ctrl',
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  super: 'meta'
}

/** Combinaciones que el agente nunca puede disparar por `press_key` (cerrar la app o la pestaña). */
const BLOCKED_COMBOS = new Set(['meta+q', 'meta+w'])

function letterOrDigitDef(base: string): KeyDef | null {
  if (/^[a-z]$/.test(base)) {
    return {
      key: base,
      code: `Key${base.toUpperCase()}`,
      keyCode: base.toUpperCase().charCodeAt(0),
      text: base,
      shiftText: base.toUpperCase()
    }
  }
  if (/^[0-9]$/.test(base)) {
    return { key: base, code: `Digit${base}`, keyCode: base.charCodeAt(0), text: base }
  }
  return null
}

export interface ParsedKeyCombo {
  down: KeyEventParams
  up: KeyEventParams
}

/**
 * Traduce "Enter", "cmd+shift+t", "a"… a los eventos CDP. Lanza si la combinación está bloqueada
 * o no se reconoce ninguna tecla base. Insensible a mayúsculas; los modificadores y la tecla base
 * se separan por "+".
 */
export function parseKeyCombo(input: string): ParsedKeyCombo {
  const raw = input.trim()
  if (!raw) throw new Error('key vacío')
  const parts = raw
    .split('+')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
  if (!parts.length) throw new Error(`Combinación de teclas inválida: "${input}"`)
  const base = parts[parts.length - 1]
  const modParts = parts.slice(0, -1)
  let modifiers = 0
  for (const m of modParts) {
    const canon = MOD_ALIASES[m]
    if (!canon) throw new Error(`Modificador de tecla no reconocido: "${m}"`)
    modifiers |= MOD[canon]
  }
  const normalized = [...modParts.map((m) => MOD_ALIASES[m]), base].join('+')
  if (BLOCKED_COMBOS.has(normalized)) {
    throw new Error(`La combinación "${input}" está bloqueada (cierra la app o la pestaña): el agente no puede pulsarla.`)
  }
  const def = NAMED_KEYS[base] ?? letterOrDigitDef(base)
  if (!def) throw new Error(`Tecla no reconocida: "${base}"`)
  const shifted = (modifiers & MOD.shift) !== 0
  const text = shifted ? (def.shiftText ?? def.text) : def.text
  const hasNonShiftMod = (modifiers & (MOD.ctrl | MOD.alt | MOD.meta)) !== 0
  const eventText = hasNonShiftMod ? undefined : text
  const common = {
    key: shifted && def.shiftText ? def.shiftText : def.key,
    code: def.code,
    windowsVirtualKeyCode: def.keyCode,
    nativeVirtualKeyCode: def.keyCode,
    modifiers: modifiers || undefined
  }
  return {
    down: { type: 'keyDown', ...common, text: eventText, unmodifiedText: eventText },
    up: { type: 'keyUp', ...common }
  }
}
