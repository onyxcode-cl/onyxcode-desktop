/**
 * Ajustes › Funciones experimentales › «Ganchos»: interruptor «Activar ganchos» (`Settings.userHooksEnabled`, APAGADO por defecto) y editor del
 * archivo `userData/hooks/hooks.json` que lee el motor. Guardar valida primero aquí con la misma lógica que el motor (`@shared/user-hooks`) y main
 * vuelve a validar al escribir. Los ganchos ejecutan comandos con los permisos de la persona: el aviso es siempre visible. El contenido del editor
 * no sale de esta ventana salvo hacia `settings:hooksWrite`; nunca se registra.
 */
import { useEffect, useId, useState } from 'react'
import { t as tr, type MsgKey } from '@shared/i18n'
import { HOOKS_EXAMPLE, userHooksOn, validateHooksText, type HooksIssue } from '@shared/user-hooks'
import { Button } from '../../../components/Button'
import { call } from '../../../lib/api'
import { useT } from '../../../lib/i18n'
import { errorMessage } from '../../../lib/opencode'
import { useSettings } from '../../../stores/settings'
import { Card, ErrorText, Row, TextArea, Toggle } from './ui'

const issueText = (i: HooksIssue): string => tr(`settings.engine.hooks.err.${i.code}` as MsgKey, i.params)

export function UserHooksBlock(): React.JSX.Element {
  const t = useT()
  const id = useId()
  const enabled = useSettings((s) => userHooksOn(s.settings))
  const update = useSettings((s) => s.update)
  const [text, setText] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [issues, setIssues] = useState<HooksIssue[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    call('settings:hooksRead')
      .then((r) => {
        if (!alive) return
        setText(r.text)
        setLoaded(true)
      })
      .catch(() => {
        if (alive) setError(tr('settings.engine.hooks.loadFailed'))
      })
    return () => {
      alive = false
    }
  }, [])

  const edit = (value: string): void => {
    setText(value)
    setNote(null)
    setIssues([])
    setError(null)
  }

  const save = (): void => {
    if (busy) return
    setNote(null)
    setError(null)
    const v = validateHooksText(text)
    if (!v.ok) {
      setIssues(v.issues)
      return
    }
    setIssues([])
    setBusy(true)
    call('settings:hooksWrite', { text })
      .then((r) => {
        if (r.ok) {
          setText(v.text)
          setNote(v.count > 0 ? tr('settings.engine.hooks.savedCount', { n: v.count }) : tr('settings.engine.hooks.saved'))
        } else setIssues(r.issues)
      })
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setBusy(false))
  }

  return (
    <section aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} className="mb-8">
      <h3 id={`${id}-t`} className="mb-1 text-sm font-semibold">
        {t('settings.engine.hooks.title')}
      </h3>
      <p id={`${id}-d`} className="mb-2 text-sm leading-relaxed text-muted">
        {t('settings.engine.hooks.desc')}
      </p>
      <p role="note" className="mb-3 rounded-md border border-border px-3 py-2 text-xs font-medium leading-relaxed">
        {t('settings.engine.hooks.warning')}
      </p>
      <Card className="mb-3">
        <Row label={t('settings.engine.hooks.toggle')} description={t('settings.engine.hooks.toggleDesc')}>
          <Toggle checked={enabled} onChange={(v) => void update({ userHooksEnabled: v })} label={t('settings.engine.hooks.toggle')} />
        </Row>
      </Card>
      <label htmlFor={`${id}-ed`} className="mb-1 block text-xs font-medium">
        {t('settings.engine.hooks.editorLabel')}
      </label>
      <TextArea
        id={`${id}-ed`}
        rows={10}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        value={text}
        disabled={!loaded && !error}
        placeholder={'{"hooks":{}}'}
        aria-describedby={`${id}-h`}
        onChange={(e) => edit(e.target.value)}
      />
      <p id={`${id}-h`} className="mb-2 mt-1 text-xs leading-relaxed text-muted">
        {t('settings.engine.hooks.editorHelp')}
      </p>
      <details className="mb-3 text-xs">
        <summary className="cursor-pointer font-medium">{t('settings.engine.hooks.exampleTitle')}</summary>
        <pre className="mt-2 overflow-x-auto rounded-md border border-border p-2 font-mono text-xs leading-relaxed">{HOOKS_EXAMPLE}</pre>
        <Button size="sm" variant="secondary" className="mt-2" onClick={() => edit(HOOKS_EXAMPLE)}>
          {t('settings.engine.hooks.useExample')}
        </Button>
      </details>
      <div className="mb-2 flex items-center gap-2">
        <Button size="sm" disabled={busy || (!loaded && !error)} onClick={save}>
          {t('settings.engine.hooks.save')}
        </Button>
      </div>
      {issues.length > 0 && (
        <div role="alert" className="text-xs">
          <p className="mb-1 font-medium">{t('settings.engine.hooks.errorsTitle')}</p>
          <ul className="list-disc pl-5">
            {issues.map((i, n) => (
              <li key={n} className="text-danger">
                {issueText(i)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {note && (
        <p role="status" className="text-xs text-muted">
          {note}
        </p>
      )}
      {error && <ErrorText>{error}</ErrorText>}
    </section>
  )
}
