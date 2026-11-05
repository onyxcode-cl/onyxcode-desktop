/**
 * Medidor de contexto del panel lateral (Resumen de Code, Progreso de Overdrive): barra con el % usado (ámbar desde 70 %, roja desde 90 %)
 * y «X de Y tokens», siempre visible; el desglose por categoría se despliega debajo si el motor lo entrega. Nunca queda vacío: sin
 * respuestas aún o con un modelo sin ventana declarada lo dice con palabras.
 */
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { Message } from '@opencode-ai/sdk/v2/client'
import type { ModelRef } from '@shared/types'
import { useT } from '../lib/i18n'
import { formatTokens } from '../lib/format'
import type { OpencodeClient } from '../lib/opencode'
import { useProviders } from '../stores/providers'
import { useServer } from '../stores/server'
import { ContextBreakdown, useContextoFijo } from './ContextBreakdown'
import { contextUsage } from '../lib/context-usage'

export function ContextDetail({
  messages,
  model,
  breakdownClient,
  directory
}: {
  messages: { info: Message }[]
  model: ModelRef
  breakdownClient?: OpencodeClient | null
  directory?: string
}): React.JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const providers = useProviders((s) => s.providers)
  const globalClient = useServer((s) => s.client)
  const fijo = useContextoFijo(breakdownClient ?? globalClient, messages[0]?.info.sessionID, directory, open)
  const u = contextUsage(messages, model, providers)
  if (u.kind !== 'ready') {
    return (
      <p data-testid="context-empty" className="mt-2 text-xs text-muted">
        {u.kind === 'unknown' ? t('ctx.unavailable') : t('ctx.waiting')}
      </p>
    )
  }
  const { used, limit, pct } = u
  const bar = u.tone === 'danger' ? 'bg-danger' : u.tone === 'warn' ? 'bg-warning' : 'bg-accent'
  return (
    <div className="mt-2" data-testid="context-meter" data-tone={u.tone}>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="text-muted">
          {t('settings.usage.meter.contextOf', { used: formatTokens(used), limit: formatTokens(limit), model: u.name })}
        </span>
        <span className="ml-2 shrink-0 font-medium tabular-nums text-fg">{pct} %</span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={t('settings.usage.meter.context')}
        className="h-1.5 overflow-hidden rounded-full bg-inset"
      >
        <div className={`h-full rounded-full transition-[width] duration-500 ${bar}`} style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="no-drag mt-1.5 flex items-center gap-1 rounded-md px-1 py-0.5 text-xs text-muted hover:bg-hover hover:text-fg"
      >
        <ChevronRight size={13} className={`transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
        {open ? t('ctx.detail.hide') : t('ctx.detail.show')}
      </button>
      {open && fijo?.desglose && (
        <div className="mt-2">
          <ContextBreakdown used={used} limit={limit} fijo={fijo} />
        </div>
      )}
    </div>
  )
}
