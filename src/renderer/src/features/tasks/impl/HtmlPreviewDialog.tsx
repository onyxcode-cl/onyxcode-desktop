/** HTML entregado por Tareas: mismo render aislado y acciones que el panel de Chat. */
import { useEffect, useState } from 'react'
import { getLang } from '@shared/i18n'
import type { ArtifactContext } from '@shared/ipc-extras'
import type { TasksDeliverable } from '@shared/ipc-tasks'
import { hasHtmlSlides, MAX_ARTIFACT_HTML_BYTES } from '@shared/slides-html'
import { useT } from '../../../lib/i18n'
import { getExtras } from '../../../lib/extrasApi'
import { useAppTheme } from '../../../lib/useAppTheme'
import { errorMessage } from '../../../lib/opencode'
import { ChatDocPanel } from '../../chat/ChatDocPanel'
import type { ChatDocProblem } from '../../chat/useChatDocPanel'
import { cw } from './bridge'
import { useTasks } from './store'
import { baseName } from './util'

export function HtmlPreviewDialog({ file, onClose }: { file: TasksDeliverable; onClose: () => void }): React.JSX.Element {
  const t = useT()
  const viewFailed = t('chat.file.viewFailed')
  const folder = useTasks((s) => s.folder)
  const theme = useAppTheme()
  const [attempt, setAttempt] = useState(0)
  const [creating, setCreating] = useState(true)
  const [problem, setProblem] = useState<ChatDocProblem | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [doc, setDoc] = useState<{ kind: 'html'; rawText: string; isSlides: boolean; context: ArtifactContext } | null>(null)
  const title = baseName(file.path).replace(/\.[^.]+$/, '')
  useEffect(() => {
    let cancelled = false
    const extras = getExtras()
    // Cada apertura/reintento tiene carpeta propia: un cierre tardío nunca limpia la siguiente.
    const sessionId = `tasks-html-${crypto.randomUUID()}`
    setCreating(true)
    setProblem(null)
    setDoc(null)
    const context: ArtifactContext = { kind: 'file', path: file.path, root: file.root ?? folder ?? undefined }
    const open = async (): Promise<void> => {
      if (!extras) throw new Error(viewFailed)
      const preview = await cw('tasks:previewFile', { path: file.path, maxBytes: MAX_ARTIFACT_HTML_BYTES })
      if (cancelled) return
      if (preview.kind !== 'text' || preview.truncated || !preview.content?.trim()) {
        setProblem({ reason: 'invalid' })
        return
      }
      const html = preview.content
      setDoc({ kind: 'html', rawText: html, isSlides: hasHtmlSlides(html), context })
      const result = await extras.invoke('extras:chatDoc:open', { kind: 'pdf', html, title, sessionId, lang: getLang(), theme, context })
      if (!cancelled && !result.ok) setProblem({ reason: result.reason, detail: result.detail })
    }
    void open()
      .catch((error: unknown) => {
        if (!cancelled) setProblem({ reason: 'failed', detail: errorMessage(error) })
      })
      .finally(() => {
        if (!cancelled) setCreating(false)
      })
    return () => {
      cancelled = true
      void extras?.invoke('extras:chatDoc:close', { sessionId }).catch(() => undefined)
    }
  }, [file.path, file.root, folder, title, theme, attempt, viewFailed])
  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', key)
    const off = getExtras()?.on('extras:chatDoc:event', (event) => {
      if (event.type === 'escape') onClose()
    })
    return () => {
      document.removeEventListener('keydown', key)
      off?.()
    }
  }, [onClose])
  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 ${fullscreen ? '' : 'p-6'}`}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="h-full w-full max-w-7xl overflow-hidden rounded-2xl bg-elevated shadow-xl"
      >
        <ChatDocPanel
          creating={creating}
          title={title}
          doc={doc ?? (problem ? { kind: 'html', rawText: '', isSlides: false, context: { kind: 'file', path: file.path } } : null)}
          problem={problem}
          onRetry={() => setAttempt((value) => value + 1)}
          fullscreen={fullscreen}
          onToggleFullscreen={() => setFullscreen((value) => !value)}
          onClose={onClose}
        />
      </div>
    </div>
  )
}
