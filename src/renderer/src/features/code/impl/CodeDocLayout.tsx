/** Código monta el panel del Chat; el visor y su ciclo de vida siguen siendo los mismos. */
import type { ReactNode } from 'react'
import type { MessageEntry } from '../../../stores/sessions'
import { ChatDocPanel } from '../../chat/ChatDocPanel'
import { ChatFilePanel } from '../../chat/ChatFilePanel'
import { useChatDocPanel } from '../../chat/useChatDocPanel'

// En Código se abren archivos validados desde las tarjetas, sin interpretar los bloques JSON del modelo como documentos del Chat.
const EMPTY_ENTRIES: MessageEntry[] = []

export function CodeDocLayout({
  sessionId,
  containerWidth,
  children
}: {
  sessionId: string | null
  containerWidth: number
  children: (documentOpen: boolean) => ReactNode
}): React.JSX.Element {
  const panel = useChatDocPanel(sessionId, EMPTY_ENTRIES)
  const fullscreen = panel.open && panel.fullscreen
  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-1">
      <div className={`min-h-0 min-w-0 flex-1 ${fullscreen ? 'hidden' : 'flex'}`}>{children(panel.open)}</div>
      {panel.open && (
        <div
          data-code-doc-panel
          className={`shrink-0 bg-bg ${fullscreen ? 'w-full' : containerWidth < 900 ? 'absolute inset-y-0 right-0 z-30 w-[min(100%,28rem)] shadow-2xl' : 'w-[42%] min-w-[360px] max-w-[640px]'}`}
        >
          {panel.file?.mode === 'inline' ? (
            <ChatFilePanel
              file={panel.file}
              fullscreen={panel.fullscreen}
              onToggleFullscreen={panel.toggleFullscreen}
              onClose={panel.close}
            />
          ) : (
            <ChatDocPanel
              creating={panel.creating}
              title={panel.title}
              doc={panel.doc}
              problem={panel.problem}
              file={panel.file}
              onRetry={panel.retry}
              fullscreen={panel.fullscreen}
              onToggleFullscreen={panel.toggleFullscreen}
              onClose={panel.close}
            />
          )}
        </div>
      )}
    </div>
  )
}
