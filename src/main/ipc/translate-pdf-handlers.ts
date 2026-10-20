import { BrowserWindow, type IpcMain } from 'electron'
import { pdfTranslateService } from '../translate-pdf/service'
import { handle } from './handle'

/**
 * `translate:pdf*` (F8-B200): traducir un PDF sin cambiar su diseño. Solo la ventana principal (ninguna otra tiene estos canales en
 * `CHANNEL_ROLES`) y clase X en la política remota. Los bytes viajan en base64; main guarda cada trabajo en su propia carpeta.
 */
export function registerTranslatePdfHandlers(ipcMain: IpcMain): void {
  const svc = pdfTranslateService()
  handle(ipcMain, 'translate:pdfExtract', (req) => svc.extract(req))
  handle(ipcMain, 'translate:pdfApply', (req) => svc.apply(req))
  handle(ipcMain, 'translate:pdfOpen', (req) => svc.open(req.jobId))
  handle(ipcMain, 'translate:pdfSave', (req, event) => svc.save(req.jobId, BrowserWindow.fromWebContents(event.sender)))
  handle(ipcMain, 'translate:pdfDiscard', async (req) => {
    await svc.discard(req.jobId)
  })
}
