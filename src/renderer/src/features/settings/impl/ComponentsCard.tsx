/**
 * Ajustes › Diagnóstico › «Estado de componentes»: lo mismo que revisa el arranque (`preflight:run`): qué está listo y qué falta, con
 * versiones, y el botón «Revisar de nuevo». La misma lista sale en el informe exportado (main la guarda al revisar). Instalar lo que falta se hace
 * en la pantalla «Preparando» (el botón «Instalar o activar piezas» la vuelve a abrir, también tras «Más tarde») o en la tarjeta de cada componente.
 */
import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { DISPLAY_NAME } from '@shared/brand'
import { visibleRows, type PreflightReport } from '@shared/preflight'
import { Button } from '../../../components/Button'
import { useT } from '../../../lib/i18n'
import { cw } from '../../tasks/impl/bridge'
import { LABELS, hintKey } from '../../onboarding/preflight-view'
import { openPreflight } from '../../onboarding/preflight-open'
import { Badge, Card, ErrorText } from './ui'

export function ComponentsCard(): React.JSX.Element {
  const t = useT()
  const [report, setReport] = useState<PreflightReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const run = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      setReport(await cw('preflight:run'))
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void run()
  }, [run])

  const rows = report && !report.skipped ? visibleRows(report) : []
  const trustOn = report?.components.some((c) => c.id === 'trust' && c.ok) === true
  const [removing, setRemoving] = useState(false)
  const [removeFailed, setRemoveFailed] = useState(false)
  const removeTrust = async (): Promise<void> => {
    setRemoving(true)
    setRemoveFailed(false)
    const r = await cw('preflight:trust:remove').catch(() => null)
    // Cancelar el aviso de macOS no es un error: queda como estaba.
    if (!r?.ok && r?.error !== 'cancelled') setRemoveFailed(true)
    setRemoving(false)
    await run()
  }
  return (
    <>
      <div className="mt-6 mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-48">
          <h3 className="text-sm font-semibold">{t('settings.diag.components.title')}</h3>
          <p className="text-xs text-muted">{t('settings.diag.components.desc', { app: DISPLAY_NAME })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={openPreflight}>
            {t('settings.diag.components.open')}
          </Button>
          <Button onClick={() => void run()} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}{' '}
            {busy ? t('settings.diag.components.checking') : t('settings.diag.components.recheck')}
          </Button>
        </div>
      </div>
      <Card>
        {failed && (
          <div className="px-4 py-3">
            <ErrorText>{t('settings.diag.components.error')}</ErrorText>
          </div>
        )}
        {rows.map((c) => {
          const k = hintKey(c)
          return (
            <div key={c.id} className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{t(LABELS[c.id], { app: DISPLAY_NAME })}</div>
                <div className="mt-0.5 text-xs text-muted">
                  {c.ok
                    ? c.version
                      ? t('preflight.version', { v: c.version })
                      : t('preflight.state.ready')
                    : k
                      ? t(k, { app: DISPLAY_NAME, mb: Math.round((c.sizeBytes ?? 0) / 1e6) })
                      : ''}
                </div>
              </div>
              <Badge tone={c.ok ? 'ok' : c.essential ? 'error' : 'warn'}>
                {c.ok ? t('preflight.state.ready') : c.essential ? t('preflight.state.missing') : t('preflight.state.pending')}
              </Badge>
            </div>
          )
        })}
      </Card>
      {trustOn && (
        <div className="mt-4 rounded-ctl bg-inset px-4 py-3" data-testid="trust-remove">
          <div className="text-sm font-medium">{t('settings.diag.trust.title', { app: DISPLAY_NAME })}</div>
          <p className="mt-0.5 text-xs text-muted">{t('settings.diag.trust.desc', { app: DISPLAY_NAME })}</p>
          <Button className="mt-2" variant="secondary" onClick={() => void removeTrust()} disabled={removing}>
            {removing ? t('settings.diag.trust.removing') : t('settings.diag.trust.remove', { app: DISPLAY_NAME })}
          </Button>
          {removeFailed && <ErrorText>{t('settings.diag.trust.failed')}</ErrorText>}
        </div>
      )}
    </>
  )
}
