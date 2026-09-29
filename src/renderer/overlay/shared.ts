/** Utilidades compartidas por el overlay de control y la píldora. */
import type { ComputerActionEvent, TasksApi } from '@shared/ipc-tasks'

export const tasks = (window as unknown as { api?: { tasks?: TasksApi } }).api?.tasks

export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

const KEY_GLYPHS: Record<string, string> = {
  cmd: '⌘',
  command: '⌘',
  meta: '⌘',
  super: '⌘',
  shift: '⇧',
  alt: '⌥',
  option: '⌥',
  opt: '⌥',
  ctrl: '⌃',
  control: '⌃',
  fn: 'fn',
  return: '↩',
  enter: '↩',
  tab: '⇥',
  space: 'Espacio',
  delete: '⌫',
  backspace: '⌫',
  forwarddelete: '⌦',
  escape: 'esc',
  esc: 'esc',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  pageup: 'RePág',
  pagedown: 'AvPág',
  home: 'Inicio',
  end: 'Fin'
}

/** "cmd+shift+t return" → "⌘⇧T ↩". */
export function formatKeys(keys: string): string {
  return keys
    .trim()
    .split(/\s+/)
    .map((combo) =>
      combo
        .split('+')
        .map((k) => {
          const l = k.toLowerCase()
          return KEY_GLYPHS[l] ?? (l.length === 1 ? l.toUpperCase() : l.toUpperCase())
        })
        .join('')
    )
    .join(' ')
}

function clip(s: string, n: number): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}

const SCROLL_DIR: Record<string, string> = { up: 'arriba', down: 'abajo', left: 'la izquierda', right: 'la derecha' }

/** Etiqueta corta junto al cursor. */
export function shortLabel(ev: ComputerActionEvent): string {
  switch (ev.tool) {
    case 'left_click':
      return 'Clic'
    case 'right_click':
      return 'Clic derecho'
    case 'double_click':
      return 'Doble clic'
    case 'mouse_move':
      return 'Moviendo'
    case 'drag':
      return 'Arrastrando'
    case 'scroll':
      return 'Desplazando'
    case 'type_text':
      return 'Escribiendo…'
    case 'key':
      return ev.text ? formatKeys(ev.text) : 'Teclas'
    case 'open_application':
      return ev.text ? `Abriendo ${clip(ev.text, 24)}` : 'Abriendo app'
    case 'wait':
      return 'Esperando…'
    case 'screenshot':
      return 'Captura'
    default:
      return clip(ev.tool.replace(/_/g, ' '), 24)
  }
}

/** Texto del paso actual para la píldora. */
export function describeStep(ev: ComputerActionEvent): string {
  switch (ev.tool) {
    case 'left_click':
      return 'Haciendo clic'
    case 'right_click':
      return 'Haciendo clic derecho'
    case 'double_click':
      return 'Haciendo doble clic'
    case 'mouse_move':
      return 'Moviendo el puntero'
    case 'drag':
      return 'Arrastrando'
    case 'scroll': {
      const dir = (ev.text ?? '').split(' ')[0]
      return SCROLL_DIR[dir] ? `Desplazando hacia ${SCROLL_DIR[dir]}` : 'Desplazando'
    }
    case 'type_text':
      return ev.text ? `Escribiendo “${clip(ev.text, 48)}”` : 'Escribiendo'
    case 'key':
      return ev.text ? `Pulsando ${formatKeys(ev.text)}` : 'Pulsando teclas'
    case 'open_application':
      return ev.text ? `Abriendo ${clip(ev.text, 40)}` : 'Abriendo una app'
    case 'wait':
      return ev.text ? `Esperando ${ev.text.replace('s', ' s')}` : 'Esperando'
    case 'screenshot':
      return 'Mirando la pantalla'
    default:
      return clip(ev.tool.replace(/_/g, ' '), 48)
  }
}
