/**
 * Ajustes → "Red del sandbox": lista blanca de red del proxy de egress de los servidores
 * sandboxeados (`src/main/cowork/proxy.ts` + `proxy-policy.ts`). El host del proveedor de
 * modelos siempre está permitido (si no, ninguna tarea podría llamar al modelo);
 * todo lo demás se deniega salvo que el usuario lo añada aquí o lo apruebe desde una tarjeta
 * de bloqueo ("Permitir siempre").
 */
import { useEffect, useState } from 'react'
import { Globe, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import type { CoworkMcpInfo, ManagedPolicy, NetworkPolicyState } from '@shared/ipc-cowork'
import { cw, hasCoworkBridge } from '../../cowork/impl/bridge'
import { policyLocks } from './CoworkSection'
import { Badge, Card, Row, SectionHeader, SubTitle, TextInput, Toggle } from './ui'
import { isSubmitKey } from '../../../lib/textarea'

/** Mensaje mostrado cuando la política gestionada rechaza añadir un sitio a la red. */
export const CUSTOM_HOSTS_BLOCKED_MESSAGE = 'Tu organización no permite añadir sitios a la red del sandbox.'

/** Servidores MCP «Disponible en Tareas» que aportan hosts a la red (informativo). */
export function mcpHostContributors(list: CoworkMcpInfo[]): CoworkMcpInfo[] {
  return list.filter((m) => m.tasks && m.hosts.length > 0)
}

/** Traduce un rechazo de `networkSetHost('allow')` por política al mensaje en español. */
export function networkErrorMessage(err: unknown, policy: ManagedPolicy | null): string {
  const text = err instanceof Error ? err.message : String(err)
  if (policy?.disableCustomHosts || /organizaci|pol[ií]tica|managed/i.test(text)) return CUSTOM_HOSTS_BLOCKED_MESSAGE
  return text
}

export function NetworkSection(): React.JSX.Element {
  const [state, setState] = useState<NetworkPolicyState | null>(null)
  const [newHost, setNewHost] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [policy, setPolicy] = useState<ManagedPolicy | null>(null)
  const [mcpHosts, setMcpHosts] = useState<CoworkMcpInfo[]>([])
  const locks = policyLocks(policy)

  const reload = (): void => {
    if (!hasCoworkBridge()) return
    void cw('tasks:network:state')
      .then(setState)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }

  useEffect(reload, [])

  useEffect(() => {
    if (!hasCoworkBridge()) return
    cw('tasks:policy')
      .then(setPolicy)
      .catch(() => undefined)
    cw('tasks:mcp:list')
      .then((list) => setMcpHosts(mcpHostContributors(list)))
      .catch(() => undefined)
  }, [])

  if (!hasCoworkBridge()) {
    return (
      <div>
        <SectionHeader title="Red del sandbox" description="Solo disponible en la app de escritorio." />
      </div>
    )
  }

  const addHost = (): void => {
    if (locks.customHosts) return
    const host = newHost
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
    if (!host) return
    setNewHost('')
    setError(null)
    void cw('tasks:network:setHost', { host, decision: 'allow' })
      .then(setState)
      .catch((err: unknown) => setError(networkErrorMessage(err, policy)))
  }

  const removeHost = (host: string): void => {
    void cw('tasks:network:setHost', { host, decision: 'unset' })
      .then(setState)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }

  return (
    <div>
      <SectionHeader
        title="Red del sandbox"
        description="Qué hosts pueden alcanzar los servidores de las tareas en modo sandbox. Todo lo que no esté en esta lista se bloquea (el proxy de egress lo registra y avisa)."
      />

      {locks.managed && (locks.customHosts || (policy?.extraAllowedHosts?.length ?? 0) > 0) && (
        <div role="status" className="mb-2 flex items-start gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-xs">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
          <div className="min-w-0 text-muted">
            <div className="text-sm font-medium text-fg">Gestionado por tu organización</div>
            {locks.customHosts && <p className="mt-0.5">{CUSTOM_HOSTS_BLOCKED_MESSAGE}</p>}
            {(policy?.extraAllowedHosts?.length ?? 0) > 0 && (
              <p className="mt-0.5">
                Sitios permitidos por tu organización: <span className="font-mono">{policy?.extraAllowedHosts?.join(', ')}</span>.
              </p>
            )}
          </div>
        </div>
      )}

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
            onChange={(v) => void cw('tasks:network:setToggle', { key: 'npmEnabled', value: v }).then(setState)}
            label="Permitir registro de npm"
          />
        </Row>
        <Row label="PyPI" description="pypi.org y files.pythonhosted.org — necesario para instalar paquetes de Python.">
          <Toggle
            checked={state?.pypiEnabled ?? false}
            onChange={(v) => void cw('tasks:network:setToggle', { key: 'pypiEnabled', value: v }).then(setState)}
            label="Permitir PyPI"
          />
        </Row>
        <Row
          label="Búsqueda web del agente"
          description={`Permite la herramienta de búsqueda web (${(state?.webSearchHosts ?? ['mcp.exa.ai']).join(', ')}). Las consultas se envían a ese servicio.`}
        >
          <Toggle
            checked={state?.webSearchEnabled ?? true}
            onChange={(v) => void cw('tasks:network:setToggle', { key: 'webSearchEnabled', value: v }).then(setState)}
            label="Permitir búsqueda web del agente"
          />
        </Row>
      </Card>

      {mcpHosts.length > 0 && (
        <>
          <SubTitle>De conectores MCP</SubTitle>
          <Card>
            {mcpHosts.map((m) => (
              <Row
                key={m.name}
                label={m.name}
                description={
                  <>
                    <span className="font-mono break-all">{m.hosts.join(', ')}</span>
                    <span className="mt-0.5 block">
                      Permitido porque el conector está marcado «Disponible en Tareas». Para quitarlo, desmárcalo en MCP.
                    </span>
                  </>
                }
              >
                <Badge tone="accent">Disponible en Tareas</Badge>
              </Row>
            ))}
          </Card>
        </>
      )}

      <SubTitle>Hosts añadidos</SubTitle>
      <Card>
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <TextInput
            value={newHost}
            onChange={(e) => setNewHost(e.target.value)}
            onKeyDown={(e) => isSubmitKey(e, { allowShift: true }) && addHost()}
            placeholder="ejemplo.com"
            aria-label="Añadir host permitido siempre"
            disabled={locks.customHosts}
            className="max-w-xs"
          />
          <button
            type="button"
            onClick={addHost}
            disabled={locks.customHosts}
            title={locks.customHosts ? CUSTOM_HOSTS_BLOCKED_MESSAGE : undefined}
            className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-hover disabled:pointer-events-none disabled:opacity-50"
          >
            <Plus size={13} /> Añadir
          </button>
        </div>
        {(state?.custom.length ?? 0) === 0 ? (
          <Row
            label="Sin hosts adicionales"
            description="Se bloquea todo lo que no sea el proveedor (o npm/PyPI/búsqueda web si los activaste)."
          />
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
                <button type="button" onClick={() => removeHost(host)} className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-hover">
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
