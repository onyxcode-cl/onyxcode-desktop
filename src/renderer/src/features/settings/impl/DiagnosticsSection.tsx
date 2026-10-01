import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Download, Loader2, RefreshCw, RotateCw, ShieldCheck } from 'lucide-react'
import { DIAG_SOURCE_LABELS, DIAG_SOURCES, type DiagLogs, type DiagSource } from '@shared/diagnostics'
import { redactSecrets } from '@shared/ai-errors'
import type { ServerState } from '@shared/types'
import { Button } from '../../../components/Button'
import { call } from '../../../lib/api'
import { errorMessage } from '../../../lib/opencode'
import { useServer } from '../../../stores/server'
import { Badge, Card, ErrorText, Field, Row, Select, SectionHeader, SubTitle, TextInput, Toggle } from './ui'

const AUTO_REFRESH_MS = 2000
const MAX_LINES = 1000

const STATE_LABEL: Record<ServerState, { text: string; tone: 'ok' | 'warn' | 'error' | 'muted' }> = {
  ready: { text: 'Funcionando', tone: 'ok' },
  starting: { text: 'Arrancando', tone: 'warn' },
  error: { text: 'Con error', tone: 'error' },
  stopped: { text: 'Detenido', tone: 'muted' }
}

export function DiagnosticsSection(): React.JSX.Element {
  return (
    <div>
      <SectionHeader
        title="Diagnóstico"
        description="Estado del motor de IA y sus registros, para entender qué falla o compartirlo con quien te ayude."
      />
      <StatusCard />
      <SubTitle>Registros</SubTitle>
      <LogsCard />
    </div>
  )
}

function StatusCard(): React.JSX.Element {
  const status = useServer((s) => s.status)
  const restart = useServer((s) => s.restart)
  const [restarting, setRestarting] = useState(false)
  const label = STATE_LABEL[status.state]
  // El último error puede traer líneas del motor: se oculta cualquier clave antes de mostrarlo.
  const lastError = status.error ? redactSecrets(status.error).slice(0, 1500) : null

  return (
    <Card>
      <Row label="Estado del motor" description="OpenCode, el programa que habla con la IA.">
        <Badge tone={label.tone}>{label.text}</Badge>
      </Row>
      <Row label="Reinicios automáticos" description="Cuántas veces se reinició solo desde que abriste la app.">
        <span className="text-sm tabular-nums" data-testid="diag-restarts">
          {status.restarts}
        </span>
      </Row>
      <Row label="Versión del motor">
        <span className="text-sm text-muted tabular-nums">{status.version ?? '—'}</span>
      </Row>
      <Row label="Reiniciar OpenCode" description="Si algo no responde, reinicia el motor. Las respuestas en curso se interrumpen.">
        <Button
          disabled={restarting}
          onClick={() => {
            setRestarting(true)
            void restart().finally(() => setRestarting(false))
          }}
        >
          {restarting ? <Loader2 size={14} className="animate-spin" /> : <RotateCw size={14} />} Reiniciar OpenCode
        </Button>
      </Row>
      {lastError && (
        <div className="px-4 py-3">
          <div className="mb-1 text-xs font-medium text-muted">Último error</div>
          <pre className="max-h-32 overflow-auto rounded-lg border border-border bg-bg p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-danger">
            {lastError}
          </pre>
        </div>
      )}
    </Card>
  )
}

function LogsCard(): React.JSX.Element {
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
    const t = setInterval(() => {
      if (!document.hidden) void load()
    }, AUTO_REFRESH_MS)
    return () => clearInterval(t)
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
      .then((r) => setNote(`Copiado: ${r.lines} ${r.lines === 1 ? 'línea' : 'líneas'}.`))
      .catch((err: unknown) => setError(errorMessage(err)))
  }

  const exportReport = (): void => {
    setNote(null)
    call('diag:export')
      .then((r) => setNote(r.saved ? 'Informe exportado.' : null))
      .catch((err: unknown) => setError(errorMessage(err)))
  }

  return (
    <Card className="@container p-4">
      <div className="grid grid-cols-1 items-end gap-3 @md:grid-cols-[1fr_1.4fr]">
        <Field label="Fuente">
          <Select
            aria-label="Fuente de registros"
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
        <Field label="Filtrar">
          <TextInput
            aria-label="Filtrar registros"
            placeholder="Texto a buscar…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </Field>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Actualizar
        </Button>
        <label className="flex items-center gap-2 text-xs text-muted">
          <Toggle checked={auto} onChange={setAuto} label="Actualizar cada 2 segundos" /> Cada 2 s
        </label>
        <span className="ml-auto flex items-center gap-2">
          <Button onClick={copy}>
            <Copy size={14} /> Copiar
          </Button>
          <Button onClick={exportReport}>
            <Download size={14} /> Exportar…
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
        aria-label="Registros"
        tabIndex={0}
        data-testid="diag-log"
        onScroll={(e) => {
          const el = e.currentTarget
          stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        className="mt-3 h-80 overflow-auto rounded-lg border border-border bg-bg p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all text-fg"
      >
        {logs === null
          ? 'Cargando…'
          : shown.length
            ? shown.join('\n')
            : filter.trim()
              ? 'Ninguna línea coincide con el filtro.'
              : 'Sin registros todavía.'}
      </pre>
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-subtle" aria-live="polite">
        <span>
          {logs ? `${shown.length} de ${logs.lines.length} líneas${logs.truncated ? ' (solo las últimas)' : ''}` : ''}
          {note ? ` · ${note}` : ''}
        </span>
      </div>

      <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-subtle">
        <ShieldCheck size={13} className="mt-px shrink-0" />
        Las claves y contraseñas se ocultan antes de mostrar, copiar o exportar. Revisa el texto antes de compartirlo.
      </p>
    </Card>
  )
}
