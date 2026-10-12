/**
 * Panel de documento de Chat: la vista nativa (misma del visor de documentos) ya está abierta
 * (`useChatDocPanel` llamó a `extras:chatDoc:open`); esto solo mide el hueco y pone la cabecera.
 */
import { Loader2, Maximize2, Minimize2, X } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { DownloadPdfButton, DownloadSlidesPptxButton, PresentSlidesButton } from '../../components/artifacts/ArtifactButton'
import { DownloadDataDocButton } from '../../components/artifacts/DataDocButton'
import type { ChatDocBlockKind } from '../../lib/chatDocPreview'
import { useChatDocViewport } from './useChatDocViewport'

const KIND_LABEL: Record<ChatDocBlockKind, 'chat.doc.kindPdf' | 'chat.doc.kindXlsx' | 'chat.doc.kindPptx' | 'chat.doc.kindDocx'> = {
  html: 'chat.doc.kindPdf',
  xlsx: 'chat.doc.kindXlsx',
  pptx: 'chat.doc.kindPptx',
  docx: 'chat.doc.kindDocx'
}

interface Props {
  creating: boolean
  title: string
  doc: { kind: ChatDocBlockKind; rawText: string; isSlides: boolean } | null
  fullscreen: boolean
  onToggleFullscreen: () => void
  onClose: () => void
}

export function ChatDocPanel({ creating, title, doc, fullscreen, onToggleFullscreen, onClose }: Props): React.JSX.Element {
  const t = useT()
  const { hostRef, shouldShowNative } = useChatDocViewport(true)

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {title || t('chat.doc.title')} {doc && <span className="text-subtle">· {t(KIND_LABEL[doc.kind])}</span>}
        </span>
        {doc?.kind === 'html' && <DownloadPdfButton html={doc.rawText} title={title} compact className="py-1" />}
        {doc?.kind === 'html' && doc.isSlides && (
          <>
            <PresentSlidesButton html={doc.rawText} title={title} compact className="py-1" />
            <DownloadSlidesPptxButton html={doc.rawText} title={title} compact className="py-1" />
          </>
        )}
        {doc && (doc.kind === 'xlsx' || doc.kind === 'pptx' || doc.kind === 'docx') && (
          <DownloadDataDocButton kind={doc.kind} rawText={doc.rawText} title={title} compact className="py-1" />
        )}
        <button
          type="button"
          onClick={onToggleFullscreen}
          aria-label={t(fullscreen ? 'chat.doc.exitFullscreen' : 'chat.doc.fullscreen')}
          className="rounded-md p-1 text-muted hover:bg-hover hover:text-fg"
        >
          {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="rounded-md p-1 text-muted hover:bg-hover hover:text-fg"
        >
          <X size={14} />
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={hostRef} className="absolute inset-0" style={{ visibility: shouldShowNative ? 'visible' : 'hidden' }} />
        {creating && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-elevated text-muted">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-[12.5px]">{t('chat.doc.creating')}</span>
          </div>
        )}
      </div>
    </div>
  )
}
