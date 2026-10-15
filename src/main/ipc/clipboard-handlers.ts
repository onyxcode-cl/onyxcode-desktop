import { clipboard, type IpcMain } from 'electron'
import { t } from '@shared/i18n'
import { readPasteFiles, type ClipboardReader } from '../clipboard/paste-files'
import { handle, IpcError } from './handle'
import { windowOfSender } from './sender-window'

/** Portapapeles real de Electron como lector (formatos de Finder/Explorador y la imagen como PNG). */
export const electronClipboardReader: ClipboardReader = {
  availableFormats: () => clipboard.availableFormats(),
  readFormat: (format) => clipboard.read(format),
  readBuffer: (format) => clipboard.readBuffer(format),
  readImagePng: () => {
    const img = clipboard.readImage()
    return img.isEmpty() ? null : img.toPNG()
  }
}

/**
 * `clipboard:readFilesForPaste`: respaldo del pegado cuando el evento `paste` no trae archivos. Solo la ventana
 * que tiene el foco (el pegado es un gesto del usuario en esa ventana); el celular lo tiene prohibido por política.
 */
export function registerClipboardHandlers(ipcMain: IpcMain): void {
  handle(ipcMain, 'clipboard:readFilesForPaste', async ({ scope }, event) => {
    const win = windowOfSender(event.sender)
    if (!win || !win.isFocused()) throw new IpcError('FORBIDDEN', t('chat.paste.notFocused'))
    return readPasteFiles(electronClipboardReader, scope)
  })
}
