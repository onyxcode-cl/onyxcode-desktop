/**
 * Atajos de teclado configurables de la aplicación (F8-B46): lógica PURA compartida (sin DOM ni Electron).
 *
 * - Registro de acciones: id estable, categoría, clave i18n del nombre, atajo por defecto. La ejecución (que necesita los
 *   stores del renderer) vive en `renderer/src/keybindings/`.
 * - Forma NORMALIZADA de un atajo: modificadores en orden fijo `Mod`, `Ctrl`, `Alt`, `Shift` y una tecla, unidos por `+`
 *   (`Mod+K`, `Mod+Shift+P`, `Ctrl+Tab`, `Shift+Tab`, `Mod+\`). `Mod` es la tecla principal de la plataforma (⌘ en macOS,
 *   Ctrl en Windows/Linux); `Ctrl` es el Control literal y solo existe en macOS (en Windows/Linux `Ctrl` se normaliza a `Mod`).
 *   Así un perfil guardado en un Mac sigue teniendo sentido en Windows.
 * - Teclas: letras y dígitos por carácter/código físico, teclas con nombre por `event.code`, signos de puntuación por
 *   `event.key` (o, si el carácter no es ASCII —`ç`, `ñ`, Option—, por el código físico US). Con teclado español,
 *   AltGr (Ctrl+Alt) NO es un atajo, y durante la composición de un IME o una tecla muerta no se dispara nada.
 * - Se guarda solo lo que el usuario cambia: `keybindings: { [actionId]: string | null }` (`null` = desactivado, ausente =
 *   por defecto). Pensado para poder ir luego por perfil.
 */
import type { MsgKey } from './i18n'

export type KbPlatform = 'mac' | 'win' | 'linux'

export function kbPlatformOf(platform: string): KbPlatform {
  return platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : 'linux'
}

/** Mapa de overrides persistido (`ExtrasPrefs.keybindings`). */
export type KeybindingOverrides = Record<string, string | null>

// ───────────────────────────── teclas ─────────────────────────────

const NAMED_CODES: Record<string, string> = {
  Tab: 'Tab',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Escape: 'Escape',
  Space: 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown'
}

const PUNCT_BY_CODE: Record<string, string> = {
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`'
}

const PUNCT_CHARS = new Set(Object.values(PUNCT_BY_CODE))
const FKEY = /^F([1-9]|1[0-2])$/

/** Alias aceptados al leer un atajo escrito a mano o heredado (aceleradores de Electron incluidos). */
const KEY_ALIASES: Record<string, string> = {
  esc: 'Escape',
  escape: 'Escape',
  return: 'Enter',
  enter: 'Enter',
  space: 'Space',
  spacebar: 'Space',
  tab: 'Tab',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  plus: 'Plus'
}

function parseKeyToken(raw: string): string | null {
  if (raw === '+') return 'Plus'
  if (PUNCT_CHARS.has(raw)) return raw
  const lower = raw.toLowerCase()
  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower]
  if (/^[a-z0-9]$/i.test(raw)) return raw.toUpperCase()
  const f = /^f(\d{1,2})$/i.exec(raw)
  if (f && FKEY.test(`F${f[1]}`)) return `F${f[1]}`
  return null
}

interface ParsedBinding {
  mod: boolean
  ctrl: boolean
  alt: boolean
  shift: boolean
  key: string
}

function join(p: ParsedBinding): string {
  return [p.mod && 'Mod', p.ctrl && 'Ctrl', p.alt && 'Alt', p.shift && 'Shift', p.key].filter(Boolean).join('+')
}

/** Lee un atajo (normalizado o acelerador de Electron) y lo devuelve normalizado para `platform`; `null` si no es válido. */
export function normalizeBinding(input: string, platform: KbPlatform): string | null {
  if (typeof input !== 'string') return null
  const text = input.trim()
  if (!text || text.length > 60) return null
  // El `+` como tecla (`Mod++`) acaba en `+`; se separa a mano.
  const parts = text.endsWith('++') ? [...text.slice(0, -2).split('+'), '+'] : text.split('+')
  const keyRaw = parts.pop()
  if (keyRaw === undefined || keyRaw === '') return null
  const key = parseKeyToken(keyRaw)
  if (!key) return null
  const p: ParsedBinding = { mod: false, ctrl: false, alt: false, shift: false, key }
  for (const m of parts) {
    switch (m.toLowerCase()) {
      case 'mod':
      case 'cmdorctrl':
      case 'commandorcontrol':
        p.mod = true
        break
      case 'cmd':
      case 'command':
      case 'meta':
      case 'super':
        if (platform === 'mac') p.mod = true
        else return null // la tecla Windows/Super la reserva el sistema
        break
      case 'ctrl':
      case 'control':
        if (platform === 'mac') p.ctrl = true
        else p.mod = true
        break
      case 'alt':
      case 'option':
        p.alt = true
        break
      case 'shift':
        p.shift = true
        break
      default:
        return null
    }
  }
  return join(p)
}

export interface KeyEventLike {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  isComposing?: boolean
  keyCode?: number
  getModifierState?: (key: string) => boolean
}

const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'AltGraph', 'Shift', 'OS', 'CapsLock', 'Fn', 'FnLock'])

function keyTokenOf(e: KeyEventLike): string | null {
  const named = NAMED_CODES[e.code]
  if (named) return named
  if (FKEY.test(e.code)) return e.code
  const digit = /^Digit([0-9])$/.exec(e.code)
  if (digit) return digit[1]
  const k = e.key
  if (k.length === 1) {
    if (/^[a-zA-Z]$/.test(k)) return k.toUpperCase()
    if (/^[0-9]$/.test(k)) return k
    if (k === '+') return 'Plus'
    if (PUNCT_CHARS.has(k)) return k
  }
  // Carácter no ASCII (ç, ñ, Option+tecla, otra distribución): la tecla física.
  const letter = /^Key([A-Z])$/.exec(e.code)
  if (letter) return letter[1]
  return PUNCT_BY_CODE[e.code] ?? null
}

/**
 * KeyboardEvent → atajo normalizado, o `null` si el evento no puede ser un atajo (solo modificadores, composición de IME,
 * tecla muerta, AltGr en Windows/Linux, tecla Windows/Super, tecla desconocida). Es la ÚNICA función que traduce eventos:
 * la usan tanto el grabador de Ajustes como el despachador, así que lo grabado siempre coincide con lo que se pulsa.
 */
export function eventToBinding(e: KeyEventLike, platform: KbPlatform): string | null {
  if (e.isComposing || e.keyCode === 229 || e.key === 'Process' || e.key === 'Dead' || e.key === 'Unidentified') return null
  if (MODIFIER_KEYS.has(e.key)) return null
  const altGr = platform !== 'mac' && e.getModifierState?.('AltGraph') === true
  if (altGr) return null
  if (platform !== 'mac' && e.metaKey) return null
  const key = keyTokenOf(e)
  if (!key) return null
  const p: ParsedBinding = {
    mod: platform === 'mac' ? e.metaKey : e.ctrlKey,
    ctrl: platform === 'mac' ? e.ctrlKey : false,
    alt: e.altKey,
    shift: e.shiftKey,
    key
  }
  return join(p)
}

/** ¿Lleva un modificador «fuerte» (Mod/Ctrl/Alt) o es una tecla de función? Sin ello es un atajo «desnudo» (Esc, Shift+Tab…). */
export function hasStrongModifier(binding: string): boolean {
  const parts = binding.split('+')
  return parts.some((p) => p === 'Mod' || p === 'Ctrl' || p === 'Alt') || FKEY.test(parts[parts.length - 1] ?? '')
}

export function bindingParts(binding: string): { mods: string[]; key: string } {
  const normalized = binding.endsWith('++') ? `${binding.slice(0, -2)}+Plus` : binding
  const parts = normalized.split('+')
  const key = parts.pop() ?? ''
  return { mods: parts, key }
}

const MAC_SYMBOL: Record<string, string> = { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' }
const PC_SYMBOL: Record<string, string> = { Mod: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift' }
const KEY_SYMBOL: Record<string, string> = {
  Enter: '↩',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
  Backspace: '⌫',
  Delete: '⌦',
  Tab: '⇥',
  Plus: '+',
  Escape: 'Esc'
}

/** Teclas para mostrar (`Space` y demás nombres traducibles los resuelve quien llama con `spaceLabel`). */
export function bindingDisplay(binding: string, platform: KbPlatform, spaceLabel = 'Space'): string[] {
  const { mods, key } = bindingParts(binding)
  const table = platform === 'mac' ? MAC_SYMBOL : PC_SYMBOL
  const keyLabel = key === 'Space' ? spaceLabel : (KEY_SYMBOL[key] ?? key)
  return [...mods.map((m) => table[m] ?? m), keyLabel]
}

// ───────────────────────────── combinaciones reservadas ─────────────────────────────

export type ReservedLevel = 'block' | 'warn'
export interface Reserved {
  level: ReservedLevel
  /** Clave i18n del motivo (la lista es por plataforma; los motivos son genéricos). */
  reason: 'system' | 'edit' | 'menu'
}

const RESERVED_MAC: Record<string, Reserved> = {
  'Mod+Q': { level: 'block', reason: 'system' },
  'Mod+Shift+Q': { level: 'block', reason: 'system' },
  'Mod+H': { level: 'block', reason: 'system' },
  'Mod+Alt+H': { level: 'block', reason: 'system' },
  'Mod+M': { level: 'block', reason: 'system' },
  'Mod+Tab': { level: 'block', reason: 'system' },
  'Mod+Shift+Tab': { level: 'block', reason: 'system' },
  'Mod+Space': { level: 'block', reason: 'system' },
  'Mod+Alt+Escape': { level: 'block', reason: 'system' },
  'Mod+Shift+3': { level: 'block', reason: 'system' },
  'Mod+Shift+4': { level: 'block', reason: 'system' },
  'Mod+Shift+5': { level: 'block', reason: 'system' },
  'Ctrl+Space': { level: 'block', reason: 'system' },
  'Mod+C': { level: 'block', reason: 'edit' },
  'Mod+V': { level: 'block', reason: 'edit' },
  'Mod+X': { level: 'block', reason: 'edit' },
  'Mod+A': { level: 'block', reason: 'edit' },
  'Mod+Z': { level: 'block', reason: 'edit' },
  'Mod+Shift+Z': { level: 'block', reason: 'edit' },
  'Mod+W': { level: 'warn', reason: 'menu' },
  'Mod+0': { level: 'warn', reason: 'menu' },
  'Mod+-': { level: 'warn', reason: 'menu' },
  'Mod+=': { level: 'warn', reason: 'menu' },
  'Mod+Shift+=': { level: 'warn', reason: 'menu' }
}

const RESERVED_PC: Record<string, Reserved> = {
  'Alt+F4': { level: 'block', reason: 'system' },
  'Alt+Tab': { level: 'block', reason: 'system' },
  'Alt+Shift+Tab': { level: 'block', reason: 'system' },
  'Alt+Space': { level: 'block', reason: 'system' },
  'Alt+Escape': { level: 'block', reason: 'system' },
  'Mod+Alt+Delete': { level: 'block', reason: 'system' },
  'Mod+Shift+Escape': { level: 'block', reason: 'system' },
  'Mod+Escape': { level: 'block', reason: 'system' },
  'Mod+Alt+Tab': { level: 'block', reason: 'system' },
  'Mod+C': { level: 'block', reason: 'edit' },
  'Mod+V': { level: 'block', reason: 'edit' },
  'Mod+X': { level: 'block', reason: 'edit' },
  'Mod+A': { level: 'block', reason: 'edit' },
  'Mod+Z': { level: 'block', reason: 'edit' },
  'Mod+Y': { level: 'block', reason: 'edit' },
  'Mod+Shift+Z': { level: 'block', reason: 'edit' },
  'Mod+W': { level: 'warn', reason: 'menu' },
  'Mod+0': { level: 'warn', reason: 'menu' },
  'Mod+-': { level: 'warn', reason: 'menu' },
  'Mod+=': { level: 'warn', reason: 'menu' },
  'Mod+Shift+=': { level: 'warn', reason: 'menu' },
  F11: { level: 'warn', reason: 'menu' }
}

/** ¿Combinación del sistema o del menú de la aplicación? `block` = no se admite; `warn` = se avisa y se deja asignar. */
export function reservedFor(binding: string, platform: KbPlatform): Reserved | null {
  return (platform === 'mac' ? RESERVED_MAC : RESERVED_PC)[binding] ?? null
}

// ───────────────────────────── registro de acciones ─────────────────────────────

export type KbCategory = 'navigation' | 'conversation' | 'code' | 'window'
export const KB_CATEGORIES: readonly KbCategory[] = ['navigation', 'conversation', 'code', 'window']

/**
 * Dónde puede dispararse un atajo «desnudo» (sin Mod/Ctrl/Alt) respecto al foco: `composer` solo en el compositor;
 * `composerOrIdle` en el compositor o con el foco fuera de cualquier campo de texto. Los atajos con modificador fuerte
 * se disparan en cualquier sitio (como siempre: ⌘K funciona con el cursor en un campo).
 */
export type BareScope = 'composer' | 'composerOrIdle'

export interface ActionMeta {
  /** Id estable (se guarda en las preferencias): NO se renombra. */
  id: string
  category: KbCategory
  nameKey: MsgKey
  /** Atajo por defecto (puede escribirse con alias de Electron); `null` = sin atajo. */
  defaultBinding: string | null
  /** Si lo declara, admite un atajo desnudo con ese alcance; si no, el atajo debe llevar modificador o ser F1–F12. */
  bare?: BareScope
  /** Acciones que comparten atajo por diseño porque solo una está disponible a la vez (no cuentan como conflicto). */
  exclusiveWith?: readonly string[]
}

export const ACTIONS: readonly ActionMeta[] = [
  {
    id: 'palette.toggle',
    category: 'window',
    nameKey: 'settings.shortcuts.app.palette',
    defaultBinding: 'Mod+K',
    exclusiveWith: ['code.sessionSwitcher']
  },
  { id: 'palette.alt', category: 'window', nameKey: 'settings.shortcuts.app.paletteCode', defaultBinding: 'Mod+Shift+P' },
  { id: 'sidebar.toggle', category: 'window', nameKey: 'settings.shortcuts.app.sidebar', defaultBinding: 'Mod+\\' },
  { id: 'settings.toggle', category: 'window', nameKey: 'settings.shortcuts.app.settings', defaultBinding: 'Mod+,' },
  { id: 'mode.next', category: 'navigation', nameKey: 'settings.shortcuts.app.switchMode', defaultBinding: 'Ctrl+Tab' },
  { id: 'mode.prev', category: 'navigation', nameKey: 'settings.shortcuts.act.modePrev', defaultBinding: 'Ctrl+Shift+Tab' },
  { id: 'mode.chat', category: 'navigation', nameKey: 'settings.shortcuts.act.modeChat', defaultBinding: null },
  { id: 'mode.code', category: 'navigation', nameKey: 'settings.shortcuts.act.modeCode', defaultBinding: null },
  { id: 'mode.tasks', category: 'navigation', nameKey: 'settings.shortcuts.act.modeTasks', defaultBinding: null },
  { id: 'mode.routines', category: 'navigation', nameKey: 'settings.shortcuts.act.modeRoutines', defaultBinding: null },
  { id: 'conversation.new', category: 'conversation', nameKey: 'settings.shortcuts.app.new', defaultBinding: 'Mod+N' },
  { id: 'composer.focus', category: 'conversation', nameKey: 'settings.shortcuts.act.composerFocus', defaultBinding: null },
  {
    id: 'session.stop',
    category: 'conversation',
    nameKey: 'settings.shortcuts.act.stop',
    defaultBinding: 'Escape',
    bare: 'composerOrIdle'
  },
  {
    id: 'code.togglePlanBuild',
    category: 'code',
    nameKey: 'settings.shortcuts.act.planBuild',
    defaultBinding: 'Shift+Tab',
    bare: 'composer'
  },
  { id: 'code.setPlan', category: 'code', nameKey: 'settings.shortcuts.act.plan', defaultBinding: null },
  { id: 'code.setBuild', category: 'code', nameKey: 'settings.shortcuts.act.build', defaultBinding: null },
  {
    id: 'code.sessionSwitcher',
    category: 'code',
    nameKey: 'settings.shortcuts.act.sessionSwitcher',
    defaultBinding: 'Mod+K',
    exclusiveWith: ['palette.toggle']
  },
  { id: 'code.panel.changes', category: 'code', nameKey: 'settings.shortcuts.act.panelChanges', defaultBinding: 'Mod+1' },
  { id: 'code.panel.terminal', category: 'code', nameKey: 'settings.shortcuts.act.panelTerminal', defaultBinding: 'Mod+2' },
  { id: 'code.panel.files', category: 'code', nameKey: 'settings.shortcuts.act.panelFiles', defaultBinding: 'Mod+3' },
  { id: 'code.panel.browser', category: 'code', nameKey: 'settings.shortcuts.act.panelBrowser', defaultBinding: 'Mod+4' }
]

export const ACTIONS_BY_ID: Readonly<Record<string, ActionMeta>> = Object.fromEntries(ACTIONS.map((a) => [a.id, a]))

/** Atajo por defecto de una acción, normalizado para la plataforma. */
export function defaultBindingOf(action: ActionMeta, platform: KbPlatform): string | null {
  return action.defaultBinding ? normalizeBinding(action.defaultBinding, platform) : null
}

/**
 * Atajo efectivo de cada acción: el override del usuario (normalizado; `null` = desactivado; si es inválido se ignora y
 * vale el de por defecto) o el de por defecto.
 */
export function effectiveBindings(overrides: KeybindingOverrides | undefined, platform: KbPlatform): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const a of ACTIONS) {
    const ov = overrides && Object.prototype.hasOwnProperty.call(overrides, a.id) ? overrides[a.id] : undefined
    if (ov === null) out[a.id] = null
    else if (typeof ov === 'string') out[a.id] = normalizeBinding(ov, platform) ?? defaultBindingOf(a, platform)
    else out[a.id] = defaultBindingOf(a, platform)
  }
  return out
}

/** Acciones (distintas de `actionId`) que ya usan `binding`; ignora las que comparten atajo por diseño. */
export function findConflicts(binding: string, actionId: string, effective: Record<string, string | null>): ActionMeta[] {
  const me = ACTIONS_BY_ID[actionId]
  return ACTIONS.filter((a) => {
    if (a.id === actionId || effective[a.id] !== binding) return false
    if (me?.exclusiveWith?.includes(a.id) || a.exclusiveWith?.includes(actionId)) return false
    return true
  })
}

/** Acciones cuyo atajo efectivo es `binding` (candidatas a ejecutarse con ese evento; las no disponibles las descarta quien llama). */
export function actionsFor(binding: string, effective: Record<string, string | null>): ActionMeta[] {
  return ACTIONS.filter((a) => effective[a.id] === binding)
}

export type ValidationResult =
  | { ok: true; binding: string; conflicts: ActionMeta[]; reserved: Reserved | null; sameAsQuickEntry: boolean }
  | { ok: false; error: 'invalid' | 'needsModifier' | 'blocked'; reserved?: Reserved }

/** Valida un atajo candidato para una acción: forma, modificador, reservadas del sistema y conflictos. */
export function validateBinding(
  candidate: string,
  actionId: string,
  effective: Record<string, string | null>,
  platform: KbPlatform,
  quickEntryAccelerator?: string
): ValidationResult {
  const binding = normalizeBinding(candidate, platform)
  if (!binding) return { ok: false, error: 'invalid' }
  const action = ACTIONS_BY_ID[actionId]
  if (!action) return { ok: false, error: 'invalid' }
  if (!hasStrongModifier(binding) && !action.bare) return { ok: false, error: 'needsModifier' }
  const reserved = reservedFor(binding, platform)
  if (reserved?.level === 'block') return { ok: false, error: 'blocked', reserved }
  const quick = quickEntryAccelerator ? normalizeBinding(quickEntryAccelerator, platform) : null
  return {
    ok: true,
    binding,
    conflicts: findConflicts(binding, actionId, effective),
    reserved,
    sameAsQuickEntry: !!quick && quick === binding
  }
}

/** Depura los overrides leídos del disco o de IPC: solo ids con forma válida y valores `null` o atajos normalizables. */
export function sanitizeOverrides(raw: unknown, platform: KbPlatform): KeybindingOverrides {
  const out: KeybindingOverrides = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  let n = 0
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= 100) break
    if (!/^[A-Za-z][A-Za-z0-9.]{0,79}$/.test(id) || id === 'constructor' || id === 'prototype') continue
    if (v === null) out[id] = null
    else if (typeof v === 'string') {
      const norm = normalizeBinding(v, platform)
      if (norm) out[id] = norm
    } else continue
    n++
  }
  return out
}

/** Contexto del foco para decidir si un atajo desnudo puede dispararse. */
export type FocusKind = 'composer' | 'editable' | 'idle'

/** ¿Puede dispararse `action` con `binding` estando el foco en `focus`? */
export function allowedAtFocus(action: ActionMeta, binding: string, focus: FocusKind): boolean {
  if (hasStrongModifier(binding)) return true
  if (action.bare === 'composer') return focus === 'composer'
  if (action.bare === 'composerOrIdle') return focus !== 'editable'
  return false
}

// ───────────────────────────── edición de overrides (puras) ─────────────────────────────

/**
 * Overrides tras asignar `binding` a `actionId`. Si coincide con el atajo por defecto de la acción se borra el override
 * (queda «por defecto»). `takeFrom` son las acciones en conflicto que ceden el atajo: quedan desactivadas (`null`) o,
 * si el atajo era el suyo por defecto y se les quita, también `null` (nunca se les asigna otro en silencio).
 */
export function withBinding(
  overrides: KeybindingOverrides,
  actionId: string,
  binding: string,
  platform: KbPlatform,
  takeFrom: readonly string[] = []
): KeybindingOverrides {
  const next: KeybindingOverrides = { ...overrides }
  for (const id of takeFrom) next[id] = null
  const action = ACTIONS_BY_ID[actionId]
  if (action && defaultBindingOf(action, platform) === binding) delete next[actionId]
  else next[actionId] = binding
  return next
}

/** Overrides con la acción desactivada (`null`); si ya no tenía atajo por defecto, simplemente sin override. */
export function withDisabled(overrides: KeybindingOverrides, actionId: string, platform: KbPlatform): KeybindingOverrides {
  const next: KeybindingOverrides = { ...overrides }
  const action = ACTIONS_BY_ID[actionId]
  if (action && defaultBindingOf(action, platform) === null) delete next[actionId]
  else next[actionId] = null
  return next
}

/** Overrides sin el de esta acción (vuelve a su atajo por defecto). */
export function withReset(overrides: KeybindingOverrides, actionId: string): KeybindingOverrides {
  const next: KeybindingOverrides = { ...overrides }
  delete next[actionId]
  return next
}

/** ¿Cambia el atajo efectivo de la acción respecto al de por defecto? */
export function isCustomized(overrides: KeybindingOverrides, actionId: string): boolean {
  return Object.prototype.hasOwnProperty.call(overrides, actionId)
}
