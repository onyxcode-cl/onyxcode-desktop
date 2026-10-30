/**
 * Desglose del contexto (como `/context` de Claude Code): barra apilada y tabla por categoría.
 * El total usado es exacto (viene del proveedor); el reparto de lo fijo (prompt, herramientas, skills, memoria, MCP) es una
 * estimación del motor (caracteres / 4), por eso las cifras llevan «≈». Con un motor sin el desglose no se muestra.
 */
import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { OpencodeClient } from '../lib/opencode'
import { useT } from '../lib/i18n'
import { formatTokens } from '../lib/format'

export interface ContextoDesglose {
  sistema: number
  herramientas: number
  mcpInstrucciones: number
  mcpHerramientas: number
  skills: number
  memoria: number
  agentes: number
}
export interface ContextoListas {
  mcp: { nombre: string; servidor?: string; tokens: number }[]
  memoria: { ruta: string; tokens: number }[]
  skills: { nombre: string; tokens: number }[]
}
export interface ContextoFijoWire {
  tokens: number
  desglose?: ContextoDesglose
  listas?: ContextoListas
  ventana?: { contexto: number; usable: number; reservado: number }
}

export interface Row {
  id: string
  label: string
  tokens: number
  color: string
}

/** Reparte el contexto en filas. `used` es exacto; lo fijo es estimado y se acota para que Messages nunca sea negativo. */
export function buildRows(used: number, limit: number, fijo: ContextoFijoWire, t: (k: string) => string): Row[] {
  const d = fijo.desglose
  if (!d || limit <= 0) return []
  const cats: Omit<Row, 'color'>[] = [
    { id: 'system', label: t('ctx.cat.system'), tokens: d.sistema + d.agentes },
    { id: 'tools', label: t('ctx.cat.tools'), tokens: d.herramientas },
    { id: 'mcp', label: t('ctx.cat.mcp'), tokens: d.mcpHerramientas },
    { id: 'mcpInstr', label: t('ctx.cat.mcpInstr'), tokens: d.mcpInstrucciones },
    { id: 'skills', label: t('ctx.cat.skills'), tokens: d.skills },
    { id: 'memory', label: t('ctx.cat.memory'), tokens: d.memoria }
  ]
  const colors: Record<string, string> = {
    messages: 'var(--accent)',
    system: 'var(--warning)',
    tools: '#14b8a6',
    mcp: '#f97316',
    mcpInstr: '#a78bfa',
    skills: '#94a3b8',
    memory: '#64748b',
    buffer: '#475569',
    free: 'transparent'
  }
  const fixedSum = cats.reduce((s, c) => s + c.tokens, 0)
  // Si la estimación pasa del total real se escala hacia abajo: nunca más categorías que lo realmente usado.
  const scale = fixedSum > used && fixedSum > 0 ? used / fixedSum : 1
  const fixedRows = cats.map((c) => ({ ...c, tokens: Math.round(c.tokens * scale) }))
  const messages = Math.max(0, used - fixedRows.reduce((s, c) => s + c.tokens, 0))
  const reserved = Math.min(fijo.ventana?.reservado ?? 0, Math.max(0, limit - used))
  const free = Math.max(0, limit - used - reserved)
  return [
    { id: 'messages', label: t('ctx.cat.messages'), tokens: messages },
    ...fixedRows,
    ...(reserved > 0 ? [{ id: 'buffer', label: t('ctx.cat.buffer'), tokens: reserved }] : []),
    { id: 'free', label: t('ctx.cat.free'), tokens: free }
  ].map((r) => ({ ...r, color: colors[r.id] ?? 'var(--border-strong)' }))
}

export function useContextoFijo(
  client: OpencodeClient | null,
  sessionID: string | undefined,
  directory: string | undefined,
  enabled: boolean
): ContextoFijoWire | null {
  const [data, setData] = useState<ContextoFijoWire | null>(null)
  useEffect(() => {
    if (!enabled || !client || !sessionID) return
    let cancelled = false
    const run = async (): Promise<void> => {
      try {
        const r = (await (client as unknown as { client: { get: (o: unknown) => Promise<{ data?: unknown }> } }).client.get({
          url: '/experimental/session/{sessionID}/contexto-fijo',
          path: { sessionID },
          ...(directory ? { query: { directory } } : {})
        })) as { data?: ContextoFijoWire }
        if (!cancelled) setData(r.data && typeof r.data === 'object' ? r.data : null)
      } catch {
        if (!cancelled) setData(null)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [client, sessionID, directory, enabled])
  return data
}

function pctOf(n: number, limit: number): string {
  const p = (n / limit) * 100
  return `${p < 0.05 ? 0 : p < 10 ? p.toFixed(1) : Math.round(p)} %`
}

export function ContextBreakdown({ used, limit, fijo }: { used: number; limit: number; fijo: ContextoFijoWire }): React.JSX.Element | null {
  const t = useT()
  const [open, setOpen] = useState<'mcp' | 'memory' | null>(null)
  const rows = buildRows(used, limit, fijo, t as (k: string) => string)
  if (rows.length === 0) return null
  const listas = fijo.listas
  return (
    <div data-testid="context-breakdown">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-inset" aria-hidden>
        {rows
          .filter((r) => r.id !== 'free' && r.tokens > 0)
          .map((r) => (
            <div key={r.id} style={{ width: `${Math.max((r.tokens / limit) * 100, 0.6)}%`, background: r.color }} />
          ))}
      </div>
      <ul className="mt-2.5 flex flex-col gap-1">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-2 text-[12.5px]">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ background: r.color === 'transparent' ? 'var(--border-strong)' : r.color, opacity: r.id === 'free' ? 0.35 : 1 }}
            />
            <span className="min-w-0 flex-1 truncate text-fg">{r.label}</span>
            <span className="tabular-nums text-muted">
              {r.id === 'messages' || r.id === 'free' || r.id === 'buffer' ? '' : '≈ '}
              {formatTokens(r.tokens)}
            </span>
            <span className="w-12 text-right tabular-nums text-subtle">{pctOf(r.tokens, limit)}</span>
          </li>
        ))}
      </ul>
      {listas && (listas.mcp.length > 0 || listas.memoria.length > 0) && (
        <div className="mt-2 flex flex-col gap-0.5 border-t border-border pt-2">
          {(
            [
              ['mcp', t('ctx.list.mcp'), listas.mcp.map((m) => ({ k: `${m.servidor ?? ''}${m.nombre}`, n: m.nombre, tk: m.tokens }))],
              ['memory', t('ctx.list.memory'), listas.memoria.map((m) => ({ k: m.ruta, n: m.ruta, tk: m.tokens }))]
            ] as const
          )
            .filter(([, , items]) => items.length > 0)
            .map(([id, label, items]) => (
              <div key={id}>
                <button
                  type="button"
                  onClick={() => setOpen(open === id ? null : id)}
                  aria-expanded={open === id}
                  className="flex w-full items-center gap-1.5 py-0.5 text-left text-[12.5px] text-muted hover:text-fg"
                >
                  <ChevronRight size={12} className={`transition-transform ${open === id ? 'rotate-90' : ''}`} />
                  <span className="flex-1">{label}</span>
                  <span className="tabular-nums">{items.length}</span>
                </button>
                {open === id && (
                  <ul className="mb-1 ml-4 max-h-40 overflow-y-auto">
                    {items.map((it) => (
                      <li key={it.k} className="flex items-center gap-2 py-px text-[12px] text-subtle">
                        <span className="min-w-0 flex-1 truncate" title={it.n}>
                          {it.n}
                        </span>
                        <span className="tabular-nums">≈ {formatTokens(it.tk)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
        </div>
      )}
      <p className="mt-2 text-[11.5px] text-subtle">{t('ctx.approx')}</p>
    </div>
  )
}
