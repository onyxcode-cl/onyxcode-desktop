/**
 * PRUEBA (rama `exp/craft-office-pruebas`): punto único para abrir un documento en la versión WEB del programa de ArtCraft que le
 * corresponde (Excel → GridCraft, PowerPoint → DeckCraft, Word → WordCraft; PDF usa PDF.js) y coordinar el hueco del panel entre esa vista
 * y el visor de siempre. Lo usan el panel de documentos del Chat (`extras:chatDoc:*`) y el visor de archivos de Tareas (`tasks:viewer:*`):
 * un solo modo de la app muestra un documento a la vez, así que comparten estado.
 */
import { readFile, stat } from 'node:fs/promises'
import type { BrowserWindow } from 'electron'
import type { DocKind } from '@shared/doc-kind'
import { attach as attachViewer, closeView } from '../../viewer/view'
import { recordCraftProblem } from './craft-problems'
import { craftService } from './service'
import { WEB_OPEN_TIMEOUT_MS, withTimeout } from './web-timeout'
import { MAX_WEB_FILE_BYTES, attachWeb, closeWeb, isWebActive, openWebDoc } from './web-view'

/** Programa de ArtCraft para los formatos Office; PDF se lee en el visor aislado PDF.js. */
export const WEB_PROGRAM: Record<Exclude<DocKind, 'pdf'>, string> = { xlsx: 'gridcraft', pptx: 'deckcraft', docx: 'wordcraft' }

interface Last {
  win: BrowserWindow
  rect: { x: number; y: number; width: number; height: number }
  visible: boolean
}
let last: Last | null = null
let openGeneration = 0

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
  openGeneration++
  closeView()
  closeWeb()
}

/** Marca que el documento actual va por el visor de siempre (oculta la vista web) y reaplica el hueco. */
export function useClassicViewer(): void {
  openGeneration++
  closeWeb()
  applyPanel()
}

/**
 * PDF devuelve `false` para usar PDF.js. Office abre `file` en la versión web de su programa si está instalada.
 * Devuelve `false` si falta la instalación, si el archivo es demasiado grande o si algo falla: quien llama usa entonces el visor de siempre. `title` solo da nombre al archivo en la pantalla del programa.
 */
export async function openInCraftWeb(kind: DocKind, file: string, title: string): Promise<boolean> {
  const generation = ++openGeneration
  if (kind === 'pdf') {
    // Compartido por Chat, Tareas y Código. Cancela cualquier apertura Craft anterior.
    closeWeb()
    applyPanel()
    return false
  }
  const current = (): boolean => generation === openGeneration
  // Un cierre (p. ej. al cambiar el tema) destruye las vistas y borra su anfitrión/tamaño.
  // Restituirlos ANTES de arrancar wasm: esperar a su éxito lo arrancaba sin superficie.
  applyPanel()
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
    const ok = await withTimeout(
      (async () => {
        if ((await stat(file)).size > MAX_WEB_FILE_BYTES || !current()) return false
        const name = `${title.replace(/[^\p{L}\p{N} _.-]/gu, '').slice(0, 60) || 'documento'}.${kind}`
        const bytes = await readFile(file)
        if (!current()) return false
        return openWebDoc(dir, kind, name, bytes)
      })(),
      WEB_OPEN_TIMEOUT_MS,
      'apertura'
    )
    if (!current()) return false
    if (ok) applyPanel()
    else {
      closeWeb()
      console.warn(`[craft-web] la vista web de ${WEB_PROGRAM[kind]} no recibió el archivo (${kind}); se usa el visor de siempre`)
      recordCraftProblem('vista web', new Error(`la vista web de ${WEB_PROGRAM[kind]} no recibió el archivo (${kind})`), {
        programa: WEB_PROGRAM[kind]
      })
    }
    return ok
  } catch (e) {
    if (!current()) return false
    openGeneration++
    closeWeb()
    console.warn(`[craft-web] no se pudo abrir ${kind} en la vista web:`, e instanceof Error ? e.message : e)
    recordCraftProblem('vista web', e, { programa: WEB_PROGRAM[kind] })
    return false
  }
}
