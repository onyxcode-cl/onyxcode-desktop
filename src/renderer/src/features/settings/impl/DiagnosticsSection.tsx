import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Download, Loader2, RefreshCw, RotateCw, ShieldCheck } from 'lucide-react'
import { DIAG_SOURCE_LABELS, DIAG_SOURCES, type DiagLogs, type DiagSource } from '@shared/diagnostics'
import { redactSecrets } from '@shared/ai-errors'
import type { ServerState } from '@shared/types'
import { Button } from '../../../components/Button'
import type { MsgKey } from '@shared/i18n'
import { call } from '../../../lib/api'
import { useT } from '../../../lib/i18n'
import { errorMessage } from '../../../lib/opencode'
import { useServer } from '../../../stores/server'
import { Badge, Card, ErrorText, Field, Row, Select, SectionHeader, SubTitle, TextInput, Toggle } from './ui'

const AUTO_REFRESH_MS = 2000
const MAX_LINES = 1000

const STATE_LABEL: Record<ServerState, { text: MsgKey; tone: 'ok' | 'warn' | 'error' | 'muted' }> = {
  ready: { text: 'misc.diag.state.ready', tone: 'ok' },
  starting: { text: 'misc.diag.state.starting', tone: 'warn' },
  error: { text: 'misc.diag.state.error', tone: 'error' },
  stopped: { text: 'misc.diag.state.stopped', tone: 'muted' }
}

export function DiagnosticsSection(): React.JSX.Element {
  const t = useT()
  return (
    <div>
      <SectionHeader title={t('misc.diag.title')} description={t('misc.diag.desc')} />
      <StatusCard />
      <SubTitle>{t('misc.diag.logs')}</SubTitle>
      <LogsCard />
    </div>
  )
}

function StatusCard(): React.JSX.Element {
  const t = useT()
  const status = useServer((s) => s.status)
  const restart = useServer((s) => s.restart)
  const [restarting, setRestarting] = useState(false)
  const label = STATE_LABEL[status.state]
  // El último error puede traer líneas del motor: se oculta cualquier clave antes de mostrarlo.
  const lastError = status.error ? redactSecrets(status.error).slice(0, 1500) : null

  return (
    <Card>
      <Row label={t('misc.diag.engineStatus')} description={t('misc.diag.engineStatusDesc')}>
        <Badge tone={label.tone}>{t(label.text)}</Badge>
      </Row>
      <Row label={t('misc.diag.restarts')} description={t('misc.diag.restartsDesc')}>
        <span className="text-sm tabular-nums" data-testid="diag-restarts">
          {status.restarts}
        </span>
      </Row>
      <Row label={t('misc.diag.version')}>
        <span className="text-sm text-muted tabular-nums">{status.version ?? '—'}</span>
      </Row>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3 last:border-b-0">
        <div className="min-w-48 flex-1">
          <div className="text-sm font-medium">{t('misc.diag.restartEngine')}</div>
          <div className="mt-0.5 text-xs text-muted">{t('misc.diag.restartEngineDesc')}</div>
        </div>
        <Button
          disabled={restarting}
          onClick={() => {
            setRestarting(true)
            void restart().finally(() => setRestarting(false))
          }}
        >
          {restarting ? <Loader2 size={14} className="animate-spin" /> : <RotateCw size={14} />} {t('misc.diag.restartBtn')}
        </Button>
      </div>
      {lastError && (
        <div className="px-4 py-3">
          <div className="mb-1 text-xs font-medium text-muted">{t('misc.diag.lastError')}</div>
          <pre className="max-h-32 overflow-auto rounded-lg border border-border bg-bg p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-danger">
            {lastError}
          </pre>
        </div>
      )}
    </Card>
  )
}

function LogsCard(): React.JSX.Element {
  const t = useT()
  const [source, setSource] = useState<DiagSource>('engine')
  const [logs, setLogs] = useState<DiagLogs | null>(null)
  const [filter, setFilter] = useState('')
  const [auto, setAuto] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const stickBottom = useRef(true)
  /** Descarta respuestas de una fuente anterior si el usuario cambió de fuente mientras llegaban. */
  const generation = useRef(0)

  const load = useCallback(async (): Promise<void> => {
    const mine = ++generation.current
    setLoading(true)
    try {
      const r = await call('diag:logs', { source, maxLines: MAX_LINES })
      if (mine !== generation.current) return
      setLogs(r)
      setError(null)
    } catch (err) {
      if (mine === generation.current) setError(errorMessage(err))
    } finally {
      if (mine === generation.current) setLoading(false)
    }
  }, [source])

  useEffect(() => {
    setLogs(null)
    void load()
  }, [load])

  useEffect(() => {
    if (!auto) return
    const timer = setInterval(() => {
      if (!document.hidden) void load()
    }, AUTO_REFRESH_MS)
    return () => clearInterval(timer)
  }, [auto, load])

  const shown = useMemo(() => {
    const lines = logs?.lines ?? []
    const q = filter.trim().toLowerCase()
    return q ? lines.filter((l) => l.toLowerCase().includes(q)) : lines
  }, [logs, filter])

  // Si el usuario estaba al final, el texto nuevo mantiene el final a la vista.
  useEffect(() => {
    const el = preRef.current
    if (el && stickBottom.current) el.scrollTop = el.scrollHeight
  }, [shown])

  const copy = (): void => {
    setNote(null)
    call('diag:copy', { source })
      .then((r) => setNote(t('misc.diag.copied', { count: r.lines })))
      .catch((err: unknown) => setError(errorMessage(err)))
  }

  const exportReport = (): void => {
    setNote(null)
    call('diag:export')
      .then((r) => setNote(r.saved ? t('misc.diag.exported') : null))
      .catch((err: unknown) => setError(errorMessage(err)))
  }

  return (
    <Card className="@container p-4">
      <div className="grid grid-cols-1 items-end gap-3 @md:grid-cols-[1fr_1.4fr]">
        <Field label={t('misc.diag.source')}>
          <Select
            aria-label={t('misc.diag.sourceAria')}
            value={source}
            onChange={(e) => {
              setSource(e.target.value as DiagSource)
              setNote(null)
            }}
          >
            {DIAG_SOURCES.map((s) => (
              <option key={s} value={s}>
                {DIAG_SOURCE_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('misc.diag.filter')}>
          <TextInput
            aria-label={t('misc.diag.filterAria')}
            placeholder={t('misc.diag.filterPlaceholder')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </Field>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} {t('misc.diag.refresh')}
        </Button>
        <label className="flex items-center gap-2 text-xs text-muted">
          <Toggle checked={auto} onChange={setAuto} label={t('misc.diag.autoLabel')} /> {t('misc.diag.autoShort')}
        </label>
        <span className="ml-auto flex items-center gap-2">
          <Button onClick={copy}>
            <Copy size={14} /> {t('misc.diag.copy')}
          </Button>
          <Button onClick={exportReport}>
            <Download size={14} /> {t('misc.diag.export')}
          </Button>
        </span>
      </div>

      {error && (
        <div className="mt-3">
          <ErrorText>{error}</ErrorText>
        </div>
      )}

      <pre
        ref={preRef}
        aria-label={t('misc.diag.logsAria')}
        tabIndex={0}
        data-testid="diag-log"
        onScroll={(e) => {
          const el = e.currentTarget
          stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        className="mt-3 h-80 overflow-auto rounded-lg border border-border bg-bg p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all text-fg"
      >
        {logs === null
          ? t('misc.diag.loading')
          : shown.length
            ? shown.join('\n')
            : filter.trim()
              ? t('misc.diag.noMatch')
              : t('misc.diag.empty')}
      </pre>
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-subtle" aria-live="polite">
        <span>
          {logs
            ? `${t('misc.diag.count', { shown: shown.length, total: logs.lines.length })}${logs.truncated ? t('misc.diag.truncated') : ''}`
            : ''}
          {note ? ` · ${note}` : ''}
        </span>
      </div>

      <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-subtle">
        <ShieldCheck size={13} className="mt-px shrink-0" />
        {t('misc.diag.redactNote')}
      </p>
    </Card>
  )
}
