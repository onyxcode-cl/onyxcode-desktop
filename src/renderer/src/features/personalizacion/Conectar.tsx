/**
 * Conectar un conector, paso a paso y en lenguaje llano (F8-B181). Nada se añade ni se conecta hasta el paso 2:
 *   1. «Lee esto»: qué podrá y qué NO podrá hacer, aviso de que verá tus datos y se los pasa al modelo, casilla «Entiendo».
 *   2. «Entra a tu cuenta» (o «Datos de acceso»): token (se guarda sin volver a mostrarse) o inicio de sesión en el servicio.
 *      El inicio de sesión lo hace el flujo que ya tiene el motor: la app nunca ve la contraseña.
 *   3. «Listo»: el estado real que informa el motor (nada se afirma si no está conectado).
 * Reutiliza el alta de Ajustes › Conectores (`useMcpConnections.install`), que construye la entrada desde su copia del catálogo.
 */
import { useState } from 'react'
import { AlertTriangle, Check, ExternalLink, Loader2, X } from 'lucide-react'
import type { CatalogConnector } from '@shared/catalogo'
import { catalogText } from '@shared/mcp-catalog'
import { Button } from '../../components/Button'
import { useT } from '../../lib/i18n'
import { errorMessage } from '../../lib/opencode'
import { previewJson, suggestName } from '../settings/impl/McpCatalogDialog'
import { TextInput } from '../settings/impl/ui'
import { Toggle } from '../../components/Toggle'
import { IconTile } from './Ficha'
import { Modal } from './Modal'
import type { ConnectorState } from './logic'

type Step = 1 | 2 | 3

export function ConnectWizard({
  item,
  existingNames,
  stateOf,
  onInstall,
  onLogin,
  onClose
}: {
  item: CatalogConnector
  existingNames: string[]
  /** Estado real del conector tras añadirlo (lo informa el motor). */
  stateOf: (server: string) => ConnectorState
  onInstall: (req: { name: string; inputs: Record<string, string>; enable: boolean; askEachUse: boolean }) => Promise<void>
  onLogin: (server: string) => Promise<void>
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const ct = catalogText(item)
  const [step, setStep] = useState<Step>(1)
  const [understood, setUnderstood] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const [askEachUse, setAskEachUse] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [server, setServer] = useState<string | null>(null)
  const name = suggestName(item.name, existingNames)

  const inputErrors = Object.fromEntries(
    item.inputs.map((i) => {
      const v = values[i.id] ?? ''
      if (!v) return [i.id, null]
      if (/[\r\n]/.test(v)) return [i.id, t('mcp.dlg.noNewlines')]
      if (v.length > i.maxLength || !new RegExp(i.pattern).test(v)) return [i.id, t('mcp.dlg.badFormat', { label: ct.inputs[i.id].label })]
      return [i.id, null]
    })
  )
  const missing = item.inputs.some((i) => !values[i.id])
  const canGo = !busy && !missing && Object.values(inputErrors).every((e) => !e)

  const connect = async (): Promise<void> => {
    if (!canGo) return
    setBusy(true)
    setError(null)
    try {
      await onInstall({ name, inputs: values, enable: true, askEachUse })
      setServer(name)
      if (item.auth === 'oauth') {
        try {
          await onLogin(name)
        } catch (err) {
          // El conector ya quedó añadido: se sigue al paso 3, que dice la verdad («falta entrar») y deja reintentar.
          setError(errorMessage(err))
        }
      }
      setStep(3)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const retryLogin = async (): Promise<void> => {
    if (!server) return
    setBusy(true)
    setError(null)
    try {
      await onLogin(server)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const st: ConnectorState = server ? stateOf(server) : 'none'
  const stepLabel = (n: Step): string =>
    n === 1 ? t('pers.wiz.step1') : n === 2 ? (item.auth === 'oauth' ? t('pers.wiz.step2oauth') : t('pers.wiz.step2')) : t('pers.wiz.step3')

  return (
    <Modal
      labelId="pers-wizard-title"
      onClose={onClose}
      busy={busy}
      wide
      header={
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex min-w-0 items-center gap-3">
            <IconTile icon={item.icon} size={40} />
            <div className="min-w-0">
              <h3 id="pers-wizard-title" className="text-base font-semibold desk:text-[17px] desk:leading-6">
                {t('pers.wiz.title', { title: ct.title })}
              </h3>
              <p className="text-xs text-muted">{t('pers.wiz.sub')}</p>
            </div>
          </div>
          <ol className="ml-auto flex items-center gap-2 text-xs" aria-label={t('pers.wiz.steps')}>
            {([1, 2, 3] as Step[]).map((n) => (
              <li
                key={n}
                aria-current={step === n ? 'step' : undefined}
                className={`flex items-center gap-1.5 ${step === n ? 'font-semibold text-fg' : 'text-muted'}`}
              >
                <span
                  className={`grid size-5 place-items-center rounded-full text-meta ${step === n ? 'bg-accent text-accent-fg' : step > n ? 'bg-success/20 text-success' : 'border border-border'}`}
                >
                  {step > n ? <Check size={11} aria-hidden="true" /> : n}
                </span>
                {stepLabel(n)}
              </li>
            ))}
          </ol>
        </div>
      }
      footer={
        step === 1 ? (
          <>
            <Button variant="ghost" onClick={onClose} data-initial-focus="">
              {t('pers.wiz.notNow')}
            </Button>
            <Button variant="primary" disabled={!understood} onClick={() => setStep(2)}>
              {t('pers.wiz.next')}
            </Button>
          </>
        ) : step === 2 ? (
          <>
            <Button variant="ghost" onClick={() => setStep(1)} disabled={busy}>
              {t('pers.wiz.back')}
            </Button>
            <Button variant="primary" disabled={!canGo} onClick={() => void connect()}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : item.auth === 'oauth' ? <ExternalLink size={14} /> : null}{' '}
              {item.auth === 'oauth' ? t('pers.wiz.continueIn', { publisher: item.publisher }) : t('pers.wiz.connectNow')}
            </Button>
          </>
        ) : (
          <>
            {st === 'needs-login' && (
              <Button variant="secondary" onClick={() => void retryLogin()} disabled={busy}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />} {t('pers.connector.login')}
              </Button>
            )}
            <Button variant="primary" onClick={onClose} data-initial-focus="">
              {t('pers.done')}
            </Button>
          </>
        )
      }
    >
      {step === 1 && (
        <div className="grid gap-5 desk:grid-cols-2">
          <div>
            <h4 className="text-meta font-semibold tracking-[0.04em] text-subtle uppercase">{t('pers.detail.can')}</h4>
            <ul className="mt-2 space-y-2 text-sm">
              {ct.capabilities.map((c) => (
                <li key={c} className="flex items-start gap-2">
                  <Check size={16} className="mt-0.5 shrink-0 text-success" aria-hidden="true" /> <span>{c}</span>
                </li>
              ))}
            </ul>
            <h4 className="mt-5 text-meta font-semibold tracking-[0.04em] text-subtle uppercase">{t('pers.detail.cannot')}</h4>
            <ul className="mt-2 space-y-2 text-sm">
              {ct.cannot.map((c) => (
                <li key={c} className="flex items-start gap-2">
                  <X size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" /> <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-3">
            <div className="rounded-xl border border-warning/40 bg-warning/10 p-3.5 text-sm">
              <p className="flex items-center gap-1.5 font-semibold text-warning">
                <AlertTriangle size={15} aria-hidden="true" /> {t('pers.wiz.sees', { title: ct.title })}
              </p>
              <p className="mt-1.5 leading-relaxed">{t('pers.wiz.seesBody')}</p>
              <p className="mt-1.5 text-xs text-muted">{ct.dataLeaves}</p>
            </div>
            {item.writes && <p className="text-xs text-warning">{t('mcp.dlg.writes')}</p>}
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={understood}
                onChange={(e) => setUnderstood(e.target.checked)}
                className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
              />
              <span>{t('pers.wiz.understand', { title: ct.title })}</span>
            </label>
            <p className="text-xs text-muted">{t('pers.wiz.undo')}</p>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          {item.auth === 'none' && <p className="text-sm">{t('pers.wiz.noAccount', { title: ct.title })}</p>}
          {item.auth === 'oauth' && (
            <div className="rounded-xl border border-border bg-bg p-3.5 text-sm">
              <p className="font-semibold">{t('pers.wiz.after')}</p>
              <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-muted">
                <li>{t('pers.wiz.oauth1', { publisher: item.publisher })}</li>
                <li>{t('pers.wiz.oauth2')}</li>
              </ol>
              <p className="mt-2 text-xs text-muted">{t('pers.wiz.neverSeen')}</p>
            </div>
          )}
          {item.inputs.map((input) => (
            <div key={input.id}>
              <label className="block text-sm font-medium" htmlFor={`pers-in-${input.id}`}>
                {ct.inputs[input.id].label}
              </label>
              {ct.inputs[input.id].help && <p className="mt-0.5 text-xs text-muted">{ct.inputs[input.id].help}</p>}
              <TextInput
                id={`pers-in-${input.id}`}
                type="password"
                autoComplete="off"
                spellCheck={false}
                className="mt-1.5 font-mono"
                maxLength={input.maxLength}
                value={values[input.id] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [input.id]: e.target.value }))}
                aria-invalid={!!inputErrors[input.id]}
              />
              {inputErrors[input.id] && <p className="mt-1 text-xs text-danger">{inputErrors[input.id]}</p>}
              <p className="mt-1 text-xs text-subtle">{t('pers.wiz.tokenSaved')}</p>
            </div>
          ))}
          <label className="flex items-center gap-2.5 text-sm">
            <Toggle checked={askEachUse} onChange={setAskEachUse} label={t('mcp.dlg.askEach')} disabled={busy} />
            <span>{t('mcp.dlg.askEach')}</span>
          </label>
          <p className="text-xs text-muted">{t('pers.wiz.tasksOff')}</p>
          <details className="text-xs text-muted">
            <summary className="cursor-pointer">{t('pers.wiz.showExact')}</summary>
            <pre
              tabIndex={0}
              aria-label={t('mcp.dlg.configAria')}
              className="mt-1.5 max-h-40 overflow-auto rounded-lg border border-border bg-bg p-2.5 font-mono text-meta leading-relaxed"
            >
              {previewJson(item, name, true, askEachUse)}
            </pre>
          </details>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3 text-sm" role="status">
          {st === 'connected' ? (
            <p className="flex items-center gap-2 font-semibold text-success">
              <Check size={18} aria-hidden="true" /> {t('pers.wiz.done', { title: ct.title })}
            </p>
          ) : st === 'needs-login' ? (
            <p className="flex items-start gap-2 text-warning">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" /> {t('pers.wiz.needsLogin', { title: ct.title })}
            </p>
          ) : st === 'problem' ? (
            <p className="flex items-start gap-2 text-danger">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" /> {t('pers.wiz.problem', { title: ct.title })}
            </p>
          ) : (
            <p className="flex items-center gap-2 text-muted">
              <Loader2 size={16} className="animate-spin" aria-hidden="true" /> {t('pers.wiz.checking')}
            </p>
          )}
          <p className="text-muted">{t('pers.wiz.tryIt')}</p>
          <ul className="space-y-1.5">
            {ct.examples.map((x) => (
              <li key={x} className="rounded-lg border border-border bg-bg px-3 py-1.5 text-muted">
                «{x}»
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">{t('pers.wiz.removeLater')}</p>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}
