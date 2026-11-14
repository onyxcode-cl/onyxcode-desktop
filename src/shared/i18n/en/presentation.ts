import type { Messages } from '../index'
import type { presentation as es } from '../es/presentation'

export const presentation = {
  'presentation.chooseTitle': 'Present',
  'presentation.chooseMessage': 'Which screen would you like to present on?',
  'presentation.screen': 'Screen {number}',
  'presentation.primary': ' (primary)',
  'presentation.cancel': 'Cancel',
  'presentation.counter': 'Slide {current} of {total}',
  'presentation.controls': 'Arrows, space or click to advance · Esc to exit'
} as const satisfies Messages<typeof es>
