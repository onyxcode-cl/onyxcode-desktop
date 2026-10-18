/**
 * Ajustes › Uso (F8-B189): cuánto se ha usado la IA en este equipo, en palabras llanas. Los números salen del motor local
 * (tokens por conversación y costo cuando el servicio lo informa); no hay cuentas, facturación ni envío de datos. Ver
 * `usage-aggregate.ts` (qué se suma y qué se dice) y `usage-source.ts` (de dónde se lee, con tope).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw } from 'lucide-react'
import { getLang } from '@shared/i18n'
import { MODE_LABELS } from '@shared/labels'
import { Button } from '../../../components/Button'
import { useT } from '../../../lib/i18n'
import { errText } from '../../../lib/format'
import { errorMessage } from '../../../lib/opencode'
import { useProviders } from '../../../stores/providers'
import { MAIN_SOURCE, useSessions } from '../../../stores/sessions'
import { useServer } from '../../../stores/server'
import { Card, ErrorText, SectionHeader, formatCost, formatNumber, formatTokens } from './ui'
import {
  UNKNOWN_MODEL,
  USAGE_PERIODS,
  aggregateUsage,
  costKind,
  usageStatus,
  type CostTotals,
  type UsagePeriod,
  type UsageReport,
  type UsageRow
} from './usage-aggregate'
import { USAGE_LIMIT, isFreeModel, readUsage, type UsageRead } from './usage-source'
import type { TasksUsageSummary } from '@shared/ipc-tasks'
import { cw, hasTasksBridge } from '../../tasks/impl/bridge'

/** Resumen de Overdrive que calcula `main` (solo cifras de cada carpeta aprobada), o `null` si no se pudo pedir. */
async function fetchTasksUsage(): Promise<TasksUsageSummary | null> {
  if (!hasTasksBridge()) return null
  try {
    return await cw('tasks:usage:summary')
  } catch {
    return null
  }
}

type Load =
  | { phase: 'idle' }
  | { phase: 'loading'; read?: UsageRead; at?: number }
  | { phase: 'ready'; read: UsageRead; at: number }
  | { phase: 'error'; error: string }

const locale = (): string => (getLang() === 'en' ? 'en-US' : 'es-CL')

function costText(c: CostTotals, t: ReturnType<typeof useT>): string {
  switch (costKind(c)) {
    case 'amount':
      return c.unknown > 0 ? t('settings.usage.cost.mixed', { cost: formatCost(c.usd) }) : formatCost(c.usd)
    case 'free':
      return t('settings.usage.cost.free')
    case 'unknown':
      return t('settings.usage.cost.unknown')
    default:
      return t('settings.usage.cost.none')
  }
}

export function UsageSection(): React.JSX.Element {
  const t = useT()
  const client = useServer((s) => s.client)
  const chatDirectory = useServer((s) => s.connection?.chatDirectory ?? null)
  const providers = useProviders((s) => s.providers)
  const [load, setLoad] = useState<Load>({ phase: 'idle' })
  const [period, setPeriod] = useState<UsagePeriod>('7d')
  const run = useRef(0)

  const refresh = useCallback(async () => {
    if (!client) return
    const id = ++run.current
    setLoad((l) => ({ phase: 'loading', ...(l.phase === 'ready' ? { read: l.read, at: l.at } : {}) }))
    try {
      // Overdrive: cada carpeta aprobada tiene su propio servidor y su propio registro; `main` resume sus cifras (F8-B198). Lo que la
      // app tiene cargado en memoria completa lo que ese resumen no cubra (p. ej. Windows).
      const st = useSessions.getState()
      const tasks = Object.values(st.sessions).filter((s) => (st.sessionSource[s.id] ?? MAIN_SOURCE) !== MAIN_SOURCE)
      const tasksUsage = await fetchTasksUsage()
      const read = await readUsage(client as never, { chatDirectory, tasks, tasksUsage }, errorMessage)
      if (id === run.current) setLoad({ phase: 'ready', read, at: Date.now() })
    } catch (err) {
      if (id === run.current) setLoad({ phase: 'error', error: errText(err) })
    }
  }, [client, chatDirectory])

  // Lectura perezosa: solo al abrir esta pantalla (o con «Actualizar»), nunca en segundo plano.
  useEffect(() => {
    void refresh()
    return () => {
      // Al salir de la pantalla, una lectura en vuelo ya no actualiza nada (el contador es un contador, no un nodo).
      // eslint-disable-next-line react-hooks/exhaustive-deps
      run.current++
    }
  }, [refresh])

  const shown = load.phase === 'ready' ? load : load.phase === 'loading' && load.read && load.at ? { read: load.read, at: load.at } : null
  const report = useMemo<UsageReport | null>(
    () =>
      shown
        ? aggregateUsage(shown.read.sessions, {
            now: shown.at,
            period,
            capped: shown.read.capped,
            ...(shown.read.oldestRead !== undefined ? { oldestRead: shown.read.oldestRead } : {}),
            isFree: (p, m) => isFreeModel(p, m, providers)
          })
        : null,
    // `shown` cambia de identidad en cada render; sus dos piezas son las que importan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown?.read, shown?.at, period, providers]
  )
  const loading = load.phase === 'loading'

  return (
    <div>
      <SectionHeader title={t('settings.usage.title')} description={t('settings.usage.subtitle')} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label={t('settings.usage.period.aria')} className="flex rounded-lg border border-border p-0.5 text-xs">
          {USAGE_PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={period === p}
              data-testid={`usage-period-${p}`}
              onClick={() => setPeriod(p)}
              className={`rounded-md px-3 py-1 ${period === p ? 'bg-active font-medium text-fg' : 'text-muted hover:text-fg'}`}
            >
              {t(`settings.usage.period.${p}`)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {shown && !loading && (
            <span className="text-[11px] desk:text-meta text-subtle" data-testid="usage-updated">
              {t('settings.usage.updatedAt', {
                time: new Date(shown.at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
              })}
            </span>
          )}
          <Button variant="ghost" onClick={() => void refresh()} disabled={loading || !client} data-testid="usage-refresh">
            {loading ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <RefreshCw size={14} aria-hidden />}{' '}
            {t('settings.usage.refresh')}
          </Button>
        </div>
      </div>

      {!client && <p className="text-sm text-muted">{t('settings.usage.waiting')}</p>}

      {client && load.phase === 'error' && (
        <div className="space-y-3" data-testid="usage-error">
          <ErrorText>{t('settings.usage.error', { error: load.error })}</ErrorText>
          <Button variant="secondary" onClick={() => void refresh()}>
            {t('settings.usage.retry')}
          </Button>
        </div>
      )}

      {client && !shown && (load.phase === 'loading' || load.phase === 'idle') && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted" data-testid="usage-loading">
          <Loader2 size={14} className="animate-spin" aria-hidden /> {t('settings.usage.loading')}
        </p>
      )}

      {report && shown && <UsageReportView report={report} read={shown.read} />}
    </div>
  )
}

function UsageReportView({ report, read }: { report: UsageReport; read: UsageRead }): React.JSX.Element {
  const t = useT()
  const providers = useProviders((s) => s.providers)
  const status = usageStatus(report)
  const Icon = status.tone === 'warn' ? AlertTriangle : status.tone === 'empty' ? Info : CheckCircle2
  const tone = status.tone === 'warn' ? 'text-warning' : status.tone === 'empty' ? 'text-muted' : 'text-success'
  const whenKey = `settings.usage.when.${report.period}` as const
  const costSentence = status.costKey ? t(status.costKey, { cost: formatCost(report.cost.usd), count: report.cost.unknown }) : null

  const modelLabel = (key: string): { text: string; title?: string } => {
    if (key === UNKNOWN_MODEL) return { text: t('settings.usage.unknown') }
    const [pid, ...rest] = key.split('/')
    const mid = rest.join('/')
    const name = providers.find((p) => p.id === pid)?.models[mid]?.name
    return { text: name || mid, title: key }
  }

  const dateFmt = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short' })
  const dayFmt = new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'short' })

  return (
    <div data-testid="usage-report">
      <Card className="mb-4 px-4 py-3.5">
        <div role="status" aria-live="polite" className="flex items-start gap-2.5">
          <Icon size={18} className={`mt-0.5 shrink-0 ${tone}`} aria-hidden />
          <div className="min-w-0 text-sm leading-relaxed" data-testid="usage-status">
            <p className="font-medium">
              {t(status.key, { when: t(whenKey), tokens: formatTokens(report.total), count: report.conversations })}
            </p>
            {costSentence && <p className="mt-0.5 text-muted">{costSentence}</p>}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Stat label={t('settings.usage.stat.conversations')} value={formatNumber(report.conversations)} />
        <Stat
          label={t('settings.usage.stat.tokens')}
          value={formatTokens(report.total)}
          hint={`${t('settings.usage.stat.cache')}: ${formatTokens(report.tokens.cacheRead + report.tokens.cacheWrite)}`}
        />
        <Stat label={t('settings.usage.stat.cost')} value={costText(report.cost, t)} />
      </div>

      <details className="mt-3 rounded-lg px-1 text-sm" data-testid="usage-tokens-help">
        <summary className="cursor-pointer text-muted hover:text-fg">{t('settings.usage.tokens.summary')}</summary>
        <p className="mt-1.5 max-w-prose text-xs leading-relaxed text-muted">{t('settings.usage.tokens.body')}</p>
      </details>

      {report.bucketUnit && (
        <UsageTable
          caption={t(report.bucketUnit === 'day' ? 'settings.usage.byDay' : 'settings.usage.byWeek')}
          firstCol={t(report.bucketUnit === 'day' ? 'settings.usage.col.day' : 'settings.usage.col.week')}
          rows={report.buckets}
          label={(r) =>
            report.bucketUnit === 'day'
              ? { text: dayFmt.format(new Date(Number(r.key))) }
              : { text: t('settings.usage.weekOf', { date: dateFmt.format(new Date(Number(r.key))) }) }
          }
          testId="usage-by-bucket"
        />
      )}
      <UsageTable
        caption={t('settings.usage.byModel')}
        firstCol={t('settings.usage.col.model')}
        rows={report.byModel}
        label={(r) => modelLabel(r.key)}
        showCost
        testId="usage-by-model"
      />
      <UsageTable
        caption={t('settings.usage.byMode')}
        firstCol={t('settings.usage.col.mode')}
        rows={report.byMode}
        label={(r) => ({ text: MODE_LABELS[r.key as 'chat' | 'code' | 'tasks'] })}
        // Si Overdrive no se pudo leer y no hay nada que sumar, un «0» engañaría: se dice con claridad que no se cuenta.
        rowNote={(r) =>
          r.key === 'tasks' && read.tasksSource !== 'read' && r.conversations === 0 ? t('settings.usage.mode.notCounted') : null
        }
        showCost
        testId="usage-by-mode"
      />

      <ul className="mt-6 space-y-1.5 text-[11px] desk:text-meta leading-relaxed text-subtle" data-testid="usage-notes">
        <li>{t('settings.usage.note.limits')}</li>
        <li>{t('settings.usage.note.counting')}</li>
        <li>
          {t('settings.usage.note.limit', { limit: USAGE_LIMIT })}
          {read.capped && <> {t('settings.usage.note.capped')}</>}
        </li>
        <li data-testid="usage-note-tasks">
          {t(
            read.tasksSource === 'read'
              ? 'settings.usage.note.tasks'
              : read.tasksSource === 'unsupported'
                ? 'settings.usage.note.tasks.unsupported'
                : 'settings.usage.note.tasks.unavailable'
          )}
          {read.tasksSource === 'read' && read.tasksUnreadable > 0 && (
            <> {t('settings.usage.note.tasks.unreadable', { count: read.tasksUnreadable })}</>
          )}
        </li>
        <li>{t('settings.usage.note.cost')}</li>
      </ul>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }): React.JSX.Element {
  return (
    <Card className="px-3 py-2.5">
      <div className="text-[11px] desk:text-meta text-muted">{label}</div>
      <div className="mt-0.5 text-base font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-[11px] desk:text-meta text-subtle">{hint}</div>}
    </Card>
  )
}

/** Tabla con barras: los números van en la tabla (lo que lee un lector de pantalla) y la barra es solo un apoyo visual. */
function UsageTable({
  caption,
  firstCol,
  rows,
  label,
  rowNote,
  showCost,
  testId
}: {
  caption: string
  firstCol: string
  rows: UsageRow[]
  label: (r: UsageRow) => { text: string; title?: string }
  /** Texto que sustituye a las cifras de una fila (p. ej. «no se cuenta aquí todavía»); `null`: fila normal. */
  rowNote?: (r: UsageRow) => string | null
  showCost?: boolean
  testId: string
}): React.JSX.Element {
  const t = useT()
  const max = Math.max(...rows.map((r) => r.total), 0)
  return (
    <div className="mt-6" data-testid={testId}>
      <Card>
        <table className="w-full table-fixed border-collapse text-left text-sm">
          <caption className="px-4 pt-3 pb-1 text-left text-[11.5px] desk:text-meta font-semibold text-muted">{caption}</caption>
          <thead>
            <tr className="text-[11px] desk:text-meta text-subtle">
              <th scope="col" className="w-[34%] px-4 py-1.5 font-medium">
                {firstCol}
              </th>
              <th scope="col" className="w-[17%] px-2 py-1.5 text-right font-medium">
                {t('settings.usage.col.conversations')}
              </th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">
                {t('settings.usage.col.tokens')}
              </th>
              {showCost && (
                <th scope="col" className="w-[20%] px-4 py-1.5 text-right font-medium">
                  {t('settings.usage.col.cost')}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={showCost ? 4 : 3} className="px-4 py-3 text-muted">
                  {t('settings.usage.noData')}
                </td>
              </tr>
            )}
            {rows.slice(0, 12).map((r) => {
              const l = label(r)
              const note = rowNote?.(r) ?? null
              if (note)
                return (
                  <tr key={r.key} className="border-t border-border align-top" data-testid={`usage-row-note-${r.key}`}>
                    <th scope="row" className="truncate px-4 py-2 font-normal" title={l.title ?? l.text}>
                      {l.text}
                    </th>
                    <td colSpan={showCost ? 3 : 2} className="px-2 py-2 text-muted">
                      {note}
                    </td>
                  </tr>
                )
              return (
                <tr key={r.key} className="border-t border-border align-top">
                  <th scope="row" className="truncate px-4 py-2 font-normal" title={l.title ?? l.text}>
                    {l.text}
                  </th>
                  <td className="px-2 py-2 text-right tabular-nums">{formatNumber(r.conversations)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {formatTokens(r.total)}
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-hover" aria-hidden>
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${max > 0 ? Math.max((r.total / max) * 100, r.total > 0 ? 2 : 0) : 0}%` }}
                      />
                    </div>
                  </td>
                  {showCost && <td className="px-4 py-2 text-right tabular-nums">{costText(r.cost, t)}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
