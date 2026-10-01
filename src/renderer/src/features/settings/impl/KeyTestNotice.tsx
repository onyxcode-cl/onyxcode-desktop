import { CheckCircle2, CircleAlert, Info, Loader2 } from 'lucide-react'
import { keyTestText, type KeyTestTone } from '@shared/key-test'
import { useT } from '../../../lib/i18n'
import { useKeyTest, type KeyTestEntry } from './useKeyTest'

const TONE_CLASS: Record<KeyTestTone, string> = {
  ok: 'text-success',
  warn: 'text-warning',
  error: 'text-danger',
  info: 'text-muted'
}

/**
 * Resultado de «Probar clave» de un proveedor (título + explicación). No muestra nada si aún no se probó.
 * `action` = botón opcional junto al título (p. ej. «Cambiar clave»).
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
  return <KeyTestView entry={entry} providerName={providerName} className={className} action={action} />
}

/** Parte visual de `KeyTestNotice` (sin store: se prueba por separado). */
export function KeyTestView({
  entry,
  providerName,
  className = 'mt-2',
  action
}: {
  entry: KeyTestEntry | undefined
  providerName: string
  className?: string
  action?: React.ReactNode
}): React.JSX.Element | null {
  const t = useT()
  if (!entry) return null
  if (entry.phase === 'testing')
    return (
      <p role="status" aria-live="polite" data-key-test="testing" className={`flex items-center gap-1.5 text-xs text-muted ${className}`}>
        <Loader2 size={12} className="animate-spin" /> {t('models.keyTest.testing', { name: providerName })}
      </p>
    )
  if (entry.phase === 'error')
    return (
      <p role="status" aria-live="polite" data-key-test="error" className={`flex items-center gap-1.5 text-xs text-warning ${className}`}>
        <CircleAlert size={12} /> {entry.message}
      </p>
    )
  const text = keyTestText(entry.result, providerName)
  const Icon = text.tone === 'ok' ? CheckCircle2 : text.tone === 'info' ? Info : CircleAlert
  return (
    <div role="status" aria-live="polite" data-key-test={entry.result.status} className={`flex items-start gap-1.5 text-xs ${className}`}>
      <Icon size={13} className={`mt-px shrink-0 ${TONE_CLASS[text.tone]}`} />
      <div className="min-w-0">
        <span className={`font-medium ${TONE_CLASS[text.tone]}`}>{text.title}</span>
        {text.tone !== 'ok' && <span className="text-muted"> — {text.message}</span>}
        {action && <span className="ml-2">{action}</span>}
      </div>
    </div>
  )
}
