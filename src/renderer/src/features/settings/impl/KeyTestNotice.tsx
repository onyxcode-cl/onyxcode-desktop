import { CheckCircle2, CircleAlert, Info, Loader2 } from 'lucide-react'
import { keyTestText, type KeyTestTone } from '@shared/key-test'
import { useKeyTest } from './useKeyTest'

const TONE_CLASS: Record<KeyTestTone, string> = {
  ok: 'text-success',
  warn: 'text-warning',
  error: 'text-danger',
  info: 'text-muted'
}

/**
 * Resultado de «Probar clave» de un proveedor (título + explicación). No muestra nada si aún no se probó.
 * `action` = botón opcional a la derecha del título (p. ej. «Cambiar clave»).
 */
export function KeyTestNotice({
  providerID,
  providerName,
  className = 'mt-2',
  action
}: {
  providerID: string | null
  providerName: string
  className?: string
  action?: React.ReactNode
}): React.JSX.Element | null {
  const { entry } = useKeyTest(providerID)
  if (!entry) return null
  if (entry.phase === 'testing')
    return (
      <p role="status" aria-live="polite" data-key-test="testing" className={`flex items-center gap-1.5 text-xs text-muted ${className}`}>
        <Loader2 size={12} className="animate-spin" /> Probando la clave de {providerName}…
      </p>
    )
  if (entry.phase === 'error')
    return (
      <p role="status" aria-live="polite" data-key-test="error" className={`flex items-center gap-1.5 text-xs text-warning ${className}`}>
        <CircleAlert size={12} /> {entry.message}
      </p>
    )
  const t = keyTestText(entry.result, providerName)
  const Icon = t.tone === 'ok' ? CheckCircle2 : t.tone === 'info' ? Info : CircleAlert
  return (
    <div role="status" aria-live="polite" data-key-test={entry.result.status} className={`flex items-start gap-1.5 text-xs ${className}`}>
      <Icon size={13} className={`mt-px shrink-0 ${TONE_CLASS[t.tone]}`} />
      <div className="min-w-0">
        <span className={`font-medium ${TONE_CLASS[t.tone]}`}>{t.title}</span>
        {t.tone !== 'ok' && <span className="text-muted"> — {t.message}</span>}
        {action && <span className="ml-2">{action}</span>}
      </div>
    </div>
  )
}
