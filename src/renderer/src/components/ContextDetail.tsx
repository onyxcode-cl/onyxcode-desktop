/**
 * Desglose del contexto dentro del panel lateral (Resumen de Code, Progreso de Overdrive): se despliega en la propia tarjeta
 * «Contexto» en vez de un popover sobre la conversación. Sin desglose del motor (motor anterior) muestra solo usado / ventana.
 */
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { AssistantMessage, Message } from '@opencode-ai/sdk/v2/client'
import type { ModelRef } from '@shared/types'
import { useT } from '../lib/i18n'
import { formatTokens } from '../lib/format'
import type { OpencodeClient } from '../lib/opencode'
import { useProviders } from '../stores/providers'
import { useServer } from '../stores/server'
import { ContextBreakdown, useContextoFijo } from './ContextBreakdown'

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
}): React.JSX.Element | null {
  const t = useT()
  const [open, setOpen] = useState(false)
  const providers = useProviders((s) => s.providers)
  const globalClient = useServer((s) => s.client)
  const fijo = useContextoFijo(breakdownClient ?? globalClient, messages[0]?.info.sessionID, directory, open)
  const info = providers.find((p) => p.id === model.providerID)?.models[model.modelID]
  const assistants = messages.map((m) => m.info).filter((i): i is AssistantMessage => i.role === 'assistant')
  const last = assistants[assistants.length - 1]
  const used = last && last.modelID === model.modelID ? last.tokens.input + last.tokens.cache.read + last.tokens.cache.write : 0
  if (!info || used === 0) return null
  const limit = info.limit.context
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="no-drag flex items-center gap-1 rounded-md px-1 py-0.5 text-xs text-muted hover:bg-hover hover:text-fg"
      >
        <ChevronRight size={13} className={`transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
        {open ? t('ctx.detail.hide') : t('ctx.detail.show')}
        <span className="ml-1 tabular-nums text-subtle">{pct} %</span>
      </button>
      {open && (
        <div className="mt-2">
          {fijo?.desglose ? (
            <ContextBreakdown used={used} limit={limit} fijo={fijo} />
          ) : (
            <div className="h-1.5 overflow-hidden rounded-full bg-inset">
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(pct, 2)}%` }} />
            </div>
          )}
          <p className="mt-1.5 text-[12px] text-subtle">
            {t('settings.usage.meter.contextOf', { used: formatTokens(used), limit: formatTokens(limit), model: info.name })}
          </p>
        </div>
      )}
    </div>
  )
}
