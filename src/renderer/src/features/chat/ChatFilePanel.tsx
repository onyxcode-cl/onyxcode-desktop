/**
 * Panel lateral del Chat para un archivo del disco que se muestra DENTRO de la interfaz: imagen (como `<img>` con un data URL: sin
 * scripts), texto, Markdown (con el mismo renderizador del chat, que no ejecuta HTML) y código (texto plano). Main lee el archivo
 * con tope de tamaño y solo desde carpetas permitidas; aquí no hay `iframe` ni HTML en bruto. PDF/Office van por el visor nativo
 * (`ChatDocPanel`) y las páginas web por la vista previa aislada de siempre.
 */
import { Loader2, Maximize2, Minimize2, X } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { Markdown } from '../../components/Markdown'
import { ChatFileButtons, kindLabelKey } from './ChatFiles'
import type { ChatFileView } from './useChatDocPanel'

interface Props {
  file: ChatFileView
  fullscreen: boolean
  onToggleFullscreen: () => void
  onClose: () => void
}

export function ChatFilePanel({ file, fullscreen, onToggleFullscreen, onClose }: Props): React.JSX.Element {
  const t = useT()
  const { info, content } = file
  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border" data-chat-file-panel={info.kind}>
      <div className="drag flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-2 desk:h-12 desk:py-0 desk:pr-[calc(var(--controls-inset,0px)+12px)]">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={info.path}>
          {info.name} <span className="text-subtle">· {t(kindLabelKey(info))}</span>
        </span>
        <ChatFileButtons info={info} compact />
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
      <div className="min-h-0 flex-1 overflow-auto bg-elevated">
        {file.status === 'loading' && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-[12.5px]">{t('chat.file.loading')}</span>
          </div>
        )}
        {file.status === 'error' && (
          <p role="alert" className="p-4 text-[13px] text-muted">
            {t(file.error ?? 'chat.file.viewFailed')}
          </p>
        )}
        {file.status === 'ready' && content?.ok && content.kind === 'image' && (
          <div className="flex min-h-full items-center justify-center p-4">
            <img
              src={content.dataUrl}
              alt={t('chat.file.imageAlt', { name: info.name })}
              className="max-h-full max-w-full rounded-lg object-contain"
            />
          </div>
        )}
        {file.status === 'ready' && content?.ok && content.kind !== 'image' && (
          <div className="p-4">
            {content.truncated && <p className="mb-3 text-meta text-muted">{t('chat.file.truncated')}</p>}
            {content.kind === 'markdown' ? (
              <Markdown text={content.text} />
            ) : (
              <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-fg select-text">
                {content.text}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
