/**
 * Panel de documento de Chat: la vista nativa (misma del visor de documentos) ya está abierta
 * (`useChatDocPanel` llamó a `extras:chatDoc:open`); esto solo mide el hueco y pone la cabecera.
 */
import { useState } from 'react'
import { ExternalLink, Loader2, Maximize2, Minimize2, X } from 'lucide-react'
import { isDocxSpec, isPptxSpec, isXlsxSpec } from '@shared/chat-doc-spec'
import { getExtras } from '../../lib/extrasApi'
import { parseDataBlock } from '../../lib/chatDocBlocks'
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
  const [opening, setOpening] = useState(false)
  const [openFailed, setOpenFailed] = useState(false)

  // Abre el documento en el programa de ArtCraft de escritorio (o en el del sistema): sirve para verlo grande o seguir editándolo ahí.
  const openExternal = async (): Promise<void> => {
    const extras = getExtras()
    if (!extras || !doc) return
    setOpening(true)
    setOpenFailed(false)
    try {
      let res: { ok: boolean } | undefined
      if (doc.kind === 'html') res = await extras.invoke('extras:chatDoc:openExternal', { kind: 'pdf', title, html: doc.rawText })
      else {
        const parsed = parseDataBlock(doc.kind, doc.rawText)
        if (doc.kind === 'xlsx' && isXlsxSpec(parsed))
          res = await extras.invoke('extras:chatDoc:openExternal', { kind: 'xlsx', title, data: parsed })
        else if (doc.kind === 'docx' && isDocxSpec(parsed))
          res = await extras.invoke('extras:chatDoc:openExternal', { kind: 'docx', title, data: parsed })
        else if (doc.kind === 'pptx' && isPptxSpec(parsed))
          res = await extras.invoke('extras:chatDoc:openExternal', { kind: 'pptx', title, data: parsed })
      }
      setOpenFailed(!res?.ok)
    } catch {
      setOpenFailed(true)
    } finally {
      setOpening(false)
    }
  }

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
        {doc && !doc.isSlides && (
          <button
            type="button"
            onClick={() => void openExternal()}
            disabled={opening}
            title={openFailed ? t('chat.doc.openExternalFailed') : t('chat.doc.openExternalHint')}
            aria-label={t('chat.doc.openExternal')}
            className={`no-drag inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 ${openFailed ? 'border-danger/40 text-danger' : 'border-border bg-elevated text-muted hover:bg-hover hover:text-fg'}`}
          >
            {opening ? <Loader2 size={13} className="animate-spin" /> : <ExternalLink size={13} />}
            {t('chat.doc.openExternal')}
          </button>
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
