/**
 * Artifacts: detectar bloques ```html en respuestas del modelo y abrirlos en una ventana aislada.
 *
 * Uso en el chat:
 *   import { ArtifactButton, extractHtmlArtifacts, isHtmlCodeBlock } from '@renderer/features/settings/impl/ArtifactButton'
 *   // a) Por mensaje: {extractHtmlArtifacts(text).map((a) => <ArtifactButton key={a.index} {...a} />)}
 *   // b) Dentro del renderer de <pre>/<code> de react-markdown:
 *   //    if (isHtmlCodeBlock(className)) <ArtifactButton html={String(children)} />
 */
import { useState } from 'react'
import { AppWindow, Loader2 } from 'lucide-react'
import { getExtras } from './extras'

export interface HtmlArtifact {
  /** Posición del bloque dentro del texto (útil como key). */
  index: number
  title: string
  html: string
}

const FENCE = /(^|\n)[ \t]*(```+|~~~+)[ \t]*(html|htm|xhtml)\b[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*(?=\n|$)/gi

/** Extrae los bloques ```html completos (ignora un bloque aún sin cerrar durante el streaming). */
export function extractHtmlArtifacts(markdown: string): HtmlArtifact[] {
  const out: HtmlArtifact[] = []
  let m: RegExpExecArray | null
  FENCE.lastIndex = 0
  while ((m = FENCE.exec(markdown))) {
    const html = m[4]
    if (!html.trim()) continue
    out.push({ index: m.index, html, title: guessTitle(html, out.length + 1) })
  }
  return out
}

/** true si el className de react-markdown corresponde a un bloque HTML (`language-html`). */
export function isHtmlCodeBlock(className: string | undefined): boolean {
  return !!className && /\blanguage-(html|htm|xhtml)\b/i.test(className)
}

export function guessTitle(html: string, n = 1): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
  const raw = (title ?? h1 ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  return raw ? raw.slice(0, 80) : `Artifact ${n}`
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
}

export function ArtifactButton({ html, title, className = '', compact }: Props): React.JSX.Element | null {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const extras = getExtras()
  if (!extras) return null

  const open = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await extras.openArtifact({ title: title ?? guessTitle(html), html })
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
      aria-label="Abrir como artifact"
      className={`no-drag inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 ${error ? 'border-danger/40 text-danger' : 'border-border bg-elevated text-muted hover:bg-hover hover:text-fg'} ${className}`}
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : <AppWindow size={13} />}
      {!compact && (error ? 'Error al abrir' : 'Abrir como artifact')}
    </button>
  )
}
