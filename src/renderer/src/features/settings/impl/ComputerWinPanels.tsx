/**
 * Ajustes › Control del PC, parte de Windows (plan C §4, C5): el permiso de la app, el «Estado en este PC» (sesión interactiva,
 * sin administrador, helper, escalado y monitores) y «Ver registro». Solo se monta con `computerBackend === 'uia'`; en macOS no
 * existe nada de esto. Cada fila informa de algo real que `main` comprobó (`computer:status` → `win`): no hay controles sin efecto.
 */
import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import type { ComputerAuditRow, ComputerStatus } from '@shared/ipc-tasks'
import { Button } from '../../../components/Button'
import { useT } from '../../../lib/i18n'
import { errorMessage } from '../../../lib/opencode'
import { ComputerConsentWin } from '../../tasks/impl/ComputerConsentWin'
import { cw, hasTasksBridge } from '../../tasks/impl/bridge'
import { Badge, Card, ErrorText, Row, SubTitle } from './ui'

type T = ReturnType<typeof useT>
type Tone = 'ok' | 'warn' | 'error' | 'muted'

export interface WinStatusRow {
  id: string
  label: string
  value: string
  tone: Tone
}

/** Las filas de «Estado en este PC» a partir del estado de `main`. Pura. `status === null` = aún sin comprobar. */
export function winStatusRows(t: T, status: ComputerStatus | null): WinStatusRow[] {
  const w = status?.win
  const unknown = t('tasksComputer.winStatus.unknown')
  const consent: WinStatusRow = !w
    ? { id: 'consent', label: t('tasksComputer.winStatus.consent'), value: unknown, tone: 'muted' }
    : w.consent
      ? { id: 'consent', label: t('tasksComputer.winStatus.consent'), value: t('tasksComputer.winStatus.consentOn'), tone: 'ok' }
      : {
          id: 'consent',
          label: t('tasksComputer.winStatus.consent'),
          value: t(w.consentStale ? 'tasksComputer.winStatus.consentStale' : 'tasksComputer.winStatus.consentOff'),
          tone: 'warn'
        }
  const session: WinStatusRow =
    w?.interactive == null
      ? { id: 'session', label: t('tasksComputer.winStatus.session'), value: unknown, tone: 'muted' }
      : w.interactive
        ? { id: 'session', label: t('tasksComputer.winStatus.session'), value: t('tasksComputer.winStatus.sessionOk'), tone: 'ok' }
        : { id: 'session', label: t('tasksComputer.winStatus.session'), value: t('tasksComputer.winStatus.sessionNo'), tone: 'warn' }
  const admin: WinStatusRow =
    w?.elevated == null
      ? { id: 'admin', label: t('tasksComputer.winStatus.admin'), value: unknown, tone: 'muted' }
      : w.elevated
        ? { id: 'admin', label: t('tasksComputer.winStatus.admin'), value: t('tasksComputer.winStatus.adminYes'), tone: 'error' }
        : { id: 'admin', label: t('tasksComputer.winStatus.admin'), value: t('tasksComputer.winStatus.adminNo'), tone: 'ok' }
  const helper: WinStatusRow = !status
    ? { id: 'helper', label: t('tasksComputer.winStatus.helper'), value: unknown, tone: 'muted' }
    : status.helperOk
      ? { id: 'helper', label: t('tasksComputer.winStatus.helper'), value: t('tasksComputer.winStatus.helperOk'), tone: 'ok' }
      : { id: 'helper', label: t('tasksComputer.winStatus.helper'), value: t('tasksComputer.winStatus.helperMissing'), tone: 'error' }
  const rows = [consent, session, admin, helper]
  if (w?.dpiPercent != null) rows.push({ id: 'dpi', label: t('tasksComputer.winStatus.dpi'), value: `${w.dpiPercent} %`, tone: 'muted' })
  if (w?.monitors != null)
    rows.push({
      id: 'monitors',
      label: t('tasksComputer.winStatus.monitors'),
      value: t('tasksComputer.winStatus.monitorsValue', { count: w.monitors }),
      tone: 'muted'
    })
  return rows
}

export function WinStatusView({
  t,
  status,
  checking,
  onRecheck
}: {
  t: T
  status: ComputerStatus | null
  checking: boolean
  onRecheck: () => void
}): React.JSX.Element {
  return (
    <>
      <Card>
        {winStatusRows(t, status).map((r) => (
          <Row key={r.id} label={r.label}>
            <Badge tone={r.tone}>{r.value}</Badge>
          </Row>
        ))}
      </Card>
      <div className="mt-2">
        <Button variant="secondary" size="sm" type="button" onClick={onRecheck} disabled={checking}>
          {checking ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={13} aria-hidden="true" />}{' '}
          {t('tasksComputer.winStatus.recheck')}
        </Button>
      </div>
    </>
  )
}

const OUTCOME_TONE: Record<ComputerAuditRow['outcome'], Tone> = {
  ok: 'ok',
  denied: 'warn',
  error: 'error',
  stopped: 'warn',
  'rate-limited': 'warn'
}

/** Hora local corta de una entrada (`2026-10-07T01:30:00.000Z` → `01:30:00` en la zona del equipo). */
export function auditTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString()
}

/** Detalle visible de una entrada: coordenadas, combinación de teclas o longitud del texto (nunca el texto). */
export function auditDetail(t: T, r: ComputerAuditRow): string {
  const parts: string[] = []
  if (r.x !== null && r.y !== null) parts.push(`${r.x}, ${r.y}`)
  if (r.keyCombo) parts.push(r.keyCombo)
  if (r.textLen !== null) parts.push(t('tasksComputer.audit.chars', { count: r.textLen }))
  if (r.appName) parts.push(r.appName)
  if (r.reason) parts.push(r.reason)
  return parts.join(' · ')
}

export function AuditLogView({ t, rows }: { t: T; rows: ComputerAuditRow[] }): React.JSX.Element {
  if (!rows.length) return <p className="text-sm text-muted">{t('tasksComputer.audit.empty')}</p>
  return (
    <div className="max-h-80 overflow-auto rounded-xl border border-border">
      <table className="w-full text-left text-xs" aria-label={t('tasksComputer.audit.aria')}>
        <thead className="sticky top-0 bg-elevated text-muted">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              {t('tasksComputer.audit.colTime')}
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {t('tasksComputer.audit.colAction')}
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {t('tasksComputer.audit.colResult')}
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {t('tasksComputer.audit.colDetail')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.at}-${i}`} className="border-t border-border">
              <td className="whitespace-nowrap px-3 py-1.5 text-muted">{auditTime(r.at)}</td>
              <td className="px-3 py-1.5 font-mono">{r.tool}</td>
              <td className="px-3 py-1.5">
                <Badge tone={OUTCOME_TONE[r.outcome]}>{t(`tasksComputer.audit.out.${r.outcome}`)}</Badge>
              </td>
              <td className="px-3 py-1.5 text-muted">{auditDetail(t, r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ComputerAuditLog(): React.JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<ComputerAuditRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    setError(null)
    cw('computer:auditLog')
      .then(setRows)
      .catch((err: unknown) => setError(errorMessage(err) || t('tasksComputer.audit.failed')))
  }, [t])
  const toggle = (): void => {
    if (!open) load()
    setOpen(!open)
  }
  return (
    <div>
      <p className="mb-3 text-sm text-muted">{t('tasksComputer.audit.desc')}</p>
      <Button variant="secondary" size="sm" type="button" aria-expanded={open} onClick={toggle}>
        {open ? t('tasksComputer.audit.hide') : t('tasksComputer.audit.show')}
      </Button>
      {open && (
        <div className="mt-3">
          {error ? (
            <ErrorText>{error}</ErrorText>
          ) : rows === null ? (
            <p className="flex items-center gap-1.5 text-sm text-muted">
              <Loader2 size={13} className="animate-spin" aria-hidden="true" /> {t('tasksComputer.audit.loading')}
            </p>
          ) : (
            <AuditLogView t={t} rows={rows} />
          )}
        </div>
      )}
    </div>
  )
}

/** Todo lo de Windows de Ajustes › Control del PC. */
export function ComputerWinSettings(): React.JSX.Element {
  const t = useT()
  const [status, setStatus] = useState<ComputerStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const refresh = useCallback(() => {
    if (!hasTasksBridge()) return
    setChecking(true)
    cw('computer:status')
      .then(setStatus)
      .catch(() => undefined)
      .finally(() => setChecking(false))
  }, [])
  useEffect(() => {
    refresh()
    // Al volver a la ventana (p. ej. tras desbloquear la sesión o cerrar el administrador) se vuelve a comprobar.
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])
  return (
    <div>
      <ComputerConsentWin showOnWhenGranted />
      <SubTitle>{t('tasksComputer.winStatus.title')}</SubTitle>
      <WinStatusView t={t} status={status} checking={checking} onRecheck={refresh} />
      <SubTitle>{t('tasksComputer.audit.title')}</SubTitle>
      <ComputerAuditLog />
    </div>
  )
}
