import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import type { GlobalSession } from '@opencode-ai/sdk/v2/client'
import { Button } from '../../../components/Button'
import { errorMessage } from '../../../lib/opencode'
import { useServer } from '../../../stores/server'
import { Card, ErrorText, SectionHeader, SubTitle, formatCost, formatNumber, formatTokens } from './ui'

type Period = 'today' | '7d' | '30d' | 'all'

const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Hoy' },
  { id: '7d', label: '7 días' },
  { id: '30d', label: '30 días' },
  { id: 'all', label: 'Todo' }
]

const PAGE = 500
const MAX_SESSIONS = 5000

interface Totals {
  sessions: number
  cost: number
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

const EMPTY: Totals = { sessions: 0, cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }

function add(t: Totals, s: GlobalSession): Totals {
  const k = s.tokens
  return {
    sessions: t.sessions + 1,
    cost: t.cost + (s.cost ?? 0),
    input: t.input + (k?.input ?? 0),
    output: t.output + (k?.output ?? 0),
    reasoning: t.reasoning + (k?.reasoning ?? 0),
    cacheRead: t.cacheRead + (k?.cache.read ?? 0),
    cacheWrite: t.cacheWrite + (k?.cache.write ?? 0)
  }
}

function since(period: Period): number {
  const now = new Date()
  if (period === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (period === '7d') return now.getTime() - 7 * 86_400_000
  if (period === '30d') return now.getTime() - 30 * 86_400_000
  return 0
}

/**
 * Uso: OpenCode guarda `cost` y `tokens` agregados por sesión (incluye subagentes como sesiones
 * hijas). Se listan todas las sesiones de todos los proyectos (`experimental.session.list`).
 */
export function UsageSection(): React.JSX.Element {
  const client = useServer((s) => s.client)
  const [sessions, setSessions] = useState<GlobalSession[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<Period>('30d')

  const load = useCallback(async () => {
    if (!client) return
    setLoading(true)
    setError(null)
    try {
      const all: GlobalSession[] = []
      let cursor: number | undefined
      while (all.length < MAX_SESSIONS) {
        const r = await client.experimental.session.list({ limit: PAGE, ...(cursor !== undefined ? { cursor } : {}) })
        if (r.error || !r.data) throw new Error(errorMessage(r.error))
        all.push(...r.data)
        if (r.data.length < PAGE) break
        const last = r.data[r.data.length - 1]
        const next = last.time.updated
        if (cursor === next) break
        cursor = next
      }
      // Dedupe por si la paginación por cursor repite la última.
      const seen = new Set<string>()
      setSessions(all.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true))))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [client])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const from = since(period)
    return (sessions ?? []).filter((s) => s.time.updated >= from)
  }, [sessions, period])

  const totals = useMemo(() => filtered.reduce(add, EMPTY), [filtered])

  const byModel = useMemo(() => groupBy(filtered, (s) => (s.model ? `${s.model.providerID}/${s.model.id}` : 'desconocido')), [filtered])
  const byProject = useMemo(
    () => groupBy(filtered, (s) => s.project?.name ?? s.project?.worktree.split('/').pop() ?? s.directory.split('/').pop() ?? s.directory),
    [filtered]
  )
  const top = useMemo(() => [...filtered].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0)).slice(0, 10), [filtered])

  return (
    <div>
      <SectionHeader
        title="Uso"
        description="Tokens y costo estimado según los datos que OpenCode guarda por sesión (todos los proyectos)."
      />
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex rounded-lg border border-border p-0.5 text-xs">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              className={`rounded-md px-3 py-1 ${period === p.id ? 'bg-active font-medium text-fg' : 'text-muted hover:text-fg'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <Button variant="ghost" onClick={() => void load()} disabled={loading || !client}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Actualizar
        </Button>
      </div>

      {error && <ErrorText>{error}</ErrorText>}
      {!client && <p className="text-sm text-muted">Esperando al servidor de OpenCode…</p>}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Costo estimado" value={formatCost(totals.cost)} />
        <Stat label="Sesiones" value={formatNumber(totals.sessions)} />
        <Stat label="Tokens entrada" value={formatTokens(totals.input)} />
        <Stat label="Tokens salida" value={formatTokens(totals.output)} />
        <Stat label="Razonamiento" value={formatTokens(totals.reasoning)} />
        <Stat label="Caché (lectura)" value={formatTokens(totals.cacheRead)} />
        <Stat label="Caché (escritura)" value={formatTokens(totals.cacheWrite)} />
        <Stat
          label="Total tokens"
          value={formatTokens(totals.input + totals.output + totals.reasoning + totals.cacheRead + totals.cacheWrite)}
        />
      </div>
      <p className="mt-2 text-[11px] text-subtle">
        El costo usa los precios públicos de cada modelo; con una suscripción (p.ej. OpenCode Go) es sólo referencial.
      </p>

      <SubTitle>Por modelo</SubTitle>
      <Breakdown groups={byModel} />

      <SubTitle>Por proyecto</SubTitle>
      <Breakdown groups={byProject} />

      <SubTitle>Sesiones más costosas</SubTitle>
      <Card>
        {top.length === 0 && <div className="px-4 py-4 text-sm text-muted">Sin sesiones en este período.</div>}
        {top.map((s) => (
          <div key={s.id} className="flex items-center gap-3 border-b border-border px-4 py-2 text-sm last:border-b-0">
            <div className="min-w-0 flex-1">
              <div className="truncate">{s.title || 'Sin título'}</div>
              <div className="truncate text-xs text-muted">
                {new Date(s.time.updated).toLocaleString('es-CL')} · {s.model?.id ?? '—'}
              </div>
            </div>
            <div className="text-right text-xs text-muted tabular-nums">
              {formatTokens((s.tokens?.input ?? 0) + (s.tokens?.output ?? 0))} tok
            </div>
            <div className="w-20 text-right font-medium tabular-nums">{formatCost(s.cost ?? 0)}</div>
          </div>
        ))}
      </Card>
    </div>
  )
}

interface Group {
  key: string
  totals: Totals
}

function groupBy(list: GlobalSession[], keyOf: (s: GlobalSession) => string): Group[] {
  const map = new Map<string, Totals>()
  for (const s of list) {
    const k = keyOf(s)
    map.set(k, add(map.get(k) ?? EMPTY, s))
  }
  return [...map.entries()].map(([key, totals]) => ({ key, totals })).sort((a, b) => b.totals.cost - a.totals.cost)
}

function Breakdown({ groups }: { groups: Group[] }): React.JSX.Element {
  const max = Math.max(...groups.map((g) => g.totals.cost), 0)
  return (
    <Card>
      {groups.length === 0 && <div className="px-4 py-4 text-sm text-muted">Sin datos.</div>}
      {groups.slice(0, 12).map((g) => (
        <div key={g.key} className="border-b border-border px-4 py-2 text-sm last:border-b-0">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1 truncate font-mono text-xs">{g.key}</div>
            <div className="text-xs text-muted tabular-nums">
              {g.totals.sessions} ses. · {formatTokens(g.totals.input + g.totals.output)} tok
            </div>
            <div className="w-20 text-right font-medium tabular-nums">{formatCost(g.totals.cost)}</div>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-hover">
            <div className="h-full rounded-full bg-accent" style={{ width: `${max > 0 ? (g.totals.cost / max) * 100 : 0}%` }} />
          </div>
        </div>
      ))}
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <Card className="px-3 py-2.5">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="mt-0.5 text-base font-semibold tabular-nums">{value}</div>
    </Card>
  )
}
