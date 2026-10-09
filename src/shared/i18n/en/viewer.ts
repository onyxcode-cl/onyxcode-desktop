import type { Messages } from '../index'
import type { viewer as es } from '../es/viewer'

export const viewer = {
  'viewer.tab': 'Document'
} satisfies Messages<typeof es>
