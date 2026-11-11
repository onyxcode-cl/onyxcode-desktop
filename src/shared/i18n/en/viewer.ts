import type { Messages } from '../index'
import type { viewer as es } from '../es/viewer'

export const viewer = {
  'viewer.tab': 'Document',
  'viewer.loading': 'Opening preview…',
  'viewer.ready': 'Preview ready. If you cannot see the document, open it with the system app.',
  'viewer.fallback': 'Fallback viewer loaded. If you cannot see the document, open it with the system app.',
  'viewer.timeout': 'The preview did not respond within 8 seconds. You can open the file with the system app.',
  'viewer.openSystem': 'Open with the system app',
  'viewer.systemFailed': 'Could not open the file with the system app. Check that you have an app for this file type.'
} satisfies Messages<typeof es>
