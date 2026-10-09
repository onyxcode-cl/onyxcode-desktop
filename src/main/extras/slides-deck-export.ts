/**
 * Un deck `​```slides` (HTML/CSS libre, ver `chat.md`/`config.ts`) → `.pptx` PROYECTABLE: cada
 * diapositiva se captura como imagen (`captureSlidesAsPngs`, `artifact-window.ts`) y se arma el
 * archivo (`assembleSlidesPptx`, `slides-deck-pptx.ts` — puro, sin `electron`, separado a propósito
 * para poder probarlo con buffers de prueba). Se abre y proyecta perfecto en PowerPoint/Keynote, pero
 * el texto NO queda editable ahí — es una foto, a propósito (F8-B135): el camino "texto de verdad"
 * (convertir cada elemento HTML en una forma nativa) es el mismo problema sin resolver que tiene
 * Gamma.app hoy (investigado: diapositivas bloqueadas como imagen o texto fragmentado, según sus
 * propios usuarios) — acá se elige a propósito, no por limitación encontrada tarde.
 *
 * Nombre de archivo DISTINTO de `render-pptx.ts` a propósito: ese archivo arma el `​```pptx`
 * ESTRUCTURADO (bullets/cards/charts con el sistema de diseño de temas/estilos) — un mecanismo
 * totalmente distinto, nunca usado a la vez que `​```slides` para el mismo documento.
 */
import { app, type BrowserWindow, dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { t } from '@shared/i18n'
import type { ArtifactPayload } from '@shared/ipc-extras'
import { captureSlidesAsPngs, safeDocumentName } from './artifact-window'
import { assembleSlidesPptx } from './slides-deck-pptx'

/**
 * `html` de un deck (`​```slides`) → `.pptx` proyectable con diálogo "Guardar como": el destino lo
 * elige SIEMPRE el usuario, nunca el agente (mismo patrón que `downloadHtmlAsPdf`). `null` si el
 * usuario cancela el diálogo.
 */
export async function downloadSlidesAsPptx(payload: ArtifactPayload, win: BrowserWindow | null): Promise<string | null> {
  const images = await captureSlidesAsPngs(payload.html, payload.title || 'Presentación')
  const pptx = await assembleSlidesPptx(images)
  const safe = safeDocumentName(payload.title || 'presentacion', 'presentacion')
  const options: Electron.SaveDialogOptions = {
    title: t('merr.dialog.saveDoc'),
    defaultPath: join(app.getPath('downloads'), `${safe}.pptx`),
    filters: [{ name: 'PowerPoint', extensions: ['pptx'] }]
  }
  const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (res.canceled || !res.filePath) return null
  await writeFile(res.filePath, pptx)
  return res.filePath
}
