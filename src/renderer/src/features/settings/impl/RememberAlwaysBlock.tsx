/**
 * Ajustes › Funciones experimentales › «Recordar mis "siempre" entre sesiones»: interruptor (`Settings.rememberAlways`, encendido por
 * defecto) y botón «Olvidar los permisos guardados». El motor guarda en disco los permisos que la persona respondió con «Permitir siempre»;
 * apagar el interruptor reinicia el motor (cuando no hay nada en curso, lo hace el proceso principal) y deja de guardar y de aplicar lo
 * guardado. Lo guardado vive en la carpeta de datos de la app y nunca incluye comandos sueltos de alto riesgo (ver `permission-persist.ts`).
 */
import { useId, useState } from 'react'
import { rememberAlwaysOn } from '@shared/permission-persist'
import { Button } from '../../../components/Button'
import { call } from '../../../lib/api'
import { useT } from '../../../lib/i18n'
import { errorMessage } from '../../../lib/opencode'
import { useSettings } from '../../../stores/settings'
import { Card, ErrorText, Row, Toggle } from './ui'

export function RememberAlwaysBlock(): React.JSX.Element {
  const t = useT()
  const id = useId()
  const remember = useSettings((s) => rememberAlwaysOn(s.settings))
  const update = useSettings((s) => s.update)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const forget = (): void => {
    if (busy) return
    setBusy(true)
    setNote(null)
    setError(null)
    call('settings:forgetAlways')
      .then((r) =>
        setNote(r.removed > 0 ? t('settings.engine.remember.forgotten', { n: r.removed }) : t('settings.engine.remember.nothing'))
      )
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setBusy(false))
  }

  return (
    <section aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} className="mb-8">
      <h3 id={`${id}-t`} className="mb-1 text-sm font-semibold">
        {t('settings.engine.remember.title')}
      </h3>
      <p id={`${id}-d`} className="mb-3 text-sm leading-relaxed text-muted">
        {t('settings.engine.remember.desc')}
      </p>
      <Card className="mb-2">
        <Row label={t('settings.engine.remember.toggle')} description={t('settings.engine.remember.toggleDesc')}>
          <Toggle checked={remember} onChange={(v) => void update({ rememberAlways: v })} label={t('settings.engine.remember.toggle')} />
        </Row>
        <Row label={t('settings.engine.remember.forgetLabel')} description={t('settings.engine.remember.forgetDesc')}>
          <Button size="sm" variant="secondary" disabled={busy} onClick={forget}>
            {t('settings.engine.remember.forget')}
          </Button>
        </Row>
      </Card>
      {note && (
        <p role="status" className="text-xs text-muted">
          {note}
        </p>
      )}
      {error && <ErrorText>{error}</ErrorText>}
    </section>
  )
}
