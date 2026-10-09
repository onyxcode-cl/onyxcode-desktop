/**
 * Panel del visor de documentos (Fase 0 del plan del visor): abre `path` con `tasks:viewer:open`,
 * sincroniza la vista nativa con `useViewerViewport` y cierra con `tasks:viewer:close` al
 * desmontarse. F1-F4 construyen el visor real por tipo; acá solo se abre/cierra el token y se
 * posiciona la vista — lo que se VE adentro lo pinta `src/viewer/` (otro proceso).
 */
import { useEffect, useState } from 'react'
import { AlertCircle, Loader2, X } from 'lucide-react'
import { getLang } from '@shared/i18n'
import { useT } from '../../../lib/i18n'
import { errorMessage } from '../../../lib/opencode'
import { cw } from './bridge'
import { baseName } from './util'
import { useViewerViewport } from './useViewerViewport'

type OpenState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready' }

function currentTheme(): 'light' | 'dark' {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

export function DocumentViewerPanel({
  path,
  visible,
  onClose
}: {
  path: string
  visible: boolean
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const [state, setState] = useState<OpenState>({ kind: 'loading' })
  const { hostRef, shouldShowNative } = useViewerViewport(visible)

  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' })
    cw('tasks:viewer:open', { path, lang: getLang(), theme: currentTheme() })
      .then((res) => {
        if (cancelled) return
        if (res.ok) setState({ kind: 'ready' })
        else setState({ kind: 'error', message: t(res.reason === 'too-large' ? 'merr.viewer.tooLarge' : 'merr.viewer.unsupported') })
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: errorMessage(err) || t('merr.viewer.openFailed') })
      })
    return () => {
      cancelled = true
      void cw('tasks:viewer:close').catch(() => undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={path}>
          {baseName(path)}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('tasks.deliv.close')}
          className="rounded-md p-1 text-muted hover:bg-hover hover:text-fg"
        >
          <X size={14} />
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        {state.kind === 'loading' && (
          <div className="flex h-full items-center justify-center text-muted">
            <Loader2 size={18} className="animate-spin" />
          </div>
        )}
        {state.kind === 'error' && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-danger">
            <AlertCircle size={18} />
            <p>{state.message}</p>
          </div>
        )}
        <div
          ref={hostRef}
          className="absolute inset-0"
          style={{ visibility: state.kind === 'ready' && shouldShowNative ? 'visible' : 'hidden' }}
        />
      </div>
    </div>
  )
}
