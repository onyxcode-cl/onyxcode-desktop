/**
 * Aviso al abrir una carpeta que trae ayudantes de `.claude/agents`: el motor los carga como ayudantes de la conversación. Los nombres vienen de
 * archivos del proyecto, así que se pintan como TEXTO PLANO. Se descarta por carpeta (y vuelve si cambian los nombres). Solo escritorio.
 */
import { useEffect, useState } from 'react'
import { Users } from 'lucide-react'
import { CLAUDE_NAMES_SHOWN } from '@shared/helper-agents'
import { call } from '../../../lib/api'
import { useT } from '../../../lib/i18n'
import { useUi } from '../../../stores/ui'

const KEY = 'code.helpers.claudeNotice'

function dismissedFor(dir: string): string | null {
  try {
    return localStorage.getItem(`${KEY}:${dir}`)
  } catch {
    return null
  }
}

export function ForeignAgentsNotice({ directory }: { directory: string }): React.JSX.Element | null {
  const t = useT()
  const [names, setNames] = useState<string[]>([])
  const [hidden, setHidden] = useState(false)
  const openSettingsAt = useUi((s) => s.openSettingsAt)

  useEffect(() => {
    let alive = true
    setNames([])
    setHidden(false)
    Promise.resolve()
      .then(() => call('helpers:inspectForeign', { directory }))
      .then((r) => {
        if (alive && Array.isArray(r?.names)) setNames(r.names)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [directory])

  const signature = names.join('|')
  if (names.length === 0 || hidden || dismissedFor(directory) === signature) return null
  const shown = names.slice(0, CLAUDE_NAMES_SHOWN).join(', ')
  const extra = names.length - CLAUDE_NAMES_SHOWN
  const list = extra > 0 ? `${shown} ${t('code.helpers.claudeNotice.more', { n: extra })}` : shown

  const dismiss = (): void => {
    try {
      localStorage.setItem(`${KEY}:${directory}`, signature)
    } catch {
      // sin storage: solo se oculta ahora
    }
    setHidden(true)
  }

  return (
    <div
      role="note"
      className="mx-6 mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-elevated px-3.5 py-2.5 text-sm"
    >
      <Users size={16} className="shrink-0 text-muted" />
      <div className="min-w-0 flex-1 basis-64">
        <p className="font-medium">{t('code.helpers.claudeNotice.title')}</p>
        <p className="break-words text-xs text-muted">{t('code.helpers.claudeNotice.body', { names: list })}</p>
      </div>
      <button
        type="button"
        onClick={() => openSettingsAt('helpers')}
        className="shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-hover"
      >
        {t('code.helpers.claudeNotice.open')}
      </button>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-hover hover:text-fg"
      >
        {t('code.helpers.claudeNotice.dismiss')}
      </button>
    </div>
  )
}
