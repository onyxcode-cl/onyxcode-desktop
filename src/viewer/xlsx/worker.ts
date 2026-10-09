/**
 * Worker del visor de Excel (Fase 3): parsea el .xlsx FUERA del hilo principal de la vista aislada —
 * un libro de 100k filas no debe trabar el toolbar ni el scroll mientras se lee. `sheetRows: 10000`
 * pone un tope duro a cuántas filas lee SheetJS (no solo cuántas se muestran): un libro más grande
 * se recorta y `GridSheet.truncated` queda en `true`, nunca se intenta leerlo entero.
 */
import { read } from 'xlsx'
import { workbookToGrid, type GridWorkbook } from './model'

export type XlsxWorkerRequest = { type: 'parse'; buffer: ArrayBuffer }
export type XlsxWorkerResponse = { type: 'result'; workbook: GridWorkbook } | { type: 'error' }

self.onmessage = (ev: MessageEvent<XlsxWorkerRequest>): void => {
  try {
    const wb = read(new Uint8Array(ev.data.buffer), { type: 'array', dense: true, cellStyles: true, sheetRows: 10000 })
    const response: XlsxWorkerResponse = { type: 'result', workbook: workbookToGrid(wb) }
    self.postMessage(response)
  } catch {
    const response: XlsxWorkerResponse = { type: 'error' }
    self.postMessage(response)
  }
}
