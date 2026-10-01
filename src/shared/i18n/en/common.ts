import type { Messages } from '../index'
import type { common as es } from '../es/common'

export const common = {
  'labels.mode.chat': 'Chat',
  'labels.mode.code': 'Code',
  'labels.mode.tasks': 'Tasks',
  'labels.mode.routines': 'Routines',
  'labels.ui.task': 'task',
  'labels.ui.network': 'Sandbox network',
  'labels.ui.htmlPreview': 'Preview',
  'labels.ui.openHtmlPreview': 'Open preview',
  'labels.ui.guideMode': 'Guide mode',
  'labels.ui.computer': 'Mac control',
  'labels.ui.autoMode': 'Auto mode'
} as const satisfies Messages<typeof es>
