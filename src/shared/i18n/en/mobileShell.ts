import type { Messages } from '../index'
import type { mobileShell as es } from '../es/mobileShell'

export const mobileShell = {
  'mobile.sheet.close': 'Close',
  'mobile.sheet.grab': 'Drag down to close'
} as const satisfies Messages<typeof es>
