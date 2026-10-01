import { useCallback, useEffect, useState } from 'react'
import { Info, X } from 'lucide-react'
import type { OpencodeInfo } from '@shared/types'
import { call } from '../lib/api'
import { useT } from '../lib/i18n'
import { engineNoticeText } from '../lib/engine-notice'
import { useServer } from '../stores/server'

const DISMISS_KEY = 'onyx.engineNotice.dismissed'

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY)
  } catch {
    return null
  }
}

/** Aviso NO bloqueante y cerrable: el motor en uso no es el probado con esta versión de la app. */
export function EngineNotice(): React.JSX.Element | null {
  const t = useT()
  const state = useServer((s) => s.status.state)
  const [info, setInfo] = useState<OpencodeInfo | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(readDismissed)

  useEffect(() => {
    let alive = true
    call('app:opencodeInfo')
      .then((i) => alive && setInfo(i))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [state])

  const close = useCallback(() => {
    if (!info?.version) return
    setDismissed(info.version)
    try {
      localStorage.setItem(DISMISS_KEY, info.version)
    } catch {
      /* sin localStorage: se cierra solo hasta recargar */
    }
  }, [info])

  const text = engineNoticeText(info, dismissed)
  if (!text) return null
  return (
    <div
      role="status"
      className="flex animate-fade-in items-center gap-2.5 border-b border-warning/25 bg-warning/8 px-4 py-2 text-xs text-warning"
    >
      <Info size={14} className="shrink-0" />
      <span className="flex-1">{text}</span>
      <button
        type="button"
        aria-label={t('notices.close')}
        onClick={close}
        className="flex shrink-0 items-center rounded-md p-0.5 transition-colors hover:bg-warning/15"
      >
        <X size={13} />
      </button>
    </div>
  )
}
