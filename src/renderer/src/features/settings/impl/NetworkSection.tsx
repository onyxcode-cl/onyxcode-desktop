/**
 * Ajustes → "Red de Cowork": lista blanca de red del proxy de egress de los servidores
 * sandboxeados (`src/main/cowork/proxy.ts` + `proxy-policy.ts`). El host del proveedor de
 * modelos siempre está permitido (si no, ninguna tarea de Cowork podría llamar al modelo);
 * todo lo demás se deniega salvo que el usuario lo añada aquí o lo apruebe desde una tarjeta
 * de bloqueo ("Permitir siempre").
 */
import { useEffect, useState } from 'react'
import { Globe, Plus, Trash2 } from 'lucide-react'
import type { NetworkPolicyState } from '@shared/ipc-cowork'
import { cw, hasCoworkBridge } from '../../cowork/impl/bridge'
import { Badge, Card, Row, SectionHeader, SubTitle, TextInput, Toggle } from './ui'

export function NetworkSection(): React.JSX.Element {
  const [state, setState] = useState<NetworkPolicyState | null>(null)
  const [newHost, setNewHost] = useState('')
  const [error, setError] = useState<string | null>(null)

  const reload = (): void => {
    if (!hasCoworkBridge()) return
    void cw('cowork:network:state')
      .then(setState)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }

  useEffect(reload, [])

  if (!hasCoworkBridge()) {
    return (
      <div>
        <SectionHeader title="Red de Cowork" description="Solo disponible en la app de escritorio." />
      </div>
    )
  }

  const addHost = (): void => {
    const host = newHost.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (!host) return
    setNewHost('')
    void cw('cowork:network:setHost', { host, decision: 'allow' })
      .then(setState)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }

  const removeHost = (host: string): void => {
    void cw('cowork:network:setHost', { host, decision: 'unset' })
      .then(setState)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }

  return (
    <div>
      <SectionHeader
        title="Red de Cowork"
        description="Qué hosts pueden alcanzar los servidores de Cowork en modo sandbox. Todo lo que no esté en esta lista se bloquea (el proxy de egress lo registra y avisa)."
      />

      <SubTitle>Siempre permitido</SubTitle>
      <Card>
        <Row
          label={
            <span className="flex items-center gap-2">
              <Globe size={14} className="text-accent" /> {state?.providerHost ?? 'opencode.ai'}
            </span>
          }
          description="Host del proveedor de modelos. Necesario para que el agente funcione; no se puede quitar."
        >
          <Badge tone="ok">Permitido</Badge>
        </Row>
        <Row label="Registro de npm" description="registry.npmjs.org — necesario para instalar paquetes de Node dentro de una tarea.">
          <Toggle
            checked={state?.npmEnabled ?? false}
            onChange={(v) => void cw('cowork:network:setToggle', { key: 'npmEnabled', value: v }).then(setState)}
            label="Permitir registro de npm"
          />
        </Row>
        <Row label="PyPI" description="pypi.org y files.pythonhosted.org — necesario para instalar paquetes de Python.">
          <Toggle
            checked={state?.pypiEnabled ?? false}
            onChange={(v) => void cw('cowork:network:setToggle', { key: 'pypiEnabled', value: v }).then(setState)}
            label="Permitir PyPI"
          />
        </Row>
      </Card>

      <SubTitle>Hosts añadidos</SubTitle>
      <Card>
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <TextInput
            value={newHost}
            onChange={(e) => setNewHost(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addHost()}
            placeholder="ejemplo.com"
            className="max-w-xs"
          />
          <button
            type="button"
            onClick={addHost}
            className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-hover"
          >
            <Plus size={13} /> Añadir
          </button>
        </div>
        {(state?.custom.length ?? 0) === 0 ? (
          <Row label="Sin hosts adicionales" description="Se bloquea todo lo que no sea el proveedor (o npm/PyPI si los activaste)." />
        ) : (
          state?.custom.map((host) => (
            <Row key={host} label={host}>
              <button
                type="button"
                onClick={() => removeHost(host)}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-danger hover:bg-danger/10"
                aria-label={`Quitar ${host}`}
              >
                <Trash2 size={13} /> Quitar
              </button>
            </Row>
          ))
        )}
      </Card>

      {(state?.blocked.length ?? 0) > 0 && (
        <>
          <SubTitle>Bloqueados explícitamente</SubTitle>
          <Card>
            {state?.blocked.map((host) => (
              <Row key={host} label={host} description="Marcado 'Mantener bloqueado' desde una tarjeta de aviso.">
                <button
                  type="button"
                  onClick={() => removeHost(host)}
                  className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-hover"
                >
                  Quitar
                </button>
              </Row>
            ))}
          </Card>
        </>
      )}

      {error && <p className="mt-3 text-xs text-danger">{error}</p>}
    </div>
  )
}
