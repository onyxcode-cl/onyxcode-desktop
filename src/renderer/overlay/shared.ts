/** Utilidades compartidas por el overlay de control y la píldora. */
import type { ComputerActionEvent, TasksApi } from '@shared/ipc-tasks'
import { t, type MsgKey } from '@shared/i18n'

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
  arrowright: '→'
}

/** Teclas con nombre en el idioma activo. */
const KEY_NAMES: Record<string, MsgKey> = {
  space: 'ovl.key.space',
  pageup: 'ovl.key.pageup',
  pagedown: 'ovl.key.pagedown',
  home: 'ovl.key.home',
  end: 'ovl.key.end'
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
          return KEY_GLYPHS[l] ?? (KEY_NAMES[l] ? t(KEY_NAMES[l]) : l.toUpperCase())
        })
        .join('')
    )
    .join(' ')
}

function clip(s: string, n: number): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}

const SCROLL_DIR: Record<string, MsgKey> = { up: 'ovl.dir.up', down: 'ovl.dir.down', left: 'ovl.dir.left', right: 'ovl.dir.right' }

/** Etiqueta corta junto al cursor. */
export function shortLabel(ev: ComputerActionEvent): string {
  switch (ev.tool) {
    case 'left_click':
      return t('ovl.short.click')
    case 'right_click':
      return t('ovl.short.rightClick')
    case 'double_click':
      return t('ovl.short.doubleClick')
    case 'mouse_move':
      return t('ovl.short.move')
    case 'drag':
      return t('ovl.short.drag')
    case 'scroll':
      return t('ovl.short.scroll')
    case 'type_text':
      return t('ovl.short.type')
    case 'key':
      return ev.text ? formatKeys(ev.text) : t('ovl.short.keys')
    case 'open_application':
      return ev.text ? t('ovl.short.openApp', { app: clip(ev.text, 24) }) : t('ovl.short.openAppNoName')
    case 'wait':
      return t('ovl.short.wait')
    case 'screenshot':
      return t('ovl.short.screenshot')
    default:
      return clip(ev.tool.replace(/_/g, ' '), 24)
  }
}

/** Texto del paso actual para la píldora. */
export function describeStep(ev: ComputerActionEvent): string {
  switch (ev.tool) {
    case 'left_click':
      return t('ovl.step.click')
    case 'right_click':
      return t('ovl.step.rightClick')
    case 'double_click':
      return t('ovl.step.doubleClick')
    case 'mouse_move':
      return t('ovl.step.move')
    case 'drag':
      return t('ovl.step.drag')
    case 'scroll': {
      const dir = (ev.text ?? '').split(' ')[0]
      return SCROLL_DIR[dir] ? t('ovl.step.scrollDir', { dir: t(SCROLL_DIR[dir]) }) : t('ovl.step.scroll')
    }
    case 'type_text':
      return ev.text ? t('ovl.step.typeText', { text: clip(ev.text, 48) }) : t('ovl.step.type')
    case 'key':
      return ev.text ? t('ovl.step.pressKeys', { keys: formatKeys(ev.text) }) : t('ovl.step.press')
    case 'open_application':
      return ev.text ? t('ovl.step.openApp', { app: clip(ev.text, 40) }) : t('ovl.step.openAnApp')
    case 'wait':
      return ev.text ? t('ovl.step.waitFor', { time: ev.text.replace('s', ' s') }) : t('ovl.step.wait')
    case 'screenshot':
      return t('ovl.step.look')
    default:
      return clip(ev.tool.replace(/_/g, ' '), 48)
  }
}
