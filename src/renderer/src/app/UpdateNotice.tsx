import { Download, X } from 'lucide-react'
import { api, call } from '../lib/api'
import { downloadUrl, updateNoticeText } from '../lib/update-notice'
import { useUpdateState } from '../lib/use-update-state'

/** Aviso NO bloqueante de versión nueva (sin autoinstalación: «Descargar» abre la página de la release). */
export function UpdateNotice(): React.JSX.Element | null {
  const [state, setState] = useUpdateState()
  const text = updateNoticeText(state)
  const url = downloadUrl(state)
  if (!text || !state?.latest) return null
  const version = state.latest.version

  const later = (): void => {
    call('app:dismissUpdate', { version })
      .then(setState)
      .catch(() => undefined)
  }

  return (
    <div
      role="status"
      data-testid="update-notice"
      className="flex animate-fade-in items-center gap-2.5 border-b border-accent/25 bg-accent-soft px-4 py-2 text-xs text-accent"
    >
      <Download size={14} className="shrink-0" />
      <span className="flex-1">{text}</span>
      {url && (
        <button
          type="button"
          onClick={() => void api.invoke('app:openExternal', { url })}
          className="no-drag shrink-0 rounded-md px-2 py-0.5 font-medium underline-offset-2 transition-colors hover:bg-accent/15 hover:underline"
        >
          Descargar
        </button>
      )}
      <button type="button" onClick={later} className="no-drag shrink-0 rounded-md px-2 py-0.5 transition-colors hover:bg-accent/15">
        Más tarde
      </button>
      <button
        type="button"
        aria-label="Cerrar aviso"
        onClick={later}
        className="flex shrink-0 items-center rounded-md p-0.5 transition-colors hover:bg-accent/15"
      >
        <X size={13} />
      </button>
    </div>
  )
}
