/**
 * Artifacts: detectar bloques ```html en respuestas del modelo y abrirlos en una ventana aislada.
 *
 * Uso en el chat:
 *   import { ArtifactButton, extractHtmlArtifacts, isHtmlCodeBlock } from '@renderer/components/artifacts/ArtifactButton'
 *   // a) Por mensaje: {extractHtmlArtifacts(text).map((a) => <ArtifactButton key={a.index} {...a} />)}
 *   // b) Dentro del renderer de <pre>/<code> de react-markdown:
 *   //    if (isHtmlCodeBlock(className)) <ArtifactButton html={String(children)} />
 */
import { useState } from 'react'
import { AppWindow, Download, Loader2, MonitorPlay, Presentation } from 'lucide-react'
import { getExtras } from '../../lib/extrasApi'
import { previewInChatDocPanel } from '../../lib/chatDocPreview'
import { UI_LABELS } from '@shared/labels'

export interface HtmlArtifact {
  /** Posición del bloque dentro del texto (útil como key). */
  index: number
  title: string
  html: string
  /** `​```slides` (deck con paginación en CSS propia) en vez de un `​```html` cualquiera — solo decide
   * qué botón de descarga alternativo ofrecer (`DownloadSlidesPptxButton`), nunca cambia el camino
   * de renderizado (sigue siendo el mismo `renderHtmlToPdf` para la vista previa). */
  isSlides: boolean
}

// `slides` es un alias de HTML (mismo camino: ventana aislada o panel de Chat, mismo renderHtmlToPdf)
// pensado para decks con paginación en CSS propia (```slides```, ver el prompt del agente de Chat) —
// no es un tipo de documento distinto, solo cambia el título por defecto más abajo.
const FENCE = /(^|\n)[ \t]*(```+|~~~+)[ \t]*(html|htm|xhtml|slides)\b[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*(?=\n|$)/gi

/** Extrae los bloques ```html/```slides completos (ignora un bloque aún sin cerrar durante el streaming). */
export function extractHtmlArtifacts(markdown: string): HtmlArtifact[] {
  const out: HtmlArtifact[] = []
  let m: RegExpExecArray | null
  FENCE.lastIndex = 0
  while ((m = FENCE.exec(markdown))) {
    const html = m[4]
    if (!html.trim()) continue
    const isSlides = m[3].toLowerCase() === 'slides'
    const fallback = isSlides ? 'Presentación' : 'Vista previa'
    out.push({ index: m.index, html, title: guessTitle(html, out.length + 1, fallback), isSlides })
  }
  return out
}

/** true si el className de react-markdown corresponde a un bloque HTML/slides (`language-html`/`language-slides`). */
export function isHtmlCodeBlock(className: string | undefined): boolean {
  return !!className && /\blanguage-(html|htm|xhtml|slides)\b/i.test(className)
}

export function guessTitle(html: string, n = 1, fallback = 'Vista previa'): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
  const raw = (title ?? h1 ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return raw ? raw.slice(0, 80) : `${fallback} ${n}`
}

/** Heurística: ¿vale la pena ofrecer el botón? (documento completo o con estructura visual). */
export function looksRenderable(html: string): boolean {
  return /<(!doctype|html|body|svg|canvas|style|script|div|table|main|section)\b/i.test(html)
}

interface Props {
  html: string
  title?: string
  className?: string
  /** Variante compacta (sólo icono) para cabeceras de bloque de código. */
  compact?: boolean
  /** `​```slides` en vez de un `​```html` cualquiera — ver `HtmlArtifact.isSlides`. */
  isSlides?: boolean
}

export function ArtifactButton({ html, title, className = '', compact, isSlides }: Props): React.JSX.Element | null {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const extras = getExtras()
  if (!extras) return null

  const open = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const resolvedTitle = title ?? guessTitle(html)
      // En Chat hay un panel registrado: mostrarlo ahí (como Claude), no en una ventana aparte.
      // Fuera de Chat (Tareas, Code…) no hay nadie registrado y se mantiene la ventana aislada de siempre.
      if (previewInChatDocPanel('html', html, resolvedTitle, isSlides)) return
      await extras.openArtifact({ title: resolvedTitle, html })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void open()}
      disabled={busy}
      title={error ?? 'Abrir el HTML en una ventana aislada (sin acceso a red ni a la app)'}
      aria-label={UI_LABELS.openHtmlPreview}
      className={`no-drag inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 ${error ? 'border-danger/40 text-danger' : 'border-border bg-elevated text-muted hover:bg-hover hover:text-fg'} ${className}`}
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : <AppWindow size={13} />}
      {!compact && (error ? 'Error al abrir' : UI_LABELS.openHtmlPreview)}
    </button>
  )
}

/**
 * «Descargar como PDF» junto al botón de vista previa: renderiza el HTML en la misma ventana
 * aislada sin red (`renderHtmlToPdf`) y un diálogo nativo "Guardar como" — el destino lo elige
 * SIEMPRE la persona, nunca el agente. Mismo guardado que `ArtifactButton` si `extras` no existe.
 */
export function DownloadPdfButton({ html, title, className = '', compact }: Props): React.JSX.Element | null {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const extras = getExtras()
  if (!extras) return null

  const download = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await extras.downloadHtmlAsPdf({ title: title ?? guessTitle(html), html })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void download()}
      disabled={busy}
      title={error ?? UI_LABELS.downloadPdf}
      aria-label={UI_LABELS.downloadPdf}
      className={`no-drag inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 ${error ? 'border-danger/40 text-danger' : 'border-border bg-elevated text-muted hover:bg-hover hover:text-fg'} ${className}`}
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
      {!compact && (error ? 'Error al guardar' : UI_LABELS.downloadPdf)}
    </button>
  )
}

/**
 * «Descargar como PowerPoint» para un deck `​```slides` — cada diapositiva se captura como imagen y
 * se pega a pantalla completa en su propio `.pptx` (ver `slides-deck-export.ts`): se abre y proyecta
 * perfecto en PowerPoint/Keynote, pero el texto NO queda editable ahí (es una foto, a propósito — ver
 * CHANGELOG F8-B135). Alternativa a `DownloadPdfButton`, nunca lo reemplaza: ambos quedan disponibles.
 */
export function DownloadSlidesPptxButton({ html, title, className = '', compact }: Props): React.JSX.Element | null {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const extras = getExtras()
  if (!extras) return null

  const download = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await extras.downloadSlidesAsPptx({ title: title ?? guessTitle(html, 1, 'Presentación'), html })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void download()}
      disabled={busy}
      title={error ?? UI_LABELS.downloadSlidesPptx}
      aria-label={UI_LABELS.downloadSlidesPptx}
      className={`no-drag inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 ${error ? 'border-danger/40 text-danger' : 'border-border bg-elevated text-muted hover:bg-hover hover:text-fg'} ${className}`}
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : <MonitorPlay size={13} />}
      {!compact && (error ? 'Error al guardar' : UI_LABELS.downloadSlidesPptx)}
    </button>
  )
}

/**
 * «Presentar» un deck `​```slides` DENTRO de Lazunox — ni archivo descargado ni PowerPoint externo:
 * abre una ventana PROPIA (`presentSlides`, `artifact-window.ts`), sin nada de la app alrededor, en
 * pantalla completa de VERDAD del sistema operativo, mostrando el HTML real escalado a toda la
 * pantalla — siempre nítido, sin ninguna captura de imagen de por medio (a diferencia de
 * `DownloadSlidesPptxButton`). Se probó reusar el panel/ventana principal y no servía: el sidebar y
 * los controles del visor seguían ahí adentro, nunca se iba a ver como una presentación de verdad.
 * Sale con Escape o con los controles de pantalla completa del propio sistema.
 */
export function PresentSlidesButton({ html, title, className = '', compact }: Props): React.JSX.Element | null {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const extras = getExtras()
  if (!extras) return null

  const present = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await extras.presentSlides({ title: title ?? guessTitle(html, 1, 'Presentación'), html })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void present()}
      disabled={busy}
      title={error ?? UI_LABELS.presentSlides}
      aria-label={UI_LABELS.presentSlides}
      className={`no-drag inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 ${error ? 'border-danger/40 text-danger' : 'border-border bg-elevated text-muted hover:bg-hover hover:text-fg'} ${className}`}
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : <Presentation size={13} />}
      {!compact && (error ? 'Error al presentar' : UI_LABELS.presentSlides)}
    </button>
  )
}
