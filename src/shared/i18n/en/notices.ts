import type { Messages } from '../index'
import type { notices as es } from '../es/notices'

export const notices = {
  'notices.close': 'Dismiss',
  'notices.quick.title': 'Couldn’t send your quick message.',
  'notices.quick.body': 'Your text is still in the Chat message box. {reason}',
  'notices.quick.connect': 'Connect an AI',
  'notices.update.available': 'A new version of {app} is available ({version}).',
  'notices.update.checkFailed': 'Couldn’t check right now. Try again later.',
  'notices.update.newVersion': 'A new version is available: {version}',
  'notices.update.upToDate': 'You’re up to date.',
  'notices.update.lastNever': 'Last checked: not yet.',
  'notices.update.lastCheck': 'Last checked: {date}',
  'notices.update.later': 'Later',
  'notices.update.downloading': 'Downloading {app} {version}…',
  'notices.update.verifying': 'Verifying the download…',
  'notices.update.ready': '{app} {version} is ready: restart to finish updating.',
  'notices.update.restartNow': 'Restart now',
  'notices.update.installing': 'Installing the update…',
  'notices.update.restarting': 'Restarting {app}…',
  'notices.update.downloadManual': 'Download manually',
  'notices.update.install': 'Update',
  'notices.update.download': 'Download',
  'notices.engine.bundled': 'bundled',
  'notices.engine.cli': 'your CLI',
  'notices.engine.custom': 'custom path',
  'notices.engine.mismatch':
    'You’re using OpenCode {version}; {app} was tested with {sdk}. If something breaks, switch to the bundled engine.',
  'notices.updateError.network': 'Couldn’t download the update. Check your connection.',
  'notices.updateError.signature': 'The update failed the authenticity check and was discarded.',
  'notices.updateError.downgrade': 'The offered update isn’t newer than the installed version and was discarded.',
  'notices.updateError.mismatch': 'The downloaded file doesn’t match what was published and was discarded.',
  'notices.updateError.invalid': 'The downloaded package isn’t valid and was discarded.',
  'notices.updateError.space': 'There isn’t enough free space to update.',
  'notices.updateError.location': 'This copy of the app can’t update itself from here.',
  'notices.updateError.rolledBack': 'The new version didn’t start properly, so the previous one was restored.',
  'notices.updateError.install': 'Couldn’t install the update. Your current version is untouched.',
  'notices.updateError.generic': 'Couldn’t update.',
  // macOS-only features: notice in Settings and on saved routines (Windows)
  'platform.win.unavailable.title': 'Not available on Windows yet',
  'platform.win.unavailable.tasks': '{tasks} mode (autonomous work in a sandbox) is not available on Windows yet.',
  'platform.win.unavailable.computer': '{computer} (using the mouse, keyboard and apps for you) is not available on Windows yet.',
  'platform.win.unavailable.update': 'Automatic updates are not available on Windows: install new versions by downloading them yourself.',
  'platform.win.unavailable.routine':
    'This routine uses {tasks} mode, which is not available on Windows yet: it will not run. You can recreate it in Code mode.',
  'platform.win.unavailable.routineBadge': 'Not available on Windows'
} as const satisfies Messages<typeof es>
