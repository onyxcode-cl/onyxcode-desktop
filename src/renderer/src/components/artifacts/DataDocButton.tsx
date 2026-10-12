/**
 * Botones de "Abrir vista previa"/"Descargar" para los bloques ```xlsx/```pptx del chat (datos
 * estructurados, no HTML) — hermanos de `ArtifactButton`/`DownloadPdfButton`, pero esos dos son
 * específicamente para HTML (abren una ventana aislada / piden `renderHtmlToPdf`) y no sirven acá.
 * A diferencia de `ArtifactButton`, estos SOLO tienen sentido dentro de Chat (el único lugar donde
 * existen estos bloques) — si por algún motivo no hay panel registrado, el botón simplemente no hace
 * nada en vez de abrir una ventana aparte (no hay una "vista aislada" equivalente para datos crudos).
 */
import { useState } from 'react'
import { AppWindow, Download, Loader2 } from 'lucide-react'
import { isDocxSpec, isPptxSpec, isXlsxSpec } from '@shared/chat-doc-spec'
import { UI_LABELS } from '@shared/labels'
import { getExtras } from '../../lib/extrasApi'
import { previewInChatDocPanel, type ChatDocBlockKind } from '../../lib/chatDocPreview'
import { parseDataBlock } from '../../lib/chatDocBlocks'

interface Props {
  kind: Extract<ChatDocBlockKind, 'xlsx' | 'pptx' | 'docx'>
  rawText: string
  title: string
  className?: string
  compact?: boolean
}

export function PreviewDataDocButton({ kind, rawText, title, className = '', compact }: Props): React.JSX.Element {
  const [busy, setBusy] = useState(false)

  const open = (): void => {
    setBusy(true)
    try {
      previewInChatDocPanel(kind, rawText, title)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={busy}
      title={UI_LABELS.openHtmlPreview}
      aria-label={UI_LABELS.openHtmlPreview}
      className={`no-drag inline-flex items-center gap-1.5 rounded-lg border border-border bg-elevated px-2.5 py-1 text-xs font-medium text-muted transition hover:bg-hover hover:text-fg disabled:opacity-50 ${className}`}
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : <AppWindow size={13} />}
      {!compact && UI_LABELS.openHtmlPreview}
    </button>
  )
}

export function DownloadDataDocButton({ kind, rawText, title, className = '', compact }: Props): React.JSX.Element | null {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const extras = getExtras()
  if (!extras) return null

  const download = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const parsed = parseDataBlock(kind, rawText)
      if (!parsed) throw new Error('Datos inválidos')
      if (kind === 'xlsx') {
        if (!isXlsxSpec(parsed)) throw new Error('Datos inválidos')
        await extras.invoke('extras:downloadChatDoc', { kind: 'xlsx', title, data: parsed })
      } else if (kind === 'docx') {
        if (!isDocxSpec(parsed)) throw new Error('Datos inválidos')
        await extras.invoke('extras:downloadChatDoc', { kind: 'docx', title, data: parsed })
      } else {
        if (!isPptxSpec(parsed)) throw new Error('Datos inválidos')
        await extras.invoke('extras:downloadChatDoc', { kind: 'pptx', title, data: parsed })
      }
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
