/**
 * Ajustes › Funciones experimentales › «Ver y quitar los "siempre" de una carpeta» (Ola 7, 7.22). Lista, por carpeta reciente, lo que el
 * motor recordó con «Permitir siempre» y deja quitar una regla a la vez. Todo el texto de una regla viene del motor: se pinta como texto
 * plano (nunca como HTML) y ya llega acotado y sin saltos de línea (`@shared/engine-always`). Solo ve el motor principal.
 */
import { useCallback, useEffect, useId, useState } from 'react'
import type { AlwaysListResult } from '@shared/engine-always'
import { Button } from '../../../components/Button'
import { call } from '../../../lib/api'
import { useT } from '../../../lib/i18n'
import { errorMessage } from '../../../lib/opencode'
import { useSettings } from '../../../stores/settings'
import { rememberAlwaysOn } from '@shared/permission-persist'
import { Card, ErrorText, Select } from './ui'

type View = { state: 'idle' } | { state: 'loading' } | { state: 'ready'; list: AlwaysListResult }

export function AlwaysRulesBlock(): React.JSX.Element {
  const t = useT()
  const id = useId()
  const folders = useSettings((s) => s.settings.recentFolders)
  const remember = useSettings((s) => rememberAlwaysOn(s.settings))
  const [dir, setDir] = useState<string>('')
  const [view, setView] = useState<View>({ state: 'idle' })
  const [busyId, setBusyId] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback((directory: string): void => {
    setError(null)
    if (!directory) {
      setView({ state: 'idle' })
      return
    }
    setView({ state: 'loading' })
    call('settings:alwaysList', { directory })
      .then((list) => setView({ state: 'ready', list }))
      .catch((err: unknown) => {
        setView({ state: 'idle' })
        setError(errorMessage(err))
      })
  }, [])

  // Al abrir la vista se elige la carpeta más reciente (si hay).
  useEffect(() => {
    if (!dir && folders.length > 0) setDir(folders[0]!)
  }, [dir, folders])
  useEffect(() => {
    load(dir)
  }, [dir, load])

  const revoke = (ruleId: string): void => {
    if (busyId || !dir) return
    setBusyId(ruleId)
    setNote(null)
    setError(null)
    call('settings:alwaysRevoke', { directory: dir, id: ruleId })
      .then((r) => {
        setNote(r.available && !r.ok ? t('settings.engine.always.gone') : t('settings.engine.always.revoked'))
        load(dir)
      })
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setBusyId(null))
  }

  const list = view.state === 'ready' ? view.list : null

  return (
    <section aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} className="mb-8">
      <h3 id={`${id}-t`} className="mb-1 text-sm font-semibold">
        {t('settings.engine.always.title')}
      </h3>
      <p id={`${id}-d`} className="mb-3 text-sm leading-relaxed text-muted">
        {t('settings.engine.always.desc')}
      </p>
      {folders.length === 0 ? (
        <p className="text-xs text-muted">{t('settings.engine.always.noFolders')}</p>
      ) : (
        <Card className="mb-2">
          <div className="flex flex-col gap-3 px-4 py-3">
            <label className="text-sm font-medium" htmlFor={`${id}-f`}>
              {t('settings.engine.always.folder')}
            </label>
            <Select id={`${id}-f`} value={dir} onChange={(e) => setDir(e.target.value)}>
              {folders.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
            {view.state === 'loading' && <p className="text-xs text-muted">{t('settings.engine.always.loading')}</p>}
            {list && !list.available && (
              <p role="status" className="text-xs text-muted">
                {t('settings.engine.always.unavailable')}
              </p>
            )}
            {list?.available && !list.active && !remember && list.rules.length > 0 && (
              <p className="text-xs text-muted">{t('settings.engine.always.off')}</p>
            )}
            {list?.available && list.notice && <p className="text-xs text-muted">{list.notice}</p>}
            {list?.available && list.rules.length === 0 && <p className="text-xs text-muted">{t('settings.engine.always.empty')}</p>}
            {list?.available && list.rules.length > 0 && (
              <ul className="flex flex-col divide-y divide-border/60" aria-label={t('settings.engine.always.title')}>
                {list.rules.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0 text-xs">
                      <div className="font-medium">{r.permission}</div>
                      <div className="break-all text-muted" title={r.pattern}>
                        {r.pattern}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busyId !== null}
                      aria-label={t('settings.engine.always.revokeAria', { permission: r.permission, pattern: r.pattern })}
                      onClick={() => revoke(r.id)}
                    >
                      {t('settings.engine.always.revoke')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {list?.available && list.truncated && (
              <p className="text-xs text-muted">{t('settings.engine.always.truncated', { n: list.rules.length })}</p>
            )}
          </div>
        </Card>
      )}
      <p className="text-xs text-muted">{t('settings.engine.always.sandboxNote')}</p>
      {note && (
        <p role="status" className="text-xs text-muted">
          {note}
        </p>
      )}
      {error && <ErrorText>{error}</ErrorText>}
    </section>
  )
}
