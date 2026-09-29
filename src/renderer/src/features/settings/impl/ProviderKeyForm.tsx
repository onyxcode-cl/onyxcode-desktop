import { useState } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'
import type { Provider, ProviderAuthMethod } from '@opencode-ai/sdk/v2/client'
import { Button } from '../../../components/Button'
import { errorMessage, type OpencodeClient } from '../../../lib/opencode'
import { Card, Field, Select, TextInput } from './ui'

/**
 * Guarda una API key en OpenCode (`auth.set`) y recarga los proveedores del servidor
 * (las respuestas en curso se interrumpen). Lanza si el servidor rechaza la clave.
 */
export async function saveProviderKey(client: OpencodeClient, providerID: string, key: string): Promise<void> {
  const r = await client.auth.set({ providerID, auth: { type: 'api', key } })
  if (r.error) throw new Error(errorMessage(r.error))
  await client.global.dispose()
}

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
  className?: string
}

/** Formulario «Conectar proveedor con API key»: lo usan Ajustes › Modelos y el asistente de primer uso. */
export function ProviderKeyForm({ providers, auth, busy, onSetKey, fixedProviderId, className = 'mt-3 p-4' }: Props): React.JSX.Element {
  const [picked, setPicked] = useState('')
  const [key, setKey] = useState('')
  const target = fixedProviderId ?? picked
  const methods = target ? (auth[target] ?? []) : []
  const supportsApi = !target || methods.length === 0 || methods.some((m) => m.type === 'api')
  const targetProvider = providers.find((p) => p.id === target)

  return (
    <Card className={className}>
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <KeyRound size={15} /> {fixedProviderId ? `Clave de ${targetProvider?.name ?? fixedProviderId}` : 'Conectar proveedor con API key'}
      </div>
      <div className={`grid items-end gap-2 ${fixedProviderId ? 'grid-cols-[1fr_auto]' : 'grid-cols-[1fr_1.4fr_auto]'}`}>
        {!fixedProviderId && (
          <Field label="Proveedor">
            <Select value={picked} onChange={(e) => setPicked(e.target.value)}>
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
        <Button
          variant="primary"
          disabled={busy || !target || !key.trim() || !supportsApi}
          onClick={() => {
            void onSetKey(target, key.trim()).then(
              () => {
                setKey('')
                setPicked('')
              },
              () => undefined
            )
          }}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : null} Guardar
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-subtle">
        {target && !supportsApi
          ? 'Este proveedor sólo admite inicio de sesión OAuth: ejecuta `opencode auth login` en una terminal.'
          : 'La clave se guarda en el almacén de credenciales de OpenCode (~/.local/share/opencode/auth.json). Para OAuth usa `opencode auth login`.'}
      </p>
    </Card>
  )
}
