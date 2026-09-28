/**
 * Aprobaciones de Cowork: tarjeta detallada (en la conversación) y barra fija sobre el
 * compositor con "Permitir una vez / Siempre / Rechazar" y qué ocurrirá exactamente.
 */
import { useState } from 'react'
import type { PermissionRequest } from '@opencode-ai/sdk/v2/client'
import { FileEdit, FolderInput, Globe, Repeat, ShieldAlert, Terminal, Trash2, type LucideIcon } from 'lucide-react'
import { Button } from '../../../components/Button'
import { errorMessage } from '../../../lib/opencode'
import { replyPermission } from './actions'
import { computerToolInfo, computerToolKind } from './computer-tools'
import { baseName } from './util'

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
export function describePermission(p: PermissionRequest): Described {
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
      const dir = meta(p, 'filepath', 'filePath', 'path', 'parentDir') || patterns
      return {
        icon: FolderInput,
        title: 'El agente quiere acceder fuera de la carpeta',
        effect: 'Podrá leer (y en acceso total, modificar) archivos de esta ubicación, que no es la carpeta de la tarea.',
        detail: dir,
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

function useReply(request: PermissionRequest): { busy: boolean; error: string | null; answer: (r: Reply) => void } {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const answer = (reply: Reply): void => {
    setBusy(true)
    setError(null)
    replyPermission(request.id, reply)
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setBusy(false))
  }
  return { busy, error, answer }
}

function alwaysHint(p: PermissionRequest): string {
  const list = p.always.length > 0 ? p.always : p.patterns
  return list.length > 0 ? `No volverá a preguntar en esta sesión para: ${list.join(', ')}` : 'No volverá a preguntar por esto'
}

/** Tarjeta detallada dentro de la conversación. */
export function PermissionCard({ request }: { request: PermissionRequest }): React.JSX.Element {
  const d = describePermission(request)
  const { busy, error, answer } = useReply(request)
  const Icon = d.icon
  return (
    <div
      id={`perm-${request.id}`}
      className={`rounded-xl border p-3.5 ${d.danger ? 'border-danger/40 bg-danger/5' : 'border-amber-500/40 bg-amber-500/5'}`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
            d.danger ? 'bg-danger/15 text-danger' : 'bg-amber-500/15 text-amber-600 [[data-theme=dark]_&]:text-amber-400'
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
          {d.aiDescription && (
            <div className="mt-2 rounded-md border border-border/70 bg-hover/40 px-2.5 py-1.5">
              <p className="text-[10px] font-semibold tracking-wide text-subtle uppercase">Descripción de la IA (no verificada)</p>
              <p className="mt-0.5 text-xs text-muted">{d.aiDescription}</p>
            </div>
          )}
          {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant={d.danger ? 'danger' : 'primary'} disabled={busy} onClick={() => answer('once')}>
              Permitir una vez
            </Button>
            {!d.danger && (
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

/** Barra fija sobre el compositor (la primera solicitud pendiente). */
export function ApprovalBar({ requests }: { requests: PermissionRequest[] }): React.JSX.Element | null {
  const first = requests[0]
  if (!first) return null
  return <ApprovalBarInner key={first.id} request={first} more={requests.length - 1} />
}

function ApprovalBarInner({ request, more }: { request: PermissionRequest; more: number }): React.JSX.Element {
  const d = describePermission(request)
  const { busy, error, answer } = useReply(request)
  const Icon = d.icon
  return (
    <div className="mx-auto mb-2 w-full max-w-3xl px-6">
      <div
        className={`flex items-center gap-3 rounded-xl border px-3 py-2 shadow-sm ${
          d.danger ? 'border-danger/50 bg-danger/10' : 'border-amber-500/50 bg-amber-500/10'
        }`}
      >
        <Icon size={16} className={`shrink-0 ${d.danger ? 'text-danger' : 'text-amber-600 [[data-theme=dark]_&]:text-amber-400'}`} />
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          title="Ver detalles"
          onClick={() => document.getElementById(`perm-${request.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
        >
          <span className="block truncate text-sm font-medium">
            {d.title}
            {more > 0 && <span className="ml-1.5 text-xs font-normal text-muted">+{more} más</span>}
          </span>
          <span className="block truncate font-mono text-[11px] text-muted">{error ?? d.detail}</span>
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="ghost" className="!px-2 !py-1 text-xs" disabled={busy} onClick={() => answer('reject')}>
            Rechazar
          </Button>
          {!d.danger && (
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
        </div>
      </div>
    </div>
  )
}
