import { app, dialog, type BrowserWindow } from 'electron'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'

/** Igual que los otros ganchos E2E: una app empaquetada ignora siempre el entorno. */
export function resolveE2eExportDir(input: { isPackaged: boolean; env: NodeJS.ProcessEnv }): string | null {
  const dir = !input.isPackaged ? input.env.LAZUNOX_E2E_EXPORT_DIR : undefined
  return dir && isAbsolute(dir) ? dir : null
}

/** El destino real sigue siendo un diálogo. En pruebas cada descarga tiene su propia carpeta. */
export async function showExportSaveDialog(
  win: BrowserWindow | null,
  options: Electron.SaveDialogOptions
): Promise<Electron.SaveDialogReturnValue> {
  const dir = resolveE2eExportDir({ isPackaged: app.isPackaged, env: process.env })
  if (!dir) return win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options)
  await mkdir(dir, { recursive: true })
  const target = await mkdtemp(join(dir, 'export-'))
  return { canceled: false, filePath: join(target, basename(options.defaultPath || 'documento')) }
}
