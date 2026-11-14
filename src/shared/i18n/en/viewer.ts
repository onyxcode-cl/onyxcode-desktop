import type { Messages } from '../index'
import type { viewer as es } from '../es/viewer'

export const viewer = {
  'viewer.pptx.present': 'Present',
  'viewer.pptx.preview': 'View',
  'viewer.pptx.busy': 'Preparing…',
  'viewer.pptx.failed': 'The presentation could not be opened.',
  'viewer.pptx.note':
    'This presents a static visual copy: review the slides before projecting; animations, video and audio are not played.',
  'viewer.pptx.invalid': 'The file is not a valid PowerPoint .pptx or contains no slides. Legacy .ppt files cannot be presented here.',
  'viewer.pptx.limit': 'This presentation exceeds {n} slides. Split it into smaller presentations.',
  'viewer.pptx.incomplete':
    'Some slides could not be rendered: expected {expected}, received {actual}. An incomplete presentation was not opened.',
  'viewer.pptx.slideFailed': 'Slide {n} could not be rendered.',
  'viewer.pptx.weight': 'This presentation exceeds the projection memory limit. Split it into smaller presentations.',
  'viewer.pptx.noEngine': 'Install the document designer in Settings to present this PowerPoint.',
  'viewer.pptx.renderFailed': 'The full PowerPoint could not be rendered. Check the file or save it as PDF from its original program.',
  'viewer.tab': 'Document',
  'viewer.loading': 'Opening preview…',
  'viewer.ready': 'Preview ready. If you cannot see the document, open it with the system app.',
  'viewer.fallback': 'Fallback viewer loaded. If you cannot see the document, open it with the system app.',
  'viewer.timeout': 'The preview did not respond within 8 seconds. You can open the file with the system app.',
  'viewer.openSystem': 'Open with the system app',
  'viewer.systemFailed': 'Could not open the file with the system app. Check that you have an app for this file type.'
} satisfies Messages<typeof es>
