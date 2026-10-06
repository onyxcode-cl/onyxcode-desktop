/**
 * Banderas de capacidades que `main` entrega al preload de la ventana principal (`webPreferences.additionalArguments`).
 * Puro. SOLO ayudan a la interfaz a mostrar u ocultar cosas: quien decide de verdad es `main` (canales registrados,
 * `selectBackend`, política de carpetas). Solo se reconocen las banderas conocidas; cualquier otro texto se ignora.
 */
import type { CapsFlags } from './platform-caps'

export const CAPS_ARG_PREFIX = '--lazunox-caps='
const KNOWN = ['tasksWin', 'computerWin', 'remoteWin'] as const

/** `['--lazunox-caps=tasksWin']` si hay alguna encendida; `[]` si no (nada que añadir a la ventana). */
export function capsFlagsToArgs(flags: CapsFlags): string[] {
  const on = KNOWN.filter((k) => flags[k] === true)
  return on.length > 0 ? [`${CAPS_ARG_PREFIX}${on.join(',')}`] : []
}

/** Lee `process.argv` del preload. Ausente, vacío o con basura = todo apagado. */
export function capsFlagsFromArgv(argv: readonly string[]): CapsFlags {
  const arg = [...argv].reverse().find((a) => typeof a === 'string' && a.startsWith(CAPS_ARG_PREFIX))
  const tokens = arg ? arg.slice(CAPS_ARG_PREFIX.length).split(',') : []
  const out: CapsFlags = {}
  for (const k of KNOWN) if (tokens.includes(k)) out[k] = true
  return out
}
