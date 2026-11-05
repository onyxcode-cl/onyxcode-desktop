/**
 * Motor ÚNICO de documentos (PDF vía HTML, Excel, PowerPoint y Word): datos estructurados → bytes del archivo real. Lo usan el Chat
 * (`extras/chat-docs.ts`) y la herramienta `documentos` que se le ofrece a las Tareas y a Code (`documents/mcp-server.ts`), de modo que el
 * mismo JSON da el mismo archivo en macOS y en Windows, sea cual sea el modo desde el que se pide.
 */
import { renderHtmlToPdf } from '../extras/artifact-window'
import { craftService } from '../office/craft/service'
import { recordCraftProblem } from '../office/craft/craft-problems'
import { foldSubtitles, renderChatDeck } from '../office/craft/chat-deck'
import { ensureTitlePlaceholders } from '../office/craft/pptx-titles'
import { renderChatGrid } from '../office/craft/chat-grid'
import { isPptxSpec, renderPptx, type PptxSpec } from '../extras/render-pptx'
import { isXlsxSpec, renderXlsx, type XlsxSpec } from '../extras/render-xlsx'
import { isDocxSpec, type DocxSpec } from '@shared/chat-doc-spec'
import { renderChatDocx } from '../office/craft/chat-word'
import type { ImageMap } from './image-files'

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
  /** Imágenes ya leídas, validadas y copiadas (solo Tareas/Code, ver `documents/image-files.ts`). Sin ellas, las imágenes del spec se omiten. */
  images?: ImageMap
  /** `false`: el PDF no descarga imágenes de internet (agentes aislados: la app no sale a la red en su nombre). Por defecto sí (Chat). */
  remoteImages?: boolean
}

/** Ruta de un programa de ArtCraft si está instalado (`null` si no lo está o si la plataforma no tiene descarga fijada: hoy hay para macOS y Windows). */
export function craftBinary(tool: 'deckcraft' | 'wordcraft' | 'gridcraft'): string | null {
  const st = craftService().status()
  return st.state === 'installed' ? (st.bins[tool] ?? null) : null
}

/** Tras un intento fallido no se vuelve a bajar hasta pasado este tiempo (para no repetir una descarga rota en cada documento). */
const AUTO_INSTALL_RETRY_MS = 10 * 60_000
let lastAutoInstallFailure = 0
let autoInstalling: Promise<void> | null = null

/**
 * ArtCraft es el camino NORMAL de los documentos (macOS y Windows por igual): si falta, se instala bajo demanda la primera vez que se
 * crea o se mira un documento, en vez de caer en silencio al generador de respaldo o a la vista simplificada. Un solo intento a la vez
 * (los documentos que llegan mientras tanto esperan al mismo), sin repetir un fallo reciente, y nunca lanza: si no se puede, el
 * llamador sigue con su respaldo de siempre. `LAZUNOX_CRAFT_AUTOINSTALL=0` lo apaga.
 */
export async function ensureCraft(now: () => number = Date.now): Promise<void> {
  if (process.env.LAZUNOX_CRAFT_AUTOINSTALL === '0') return
  try {
    if (autoInstalling) return await autoInstalling
    if (craftService().status().state !== 'missing') return
    if (now() - lastAutoInstallFailure < AUTO_INSTALL_RETRY_MS) return
    autoInstalling = (async () => {
      const r = await craftService().installNow()
      if (!r.ok) lastAutoInstallFailure = now()
    })()
    try {
      await autoInstalling
    } finally {
      autoInstalling = null
    }
  } catch (e) {
    lastAutoInstallFailure = now()
    console.warn('[documentos] no se pudo instalar ArtCraft bajo demanda:', e instanceof Error ? e.message : e)
  }
}

/** Solo pruebas: olvida el último fallo de instalación. */
export function resetEnsureCraftForTests(): void {
  lastAutoInstallFailure = 0
  autoInstalling = null
}

export async function renderBytes(input: ChatDocInput, title: string, opts: RenderOptions = {}): Promise<Buffer> {
  if (input.kind === 'pdf') {
    const pdf = await renderHtmlToPdf(input.html, title || 'Documento', { remoteImages: opts.remoteImages })
    if (!pdf.subarray(0, 4).equals(Buffer.from('%PDF'))) throw new Error('No se pudo generar el PDF.')
    return pdf
  }
  if (input.kind === 'xlsx') {
    await ensureCraft()
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
    await ensureCraft()
    if (!isDocxSpec(input.data)) throw new ChatDocError('invalid', 'Datos de Word inválidos.')
    // Word solo se arma con WordCraft (no hay generador de respaldo): sin el programa instalado, el panel avisa que falló.
    const word = craftBinary('wordcraft')
    if (!word) throw new ChatDocError('no-craft', 'El diseñador de documentos (WordCraft) no está instalado.')
    return renderChatDocx(word, input.data, undefined, opts.images)
  }
  if (!isPptxSpec(input.data)) throw new ChatDocError('invalid', 'Datos de PowerPoint inválidos.')
  await ensureCraft()
  // Con DeckCraft instalado la presentación se arma con él (diseño «dots»); si falla por lo que sea, cae al generador de siempre.
  const craft = craftBinary('deckcraft')
  if (craft) {
    try {
      return await renderChatDeck(craft, input.data, undefined, undefined, opts.images)
    } catch (e) {
      console.warn('[chat-docs] DeckCraft falló, se usa el generador de siempre:', e instanceof Error ? e.message : e)
      recordCraftProblem('documento', e, { programa: 'deckcraft' }, { level: 'warn' })
    }
  }
  // Respaldo (pptxgenjs): mismas garantías que con DeckCraft: subtítulo de la portada y marcador de título en cada diapositiva.
  return ensureTitlePlaceholders(await renderPptx(foldSubtitles(input.data), opts.images))
}
