import type { Messages } from '../index'
import type { main as es } from '../es/main'

export const main = {
  'main.tray.newConversation': 'New conversation',
  'main.tray.quickEntry': 'Quick Entry',
  'main.tray.openApp': 'Open {app}',
  'main.tray.settings': 'Settings…',
  'main.tray.quit': 'Quit {app}',
  'main.menu.view': 'View',
  'main.menu.about': 'About {app}',
  'main.menu.hide': 'Hide {app}',
  'main.menu.quit': 'Quit {app}',
  'main.menu.file': 'File',
  'main.menu.exit': 'Exit',
  'main.menu.edit': 'Edit',
  'main.menu.undo': 'Undo',
  'main.menu.redo': 'Redo',
  'main.menu.cut': 'Cut',
  'main.menu.copy': 'Copy',
  'main.menu.paste': 'Paste',
  'main.menu.selectAll': 'Select all',
  'main.menu.resetZoom': 'Actual size',
  'main.menu.zoomIn': 'Zoom in',
  'main.menu.zoomOut': 'Zoom out',
  'main.menu.fullscreen': 'Full screen',
  'main.menu.window': 'Window',
  'main.menu.minimize': 'Minimize',
  'main.menu.closeWindow': 'Close window',
  'main.menu.help': 'Help'
} as const satisfies Messages<typeof es>
