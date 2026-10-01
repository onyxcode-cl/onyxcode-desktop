/**
 * Ajustes → "Red del sandbox": lista blanca de red del proxy de egress de los servidores
 * sandboxeados (`src/main/tasks/proxy.ts` + `proxy-policy.ts`). El host del proveedor de
 * modelos siempre está permitido (si no, ninguna tarea podría llamar al modelo);
 * todo lo demás se deniega salvo que el usuario lo añada aquí o lo apruebe desde una tarjeta
 * de bloqueo ("Permitir siempre").
 */
import { useEffect, useState } from 'react'
import { Globe, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import type { TasksMcpInfo, ManagedPolicy, NetworkPolicyState } from '@shared/ipc-tasks'
import { t as tr } from '@shared/i18n'
import { UI_LABELS } from '@shared/labels'
import { cw, hasTasksBridge } from '../../tasks/impl/bridge'
import { policyLocks } from './TasksSection'
import { Badge, Card, Row, SectionHeader, SubTitle, TextInput, Toggle } from './ui'
import { useT } from '../../../lib/i18n'
import { isSubmitKey } from '../../../lib/textarea'

/** Mensaje mostrado cuando la política gestionada rechaza añadir un sitio a la red. */
export function customHostsBlockedMessage(): string {
  return tr('misc.net.blocked')
}

/** Servidores MCP «Disponible en Tareas» que aportan hosts a la red (informativo). */
export function mcpHostContributors(list: TasksMcpInfo[]): TasksMcpInfo[] {
  return list.filter((m) => m.tasks && m.hosts.length > 0)
}

/** Traduce un rechazo de `networkSetHost('allow')` por política al mensaje en español. */
export function networkErrorMessage(err: unknown, policy: ManagedPolicy | null): string {
  const text = err instanceof Error ? err.message : String(err)
  if (policy?.disableCustomHosts || /organizaci|pol[ií]tica|managed/i.test(text)) return customHostsBlockedMessage()
  return text
}

export function NetworkSection(): React.JSX.Element {
  const t = useT()
  const [state, setState] = useState<NetworkPolicyState | null>(null)
  const [newHost, setNewHost] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [policy, setPolicy] = useState<ManagedPolicy | null>(null)
  const [mcpHosts, setMcpHosts] = useState<TasksMcpInfo[]>([])
  const locks = policyLocks(policy)

  const reload = (): void => {
    if (!hasTasksBridge()) return
    void cw('tasks:network:state')
      .then(setState)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }

  useEffect(reload, [])

  useEffect(() => {
    if (!hasTasksBridge()) return
    cw('tasks:policy')
      .then(setPolicy)
      .catch(() => undefined)
    cw('tasks:mcp:list')
      .then((list) => setMcpHosts(mcpHostContributors(list)))
      .catch(() => undefined)
  }, [])

  if (!hasTasksBridge()) {
    return (
      <div>
        <SectionHeader title={UI_LABELS.network} description={t('misc.desktopOnly')} />
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
      <SectionHeader title={UI_LABELS.network} description={t('misc.net.desc')} />

      {locks.managed && (locks.customHosts || (policy?.extraAllowedHosts?.length ?? 0) > 0) && (
        <div role="status" className="mb-2 flex items-start gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-xs">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
          <div className="min-w-0 text-muted">
            <div className="text-sm font-medium text-fg">{t('misc.managedTitle')}</div>
            {locks.customHosts && <p className="mt-0.5">{customHostsBlockedMessage()}</p>}
            {(policy?.extraAllowedHosts?.length ?? 0) > 0 && (
              <p className="mt-0.5">
                {t('misc.net.orgSites')}
                <span className="font-mono">{policy?.extraAllowedHosts?.join(', ')}</span>.
              </p>
            )}
          </div>
        </div>
      )}

      <SubTitle>{t('misc.net.always')}</SubTitle>
      <Card>
        <Row
          label={
            <span className="flex items-center gap-2">
              <Globe size={14} className="text-accent" /> {state?.providerHost ?? 'opencode.ai'}
            </span>
          }
          description={t('misc.net.providerDesc')}
        >
          <Badge tone="ok">{t('misc.net.allowed')}</Badge>
        </Row>
        <Row label={t('misc.net.npm')} description={t('misc.net.npmDesc')}>
          <Toggle
            checked={state?.npmEnabled ?? false}
            onChange={(v) => void cw('tasks:network:setToggle', { key: 'npmEnabled', value: v }).then(setState)}
            label={t('misc.net.npmToggle')}
          />
        </Row>
        <Row label="PyPI" description={t('misc.net.pypiDesc')}>
          <Toggle
            checked={state?.pypiEnabled ?? false}
            onChange={(v) => void cw('tasks:network:setToggle', { key: 'pypiEnabled', value: v }).then(setState)}
            label={t('misc.net.pypiToggle')}
          />
        </Row>
        <Row
          label={t('misc.net.search')}
          description={t('misc.net.searchDesc', { hosts: (state?.webSearchHosts ?? ['mcp.exa.ai']).join(', ') })}
        >
          <Toggle
            checked={state?.webSearchEnabled ?? true}
            onChange={(v) => void cw('tasks:network:setToggle', { key: 'webSearchEnabled', value: v }).then(setState)}
            label={t('misc.net.searchToggle')}
          />
        </Row>
      </Card>

      {mcpHosts.length > 0 && (
        <>
          <SubTitle>{t('misc.net.mcp')}</SubTitle>
          <Card>
            {mcpHosts.map((m) => (
              <Row
                key={m.name}
                label={m.name}
                description={
                  <>
                    <span className="font-mono break-all">{m.hosts.join(', ')}</span>
                    <span className="mt-0.5 block">{t('misc.net.mcpDesc')}</span>
                  </>
                }
              >
                <Badge tone="accent">{t('misc.net.mcpBadge')}</Badge>
              </Row>
            ))}
          </Card>
        </>
      )}

      <SubTitle>{t('misc.net.added')}</SubTitle>
      <Card>
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <TextInput
            value={newHost}
            onChange={(e) => setNewHost(e.target.value)}
            onKeyDown={(e) => isSubmitKey(e, { allowShift: true }) && addHost()}
            placeholder={t('misc.net.placeholder')}
            aria-label={t('misc.net.addAria')}
            disabled={locks.customHosts}
            className="max-w-xs"
          />
          <button
            type="button"
            onClick={addHost}
            disabled={locks.customHosts}
            title={locks.customHosts ? customHostsBlockedMessage() : undefined}
            className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-hover disabled:pointer-events-none disabled:opacity-50"
          >
            <Plus size={13} /> {t('misc.add')}
          </button>
        </div>
        {(state?.custom.length ?? 0) === 0 ? (
          <Row label={t('misc.net.none')} description={t('misc.net.noneDesc')} />
        ) : (
          state?.custom.map((host) => (
            <Row key={host} label={host}>
              <button
                type="button"
                onClick={() => removeHost(host)}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-danger hover:bg-danger/10"
                aria-label={t('misc.net.removeAria', { host })}
              >
                <Trash2 size={13} /> {t('misc.remove')}
              </button>
            </Row>
          ))
        )}
      </Card>

      {(state?.blocked.length ?? 0) > 0 && (
        <>
          <SubTitle>{t('misc.net.blockedTitle')}</SubTitle>
          <Card>
            {state?.blocked.map((host) => (
              <Row key={host} label={host} description={t('misc.net.blockedDesc')}>
                <button type="button" onClick={() => removeHost(host)} className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-hover">
                  {t('misc.remove')}
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
