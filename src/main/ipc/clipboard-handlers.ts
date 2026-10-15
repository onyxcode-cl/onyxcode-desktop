import { clipboard, nativeImage, type IpcMain } from 'electron'
import { t } from '@shared/i18n'
import { readPasteFiles, type ClipboardReader } from '../clipboard/paste-files'
import { handle, IpcError } from './handle'
import { windowOfSender } from './sender-window'

async function clipboardItems(): Promise<Electron.ClipboardItem[]> {
  try {
    return await clipboard.read()
  } catch {
    return []
  }
}

/**
 * Portapapeles real de Electron 44 (API asíncrona) como lector. Los formatos nativos de Finder/Explorador se piden
 * por su nombre y, si no, con la clave `electron application/osclipboard;format="…"`.
 */
export const electronClipboardReader: ClipboardReader = {
  async readRaw(format) {
    const keys = [format, `electron application/osclipboard;format="${format}"`]
    const items = await clipboardItems()
    for (const key of keys) {
      for (const item of items) {
        try {
          const blob = (await item.getType(key)) as Blob
          return Buffer.from(await blob.arrayBuffer())
        } catch {
          /* este elemento no trae ese formato */
        }
      }
    }
    return null
  },
  async readImagePng() {
    for (const item of await clipboardItems()) {
      const type = item.types.find((x) => x.startsWith('image/'))
      if (!type) continue
      try {
        const buf = Buffer.from(await ((await item.getType(type)) as Blob).arrayBuffer())
        if (type === 'image/png') return buf
        const img = nativeImage.createFromBuffer(buf)
        return img.isEmpty() ? null : img.toPNG()
      } catch {
        /* siguiente elemento */
      }
    }
    return null
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
