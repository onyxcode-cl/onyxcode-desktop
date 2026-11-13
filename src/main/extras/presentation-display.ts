import { app, BrowserWindow, dialog, screen, type Display } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { t } from '@shared/i18n'

/** Display IDs are Electron's stable identifiers; never persist screen coordinates. */
export async function choosePresentationDisplay(): Promise<Display | null> {
  const displays = screen.getAllDisplays()
  const primary = screen.getPrimaryDisplay()
  if (displays.length < 2) return displays[0] ?? primary
  let lastId: number | undefined
  const file = join(app.getPath('userData'), 'presentation-display.json')
  try {
    const saved = JSON.parse(await readFile(file, 'utf8')) as { displayId?: unknown }
    if (typeof saved.displayId === 'number' && Number.isSafeInteger(saved.displayId)) lastId = saved.displayId
  } catch {
    /* A missing/corrupt preference does not prevent presenting. */
  }
  const labels = displays.map((display, index) => {
    const name = display.label.trim() || t('presentation.screen', { number: index + 1 })
    const width = Math.round(display.size.width * display.scaleFactor)
    const height = Math.round(display.size.height * display.scaleFactor)
    return `${name} · ${width} × ${height}${display.id === primary.id ? t('presentation.primary') : ''}`
  })
  const remembered = displays.findIndex((display) => display.id === lastId)
  const options: Electron.MessageBoxOptions = {
    type: 'question',
    title: t('presentation.chooseTitle'),
    message: t('presentation.chooseMessage'),
    buttons: [...labels, t('presentation.cancel')],
    defaultId:
      remembered >= 0
        ? remembered
        : Math.max(
            0,
            displays.findIndex((display) => display.id === primary.id)
          ),
    cancelId: displays.length,
    noLink: true
  }
  const focused = BrowserWindow.getFocusedWindow()
  const parent =
    focused && !focused.isDestroyed() ? focused : BrowserWindow.getAllWindows().find((win) => !win.isDestroyed() && win.isVisible())
  // Without a live parent, Electron's macOS dialog would block the main event loop.
  if (!parent) return null
  const { response } = await dialog.showMessageBox(parent, options)
  if (parent.isDestroyed()) return null
  if (response < 0 || response >= displays.length) return null
  // A cable may be unplugged while the chooser is open.
  const selected = screen.getAllDisplays().find((display) => display.id === displays[response].id) ?? screen.getPrimaryDisplay()
  try {
    await writeFile(file, JSON.stringify({ displayId: selected.id }), { encoding: 'utf8', mode: 0o600 })
  } catch {
    /* Read-only preferences must not block a presentation. */
  }
  return selected
}

/** Same API on macOS and Windows. Fullscreen must be left before moving to another display. */
export function bindPresentationDisplay(win: BrowserWindow, selected: Display): void {
  let currentId = selected.id
  let moving = false
  let awaitingExit = false
  let pending: Display | null = null
  let timer: NodeJS.Timeout | undefined
  const clearTimer = (): void => {
    if (timer) clearTimeout(timer)
    timer = undefined
  }
  const finishMove = (): void => {
    if (!pending || win.isDestroyed()) return
    const destination = screen.getAllDisplays().find((display) => display.id === pending?.id) ?? screen.getPrimaryDisplay()
    pending = null
    currentId = destination.id
    win.setBounds(destination.bounds)
    win.setFullScreen(true)
    clearTimer()
    // Some window managers do not emit fullscreen transitions. Never wait indefinitely.
    timer = setTimeout(() => {
      moving = false
      timer = undefined
    }, 2000)
  }
  const removed = (_event: Electron.Event, display: Display): void => {
    if (display.id !== currentId || win.isDestroyed()) return
    pending = screen.getPrimaryDisplay()
    moving = true
    clearTimer()
    if (win.isFullScreen()) {
      awaitingExit = true
      timer = setTimeout(finishMove, 2000)
      win.setFullScreen(false)
    } else finishMove()
  }
  const leave = (): void => {
    if (moving || awaitingExit) {
      if (win.isDestroyed()) return
      awaitingExit = false
      moving = true
      // The timeout may have requested entry before a slow OS finished exiting.
      // Reapply the destination after the actual exit, even if pending was consumed.
      pending ??= screen.getAllDisplays().find((display) => display.id === currentId) ?? screen.getPrimaryDisplay()
      finishMove()
      return
    }
    if (win.isDestroyed()) return
    // The OS can leave fullscreen before Electron reports display-removed.
    if (!screen.getAllDisplays().some((display) => display.id === currentId)) {
      moving = true
      pending = screen.getPrimaryDisplay()
      finishMove()
      return
    }
    win.close()
  }
  const enter = (): void => {
    if (!pending) {
      awaitingExit = false
      moving = false
      clearTimer()
    }
  }
  screen.on('display-removed', removed)
  win.on('leave-full-screen', leave)
  win.on('enter-full-screen', enter)
  win.once('closed', () => {
    clearTimer()
    screen.removeListener('display-removed', removed)
    win.removeListener('leave-full-screen', leave)
    win.removeListener('enter-full-screen', enter)
  })
  // Revalidate after HTML/assets have loaded, not just when the dialog returned.
  const connected = screen.getAllDisplays().find((display) => display.id === currentId) ?? screen.getPrimaryDisplay()
  currentId = connected.id
  win.setBounds(connected.bounds)
}
