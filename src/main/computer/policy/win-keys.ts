/**
 * Política pura de combinaciones de teclas del helper de Windows (`key`). Sin Electron ni Node.
 * Plan C §3 «Combinaciones de teclas». Falla cerrado: lo que no se entiende se rechaza.
 */

export const WIN_STOP_SHORTCUT = 'ctrl+alt+shift+escape'

export type KeyRejection = 'cmd' | 'blocked' | 'win' | 'stop' | 'foreground' | 'invalid'

export type KeyVerdict = { ok: true; combo: string } | { ok: false; code: KeyRejection; reason: string; combo: string }

export interface KeyPolicyContext {
  /** Lazunox es la ventana en primer plano (alt+f4 y ctrl+w cerrarían la app). */
  lazunoxFrontmost?: boolean
  /** Atajo de parada vigente (por defecto `WIN_STOP_SHORTCUT`). */
  stopShortcut?: string
}

const MOD_ALIASES: Record<string, string> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  shift: 'shift',
  alt: 'alt',
  option: 'alt',
  win: 'win',
  windows: 'win',
  lwin: 'win',
  rwin: 'win',
  meta: 'win',
  super: 'win'
}
const MOD_ORDER = ['ctrl', 'alt', 'shift', 'win']
const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  delete: 'del',
  return: 'enter',
  spacebar: 'space',
  ' ': 'space',
  pgup: 'pageup',
  pgdn: 'pagedown',
  pagedn: 'pagedown',
  ins: 'insert'
}
const MAC_ONLY = new Set(['cmd', 'command'])
const WIN_ALLOWED_KEYS = new Set(['d', 'e', 's'])
const KEY_NAME =
  /^[a-z0-9]$|^(f([1-9]|1[0-9]|2[0-4])|escape|enter|tab|space|backspace|del|insert|home|end|pageup|pagedown|up|down|left|right|plus|minus|comma|period|slash|backslash|semicolon|quote|backquote|bracketleft|bracketright|equal|capslock|printscreen|pause|menu|numlock|scrolllock|[-=,./;'`\\[\]+])$/

export interface ParsedCombo {
  mods: string[]
  key: string
  /** Se pidió un modificador de macOS (`cmd`/`command`). */
  macMod: boolean
}

/** Parte `ctrl+shift+t` en modificadores canónicos (ordenados) y tecla. Devuelve null si no se entiende. */
export function parseCombo(raw: string): ParsedCombo | null {
  const text = raw.trim().toLowerCase()
  if (!text || text.length > 64) return null
  let tokens: string[]
  if (text.endsWith('++')) tokens = [...text.slice(0, -2).split('+'), '+']
  else if (text === '+') tokens = ['+']
  else tokens = text.split('+')
  if (tokens.some((t) => t.trim() === '' && t !== '+')) return null
  tokens = tokens.map((t) => (t === '+' ? t : t.trim()))
  const mods = new Set<string>()
  let macMod = false
  let key = ''
  let invalid = false
  tokens.forEach((t, i) => {
    const last = i === tokens.length - 1
    if (MAC_ONLY.has(t)) macMod = true
    else if (MOD_ALIASES[t]) mods.add(MOD_ALIASES[t])
    else if (last) key = KEY_ALIASES[t] ?? t
    else invalid = true
  })
  if (invalid) return null
  if (key !== '' && !KEY_NAME.test(key)) return null
  return { mods: MOD_ORDER.filter((m) => mods.has(m)), key, macMod }
}

const fmt = (p: ParsedCombo): string => [...p.mods, ...(p.key ? [p.key] : [])].join('+')
const same = (p: ParsedCombo, mods: string[], key: string): boolean =>
  p.key === key && p.mods.length === mods.length && mods.every((m) => p.mods.includes(m))

/** Evalúa UNA combinación (sin espacios). */
export function checkCombo(raw: string, ctx: KeyPolicyContext = {}): KeyVerdict {
  const p = parseCombo(raw)
  if (!p) return { ok: false, code: 'invalid', reason: `Combinación de teclas no válida: «${raw.slice(0, 40)}»`, combo: '' }
  const combo = fmt(p)
  if (p.macMod) return { ok: false, code: 'cmd', reason: 'En Windows usa ctrl', combo: raw.trim().toLowerCase() }
  const no = (code: KeyRejection, reason: string): KeyVerdict => ({ ok: false, code, reason, combo })
  const stop = parseCombo(ctx.stopShortcut ?? WIN_STOP_SHORTCUT)
  if (stop && same(p, stop.mods, stop.key)) return no('stop', 'Ese atajo es el de parada de Lazunox: no se puede pulsar')
  if (same(p, ['ctrl', 'alt'], 'del')) return no('blocked', 'Ctrl+Alt+Supr está reservado al usuario')
  if (same(p, ['ctrl', 'shift'], 'escape')) return no('blocked', 'Ctrl+Mayús+Esc abre el Administrador de tareas: lo hace el usuario')
  if (p.mods.includes('win')) {
    if (p.mods.length === 1 && WIN_ALLOWED_KEYS.has(p.key)) return { ok: true, combo }
    if (same(p, ['win'], 'r')) return no('blocked', 'Win+R (Ejecutar) lo abre el usuario')
    if (same(p, ['win'], 'x')) return no('blocked', 'Win+X lo abre el usuario')
    if (same(p, ['win'], 'l')) return no('blocked', 'Win+L bloquea la sesión: lo hace el usuario')
    return no('win', 'Solo se permiten Win+D, Win+E y Win+S entre las combinaciones con la tecla Windows')
  }
  if (ctx.lazunoxFrontmost && (same(p, ['alt'], 'f4') || same(p, ['ctrl'], 'w'))) {
    return no('foreground', 'Con Lazunox en primer plano, ese atajo cerraría la aplicación')
  }
  return { ok: true, combo }
}

export type KeysVerdict = { ok: true; combos: string[] } | { ok: false; code: KeyRejection; reason: string; combo: string }

/** Evalúa el argumento de `key`: varias combinaciones separadas por espacios (como el helper de macOS). */
export function checkKeys(input: string, ctx: KeyPolicyContext = {}): KeysVerdict {
  const parts = input.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { ok: false, code: 'invalid', reason: 'Falta la combinación de teclas', combo: '' }
  if (parts.length > 16) return { ok: false, code: 'invalid', reason: 'Demasiadas combinaciones en una llamada', combo: '' }
  const combos: string[] = []
  for (const part of parts) {
    const v = checkCombo(part, ctx)
    if (!v.ok) return v
    combos.push(v.combo)
  }
  return { ok: true, combos }
}
