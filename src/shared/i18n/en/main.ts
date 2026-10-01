import type { Messages } from '../index'
import type { main as es } from '../es/main'

export const main = {
  'main.tray.newConversation': 'New conversation',
  'main.tray.quickEntry': 'Quick Entry',
  'main.tray.openApp': 'Open {app}',
  'main.tray.settings': 'Settings…',
  'main.tray.quit': 'Quit {app}',
  'main.menu.view': 'View'
} as const satisfies Messages<typeof es>
