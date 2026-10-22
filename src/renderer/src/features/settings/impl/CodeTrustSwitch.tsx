/**
 * Interruptor «Sin preguntar en Code» de un conector (Ajustes › Conectores). Por defecto apagado: en Code la IA pide permiso en cada
 * uso del conector; al encenderlo la persona declara que confía en él. Solo escribe `Settings.codeTrustedMcp`.
 * Los conectores internos de la app (`browser`…) no son configurables y no usan este componente.
 */
import { useId } from 'react'
import { isInternalCodeMcp, normalizeCodeTrustedMcp, withCodeTrust } from '@shared/mcp-permissions'
import { useT } from '../../../lib/i18n'
import { useSettings } from '../../../stores/settings'
import { Toggle } from './ui'

export function CodeTrustSwitch({ name, disabled }: { name: string; disabled?: boolean }): React.JSX.Element | null {
  const t = useT()
  const id = useId()
  const stored = useSettings((s) => s.settings.codeTrustedMcp)
  const update = useSettings((s) => s.update)
  if (isInternalCodeMcp(name)) return null
  const trusted = normalizeCodeTrustedMcp(stored)
  return (
    <div
      role="group"
      aria-labelledby={`${id}-l`}
      aria-describedby={`${id}-d`}
      className="mt-3 rounded-lg border border-border bg-bg px-3 py-2.5"
    >
      <label className="flex items-center gap-2 text-xs">
        <Toggle
          checked={trusted.includes(name)}
          disabled={disabled}
          label={t('mcp.codeTrust.label')}
          onChange={(v) => void update({ codeTrustedMcp: withCodeTrust(trusted, name, v) })}
        />
        <span id={`${id}-l`} className="font-medium">
          {t('mcp.codeTrust.label')}
        </span>
      </label>
      <p id={`${id}-d`} className="mt-1.5 text-[11px] desk:text-meta text-subtle">
        {t('mcp.codeTrust.desc')}
      </p>
    </div>
  )
}
