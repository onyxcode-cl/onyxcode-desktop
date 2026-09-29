import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  FolderOpen,
  Globe,
  Info,
  KeyRound,
  Loader2,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Terminal,
  Trash2,
  Unplug
} from 'lucide-react'
import type { McpStatus } from '@opencode-ai/sdk/v2/client'
import type { CoworkMcpInfo } from '@shared/ipc-cowork'
import type { AppMcpConfig, McpEntry } from '@shared/ipc-extras'
import { Button } from '../../../components/Button'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { IconButton } from '../../../components/IconButton'
import { errorMessage } from '../../../lib/opencode'
import { useServer } from '../../../stores/server'
import { cw, hasCoworkBridge } from '../../cowork/impl/bridge'
import { getExtras, requireExtras } from './extras'
import { Badge, Card, ErrorText, Field, SectionHeader, TextArea, TextInput, Toggle } from './ui'

type ExternalEntry = McpEntry | { enabled: boolean }

interface Row {
  name: string
  /** Definición efectiva (merge de todas las configs) si el servidor la reporta. */
  entry: ExternalEntry | null
  /** true = definido en el archivo de la app (editable). */
  owned: boolean
  status: McpStatus | null
}

const STATUS: Record<McpStatus['status'], { label: string; tone: 'ok' | 'muted' | 'error' | 'warn' }> = {
  connected: { label: 'Conectado', tone: 'ok' },
  disabled: { label: 'Desactivado', tone: 'muted' },
  failed: { label: 'Error', tone: 'error' },
  needs_auth: { label: 'Requiere autenticación', tone: 'warn' },
  needs_client_registration: { label: 'Requiere registro OAuth', tone: 'warn' }
}

export function McpSection(): React.JSX.Element {
  const client = useServer((s) => s.client)
  const directory = useServer((s) => s.connection?.chatDirectory)
  const [appCfg, setAppCfg] = useState<AppMcpConfig | null>(null)
  const [merged, setMerged] = useState<Record<string, ExternalEntry>>({})
  const [status, setStatus] = useState<Record<string, McpStatus>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ name: string; entry: McpEntry } | 'new' | null>(null)
  // Marcas de Cowork por servidor (`cowork-mcp.json`), solo para los servidores de la app.
  const [coworkInfo, setCoworkInfo] = useState<Record<string, CoworkMcpInfo>>({})

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const extras = getExtras()
      const own = extras ? await extras.invoke('mcp:getConfig') : null
      setAppCfg(own)
      if (hasCoworkBridge()) {
        const list = await cw('cowork:mcp:list').catch(() => [] as CoworkMcpInfo[])
        setCoworkInfo(Object.fromEntries(list.map((i) => [i.name, i])))
      }
      if (client) {
        const [st, cfg] = await Promise.all([client.mcp.status({ directory }), client.config.get({ directory })])
        if (st.error) throw new Error(errorMessage(st.error))
        setStatus(st.data ?? {})
        setMerged((cfg.data?.mcp as Record<string, ExternalEntry> | undefined) ?? {})
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [client, directory])

  useEffect(() => {
    void refresh()
    const extras = getExtras()
    if (!extras) return
    return extras.on('mcp:changed', (cfg) => {
      setAppCfg(cfg)
      // El servidor recarga su config tras el cambio; volver a pedir estado.
      setTimeout(() => void refresh(), 400)
    })
  }, [refresh])

  const rows = useMemo<Row[]>(() => {
    const names = new Set([...Object.keys(appCfg?.servers ?? {}), ...Object.keys(merged), ...Object.keys(status)])
    return [...names]
      .sort((a, b) => a.localeCompare(b, 'es'))
      .map((name) => ({
        name,
        entry: appCfg?.servers[name] ?? merged[name] ?? null,
        owned: !!appCfg && name in appCfg.servers,
        status: status[name] ?? null
      }))
  }, [appCfg, merged, status])

  const run = async (key: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(key)
    setError(null)
    try {
      await fn()
      await refresh()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const toggle = (row: Row, enabled: boolean): Promise<void> =>
    run(`toggle:${row.name}`, async () => {
      if (row.owned) {
        await requireExtras().invoke('mcp:setEnabled', { name: row.name, enabled })
      } else if (client) {
        // Servidor definido fuera de la app: sólo conectar/desconectar en esta sesión del servidor.
        const r = enabled
          ? await client.mcp.connect({ name: row.name, directory })
          : await client.mcp.disconnect({ name: row.name, directory })
        if (r.error) throw new Error(errorMessage(r.error))
      }
    })

  const setCowork = (name: string, patch: { cowork?: boolean; askEachTool?: boolean }): Promise<void> =>
    run(`cowork:${name}`, async () => {
      await cw('cowork:mcp:set', { name, ...patch })
    })

  const authenticate = (row: Row): Promise<void> =>
    run(`auth:${row.name}`, async () => {
      if (!client) return
      const r = await client.mcp.auth.authenticate({ name: row.name, directory })
      if (r.error) throw new Error(errorMessage(r.error))
    })

  const remove = async (row: Row): Promise<void> => {
    const ok = await confirmDialog({
      title: '¿Eliminar servidor MCP?',
      message: `Se eliminará el servidor MCP "${row.name}".`,
      confirmLabel: 'Eliminar',
      danger: true
    })
    if (!ok) return
    return run(`remove:${row.name}`, () => requireExtras().invoke('mcp:remove', { name: row.name }))
  }

  return (
    <div>
      <SectionHeader
        title="Servidores MCP"
        description={
          <>
            Herramientas externas vía Model Context Protocol. Los servidores que agregues aquí se guardan en un archivo propio de la app (no
            se modifica tu <code className="font-mono">~/.config/opencode</code>). Al guardar, OpenCode recarga su configuración y las
            respuestas en curso se interrumpen.
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => setEditing('new')} disabled={!getExtras()}>
          <Plus size={14} /> Agregar servidor
        </Button>
        <Button variant="ghost" onClick={() => void refresh()} disabled={loading}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Actualizar
        </Button>
        {appCfg && (
          <Button variant="ghost" onClick={() => void requireExtras().invoke('mcp:revealConfig')}>
            <FolderOpen size={14} /> Ver archivo
          </Button>
        )}
      </div>

      {error && (
        <div className="mb-3">
          <ErrorText>{error}</ErrorText>
        </div>
      )}

      {editing && (
        <McpForm
          initial={editing === 'new' ? null : editing}
          existingNames={Object.keys(appCfg?.servers ?? {})}
          onCancel={() => setEditing(null)}
          onSave={async (name, entry, previousName) => {
            await requireExtras().invoke('mcp:save', { name, entry, previousName })
            setEditing(null)
            await refresh()
          }}
        />
      )}

      <Card>
        {rows.length === 0 && !loading && (
          <div className="px-4 py-6 text-center text-sm text-muted">No hay servidores MCP configurados.</div>
        )}
        {rows.map((row) => {
          const st = row.status ? STATUS[row.status.status] : null
          const enabled = row.status ? row.status.status !== 'disabled' : row.entry ? isEnabled(row.entry) : false
          const err =
            row.status && (row.status.status === 'failed' || row.status.status === 'needs_client_registration') ? row.status.error : null
          return (
            <div key={row.name} className="border-b border-border px-4 py-3 last:border-b-0">
              <div className="flex items-center gap-3">
                <span className="text-muted">
                  {row.entry && 'type' in row.entry && row.entry.type === 'remote' ? <Globe size={16} /> : <Terminal size={16} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span className="font-mono">{row.name}</span>
                    {st && <Badge tone={st.tone}>{st.label}</Badge>}
                    <Badge tone={row.owned ? 'accent' : 'muted'}>{row.owned ? 'App' : 'Config externa'}</Badge>
                  </div>
                  <div className="mt-0.5 truncate font-mono text-xs text-muted" title={describe(row.entry)}>
                    {describe(row.entry)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {row.status?.status === 'needs_auth' && (
                    <Button variant="ghost" disabled={busy !== null} onClick={() => void authenticate(row)}>
                      <KeyRound size={14} /> Autenticar
                    </Button>
                  )}
                  {!row.owned && row.status?.status === 'failed' && (
                    <IconButton label="Reintentar conexión" disabled={busy !== null} onClick={() => void toggle(row, true)}>
                      <Plug size={15} />
                    </IconButton>
                  )}
                  {row.owned && row.entry && 'type' in row.entry && (
                    <IconButton
                      label="Editar"
                      disabled={busy !== null}
                      onClick={() => setEditing({ name: row.name, entry: row.entry as McpEntry })}
                    >
                      <Pencil size={15} />
                    </IconButton>
                  )}
                  {row.owned && (
                    <IconButton label="Eliminar" disabled={busy !== null} onClick={() => void remove(row)}>
                      <Trash2 size={15} />
                    </IconButton>
                  )}
                  {busy?.endsWith(`:${row.name}`) ? (
                    <Loader2 size={16} className="mx-2 animate-spin text-muted" />
                  ) : (
                    <Toggle
                      checked={enabled}
                      disabled={busy !== null || (!row.owned && !client)}
                      label={row.owned ? 'Activar/desactivar' : 'Conectar/desconectar (temporal)'}
                      onChange={(v) => void toggle(row, v)}
                    />
                  )}
                </div>
              </div>
              {err && <div className="mt-2 text-xs whitespace-pre-wrap text-danger">{err}</div>}
              {row.owned && coworkInfo[row.name] && (
                <CoworkFlags info={coworkInfo[row.name]} disabled={busy !== null} onChange={(patch) => void setCowork(row.name, patch)} />
              )}
            </div>
          )
        })}
      </Card>
      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-subtle">
        <Unplug size={12} /> En servidores de config externa el interruptor conecta/desconecta sólo hasta el próximo reinicio. El estado
        mostrado corresponde al espacio de Chat; los proyectos de Code pueden tener MCP propios.
      </p>
      <p className="mt-1 flex items-start gap-1.5 text-[11px] text-subtle">
        <Info size={12} className="mt-0.5 shrink-0" /> «Disponible en Cowork» se aplica al abrir de nuevo la carpeta. En el sandbox los
        servidores remotos con inicio de sesión (OAuth) no están disponibles, y los sitios de los servidores remotos se añaden a la Red de
        Cowork.
      </p>
      {appCfg && <p className="mt-1 truncate font-mono text-[11px] text-subtle">{appCfg.path}</p>}
    </div>
  )
}

/** Interruptores de Cowork de un servidor de la app: disponibilidad y "Preguntar en cada uso". */
function CoworkFlags({
  info,
  disabled,
  onChange
}: {
  info: CoworkMcpInfo
  disabled: boolean
  onChange: (patch: { cowork?: boolean; askEachTool?: boolean }) => void
}): React.JSX.Element {
  return (
    <div className="mt-3 rounded-lg border border-border bg-bg px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <label className="flex items-center gap-2 text-xs">
          <Toggle
            checked={info.cowork}
            disabled={disabled || !info.enabled}
            label="Disponible en Cowork"
            onChange={(v) => onChange({ cowork: v })}
          />
          <span className="font-medium">Disponible en Cowork</span>
        </label>
        <label className="flex items-center gap-2 text-xs">
          <Toggle
            checked={info.askEachTool}
            disabled={disabled || !info.cowork}
            label="Preguntar en cada uso"
            onChange={(v) => onChange({ askEachTool: v })}
          />
          <span className={info.cowork ? 'font-medium' : 'text-muted'}>Preguntar en cada uso</span>
        </label>
      </div>
      {info.cowork && info.type === 'remote' && info.oauth && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-warning">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" /> Este servidor remoto parece usar inicio de sesión (OAuth): no estará
          disponible en el sandbox (en Control total puede funcionar).
        </p>
      )}
      {info.cowork && info.hosts.length > 0 && (
        <p className="mt-1.5 text-[11px] text-subtle">
          Sitio añadido a la Red de Cowork: <span className="font-mono">{info.hosts.join(', ')}</span>
        </p>
      )}
    </div>
  )
}

function isEnabled(e: ExternalEntry): boolean {
  return e.enabled !== false
}

function describe(e: ExternalEntry | null): string {
  if (!e || !('type' in e)) return '—'
  if (e.type === 'remote') return e.url
  return e.command.map((c) => (/\s/.test(c) ? JSON.stringify(c) : c)).join(' ')
}

// ---------------------------------------------------------------------------------------

/** Divide una línea de comando respetando comillas simples/dobles y escapes. */
export function splitCommand(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  let has = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      if (c === quote) quote = null
      else if (c === '\\' && quote === '"' && i + 1 < line.length) cur += line[++i]
      else cur += c
    } else if (c === '"' || c === "'") {
      quote = c
      has = true
    } else if (c === '\\' && i + 1 < line.length) {
      cur += line[++i]
      has = true
    } else if (/\s/.test(c)) {
      if (has || cur) out.push(cur)
      cur = ''
      has = false
    } else {
      cur += c
    }
  }
  if (has || cur) out.push(cur)
  return out
}

function joinCommand(parts: string[]): string {
  return parts.map((p) => (p === '' || /[\s"'\\]/.test(p) ? JSON.stringify(p) : p)).join(' ')
}

/** Parsea líneas "CLAVE=valor" (env) o "Clave: valor" (headers). */
function parsePairs(text: string, sep: '=' | ':'): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf(sep)
    if (i <= 0) throw new Error(`Línea inválida: "${line}" (formato ${sep === '=' ? 'CLAVE=valor' : 'Nombre: valor'})`)
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

function formatPairs(rec: Record<string, string> | undefined, sep: '=' | ': '): string {
  return rec
    ? Object.entries(rec)
        .map(([k, v]) => `${k}${sep}${v}`)
        .join('\n')
    : ''
}

function McpForm({
  initial,
  existingNames,
  onCancel,
  onSave
}: {
  initial: { name: string; entry: McpEntry } | null
  existingNames: string[]
  onCancel: () => void
  onSave: (name: string, entry: McpEntry, previousName?: string) => Promise<void>
}): React.JSX.Element {
  const init = initial?.entry
  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState<'local' | 'remote'>(init?.type ?? 'local')
  const [command, setCommand] = useState(init?.type === 'local' ? joinCommand(init.command) : '')
  const [env, setEnv] = useState(init?.type === 'local' ? formatPairs(init.environment, '=') : '')
  const [cwd, setCwd] = useState(init?.type === 'local' ? (init.cwd ?? '') : '')
  const [url, setUrl] = useState(init?.type === 'remote' ? init.url : '')
  const [headers, setHeaders] = useState(init?.type === 'remote' ? formatPairs(init.headers, ': ') : '')
  const [noOauth, setNoOauth] = useState(init?.type === 'remote' && init.oauth === false)
  const [timeout, setTimeoutMs] = useState(init?.timeout ? String(init.timeout) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    setError(null)
    try {
      const n = name.trim()
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(n)) throw new Error('Nombre inválido: usa letras, números, "-" o "_".')
      if (n !== initial?.name && existingNames.includes(n)) throw new Error(`Ya existe "${n}".`)
      const t = timeout.trim() ? Number(timeout) : undefined
      if (t !== undefined && (!Number.isFinite(t) || t <= 0)) throw new Error('Timeout inválido (milisegundos).')
      let entry: McpEntry
      if (type === 'local') {
        const parts = splitCommand(command.trim())
        if (!parts.length) throw new Error('Indica el comando (p.ej. npx -y @modelcontextprotocol/server-filesystem ~/Documentos).')
        const environment = parsePairs(env, '=')
        entry = {
          type: 'local',
          command: parts,
          ...(Object.keys(environment).length ? { environment } : {}),
          ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
          enabled: init?.enabled ?? true,
          ...(t ? { timeout: t } : {})
        }
      } else {
        const h = parsePairs(headers, ':')
        entry = {
          type: 'remote',
          url: url.trim(),
          ...(Object.keys(h).length ? { headers: h } : {}),
          ...(noOauth ? { oauth: false as const } : {}),
          enabled: init?.enabled ?? true,
          ...(t ? { timeout: t } : {})
        }
      }
      setSaving(true)
      await onSave(n, entry, initial?.name)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="mb-4 p-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm font-semibold">{initial ? `Editar "${initial.name}"` : 'Nuevo servidor MCP'}</div>
        <div className="flex rounded-lg border border-border p-0.5 text-xs">
          {(['local', 'remote'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`rounded-md px-3 py-1 ${type === t ? 'bg-active font-medium text-fg' : 'text-muted hover:text-fg'}`}
            >
              {t === 'local' ? 'Local (comando)' : 'Remoto (URL)'}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-3">
        <Field label="Nombre" hint="Las herramientas aparecerán como nombre_herramienta.">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="github" autoFocus />
        </Field>
        {type === 'local' ? (
          <>
            <Field label="Comando y argumentos" hint="Se admiten comillas para argumentos con espacios.">
              <TextInput
                className="font-mono"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="npx -y @modelcontextprotocol/server-everything"
              />
            </Field>
            <Field label="Variables de entorno (una por línea)">
              <TextArea rows={3} value={env} onChange={(e) => setEnv(e.target.value)} placeholder="API_KEY=..." />
            </Field>
            <Field label="Directorio de trabajo (opcional)">
              <TextInput className="font-mono" value={cwd} onChange={(e) => setCwd(e.target.value)} />
            </Field>
          </>
        ) : (
          <>
            <Field label="URL">
              <TextInput
                className="font-mono"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://mcp.ejemplo.com/mcp"
              />
            </Field>
            <Field label="Cabeceras (una por línea)">
              <TextArea rows={3} value={headers} onChange={(e) => setHeaders(e.target.value)} placeholder="Authorization: Bearer ..." />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={noOauth} onChange={(e) => setNoOauth(e.target.checked)} />
              Desactivar autodetección OAuth
            </label>
          </>
        )}
        <Field label="Timeout en ms (opcional, por defecto 5000)">
          <TextInput className="w-40" inputMode="numeric" value={timeout} onChange={(e) => setTimeoutMs(e.target.value)} />
        </Field>
        {error && <ErrorText>{error}</ErrorText>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={saving}>
            {saving && <Loader2 size={14} className="animate-spin" />} Guardar
          </Button>
        </div>
      </div>
    </Card>
  )
}
