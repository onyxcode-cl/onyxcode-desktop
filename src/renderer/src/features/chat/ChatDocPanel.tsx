/**
 * Panel de documento de Chat: la vista nativa (misma del visor de documentos) ya está abierta
 * (`useChatDocPanel` llamó a `extras:chatDoc:open`); esto solo mide el hueco y pone la cabecera.
 */
import { useState } from 'react'
import { AlertTriangle, ExternalLink, Loader2, Maximize2, Minimize2, X } from 'lucide-react'
import { isDocxSpec, isPptxSpec, isXlsxSpec } from '@shared/chat-doc-spec'
import { getExtras } from '../../lib/extrasApi'
import { parseDataBlock } from '../../lib/chatDocBlocks'
import { useT } from '../../lib/i18n'
import { DownloadPdfButton, DownloadSlidesPptxButton, PresentSlidesButton } from '../../components/artifacts/ArtifactButton'
import { DownloadDataDocButton } from '../../components/artifacts/DataDocButton'
import type { ChatDocBlockKind } from '../../lib/chatDocPreview'
import { requestCraftInstall } from '../settings/impl/CraftComponentCard'
import { useChatDocViewport } from './useChatDocViewport'
import type { ChatDocNotice } from './useChatDocPanel'

const KIND_LABEL: Record<ChatDocBlockKind, 'chat.doc.kindPdf' | 'chat.doc.kindXlsx' | 'chat.doc.kindPptx' | 'chat.doc.kindDocx'> = {
  html: 'chat.doc.kindPdf',
  xlsx: 'chat.doc.kindXlsx',
  pptx: 'chat.doc.kindPptx',
  docx: 'chat.doc.kindDocx'
}

interface Props {
  creating: boolean
  notice?: ChatDocNotice
  onRetry?: () => void
  title: string
  doc: { kind: ChatDocBlockKind; rawText: string; isSlides: boolean } | null
  fullscreen: boolean
  onToggleFullscreen: () => void
  onClose: () => void
}

export function ChatDocPanel({
  creating,
  notice = null,
  onRetry,
  title,
  doc,
  fullscreen,
  onToggleFullscreen,
  onClose
}: Props): React.JSX.Element {
  const t = useT()
  const { hostRef, shouldShowNative } = useChatDocViewport(true)
  const [opening, setOpening] = useState(false)
  const [openFailed, setOpenFailed] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [installFailed, setInstallFailed] = useState(false)

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

  // Word sin ArtCraft: ofrece instalarlo (pide el mismo consentimiento que Ajustes) y vuelve a generar el documento.
  const installCraft = async (): Promise<void> => {
    setInstalling(true)
    setInstallFailed(false)
    try {
      const r = await requestCraftInstall(t)
      if (r.kind === 'installed') onRetry?.()
      else if (r.kind === 'failed') setInstallFailed(true)
    } catch {
      setInstallFailed(true)
    } finally {
      setInstalling(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border">
      <div className="drag flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-2 desk:h-12 desk:py-0 desk:pr-[calc(var(--controls-inset,0px)+12px)]">
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
          className="no-drag rounded-md p-1 text-muted hover:bg-hover hover:text-fg"
        >
          {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="no-drag rounded-md p-1 text-muted hover:bg-hover hover:text-fg"
        >
          <X size={14} />
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={hostRef} className="absolute inset-0" style={{ visibility: shouldShowNative ? 'visible' : 'hidden' }} />
        {notice && !creating && (
          <div
            role="alert"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-elevated px-6 text-center text-muted"
          >
            <AlertTriangle size={20} className="text-warning" />
            <span className="max-w-sm text-[12.5px] leading-[18px]">
              {notice === 'craft-missing' ? t('chat.doc.craftMissing') : t('chat.doc.failed')}
            </span>
            {installFailed && <span className="max-w-sm text-[12px] text-danger">{t('chat.doc.craftInstallFailed')}</span>}
            {notice === 'craft-missing' && (
              <button
                type="button"
                onClick={() => void installCraft()}
                disabled={installing}
                className="no-drag inline-flex items-center gap-1.5 rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-hover disabled:opacity-50"
              >
                {installing && <Loader2 size={13} className="animate-spin" />}
                {installing ? t('chat.doc.craftInstalling') : t('chat.doc.craftInstall')}
              </button>
            )}
          </div>
        )}
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
