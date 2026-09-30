import { useEffect, useRef, useState } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'
import type { Provider, ProviderAuthAuthorization, ProviderAuthMethod } from '@opencode-ai/sdk/v2/client'
import { APP_NAME } from '@shared/brand'
import { Button } from '../../../components/Button'
import { call } from '../../../lib/api'
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
  className?: string
}

type Flow =
  | { kind: 'idle' }
  | { kind: 'starting'; index: number }
  | { kind: 'auto'; index: number }
  | { kind: 'code'; index: number; instructions: string; code: string; submitting: boolean }

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
  className = 'mt-3 p-4'
}: Props): React.JSX.Element {
  const [picked, setPicked] = useState('')
  const [key, setKey] = useState('')
  const [flow, setFlow] = useState<Flow>({ kind: 'idle' })
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
        ? `Clave de ${targetProvider?.name ?? fixedProviderId}`
        : 'Conectar proveedor con API key'
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
      },
      () => undefined
    )
  }

  const startOauth = async (index: number): Promise<void> => {
    if (!onOauthStart || !onOauthFinish || !target) return
    const mine = ++generation.current
    setFlow({ kind: 'starting', index })
    try {
      const authz = await onOauthStart(target, index)
      if (mine !== generation.current) return
      await call('app:openExternal', { url: authz.url })
      if (mine !== generation.current) return
      if (authz.method === 'auto') {
        setFlow({ kind: 'auto', index })
        await onOauthFinish(target, index)
        if (mine !== generation.current) return
        setFlow({ kind: 'idle' })
        setPicked('')
      } else {
        setFlow({ kind: 'code', index, instructions: authz.instructions, code: '', submitting: false })
      }
    } catch {
      if (mine === generation.current) setFlow({ kind: 'idle' })
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
          <Field label="Proveedor" className="col-span-2 @md:col-span-1">
            <Select value={picked} onChange={(e) => pick(e.target.value)}>
              <option value="">Elegir…</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="API key">
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
          {busy && flow.kind === 'idle' ? <Loader2 size={14} className="animate-spin" /> : null} Guardar
        </Button>
      </form>

      {target && oauth.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          {flow.kind === 'idle' || flow.kind === 'starting' ? (
            <div className="flex flex-wrap gap-2">
              {oauth.map((m) => (
                <Button key={m.index} disabled={busy || flow.kind === 'starting'} onClick={() => void startOauth(m.index)}>
                  {flow.kind === 'starting' && flow.index === m.index ? <Loader2 size={14} className="animate-spin" /> : null} Iniciar
                  sesión · {m.label}
                </Button>
              ))}
            </div>
          ) : flow.kind === 'auto' ? (
            <div className="flex items-center justify-between gap-2" aria-live="polite">
              <p className="flex items-center gap-2 text-xs text-muted">
                <Loader2 size={13} className="animate-spin" /> Completa el inicio de sesión en el navegador…
              </p>
              <Button size="sm" variant="ghost" onClick={cancelFlow}>
                Cancelar
              </Button>
            </div>
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
                <Field label="Código de autorización" className="col-span-2 @md:col-span-1">
                  <TextInput
                    autoComplete="off"
                    value={flow.code}
                    disabled={flow.submitting}
                    onChange={(e) => setFlow({ ...flow, code: e.target.value })}
                  />
                </Field>
                <Button variant="primary" type="submit" disabled={flow.submitting || !flow.code.trim()}>
                  {flow.submitting ? <Loader2 size={14} className="animate-spin" /> : null} Confirmar
                </Button>
                <Button variant="ghost" onClick={cancelFlow}>
                  Cancelar
                </Button>
              </div>
            </form>
          )}
        </div>
      )}

      <p className="mt-2 text-[11px] text-subtle">
        {target && !supportsApi && oauth.length === 0
          ? `Este proveedor sólo admite un inicio de sesión que ${APP_NAME} todavía no puede hacer: elige otro proveedor.`
          : `La clave se guarda solo para ${APP_NAME}, en su propio almacén de credenciales (no se comparte con el CLI de OpenCode).`}
      </p>
    </Card>
  )
}
