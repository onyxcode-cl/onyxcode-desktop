/**
 * Medidor de uso del compositor (estilo Claude Desktop / Codex): un anillo con el % de contexto usado
 * y, al abrirlo, el contexto, el gasto de la sesión y el de hoy / últimos 30 días (todos los proyectos).
 * Los datos salen de los mensajes ya cargados y de `experimental.session.list` (cacheado 60 s).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { BarChart3 } from 'lucide-react'
import type { AssistantMessage, Message } from '@opencode-ai/sdk/v2/client'
import type { ModelRef } from '@shared/types'
import { formatCost, formatTokens } from '../lib/format'
import { errorMessage, type OpencodeClient } from '../lib/opencode'
import { useProviders } from '../stores/providers'
import { useServer } from '../stores/server'
import { useUi } from '../stores/ui'

interface Agg {
  cost: number
  sessions: number
}
interface GlobalUsage {
  today: Agg
  month: Agg
}

const DAY = 86_400_000
const PAGE = 200
const MAX_PAGES = 10
const CACHE_MS = 60_000
let cache: { at: number; value: GlobalUsage } | null = null

async function loadGlobalUsage(client: OpencodeClient): Promise<GlobalUsage> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startMonth = now.getTime() - 30 * DAY
  const today: Agg = { cost: 0, sessions: 0 }
  const month: Agg = { cost: 0, sessions: 0 }
  const seen = new Set<string>()
  let cursor: number | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await client.experimental.session.list({ limit: PAGE, ...(cursor !== undefined ? { cursor } : {}) })
    if (r.error || !r.data) throw new Error(errorMessage(r.error))
    for (const s of r.data) {
      if (seen.has(s.id)) continue
      seen.add(s.id)
      if (s.time.updated >= startMonth) {
        month.cost += s.cost ?? 0
        month.sessions++
      }
      if (s.time.updated >= startToday) {
        today.cost += s.cost ?? 0
        today.sessions++
      }
    }
    const last = r.data[r.data.length - 1]
    // La lista viene de más reciente a más antigua: al pasar de 30 días ya no hay nada que sumar.
    if (r.data.length < PAGE || !last || last.time.updated < startMonth || cursor === last.time.updated) break
    cursor = last.time.updated
  }
  const value = { today, month }
  cache = { at: Date.now(), value }
  return value
}

function Ring({ pct }: { pct: number }): React.JSX.Element {
  const r = 7.5
  const c = 2 * Math.PI * r
  const tone = pct > 85 ? 'var(--danger)' : pct > 60 ? 'var(--warning)' : 'var(--accent)'
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden className="-rotate-90">
      <circle cx="10" cy="10" r={r} fill="none" stroke="var(--border-strong)" strokeWidth="2.25" />
      <circle
        cx="10"
        cy="10"
        r={r}
        fill="none"
        stroke={tone}
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeDasharray={`${(Math.max(pct, pct > 0 ? 4 : 0) / 100) * c} ${c}`}
        className="transition-[stroke-dasharray] duration-500"
      />
    </svg>
  )
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
      <span className="text-muted">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  )
}

export function UsageMeter({ messages, model }: { messages: { info: Message }[]; model: ModelRef }): React.JSX.Element | null {
  const providers = useProviders((s) => s.providers)
  const client = useServer((s) => s.client)
  const [open, setOpen] = useState(false)
  const [global, setGlobal] = useState<GlobalUsage | 'loading' | 'error'>('loading')
  const rootRef = useRef<HTMLDivElement>(null)

  const info = providers.find((p) => p.id === model.providerID)?.models[model.modelID]

  const session = useMemo(() => {
    const assistants = messages.map((m) => m.info).filter((i): i is AssistantMessage => i.role === 'assistant')
    const last = assistants[assistants.length - 1]
    const sum = { cost: 0, input: 0, output: 0, reasoning: 0, cache: 0 }
    for (const a of assistants) {
      sum.cost += a.cost ?? 0
      sum.input += a.tokens.input
      sum.output += a.tokens.output
      sum.reasoning += a.tokens.reasoning
      sum.cache += a.tokens.cache.read + a.tokens.cache.write
    }
    const context = last && last.modelID === model.modelID ? last.tokens.input + last.tokens.cache.read + last.tokens.cache.write : 0
    return { ...sum, context, turns: assistants.length }
  }, [messages, model.modelID])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (!open || !client) return
    let cancelled = false
    setGlobal('loading')
    loadGlobalUsage(client)
      .then((v) => !cancelled && setGlobal(v))
      .catch(() => !cancelled && setGlobal('error'))
    return () => {
      cancelled = true
    }
  }, [open, client])

  if (!info) return null

  const limit = info.limit.context
  const pct = limit > 0 ? Math.min(100, Math.round((session.context / limit) * 100)) : 0

  const openDetail = (): void => {
    try {
      localStorage.setItem('settings.section', 'usage')
    } catch {
      // sin storage: se abre en la sección que estuviera
    }
    setOpen(false)
    useUi.getState().openSettings(true)
  }

  return (
    <div ref={rootRef} className="no-drag relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Uso y contexto: ${pct}% del contexto`}
        title={`Contexto ${pct}% · ${formatCost(session.cost)} en esta sesión`}
        className={`flex h-7 items-center gap-1.5 rounded-md px-1.5 text-muted transition-colors hover:bg-hover hover:text-fg ${open ? 'bg-hover text-fg' : ''}`}
      >
        <Ring pct={pct} />
      </button>

      {open && (
        <div className="absolute right-0 bottom-full z-50 mb-2 w-72 animate-pop-in origin-bottom-right rounded-xl border border-border bg-elevated p-3.5 shadow-xl">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-[13px] font-medium">Contexto</span>
            <span className="text-[13px] tabular-nums text-muted">{pct}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-inset">
            <div
              className={`h-full rounded-full transition-[width] duration-500 ${pct > 85 ? 'bg-danger' : pct > 60 ? 'bg-warning' : 'bg-accent'}`}
              style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }}
            />
          </div>
          <p className="mt-1.5 text-[12px] text-subtle">
            {formatTokens(session.context)} de {formatTokens(limit)} tokens · {info.name}
          </p>

          <div className="my-3 border-t border-border" />

          <div className="mb-1.5 text-[13px] font-medium">Esta sesión</div>
          <div className="flex flex-col gap-1">
            <Stat label="Costo estimado" value={formatCost(session.cost)} />
            <Stat label="Tokens de entrada" value={formatTokens(session.input)} />
            <Stat label="Tokens de salida" value={formatTokens(session.output + session.reasoning)} />
            <Stat label="Caché" value={formatTokens(session.cache)} />
          </div>

          <div className="my-3 border-t border-border" />

          <div className="mb-1.5 text-[13px] font-medium">Todos los proyectos</div>
          {global === 'loading' && <p className="text-[12.5px] text-subtle">Calculando…</p>}
          {global === 'error' && <p className="text-[12.5px] text-danger">No se pudo leer el uso.</p>}
          {typeof global === 'object' && (
            <div className="flex flex-col gap-1">
              <Stat label={`Hoy · ${global.today.sessions} sesiones`} value={formatCost(global.today.cost)} />
              <Stat label={`30 días · ${global.month.sessions} sesiones`} value={formatCost(global.month.cost)} />
            </div>
          )}

          <button
            type="button"
            onClick={openDetail}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-1.5 text-[12.5px] text-muted transition-colors hover:border-border-strong hover:bg-hover hover:text-fg"
          >
            <BarChart3 size={13} /> Ver detalle de uso
          </button>
        </div>
      )}
    </div>
  )
}
