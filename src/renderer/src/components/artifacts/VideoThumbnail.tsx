import { useEffect, useState } from 'react'
import { Film } from 'lucide-react'
import type { VideoFilePreview } from '@shared/ipc-extras'
import { getExtras } from '../../lib/extrasApi'
import { useT } from '../../lib/i18n'
import { cw } from '../../features/tasks/impl/bridge'

export function VideoThumbnail({
  path,
  onOpen,
  task = false,
  preview
}: {
  path: string
  onOpen: () => void
  task?: boolean
  preview?: VideoFilePreview
}): React.JSX.Element {
  const t = useT()
  const [result, setResult] = useState<{ path: string; video?: VideoFilePreview } | null>(null)
  useEffect(() => {
    if (preview) return
    let alive = true
    const request = task
      ? cw('tasks:previewFile', { path }).then((r) => r.video)
      : getExtras()
          ?.invoke('extras:chatFile:info', { paths: [path] })
          .then((r) => r[0]?.video)
    void request
      ?.then((video) => {
        if (alive) setResult({ path, video })
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [path, task, preview])
  const video = preview ?? (result?.path === path ? result.video : undefined)
  const seconds = video ? Math.round(video.duration) : null
  const duration = seconds === null ? null : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  return (
    <button
      type="button"
      aria-label={t('viewer.video.preview')}
      onClick={onOpen}
      className="relative my-1 flex h-24 w-32 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-code text-accent"
    >
      {video?.poster ? <img src={video.poster} alt="" className="h-full w-full object-contain" /> : <Film size={24} aria-hidden="true" />}
      {duration && <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 text-xs text-white">{duration}</span>}
    </button>
  )
}
