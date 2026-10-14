/**
 * PRUEBA (rama `exp/craft-office-pruebas`): punto único para abrir un documento en la versión WEB del programa de ArtCraft que le
 * corresponde (Excel → GridCraft, PowerPoint → DeckCraft, Word → WordCraft, PDF → PdfCraft) y coordinar el hueco del panel entre esa vista
 * y el visor de siempre. Lo usan el panel de documentos del Chat (`extras:chatDoc:*`) y el visor de archivos de Tareas (`tasks:viewer:*`):
 * un solo modo de la app muestra un documento a la vez, así que comparten estado.
 */
import { readFile, stat } from 'node:fs/promises'
import type { BrowserWindow } from 'electron'
import type { DocKind } from '@shared/doc-kind'
import { attach as attachViewer, closeView } from '../../viewer/view'
import { recordCraftProblem } from './craft-problems'
import { craftService } from './service'
import { MAX_WEB_FILE_BYTES, attachWeb, closeWeb, deactivateWeb, isWebActive, openWebDoc } from './web-view'

/** Programa de ArtCraft cuya versión web muestra cada tipo de documento. */
export const WEB_PROGRAM: Record<DocKind, string> = { xlsx: 'gridcraft', pptx: 'deckcraft', docx: 'wordcraft', pdf: 'pdfcraft' }

interface Last {
  win: BrowserWindow
  rect: { x: number; y: number; width: number; height: number }
  visible: boolean
}
let last: Last | null = null

/** Reaplica el último hueco: la vista activa lo muestra y la otra se oculta. */
export function applyPanel(): void {
  if (!last) return
  attachViewer(last.win, last.rect, last.visible && !isWebActive())
  attachWeb(last.win, last.rect, last.visible)
}

/** El renderer manda el hueco del panel (cambia al redimensionar); sirve para las dos vistas. */
export function panelAttach(win: BrowserWindow, rect: Last['rect'], visible: boolean): void {
  last = { win, rect, visible }
  applyPanel()
}

/** Cierra ambas vistas (al cerrar el documento). */
export function panelClose(): void {
  closeView()
  closeWeb()
}

/** Marca que el documento actual va por el visor de siempre (oculta la vista web) y reaplica el hueco. */
export function useClassicViewer(): void {
  deactivateWeb()
  applyPanel()
}

/**
 * Abre `file` en la versión web de su programa si está instalada. Devuelve `false` (y no hace nada) si no está instalada, si el archivo es
 * demasiado grande o si algo falla: quien llama usa entonces el visor de siempre. `title` solo da nombre al archivo en la pantalla del programa.
 */
export async function openInCraftWeb(kind: DocKind, file: string, title: string): Promise<boolean> {
  const dir = craftService().webDir(WEB_PROGRAM[kind])
  if (!dir) {
    console.warn(`[craft-web] la versión web de ${WEB_PROGRAM[kind]} no está instalada; se usa el visor de siempre`)
    recordCraftProblem(
      'vista web',
      new Error(`la versión web de ${WEB_PROGRAM[kind]} no está instalada; se usa el visor de siempre`),
      { programa: WEB_PROGRAM[kind] },
      { level: 'warn' }
    )
    return false
  }
  try {
    if ((await stat(file)).size > MAX_WEB_FILE_BYTES) return false
    const name = `${title.replace(/[^\p{L}\p{N} _.-]/gu, '').slice(0, 60) || 'documento'}.${kind}`
    const ok = await openWebDoc(dir, kind, name, await readFile(file))
    if (ok) applyPanel()
    else {
      console.warn(`[craft-web] la vista web de ${WEB_PROGRAM[kind]} no recibió el archivo (${kind}); se usa el visor de siempre`)
      recordCraftProblem('vista web', new Error(`la vista web de ${WEB_PROGRAM[kind]} no recibió el archivo (${kind})`), {
        programa: WEB_PROGRAM[kind]
      })
    }
    return ok
  } catch (e) {
    console.warn(`[craft-web] no se pudo abrir ${kind} en la vista web:`, e instanceof Error ? e.message : e)
    recordCraftProblem('vista web', e, { programa: WEB_PROGRAM[kind] })
    return false
  }
}
