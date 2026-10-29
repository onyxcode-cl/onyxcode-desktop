/**
 * Motor ÚNICO de documentos (PDF vía HTML, Excel, PowerPoint y Word): datos estructurados → bytes del archivo real. Lo usan el Chat
 * (`extras/chat-docs.ts`) y la herramienta `documentos` que se le ofrece a las Tareas y a Code (`documents/mcp-server.ts`), de modo que el
 * mismo JSON da el mismo archivo en macOS y en Windows, sea cual sea el modo desde el que se pide.
 */
import { renderHtmlToPdf } from '../extras/artifact-window'
import { craftService } from '../office/craft/service'
import { recordCraftProblem } from '../office/craft/craft-problems'
import { renderChatDeck } from '../office/craft/chat-deck'
import { renderChatGrid } from '../office/craft/chat-grid'
import { isPptxSpec, renderPptx, type PptxSpec } from '../extras/render-pptx'
import { isXlsxSpec, renderXlsx, type XlsxSpec } from '../extras/render-xlsx'
import { isDocxSpec, type DocxSpec } from '@shared/chat-doc-spec'
import { renderChatDocx } from '../office/craft/chat-word'

/** Fallo de generación con un motivo que la ventana puede explicar (el mensaje es un texto propio de la app, apto para mostrar). */
export class ChatDocError extends Error {
  constructor(
    readonly code: 'invalid' | 'no-craft',
    message: string
  ) {
    super(message)
    this.name = 'ChatDocError'
  }
}

export type ChatDocInput =
  { kind: 'pdf'; html: string } | { kind: 'xlsx'; data: XlsxSpec } | { kind: 'pptx'; data: PptxSpec } | { kind: 'docx'; data: DocxSpec }

export const DOC_EXT: Record<ChatDocInput['kind'], string> = { pdf: 'pdf', xlsx: 'xlsx', pptx: 'pptx', docx: 'docx' }

export interface RenderOptions {
  /** `false`: el PDF no descarga imágenes de internet (agentes aislados: la app no sale a la red en su nombre). Por defecto sí (Chat). */
  remoteImages?: boolean
}

/** Ruta de un programa de ArtCraft si está instalado (`null` si no, o si no es macOS). */
export function craftBinary(tool: 'deckcraft' | 'wordcraft' | 'gridcraft'): string | null {
  const st = craftService().status()
  return st.state === 'installed' ? (st.bins[tool] ?? null) : null
}

export async function renderBytes(input: ChatDocInput, title: string, opts: RenderOptions = {}): Promise<Buffer> {
  if (input.kind === 'pdf') {
    const pdf = await renderHtmlToPdf(input.html, title || 'Documento', { remoteImages: opts.remoteImages })
    if (!pdf.subarray(0, 4).equals(Buffer.from('%PDF'))) throw new Error('No se pudo generar el PDF.')
    return pdf
  }
  if (input.kind === 'xlsx') {
    if (!isXlsxSpec(input.data)) throw new ChatDocError('invalid', 'Datos de Excel inválidos.')
    // Con GridCraft instalado el libro se arma con él (calcula las fórmulas); si falla, cae al generador de siempre.
    const grid = craftBinary('gridcraft')
    if (grid) {
      try {
        return await renderChatGrid(grid, input.data)
      } catch (e) {
        console.warn('[chat-docs] GridCraft falló, se usa el generador de siempre:', e instanceof Error ? e.message : e)
        recordCraftProblem('documento', e, { programa: 'gridcraft' }, { level: 'warn' })
      }
    }
    return renderXlsx(input.data)
  }
  if (input.kind === 'docx') {
    if (!isDocxSpec(input.data)) throw new ChatDocError('invalid', 'Datos de Word inválidos.')
    // Word solo se arma con WordCraft (no hay generador de respaldo): sin el programa instalado, el panel avisa que falló.
    const word = craftBinary('wordcraft')
    if (!word) throw new ChatDocError('no-craft', 'El diseñador de documentos (WordCraft) no está instalado.')
    return renderChatDocx(word, input.data)
  }
  if (!isPptxSpec(input.data)) throw new ChatDocError('invalid', 'Datos de PowerPoint inválidos.')
  // Con DeckCraft instalado la presentación se arma con él (diseño «dots»); si falla por lo que sea, cae al generador de siempre.
  const craft = craftBinary('deckcraft')
  if (craft) {
    try {
      return await renderChatDeck(craft, input.data)
    } catch (e) {
      console.warn('[chat-docs] DeckCraft falló, se usa el generador de siempre:', e instanceof Error ? e.message : e)
      recordCraftProblem('documento', e, { programa: 'deckcraft' }, { level: 'warn' })
    }
  }
  return renderPptx(input.data)
}
