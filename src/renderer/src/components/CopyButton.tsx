import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { useT } from '../lib/i18n'

/** Botón de copiar reutilizable (código, mensajes). */
export function CopyButton({
  text,
  label,
  className = '',
  showLabel = false,
  size = 13
}: {
  text: string | (() => string)
  label?: string
  className?: string
  showLabel?: boolean
  size?: number
}): React.JSX.Element {
  const tr = useT()
  const labelText = label ?? tr('common.copy')
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    const value = typeof text === 'function' ? text() : text
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? tr('common.copied') : labelText}
      aria-label={labelText}
      className={`no-drag inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-muted transition-colors hover:bg-hover hover:text-fg ${className}`}
    >
      {copied ? <Check size={size} className="text-success" /> : <Copy size={size} />}
      {showLabel && <span>{copied ? tr('common.copied') : labelText}</span>}
    </button>
  )
}
