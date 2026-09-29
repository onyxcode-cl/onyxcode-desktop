/**
 * Aprobaciones de Cowork: tarjeta detallada (en la conversación) y barra fija sobre el
 * compositor con "Permitir una vez / Siempre / Rechazar" y qué ocurrirá exactamente.
 * Las peticiones de otra carpeta (`external_directory`) tienen su propia tarjeta (`FolderRequestCard`).
 * Siempre se muestra el comando, la ruta o los parámetros LITERALES; la descripción del modelo va aparte
 * y marcada como no verificada.
 */
import { useEffect, useState } from 'react'
import type { PermissionRequest } from '@opencode-ai/sdk/v2/client'
import { FileEdit, FolderInput, Globe, PlugZap, Repeat, ShieldAlert, Terminal, Trash2, type LucideIcon } from 'lucide-react'
import { Button } from '../../../components/Button'
import { errorMessage } from '../../../lib/opencode'
import { replyPermission, replyPermissionAlways } from './actions'
import { cw } from './bridge'
import { computerToolInfo, computerToolKind } from './computer-tools'
import { metadataJson, parseMcpPermission, showAlways } from './conversation-logic'
import { FolderRequestCard } from './FolderRequestCard'
import { useCowork } from './store'
import { baseName, rememberablePatterns } from './util'

type Reply = 'once' | 'always' | 'reject'

interface Described {
  icon: LucideIcon
  title: string
  /** Qué hará exactamente (frase, redactada por nosotros, no por el modelo). */
  effect: string
  /** Detalle literal (comando, ruta, URL…) tal como lo ejecutará el agente. Se muestra primero. */
  detail: string
  /** Descripción libre generada por el modelo (p. ej. el "description" de un comando bash). No verificada. */
  aiDescription?: string
  /** Bloques literales adicionales (etiqueta + texto), p. ej. los patrones de una herramienta MCP. */
  sections?: Array<{ label: string; text: string }>
  /** `folder`: otra carpeta (tarjeta propia, sin botones rápidos). */
  kind?: 'folder'
  danger: boolean
}

/** Caracteres de control, marcas bidi y espacios invisibles que pueden ocultar el contenido real de un comando. */
// eslint-disable-next-line no-control-regex
const HIDDEN_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁤﻿]/

/** true si `text` contiene caracteres de control/unicode invisibles que podrían ocultar contenido. */
export function hasHiddenChars(text: string): boolean {
  return HIDDEN_CHARS_RE.test(text)
}

function meta(p: PermissionRequest, ...keys: string[]): string {
  for (const key of keys) {
    const v = p.metadata[key]
    if (typeof v === 'string' && v) return v
  }
  return ''
}

const DELETE_RE = /(^|[;&|]\s*)(rm|rmdir|unlink|trash|srm)\b|\s-delete\b/

/** Traduce la solicitud de permiso a lenguaje claro. */
export function describePermission(p: PermissionRequest, mcpServers: string[] = []): Described {
  const patterns = p.patterns.join(', ')
  switch (p.permission) {
    case 'bash': {
      const cmd = meta(p, 'command') || patterns
      const desc = meta(p, 'description')
      if (DELETE_RE.test(cmd)) {
        return {
          icon: Trash2,
          title: 'El agente quiere borrar archivos',
          effect: 'Se eliminarán de forma permanente los archivos o carpetas indicados en el comando.',
          detail: cmd,
          aiDescription: desc || undefined,
          danger: true
        }
      }
      return {
        icon: Terminal,
        title: 'El agente quiere ejecutar un comando',
        effect: 'Se ejecutará este comando en la terminal de la carpeta.',
        detail: cmd,
        aiDescription: desc || undefined,
        danger: false
      }
    }
    case 'edit': {
      const file = meta(p, 'filepath', 'filePath', 'path') || patterns
      return {
        icon: FileEdit,
        title: `El agente quiere modificar ${file ? `«${baseName(file)}»` : 'archivos'}`,
        effect: 'Se cambiará el contenido del archivo.',
        detail: meta(p, 'diff') || file,
        danger: false
      }
    }
    case 'external_directory': {
      const dir = meta(p, 'parentDir', 'filepath', 'filePath', 'path') || patterns
      return {
        icon: FolderInput,
        title: 'El agente quiere trabajar en otra carpeta',
        effect: 'Esta ubicación no es la carpeta de la tarea: revisa la carpeta y elige el modo antes de permitirla.',
        detail: dir,
        kind: 'folder',
        danger: true
      }
    }
    case 'webfetch':
    case 'websearch':
      return {
        icon: Globe,
        title: 'El agente quiere consultar la web',
        effect: 'Se descargará el contenido de esta dirección.',
        detail: meta(p, 'url', 'query') || patterns,
        danger: false
      }
    case 'doom_loop':
      return {
        icon: Repeat,
        title: 'El agente está repitiendo la misma acción',
        effect: 'Parece atascado. Si lo permites, volverá a intentar lo mismo; si lo rechazas, se detendrá y te explicará.',
        detail: patterns,
        danger: false
      }
    default: {
      const kind = computerToolKind(p.permission)
      if (kind) {
        return {
          icon: computerToolInfo(kind).icon,
          title: `El agente quiere controlar el Mac: ${computerToolInfo(kind).label.toLowerCase()}`,
          effect: 'Usará el ratón, el teclado o la pantalla de tu Mac.',
          detail: patterns,
          danger: true
        }
      }
      const mcp = parseMcpPermission(p.permission, mcpServers)
      if (mcp) {
        const json = metadataJson(p.metadata)
        return {
          icon: PlugZap,
          title: `El agente quiere usar ${mcp.tool} de ${mcp.server}`,
          effect: 'Es una herramienta de un conector (MCP) externo: se ejecutará con los parámetros indicados.',
          detail: json || patterns,
          sections: json && patterns ? [{ label: 'Patrones', text: p.patterns.join('\n') }] : undefined,
          danger: false
        }
      }
      return {
        icon: ShieldAlert,
        title: `El agente pide permiso: ${p.permission}`,
        effect: 'Realizará esta acción con los parámetros indicados.',
        detail: patterns || JSON.stringify(p.metadata),
        danger: false
      }
    }
  }
}

/** Nombres de los conectores MCP del usuario (una sola consulta): sirven para separar «servidor_herramienta». */
let mcpNamesPromise: Promise<string[]> | null = null
function useMcpServers(): string[] {
  const [names, setNames] = useState<string[]>([])
  useEffect(() => {
    let alive = true
    mcpNamesPromise ??= cw('cowork:mcp:list')
      .then((l) => l.map((m) => m.name))
      .catch(() => {
        mcpNamesPromise = null
        return []
      })
    void mcpNamesPromise.then((n) => alive && setNames(n))
    return () => {
      alive = false
    }
  }, [])
  return names
}

function useReply(request: PermissionRequest): { busy: boolean; error: string | null; answer: (r: Reply) => void } {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const answer = (reply: Reply): void => {
    setBusy(true)
    setError(null)
    // «Siempre» además guarda la regla en main para que valga al reabrir la carpeta.
    const call = reply === 'always' ? replyPermissionAlways(request) : replyPermission(request.id, reply)
    call.catch((err: unknown) => setError(errorMessage(err))).finally(() => setBusy(false))
  }
  return { busy, error, answer }
}

/** ¿Se ofrece «Siempre»? Oculto con la política `disableAlwaysAllow` o si nada de la petición se puede recordar. */
function useCanAlways(request: PermissionRequest, danger: boolean): boolean {
  const disable = useCowork((s) => s.policy?.disableAlwaysAllow === true)
  return showAlways({ danger, disableAlwaysAllow: disable, rememberableCount: rememberablePatterns(request).length })
}

function alwaysHint(p: PermissionRequest): string {
  const list = rememberablePatterns(p)
  return list.length > 0
    ? `No volverá a preguntar en esta carpeta para: ${list.join(', ')}. Puedes quitarlo en Ajustes.`
    : 'No volverá a preguntar por esto'
}

/** Tarjeta detallada dentro de la conversación (otra carpeta ⇒ `FolderRequestCard`). */
export function PermissionCard({ request }: { request: PermissionRequest }): React.JSX.Element | null {
  // Lote C: mientras el Modo auto está considerando esta petición (vía rápida), no se muestra
  // ninguna tarjeta; si no la aprueba, `autoPending` se limpia y vuelve a aparecer con normalidad.
  const autoPending = useCowork((s) => !!s.autoPending[request.id])
  if (autoPending) return null
  if (request.permission === 'external_directory') return <FolderRequestCard request={request} />
  return <GenericPermissionCard request={request} />
}

function GenericPermissionCard({ request }: { request: PermissionRequest }): React.JSX.Element {
  const servers = useMcpServers()
  const d = describePermission(request, servers)
  const { busy, error, answer } = useReply(request)
  const canAlways = useCanAlways(request, d.danger)
  const Icon = d.icon
  return (
    <div
      id={`perm-${request.id}`}
      tabIndex={-1}
      className={`rounded-xl border p-3.5 outline-none ${d.danger ? 'border-danger/40 bg-danger/5' : 'border-warning/40 bg-warning/5'}`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
            d.danger ? 'bg-danger/15 text-danger' : 'bg-warning/15 text-warning'
          }`}
        >
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{d.title}</p>
          <p className="mt-0.5 text-xs text-muted">{d.effect}</p>
          {d.detail && (
            <pre className="mt-2 max-h-40 overflow-auto rounded-md border border-border bg-code px-2.5 py-1.5 font-mono text-xs whitespace-pre-wrap">
              {d.detail}
            </pre>
          )}
          {d.detail && hasHiddenChars(d.detail) && (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs text-danger">
              <ShieldAlert size={13} className="mt-0.5 shrink-0" />
              Contiene caracteres de control o invisibles que no se muestran arriba. Revisa con cuidado antes de permitir.
            </p>
          )}
          {d.sections?.map((sec) => (
            <div key={sec.label} className="mt-2">
              <p className="text-[11px] font-medium text-subtle">{sec.label}</p>
              <pre className="mt-1 max-h-32 overflow-auto rounded-md border border-border bg-code px-2.5 py-1.5 font-mono text-xs whitespace-pre-wrap">
                {sec.text}
              </pre>
              {hasHiddenChars(sec.text) && (
                <p className="mt-1.5 flex items-start gap-1.5 text-xs text-danger">
                  <ShieldAlert size={13} className="mt-0.5 shrink-0" />
                  Contiene caracteres de control o invisibles que no se muestran arriba. Revisa con cuidado antes de permitir.
                </p>
              )}
            </div>
          ))}
          {d.aiDescription && (
            <div className="mt-2 rounded-md border border-border/70 bg-hover/40 px-2.5 py-1.5">
              <p className="text-[11px] font-medium text-subtle">Descripción del agente (no verificada)</p>
              <p className="mt-0.5 text-xs text-muted">{d.aiDescription}</p>
            </div>
          )}
          {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant={d.danger ? 'danger' : 'primary'} disabled={busy} onClick={() => answer('once')}>
              Permitir una vez
            </Button>
            {canAlways && (
              <Button disabled={busy} onClick={() => answer('always')} title={alwaysHint(request)}>
                Permitir siempre
              </Button>
            )}
            <Button variant="ghost" disabled={busy} onClick={() => answer('reject')}>
              Rechazar
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Barra fija sobre el compositor (la primera solicitud pendiente, sin contar las del Modo auto). */
export function ApprovalBar({ requests }: { requests: PermissionRequest[] }): React.JSX.Element | null {
  const autoPending = useCowork((s) => s.autoPending)
  const visible = requests.filter((r) => !autoPending[r.id])
  const first = visible[0]
  if (!first) return null
  return <ApprovalBarInner key={first.id} request={first} more={visible.length - 1} />
}

function ApprovalBarInner({ request, more }: { request: PermissionRequest; more: number }): React.JSX.Element {
  const servers = useMcpServers()
  const d = describePermission(request, servers)
  const { busy, error, answer } = useReply(request)
  const canAlways = useCanAlways(request, d.danger)
  const Icon = d.icon
  const review = (): void => {
    const el = document.getElementById(`perm-${request.id}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el?.focus({ preventScroll: true })
  }
  return (
    <div className="mx-auto mb-2 w-full max-w-3xl px-6">
      <div
        className={`flex items-center gap-3 rounded-xl border px-3 py-2 shadow-sm ${
          d.danger ? 'border-danger/50 bg-danger/10' : 'border-warning/50 bg-warning/10'
        }`}
      >
        <Icon size={16} className={`shrink-0 ${d.danger ? 'text-danger' : 'text-warning'}`} />
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          title="Ver detalles"
          onClick={review}
        >
          <span className="block truncate text-sm font-medium">
            {d.title}
            {more > 0 && <span className="ml-1.5 text-xs font-normal text-muted">+{more} más</span>}
          </span>
          <span className="block truncate font-mono text-[11px] text-muted">{error ?? d.detail}</span>
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          {d.kind === 'folder' ? (
            // Otra carpeta: hay que elegir carpeta y modo en la tarjeta; no hay «Permitir una vez» rápido.
            <Button variant="primary" className="!px-2.5 !py-1 text-xs" onClick={review}>
              Revisar
            </Button>
          ) : (
            <>
              <Button variant="ghost" className="!px-2 !py-1 text-xs" disabled={busy} onClick={() => answer('reject')}>
                Rechazar
              </Button>
              {canAlways && (
                <Button className="!px-2 !py-1 text-xs" disabled={busy} onClick={() => answer('always')} title={alwaysHint(request)}>
                  Siempre
                </Button>
              )}
              <Button
                variant={d.danger ? 'danger' : 'primary'}
                className="!px-2.5 !py-1 text-xs"
                disabled={busy}
                onClick={() => answer('once')}
              >
                Permitir una vez
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
