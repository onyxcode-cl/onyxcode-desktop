import { useEffect, useRef, useState } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'
import type { Provider, ProviderAuthAuthorization, ProviderAuthMethod } from '@opencode-ai/sdk/v2/client'
import { friendlyError } from '@shared/ai-errors'
import { DISPLAY_NAME } from '@shared/brand'
import { Button } from '../../../components/Button'
import { CopyButton } from '../../../components/CopyButton'
import { reportProblem } from '../../../lib/report-problems'
import { openExternalUrlStrict } from '../../../lib/open-external'
import { useT } from '../../../lib/i18n'
import { KeyTestNotice } from './KeyTestNotice'
import { authOptions, saveProviderKey } from './providerCatalog'
import { Card, Field, Select, TextInput } from './ui'

export { saveProviderKey }

interface Props {
  /** Proveedores entre los que elegir (o el único, con `fixedProviderId`). */
  providers: Pick<Provider, 'id' | 'name' | 'env'>[]
  /** Métodos de autenticación por proveedor (`provider.auth`); sin datos = se asume API key. */
  auth: Record<string, ProviderAuthMethod[]>
  busy: boolean
  /** Falla (rechaza) si no se pudo guardar; el formulario solo se limpia si resuelve. */
  onSetKey: (providerID: string, key: string) => Promise<void>
  /** Proveedor fijo (asistente de primer uso): oculta el selector. */
  fixedProviderId?: string
  /** Encabezado del formulario; `null` lo oculta (el anfitrión ya pone uno). */
  title?: string | null
  /** Inicia un inicio de sesión OAuth (devuelve la URL a abrir). Sin esta función y `onOauthFinish` no se ofrece OAuth. */
  onOauthStart?: (providerID: string, method: number) => Promise<ProviderAuthAuthorization>
  /** Completa el inicio de sesión (con `code` si el método lo pide). Rechaza si falla. */
  onOauthFinish?: (providerID: string, method: number, code?: string) => Promise<void>
  /** Libera la interfaz de un login pendiente (el anfitrión deja de marcarlo como en curso). */
  onOauthCancel?: () => void
  /** Muestra bajo el formulario el resultado de probar la clave recién guardada (false si el anfitrión ya lo enseña). */
  showTestResult?: boolean
  className?: string
}

type Flow =
  | { kind: 'idle' }
  | { kind: 'starting'; index: number }
  | { kind: 'auto'; index: number; instructions: string }
  | { kind: 'code'; index: number; instructions: string; code: string; submitting: boolean }

/** Código del flujo «sin navegador» a partir de las instrucciones del motor («Enter code: XXXX-XXXXX»); `null` si no hay. */
export function parseDeviceCode(instructions: string): string | null {
  const m = /(?:code|c[oó]digo)\s*[:：]\s*([A-Za-z0-9][A-Za-z0-9-]{3,})/i.exec(instructions)
  return m ? m[1] : null
}

/** Quita de un mensaje de error lo que no debe anotarse: códigos de autorización y cadenas largas que parezcan tokens. */
export function sanitizeAuthMessage(message: string): string {
  return message
    .replace(/([?&#](?:code|state|access_token|refresh_token|id_token)=)[^&\s]+/gi, '$1…')
    .replace(/\b(?:Bearer|Basic)\s+\S+/gi, '…')
    .replace(/[A-Za-z0-9_\-.]{24,}/g, '…')
    .slice(0, 300)
}

/** Espera de un login «automático»: muestra el código/instrucciones del motor (si las hay) y deja cancelar o cambiar de método. */
export function OauthAutoPanel({
  instructions,
  onCancel,
  onOtherMethod
}: {
  instructions: string
  onCancel: () => void
  onOtherMethod?: () => void
}): React.JSX.Element {
  const t = useT()
  const code = parseDeviceCode(instructions)
  return (
    <div className="space-y-2" aria-live="polite">
      {instructions && (
        <div data-testid="oauth-instructions" className="rounded-ctl bg-elevated px-3 py-2">
          <p className="text-xs text-muted">{t('models.form.oauthCodeHint')}</p>
          <div className="mt-1 flex items-center gap-2">
            <code className="select-all font-mono text-base font-semibold tracking-wider">{code ?? instructions}</code>
            <CopyButton text={code ?? instructions} label={t('models.form.copyCode')} showLabel />
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs text-muted">
          <Loader2 size={13} className="animate-spin" /> {t('models.form.oauthWaiting')}
        </p>
        <div className="flex items-center gap-1">
          {onOtherMethod && (
            <Button size="sm" variant="ghost" onClick={onOtherMethod}>
              {t('models.form.otherMethod')}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t('models.form.cancel')}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Motivo de un login fallido tras abrir la página, con «Reintentar» y la sugerencia del método sin navegador. */
export function OauthFailure({ reason, onRetry }: { reason: string; onRetry: () => void }): React.JSX.Element {
  const t = useT()
  return (
    <div
      role="alert"
      data-testid="oauth-failure"
      className="mb-2 rounded-ctl bg-danger/10 px-3 py-2 text-xs ring-1 ring-danger/30 ring-inset"
    >
      <p className="text-fg">{t('models.form.oauthFailed', { reason })}</p>
      <p className="mt-1 text-muted">{t('models.form.oauthHint')}</p>
      <Button size="sm" className="mt-2" onClick={onRetry}>
        {t('models.form.retry')}
      </Button>
    </div>
  )
}

/** Formulario «Conectar proveedor» (API key u OAuth): lo usan Ajustes › Modelos y el asistente de primer uso. */
export function ProviderKeyForm({
  providers,
  auth,
  busy,
  onSetKey,
  fixedProviderId,
  title,
  onOauthStart,
  onOauthFinish,
  onOauthCancel,
  showTestResult = true,
  className = 'mt-3 p-4'
}: Props): React.JSX.Element {
  const t = useT()
  const [picked, setPicked] = useState('')
  const [key, setKey] = useState('')
  /** Último proveedor cuya clave se guardó desde este formulario: muestra el resultado de la prueba. */
  const [lastSaved, setLastSaved] = useState<{ id: string; name: string } | null>(null)
  const [flow, setFlow] = useState<Flow>({ kind: 'idle' })
  /** Fallo de un login tras abrir la página (se limpia al reintentar, cancelar o cambiar de proveedor). */
  const [failure, setFailure] = useState<{ index: number; reason: string } | null>(null)
  /** Contador de generación: una respuesta de OAuth solo cuenta si sigue siendo la vigente (cancelar, cambiar de proveedor o desmontar la invalidan). */
  const generation = useRef(0)
  const target = fixedProviderId ?? picked
  const opts = authOptions(target ? auth[target] : undefined)
  const oauth = onOauthStart && onOauthFinish ? opts.oauth : []
  const supportsApi = !target || opts.api
  const targetProvider = providers.find((p) => p.id === target)
  const heading =
    title === undefined
      ? fixedProviderId
        ? t('models.form.keyOf', { name: targetProvider?.name ?? fixedProviderId })
        : t('models.form.connectWithKey')
      : title

  useEffect(() => {
    const gen = generation
    return () => {
      gen.current++
    }
  }, [])

  const cancelFlow = (): void => {
    generation.current++
    setFlow({ kind: 'idle' })
    setFailure(null)
    onOauthCancel?.()
  }

  const pick = (id: string): void => {
    cancelFlow()
    setPicked(id)
  }

  const submit = (): void => {
    if (busy || !target || !key.trim() || !supportsApi) return
    void onSetKey(target, key.trim()).then(
      () => {
        setKey('')
        setPicked('')
        setLastSaved({ id: target, name: targetProvider?.name ?? target })
      },
      () => undefined
    )
  }

  const startOauth = async (index: number): Promise<void> => {
    if (!onOauthStart || !onOauthFinish || !target) return
    const mine = ++generation.current
    setFailure(null)
    setFlow({ kind: 'starting', index })
    let opened = false
    try {
      const authz = await onOauthStart(target, index)
      if (mine !== generation.current) return
      await openExternalUrlStrict(authz.url)
      opened = true
      if (mine !== generation.current) return
      if (authz.method === 'auto') {
        setFlow({ kind: 'auto', index, instructions: authz.instructions ?? '' })
        await onOauthFinish(target, index)
        if (mine !== generation.current) return
        setFlow({ kind: 'idle' })
        setPicked('')
      } else {
        setFlow({ kind: 'code', index, instructions: authz.instructions, code: '', submitting: false })
      }
    } catch (err) {
      if (mine !== generation.current) return
      setFlow({ kind: 'idle' })
      // Un fallo ANTES de abrir la página ya lo muestra el anfitrión; el de después (callback, canje, tiempo agotado) se perdía.
      if (opened) {
        const reason = friendlyError(err, { providerID: target }).message
        setFailure({ index, reason })
        // Sin tokens ni códigos de autorización: solo el id del proveedor y el mensaje depurado.
        reportProblem(
          new Error(`Fallo de inicio de sesión (${target}): ${sanitizeAuthMessage(err instanceof Error ? err.message : String(err))}`)
        )
      }
    }
  }

  const confirmCode = async (): Promise<void> => {
    if (flow.kind !== 'code' || !onOauthFinish || !target || !flow.code.trim() || flow.submitting) return
    const { index, instructions } = flow
    const code = flow.code.trim()
    const mine = ++generation.current
    setFlow({ kind: 'code', index, instructions, code, submitting: true })
    try {
      await onOauthFinish(target, index, code)
      if (mine !== generation.current) return
      setFlow({ kind: 'idle' })
      setPicked('')
    } catch {
      if (mine === generation.current) setFlow({ kind: 'code', index, instructions, code, submitting: false })
    }
  }

  return (
    <Card className={`@container ${className}`}>
      {heading !== null && (
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <KeyRound size={15} /> {heading}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className={`grid items-end gap-2 ${fixedProviderId ? 'grid-cols-[1fr_auto]' : 'grid-cols-[1fr_auto] @md:grid-cols-[1fr_1.4fr_auto]'}`}
      >
        {!fixedProviderId && (
          <Field label={t('models.form.provider')} className="col-span-2 @md:col-span-1">
            <Select value={picked} onChange={(e) => pick(e.target.value)}>
              <option value="">{t('models.form.choose')}</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={t('models.form.apiKey')}>
          <TextInput
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={targetProvider?.env[0] ?? 'sk-…'}
            disabled={!target || !supportsApi}
          />
        </Field>
        <Button variant="primary" type="submit" disabled={busy || !target || !key.trim() || !supportsApi}>
          {busy && flow.kind === 'idle' ? <Loader2 size={14} className="animate-spin" /> : null} {t('models.form.save')}
        </Button>
      </form>

      {target && oauth.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          {failure && flow.kind === 'idle' && <OauthFailure reason={failure.reason} onRetry={() => void startOauth(failure.index)} />}
          {flow.kind === 'idle' || flow.kind === 'starting' ? (
            <div className="flex flex-wrap gap-2">
              {oauth.map((m) => (
                <Button key={m.index} disabled={busy || flow.kind === 'starting'} onClick={() => void startOauth(m.index)}>
                  {flow.kind === 'starting' && flow.index === m.index ? <Loader2 size={14} className="animate-spin" /> : null}{' '}
                  {t('models.form.signInWith', { label: m.label })}
                </Button>
              ))}
            </div>
          ) : flow.kind === 'auto' ? (
            <OauthAutoPanel
              instructions={flow.instructions}
              onCancel={cancelFlow}
              onOtherMethod={oauth.length > 1 ? cancelFlow : undefined}
            />
          ) : (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault()
                void confirmCode()
              }}
            >
              {flow.instructions && <p className="text-xs text-muted">{flow.instructions}</p>}
              <div className="grid grid-cols-[1fr_auto] items-end gap-2 @md:grid-cols-[1fr_auto_auto]">
                <Field label={t('models.form.authCode')} className="col-span-2 @md:col-span-1">
                  <TextInput
                    autoComplete="off"
                    value={flow.code}
                    disabled={flow.submitting}
                    onChange={(e) => setFlow({ ...flow, code: e.target.value })}
                  />
                </Field>
                <Button variant="primary" type="submit" disabled={flow.submitting || !flow.code.trim()}>
                  {flow.submitting ? <Loader2 size={14} className="animate-spin" /> : null} {t('models.form.confirm')}
                </Button>
                <Button variant="ghost" onClick={cancelFlow}>
                  {t('models.form.cancel')}
                </Button>
              </div>
            </form>
          )}
        </div>
      )}

      {showTestResult && <KeyTestNotice providerID={lastSaved?.id ?? null} providerName={lastSaved?.name ?? ''} />}

      <p className="mt-2 text-[11px] text-muted">
        {target && !supportsApi && oauth.length === 0
          ? t('models.form.loginOnly', { app: DISPLAY_NAME })
          : t('models.form.keyStoredNote', { app: DISPLAY_NAME })}
      </p>
    </Card>
  )
}
