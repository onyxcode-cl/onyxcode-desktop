import { subcommandRuleSummary } from '@shared/auto-review'
import { useT } from '../../lib/i18n'

/** Visible junto al comando: la persona sabe qué recordará «siempre» antes de pulsarlo. */
export function RememberRules({
  metadata,
  rules,
  available = true
}: {
  metadata: unknown
  rules: string[]
  available?: boolean
}): React.JSX.Element {
  const t = useT()
  const summary = subcommandRuleSummary(metadata)
  return (
    <div className="break-all text-meta text-muted">
      {available && rules.length > 0 && <p>{t('perm.allowProjectRules', { rules: rules.join(', ') })}</p>}
      {summary && summary.excluded.length > 0 && <p>{t('perm.rulesExcluded', { commands: summary.excluded.join('; ') })}</p>}
      {summary?.truncated && <p>{t('perm.rulesLimit')}</p>}
    </div>
  )
}
