import { useEffect, useState } from 'react'
import { parseAlwaysList } from '@shared/engine-always'
import { call } from '../../lib/api'
import { subcommandRuleSummary, vetoedRulePart } from '@shared/auto-review'
import { useT } from '../../lib/i18n'

/** Visible junto al comando: la persona sabe qué recordará «siempre» antes de pulsarlo. */
export function RememberRules({
  metadata,
  rules,
  available = true,
  showLimit = true
}: {
  metadata: unknown
  rules: string[]
  available?: boolean
  showLimit?: boolean
}): React.JSX.Element {
  const t = useT()
  const summary = subcommandRuleSummary(metadata)
  return (
    <div className="break-all text-meta text-muted">
      {available && rules.length > 0 && <p>{t('perm.allowProjectRules', { rules: rules.join(', ') })}</p>}
      {summary?.exclusions
        .filter((e) => available || e.reason !== 'blocked' || vetoedRulePart(e.command))
        .map((e) => (
          <p key={e.command}>{t('perm.rulesExcluded', { commands: e.command, reason: t(`perm.rulesExcluded.${e.reason}`) })}</p>
        ))}
      {showLimit && summary?.truncated && <p>{t('perm.rulesLimit')}</p>}
    </div>
  )
}

/** Solo presentación: ninguna carga de reglas retrasa/deshabilita el botón ni participa en la respuesta. */
export function useNewPermissionRules(
  rules: string[],
  permission: string,
  directory: string | null,
  requestID: string,
  connection?: { baseUrl: string; authorization: string } | null
): string[] {
  const [saved, setSaved] = useState<{ scope: string; patterns: string[] } | null>(null)
  const baseUrl = connection?.baseUrl
  const authorization = connection?.authorization
  const enabled = connection !== null && rules.length > 0
  const scope = JSON.stringify([directory, requestID, permission, baseUrl])
  useEffect(() => {
    if (!directory || !enabled) return
    let current = true
    const controller = new AbortController()
    void (async () => {
      try {
        const list = baseUrl
          ? await fetch(`${baseUrl}/permission/siempre?directory=${encodeURIComponent(directory)}`, {
              headers: authorization ? { Authorization: authorization } : {},
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(6000)])
            }).then(async (res) => (res.ok ? parseAlwaysList(await res.json()) : null))
          : await call('settings:alwaysList', { directory }).then((list) => (list.available ? list : null))
        if (current)
          setSaved({ scope, patterns: list?.active ? list.rules.filter((r) => r.permission === permission).map((r) => r.pattern) : [] })
      } catch {
        // Motor viejo, sin conexión o sin soporte: se conservan las sugerencias; el clic sigue disponible.
      }
    })()
    return () => {
      current = false
      controller.abort()
    }
  }, [directory, permission, scope, baseUrl, authorization, enabled])
  return saved?.scope === scope ? rules.filter((r) => !saved.patterns.includes(r)) : rules
}
