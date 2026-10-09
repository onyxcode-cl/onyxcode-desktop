/**
 * Registro mínimo (sin store, sin prop-drilling) para que "Abrir vista previa"/"Descargar" en un
 * bloque ```html/```xlsx/```pptx del chat usen el MISMO panel lateral que ya se abrió solo — no una
 * ventana aparte — sin tener que pasarle esa lógica a `Markdown.tsx` (es un componente compartido con
 * Tareas/Code y optimizado para el streaming; no vale la pena tocar su árbol de props por esto).
 * `ChatView` se registra mientras está montada; en cualquier otro modo no hay nadie registrado, así
 * que un bloque ```html (el único de los tres que también existe fuera de Chat) sigue abriendo su
 * ventana aislada de siempre.
 */
export type ChatDocBlockKind = 'html' | 'xlsx' | 'pptx'

type PreviewHandler = (kind: ChatDocBlockKind, rawText: string, title: string, isSlides?: boolean) => void

let handler: PreviewHandler | null = null

export function setChatDocPreviewHandler(fn: PreviewHandler | null): void {
  handler = fn
}

/** `true` si había un panel de chat al que mostrarle el documento (y ya se le avisó). `isSlides`
 * (solo relevante para `kind:'html'`) decide si el header del panel ofrece el botón de descarga
 * alternativo "PowerPoint (para proyectar)", ver `ArtifactButton.tsx`'s `DownloadSlidesPptxButton`. */
export function previewInChatDocPanel(kind: ChatDocBlockKind, rawText: string, title: string, isSlides = false): boolean {
  if (!handler) return false
  handler(kind, rawText, title, isSlides)
  return true
}

/**
 * Documento que se está generando ahora mismo (render/escritura en curso), o `null`. Lo usan
 * `Markdown.tsx`'s `CodeBlock` y `useChatProgress.ts` (ambos vía `useSyncExternalStore`, mismo
 * motivo que el registro de arriba: evitar prop-drilling en componentes compartidos) para mostrar
 * "Generando documento…" en vez del bloque crudo mientras tanto — si no, apenas el modelo termina de
 * escribir el texto parece que el documento ya está listo, cuando en realidad el archivo todavía se
 * está escribiendo de fondo. `startedAt` alimenta el cronómetro del HUD de progreso.
 */
export interface CreatingDoc {
  kind: ChatDocBlockKind
  rawText: string
  title: string
  startedAt: number
}

let creatingDoc: CreatingDoc | null = null
const creatingListeners = new Set<() => void>()

export function setCreatingDoc(doc: { kind: ChatDocBlockKind; rawText: string; title: string } | null): void {
  creatingDoc = doc === null ? null : { ...doc, startedAt: Date.now() }
  creatingListeners.forEach((cb) => cb())
}

/** Solo el texto crudo (compat con `CodeBlock`, que compara contra el fragmento crudo del bloque). */
export function getCreatingRawText(): string | null {
  return creatingDoc?.rawText ?? null
}

/** Documento completo (tipo + título + hora de inicio), para el HUD de progreso. */
export function getCreatingDoc(): CreatingDoc | null {
  return creatingDoc
}

export function subscribeCreatingDoc(cb: () => void): () => void {
  creatingListeners.add(cb)
  return () => creatingListeners.delete(cb)
}
