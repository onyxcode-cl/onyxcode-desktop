import { useMemo, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { friendlyError } from '@shared/ai-errors'
import { useLang, useT } from '../../lib/i18n'
import { isRemoteSurface } from '../../lib/platform'
import { useProviders } from '../../stores/providers'
import { useUi } from '../../stores/ui'
import { Button } from '../Button'

/**
 * Error de la IA para personas: título y mensaje claros, botón para conectar una IA cuando toca y el
 * texto técnico (redactado) plegado en «Ver detalle». Nunca muestra pilas ni mensajes crudos.
 * - `panel`: Code y Tareas. - `chat`: Chat (más suave, con animación de entrada).
 */
export interface ErrorActions {
  /** «Reintentar»: se ofrece en los fallos que pueden ser pasajeros (red, cuota, desconocido). */
  onRetry?: () => void | Promise<unknown>
  /** «Compactar»: se ofrece cuando la conversación no cabe en el contexto del modelo. */
  onCompact?: () => void | Promise<unknown>
}

export function ErrorNotice({
  error,
  variant = 'panel',
  onRetry,
  onCompact
}: { error: unknown; variant?: 'chat' | 'panel' } & ErrorActions): React.JSX.Element {
  const t = useT()
  const lang = useLang((s) => s.lang)
  const providers = useProviders((s) => s.providers)
  const f = useMemo(() => {
    const providerNames: Record<string, string> = {}
    for (const p of providers) providerNames[p.id] = p.name
    return friendlyError(error, { providerNames })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `lang` fuerza el recálculo al cambiar de idioma
  }, [error, providers, lang])
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const chat = variant === 'chat'
  const [pending, setPending] = useState(false)
  /** Mientras la acción corre el botón se deshabilita (evita doble envío); un fallo lo vuelve a habilitar. */
  const run = async (fn: () => void | Promise<unknown>): Promise<void> => {
    setPending(true)
    try {
      await fn()
    } catch {
      /* el fallo queda en el estado de la sesión */
    } finally {
      setPending(false)
    }
  }
  const handler = f.action === 'retry' ? onRetry : f.action === 'compact' ? onCompact : undefined

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(f.detail ?? '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* portapapeles no disponible: sin efecto */
    }
  }

  return (
    <div
      role="alert"
      className={
        chat
          ? 'mt-2 flex animate-fade-in items-start gap-2 rounded-lg border border-danger/30 bg-danger/8 px-3 py-2 text-sm text-danger'
          : 'flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger'
      }
    >
      <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{f.title}</div>
        <p className="mt-0.5 break-words">{f.message}</p>
        {f.action === 'connect' && (
          <div className="mt-2">
            <Button
              size="sm"
              variant="primary"
              className={isRemoteSurface() ? 'min-h-11 px-4' : undefined}
              onClick={() => useUi.getState().openSettingsAt('models', 'providers')}
            >
              {t('chat.error.connect')}
            </Button>
          </div>
        )}
        {handler && (
          <div className="mt-2">
            <Button
              size="sm"
              variant="primary"
              className={isRemoteSurface() ? 'min-h-11 px-4' : undefined}
              disabled={pending}
              onClick={() => void run(handler)}
            >
              {f.action === 'compact' ? t('chat.error.compact') : t('chat.error.retry')}
            </Button>
          </div>
        )}
        {f.detail && (
          // Controlado: el evento `toggle` de <details> llega en una tarea posterior y dejaba el rótulo («Ver detalle»)
          // desfasado respecto al contenido ya visible (prueba inestable no-ai (d)). Así el rótulo y el contenido van juntos.
          <details open={open} className="mt-2 text-xs text-muted">
            <summary
              className={`cursor-pointer text-subtle select-none hover:text-fg ${isRemoteSurface() ? 'inline-flex min-h-11 items-center' : ''}`}
              onClick={(e) => {
                e.preventDefault()
                setOpen((o) => !o)
              }}
            >
              {open ? t('chat.error.hideDetail') : t('chat.error.showDetail')}
            </summary>
            <pre className="mt-1.5 max-h-48 overflow-auto rounded-md border border-border/70 bg-inset px-2.5 py-2 font-mono text-[11.5px] break-words whitespace-pre-wrap text-muted select-text">
              {f.detail}
            </pre>
            <button
              type="button"
              onClick={() => void copy()}
              className={`no-drag mt-1.5 text-subtle underline-offset-2 hover:text-fg hover:underline ${isRemoteSurface() ? 'min-h-11' : ''}`}
            >
              {copied ? t('chat.error.copied') : t('chat.error.copy')}
            </button>
          </details>
        )}
      </div>
    </div>
  )
}
