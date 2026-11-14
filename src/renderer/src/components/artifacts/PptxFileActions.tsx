import { useState } from 'react'
import { Eye, Loader2, Presentation } from 'lucide-react'
import type { ChatFileInfo } from '@shared/ipc-extras'
import { getExtras } from '../../lib/extrasApi'
import { useT } from '../../lib/i18n'
import { isRemoteSurface } from '../../lib/platform'
import { viewChatFile } from '../../lib/chatFileView'
import { cw } from '../../features/tasks/impl/bridge'

export type PptxSource = { kind: 'chat' | 'tasks'; path: string } | { kind: 'attachment'; name: string; base64: string }

/** Los bytes originales solo van a main, nunca al modelo. Cada acción en disco revalida su ámbito. */
export function PptxFileActions({
  source,
  onView,
  compact = false
}: {
  source: PptxSource
  onView?: () => void
  compact?: boolean
}): React.JSX.Element | null {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (isRemoteSurface()) return null
  const run = async (present: boolean): Promise<void> => {
    const extras = getExtras()
    if (!extras || busy) return
    setBusy(true)
    setError(null)
    try {
      let info: ChatFileInfo | undefined
      const path =
        source.kind === 'attachment'
          ? (info = await extras.invoke('extras:importPptx', { name: source.name, base64: source.base64 })).path
          : source.path
      if (present) {
        if (source.kind === 'tasks') await cw('tasks:presentPptx', { path })
        else await extras.invoke('extras:presentPptx', { path })
      } else if (info) {
        if (!viewChatFile({ ...info, name: source.kind === 'attachment' ? source.name : info.name }))
          throw new Error(t('viewer.pptx.failed'))
      } else onView?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('viewer.pptx.failed'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className="no-drag inline-flex flex-wrap items-center gap-1 text-xs">
      {(source.kind === 'attachment' || onView) && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(false)}
          title={t('viewer.pptx.preview')}
          aria-label={t('viewer.pptx.preview')}
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 hover:bg-hover disabled:opacity-50"
        >
          <Eye size={13} />
          {!compact && t('viewer.pptx.preview')}
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => void run(true)}
        title={t('viewer.pptx.note')}
        aria-label={t('viewer.pptx.present')}
        className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 hover:bg-hover disabled:opacity-50"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Presentation size={13} />}
        {!compact && t(busy ? 'viewer.pptx.busy' : 'viewer.pptx.present')}
      </button>
      {!compact && <span className="basis-full text-muted">{t('viewer.pptx.note')}</span>}
      {error && (
        <span role="alert" className="basis-full text-danger">
          {error}
        </span>
      )}
    </span>
  )
}
