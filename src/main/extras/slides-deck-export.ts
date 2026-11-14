import { showExportSaveDialog } from './export-dialog'
import { app, type BrowserWindow } from 'electron'
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { t } from '@shared/i18n'
import type { ArtifactPayload } from '@shared/ipc-extras'
import { captureSlidesAsPngs, safeDocumentName } from './artifact-window'
import { writeSlidesPptx } from './slides-deck-pptx'

/** Camino real reutilizable por la comprobación externa. Cada captura se escribe inmediatamente. */
export async function exportSlidesToPptxFile(
  html: string,
  title: string,
  destination: string,
  onCapturedSlide?: (png: Buffer, index: number) => void
): Promise<number> {
  const temporary = await mkdtemp(join(tmpdir(), 'lazunox-slides-4k-'))
  try {
    const paths: string[] = []
    const count = await captureSlidesAsPngs(html, title, async (png, index) => {
      const path = join(temporary, `slide-${index + 1}.png`)
      await writeFile(path, png, { flag: 'wx' })
      onCapturedSlide?.(png, index)
      paths.push(path)
    })
    const output = join(temporary, 'presentation.pptx')
    await writeSlidesPptx(paths, output)
    // No deja un archivo parcial en el destino si fallan captura, tamaño o presupuesto.
    await copyFile(output, destination)
    return count
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

/** El destino lo elige la persona. Cancelar no abre una ventana de captura ni consume memoria. */
export async function downloadSlidesAsPptx(payload: ArtifactPayload, win: BrowserWindow | null): Promise<string | null> {
  const safe = safeDocumentName(payload.title || 'presentacion', 'presentacion')
  const options: Electron.SaveDialogOptions = {
    title: t('merr.dialog.saveDoc'),
    defaultPath: join(app.getPath('downloads'), `${safe}.pptx`),
    filters: [{ name: 'PowerPoint', extensions: ['pptx'] }]
  }
  const res = await showExportSaveDialog(win, options)
  if (res.canceled || !res.filePath) return null
  await exportSlidesToPptxFile(payload.html, payload.title || 'Presentación', res.filePath)
  return res.filePath
}
