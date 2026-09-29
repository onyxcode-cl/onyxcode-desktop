import type { ElectronApplication } from 'playwright-core'

export interface DialogStub {
  /** Rutas que devuelve showOpenDialog (vacío + canceled si no hay). */
  openPaths?: string[]
  /** Ruta que devuelve showSaveDialog (undefined → cancelado). */
  savePath?: string
}

/** Sustituye dialog.showOpenDialog/showSaveDialog en main (acepta ambas firmas, con o sin ventana). */
export async function stubDialog(app: ElectronApplication, stub: DialogStub): Promise<void> {
  await app.evaluate(({ dialog }, s) => {
    const g = globalThis as unknown as { __e2eDialogCalls?: { kind: string; options: unknown }[] }
    g.__e2eDialogCalls = []
    const opts = (a: unknown[]): unknown => (a.length > 1 ? a[1] : a[0])
    dialog.showOpenDialog = (async (...a: unknown[]) => {
      g.__e2eDialogCalls!.push({ kind: 'open', options: opts(a) })
      const paths = s.openPaths ?? []
      return { canceled: paths.length === 0, filePaths: paths }
    }) as unknown as typeof dialog.showOpenDialog
    dialog.showSaveDialog = (async (...a: unknown[]) => {
      g.__e2eDialogCalls!.push({ kind: 'save', options: opts(a) })
      return s.savePath ? { canceled: false, filePath: s.savePath } : { canceled: true, filePath: '' }
    }) as unknown as typeof dialog.showSaveDialog
  }, stub)
}

/** Llamadas recibidas por el stub (tipo y opciones) desde `stubDialog`. */
export async function dialogCalls(app: ElectronApplication): Promise<{ kind: string; options: unknown }[]> {
  return app.evaluate(() => (globalThis as unknown as { __e2eDialogCalls?: { kind: string; options: unknown }[] }).__e2eDialogCalls ?? [])
}
